const fs = require('fs');
const path = require('path');
const { WorkerRunner } = require('./worker-runner.js');

class WorkerManager {
  /**
   * @param {import('./worker-task-store.js').WorkerTaskStore} store
   * @param {object} options
   * @param {number}  [options.concurrency=1]   - Max parallel workers
   * @param {number}  [options.pollInterval=5]   - Seconds between ticks
   * @param {number}  [options.timeout=600]      - Per-task timeout in seconds
   * @param {function} [options.onTaskEvent]     - Callback (type, data) => void
   * @param {object}  [options.runner]            - Pre-built WorkerRunner (for testing)
   */
  constructor(store, options = {}) {
    this.store = store;
    this.concurrency = options.concurrency ?? 1;
    this.pollInterval = options.pollInterval ?? 5;
    this.timeout = options.timeout ?? 10800;
    this.onTaskEvent = options.onTaskEvent ?? null;
    this.defaultModel = options.defaultModel ?? null;

    this.runner = options.runner ?? new WorkerRunner({ timeout: this.timeout });
    this.running = false;
    this._intervalRef = null;
    this._paused = false;

    // Initialize pool: array of N slots, each idle
    this.pool = [];
    for (let i = 0; i < this.concurrency; i++) {
      this.pool.push({ idle: true });
    }

    // Recover any tasks that were running (e.g. from a previous crash)
    this._recoverRunningTasks();

    // Read control file for initial pause/concurrency state
    this._readControlFile();
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  start() {
    this.running = true;

    // Write PID file
    const pidPath = path.join(this.store.baseDir, 'worker.pid');
    fs.writeFileSync(pidPath, String(process.pid), 'utf8');

    // Write initial control file
    this._writeControlFile({ paused: false, concurrency: this.concurrency });

    // Fire first tick immediately (not awaited)
    this.tick();

    // Schedule recurring ticks
    this._intervalRef = setInterval(() => {
      this.tick();
    }, this.pollInterval * 1000);
  }

  stop() {
    this.running = false;

    // Clear interval
    if (this._intervalRef) {
      clearInterval(this._intervalRef);
      this._intervalRef = null;
    }

    // Remove PID file
    const pidPath = path.join(this.store.baseDir, 'worker.pid');
    try {
      fs.unlinkSync(pidPath);
    } catch {
      // File may not exist
    }
  }

  // ─── Scheduler tick ───────────────────────────────────────────────────────

  async tick() {
    // Read control file for pause/concurrency updates
    this._readControlFile();
    if (this._paused) return; // Don't pick new tasks; in-flight tasks continue

    for (let i = 0; i < this.pool.length; i++) {
      if (!this.pool[i].idle) continue;

      const task = this.store.getNextPending();
      if (!task) break;

      await this._assignSlot(i, task);
    }
  }

  // ─── Slot assignment ──────────────────────────────────────────────────────

  async _assignSlot(slotIdx, task) {
    // Mark slot busy
    this.pool[slotIdx] = { idle: false, taskId: task.id };

    const startTime = Date.now();

    // Update task in store: running
    this.store.updateTask(task.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
      workerId: slotIdx,
    });

    this._emit('taskStarted', { taskId: task.id, slotIdx });

    try {
      // Resolve model config from profile name (fallback to daemon default)
      const modelConfig = this._resolveModelConfig(task.modelProfile || this.defaultModel);

      // Run the task
      const result = await this.runner.run(task, modelConfig);

      // Calculate duration
      result.durationMs = Date.now() - startTime;

      // Determine final status
      const finalStatus =
        result.exitCode === 0 && !result.isClaudeError
          ? 'completed'
          : 'failed';

      const completedAt = new Date().toISOString();

      // Update task in store with final status
      this.store.updateTask(task.id, {
        status: finalStatus,
        completedAt,
        result,
      });

      // Build completed task object and archive
      const completedTask = this.store.getById(task.id);
      this.store.archiveTask(completedTask);

      // Emit appropriate event
      if (finalStatus === 'completed') {
        this._emit('taskCompleted', {
          taskId: task.id,
          slotIdx,
          result,
        });
      } else {
        this._emit('taskFailed', {
          taskId: task.id,
          slotIdx,
          result,
        });
      }
    } catch (err) {
      // Runner threw an unexpected error
      const result = {
        exitCode: -1,
        stdout: '',
        stderr: err.message,
        durationMs: Date.now() - startTime,
        isClaudeError: false,
        claudeResult: null,
        totalCostUsd: null,
      };

      const completedAt = new Date().toISOString();

      this.store.updateTask(task.id, {
        status: 'failed',
        completedAt,
        result,
      });

      const completedTask = this.store.getById(task.id);
      this.store.archiveTask(completedTask);

      this._emit('taskFailed', {
        taskId: task.id,
        slotIdx,
        result,
        error: err.message,
      });
    } finally {
      // Free the slot
      this.pool[slotIdx] = { idle: true };
    }
  }

  // ─── Model config resolution ─────────────────────────────────────────────

  _resolveModelConfig(profileName) {
    if (!profileName) return null;

    const modelsPath = path.join(this.store.baseDir, 'models.json');
    try {
      const raw = fs.readFileSync(modelsPath, 'utf8');
      const data = JSON.parse(raw);
      const profiles = data.profiles || data.models || [];
      const profile = profiles.find(p => p.name === profileName);
      if (!profile) return null;
      return {
        model: profile.model,
        apiKey: profile.apiKey,
        apiBaseUrl: profile.apiBaseUrl,
      };
    } catch {
      return null;
    }
  }

  // ─── Recovery ─────────────────────────────────────────────────────────────

  _recoverRunningTasks() {
    const active = this.store.getActiveTasks();
    for (const task of active) {
      if (task.status === 'running') {
        this.store.updateTask(task.id, {
          status: 'pending',
          // Clear running-specific fields by setting to undefined
          startedAt: undefined,
          workerId: undefined,
        });
      }
    }
  }

  // ─── Control file ───────────────────────────────────────────────────────

  _getControlPath() {
    return path.join(this.store.baseDir, 'worker-control.json');
  }

  _readControlFile() {
    try {
      const data = JSON.parse(fs.readFileSync(this._getControlPath(), 'utf8'));
      if (data.paused !== undefined) this._paused = !!data.paused;
      if (typeof data.concurrency === 'number' && data.concurrency > 0) {
        this._adjustConcurrency(data.concurrency);
      }
    } catch {
      // File not found or invalid — keep current state
    }
  }

  _writeControlFile(updates) {
    const controlPath = this._getControlPath();
    let existing = {};
    try { existing = JSON.parse(fs.readFileSync(controlPath, 'utf8')); } catch {}
    Object.assign(existing, updates);
    fs.writeFileSync(controlPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');
  }

  _adjustConcurrency(n) {
    if (n === this.pool.length) return;
    if (n > this.pool.length) {
      while (this.pool.length < n) this.pool.push({ idle: true });
    } else {
      // Shrink — only remove idle slots from the end
      while (this.pool.length > n) {
        const lastIdle = this.pool.findLastIndex(s => s.idle);
        if (lastIdle === -1) break; // All busy, can't shrink further
        this.pool.splice(lastIdle, 1);
      }
    }
    this.concurrency = this.pool.length;
  }

  // ─── Event emission helper ────────────────────────────────────────────────

  _emit(type, data) {
    if (this.onTaskEvent) {
      this.onTaskEvent(type, data);
    }
  }
}

module.exports = { WorkerManager };
