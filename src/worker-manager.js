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
    this.timeout = options.timeout ?? 600;
    this.onTaskEvent = options.onTaskEvent ?? null;

    this.runner = options.runner ?? new WorkerRunner({ timeout: this.timeout });
    this.running = false;
    this._intervalRef = null;

    // Initialize pool: array of N slots, each idle
    this.pool = [];
    for (let i = 0; i < this.concurrency; i++) {
      this.pool.push({ idle: true });
    }

    // Recover any tasks that were running (e.g. from a previous crash)
    this._recoverRunningTasks();
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  start() {
    this.running = true;

    // Write PID file
    const pidPath = path.join(this.store.baseDir, 'worker.pid');
    fs.writeFileSync(pidPath, String(process.pid), 'utf8');

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
      // Resolve model config from profile name
      const modelConfig = this._resolveModelConfig(task.modelProfile);

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

  // ─── Event emission helper ────────────────────────────────────────────────

  _emit(type, data) {
    if (this.onTaskEvent) {
      this.onTaskEvent(type, data);
    }
  }
}

module.exports = { WorkerManager };
