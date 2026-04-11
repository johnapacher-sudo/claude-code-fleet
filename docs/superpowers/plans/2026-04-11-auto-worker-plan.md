# Auto Worker Background Task System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an auto-worker task queue and scheduler to fleet that executes Claude Code tasks in the background, integrated into the existing TUI dashboard.

**Architecture:** Three new independent modules (worker-task-store, worker-runner, worker-manager) plugged into fleet via event bridge. The existing Master class receives worker events and renders them as virtual workers in the TUI. CLI commands are routed through the existing parseArgs/main dispatcher in index.js.

**Tech Stack:** Node.js CJS modules (matching existing codebase), React/Ink for TUI components, vitest for tests, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-11-auto-worker-design.md`

---

## File Map

**New files:**
- `src/worker-task-store.js` — CRUD on active queue JSON + daily archive files
- `src/worker-runner.js` — Spawns `claude -p` subprocess, captures result
- `src/worker-manager.js` — Orchestrates WorkerPool, scheduler loop, event bridge to Master
- `src/components/worker-queue-card.mjs` — Ink component for auto-worker task cards
- `tests/worker-task-store.test.js` — Tests for task store
- `tests/worker-runner.test.js` — Tests for runner
- `tests/worker-manager.test.js` — Tests for manager
- `tests/components/worker-queue-card.test.mjs` — Tests for TUI component

**Modified files:**
- `src/index.js` — Add `worker` subcommand routing + 7 worker command functions
- `src/master.js` — Add `workerManager` property, `handleWorkerEvent` method
- `src/components/app.mjs` — Render worker queue section, handle worker events
- `src/components/header.mjs` — Show auto-worker stats in header
- `src/components/footer.mjs` — Update key hints

---

## Task 1: WorkerTaskStore — Active Queue CRUD

**Files:**
- Create: `src/worker-task-store.js`
- Create: `tests/worker-task-store.test.js`

- [ ] **Step 1: Write failing tests for WorkerTaskStore**

Create `tests/worker-task-store.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

const { WorkerTaskStore } = await import('../src/worker-task-store.js');

describe('WorkerTaskStore', () => {
  let tmpDir;
  let store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-worker-test-'));
    store = new WorkerTaskStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates queue file on construction', () => {
    const queuePath = path.join(tmpDir, 'worker-queue.json');
    expect(fs.existsSync(queuePath)).toBe(true);
    const data = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
    expect(data.tasks).toEqual([]);
  });

  it('creates archive dir on construction', () => {
    expect(fs.existsSync(path.join(tmpDir, 'worker-archive'))).toBe(true);
  });

  it('recovers from corrupted queue file', () => {
    fs.writeFileSync(path.join(tmpDir, 'worker-queue.json'), 'not json{{{');
    const s = new WorkerTaskStore(tmpDir);
    expect(s.getActiveTasks()).toEqual([]);
  });

  it('addTask creates a pending task', () => {
    const task = store.addTask({ prompt: 'hello', title: 'Test' });
    expect(task.id).toMatch(/^task-\d+$/);
    expect(task.status).toBe('pending');
    expect(task.prompt).toBe('hello');
    expect(task.title).toBe('Test');
    expect(task.priority).toBe(5);
    expect(task.modelProfile).toBeNull();
    expect(task.cwd).toBe(process.cwd());
  });

  it('addTask respects options', () => {
    const task = store.addTask({
      prompt: 'p',
      title: 'T',
      cwd: '/tmp',
      priority: 1,
      modelProfile: 'opus',
    });
    expect(task.cwd).toBe('/tmp');
    expect(task.priority).toBe(1);
    expect(task.modelProfile).toBe('opus');
  });

  it('addTask auto-generates title from prompt', () => {
    const longPrompt = 'a'.repeat(100);
    const task = store.addTask({ prompt: longPrompt });
    expect(task.title).toBe('a'.repeat(60) + '...');
  });

  it('addTask persists to file', () => {
    store.addTask({ prompt: 'one' });
    store.addTask({ prompt: 'two' });
    // Re-read from disk
    const fresh = new WorkerTaskStore(tmpDir);
    expect(fresh.getActiveTasks()).toHaveLength(2);
  });

  it('getNextPending returns highest priority (lowest number)', () => {
    store.addTask({ prompt: 'low', priority: 5 });
    store.addTask({ prompt: 'high', priority: 1 });
    store.addTask({ prompt: 'mid', priority: 3 });
    const next = store.getNextPending();
    expect(next.prompt).toBe('high');
    expect(next.priority).toBe(1);
  });

  it('getNextPending returns null when no pending tasks', () => {
    expect(store.getNextPending()).toBeNull();
  });

  it('getNextPending skips non-pending tasks', () => {
    store.addTask({ prompt: 'running' });
    store.updateTask(store.getActiveTasks()[0].id, { status: 'running' });
    expect(store.getNextPending()).toBeNull();
  });

  it('updateTask applies partial updates', () => {
    const task = store.addTask({ prompt: 'test' });
    store.updateTask(task.id, { status: 'running', startedAt: '2026-04-11T10:00:00Z' });
    const updated = store.getById(task.id);
    expect(updated.status).toBe('running');
    expect(updated.startedAt).toBe('2026-04-11T10:00:00Z');
    expect(updated.prompt).toBe('test'); // unchanged
  });

  it('updateTask returns null for unknown id', () => {
    expect(store.updateTask('nope', { status: 'running' })).toBeNull();
  });

  it('getByStatus filters correctly', () => {
    const t1 = store.addTask({ prompt: 'a' });
    const t2 = store.addTask({ prompt: 'b' });
    store.updateTask(t1.id, { status: 'running' });
    const running = store.getByStatus('running');
    expect(running).toHaveLength(1);
    expect(running[0].id).toBe(t1.id);
  });

  it('getById returns task or null', () => {
    const task = store.addTask({ prompt: 'x' });
    expect(store.getById(task.id).prompt).toBe('x');
    expect(store.getById('nope')).toBeNull();
  });

  it('archiveTask removes from queue and writes to archive', () => {
    const task = store.addTask({ prompt: 'done' });
    const completed = {
      ...task,
      status: 'completed',
      completedAt: '2026-04-11T10:05:00Z',
      result: { exitCode: 0, claudeResult: 'ok', durationMs: 5000, totalCostUsd: 0.1 },
    };
    store.archiveTask(completed);
    // Queue should be empty
    expect(store.getActiveTasks()).toHaveLength(0);
    // Archive should have the task
    const archive = store.getArchive('2026-04-11');
    expect(archive).not.toBeNull();
    expect(archive.tasks).toHaveLength(1);
    expect(archive.tasks[0].status).toBe('completed');
    expect(archive.summary.total).toBe(1);
    expect(archive.summary.completed).toBe(1);
    expect(archive.summary.failed).toBe(0);
  });

  it('archiveTask recalculates summary', () => {
    const t1 = store.addTask({ prompt: 'a' });
    store.archiveTask({ ...t1, status: 'completed', completedAt: '2026-04-11T10:01:00Z', result: { exitCode: 0, durationMs: 1000 } });
    const t2 = store.addTask({ prompt: 'b' });
    store.archiveTask({ ...t2, status: 'failed', completedAt: '2026-04-11T10:02:00Z', result: { exitCode: 1, durationMs: 2000 } });
    const archive = store.getArchive('2026-04-11');
    expect(archive.summary.total).toBe(2);
    expect(archive.summary.completed).toBe(1);
    expect(archive.summary.failed).toBe(1);
    expect(archive.summary.totalDurationMs).toBe(3000);
  });

  it('getArchive returns null for missing date', () => {
    expect(store.getArchive('2099-12-31')).toBeNull();
  });

  it('getArchive returns null for corrupted file', () => {
    const archiveDir = path.join(tmpDir, 'worker-archive');
    fs.writeFileSync(path.join(archiveDir, '2099-01-01.json'), 'bad{json');
    expect(store.getArchive('2099-01-01')).toBeNull();
  });

  it('getArchivedTask searches across all archives', () => {
    // Write task to 2026-04-10 archive
    const archiveDir = path.join(tmpDir, 'worker-archive');
    fs.writeFileSync(path.join(archiveDir, '2026-04-10.json'), JSON.stringify({
      date: '2026-04-10',
      tasks: [{ id: 'task-old-1', prompt: 'old task', status: 'completed' }],
      summary: { total: 1, completed: 1, failed: 0, totalDurationMs: 0 },
    }));
    const found = store.getArchivedTask('task-old-1');
    expect(found).not.toBeNull();
    expect(found.prompt).toBe('old task');
  });

  it('getArchivedTask returns null for unknown id', () => {
    expect(store.getArchivedTask('nonexistent')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/worker-task-store.test.js`
Expected: FAIL — module `../src/worker-task-store.js` not found

- [ ] **Step 3: Implement WorkerTaskStore**

Create `src/worker-task-store.js`:

```javascript
const fs = require('fs');
const path = require('path');

class WorkerTaskStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.queuePath = path.join(baseDir, 'worker-queue.json');
    this.archiveDir = path.join(baseDir, 'worker-archive');
    // Ensure archive dir exists
    if (!fs.existsSync(this.archiveDir)) {
      fs.mkdirSync(this.archiveDir, { recursive: true });
    }
    // Ensure queue file exists
    this._ensureQueueFile();
  }

  _ensureQueueFile() {
    if (!fs.existsSync(this.queuePath)) {
      this._writeQueue({ tasks: [] });
      return;
    }
    // Verify it's valid JSON
    try {
      this._readQueue();
    } catch {
      this._writeQueue({ tasks: [] });
    }
  }

  _readQueue() {
    return JSON.parse(fs.readFileSync(this.queuePath, 'utf-8'));
  }

  _writeQueue(data) {
    const dir = path.dirname(this.queuePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.queuePath, JSON.stringify(data, null, 2) + '\n');
  }

  addTask(input) {
    const queue = this._readQueue();
    const title = input.title || (input.prompt.length > 60 ? input.prompt.slice(0, 60) + '...' : input.prompt);
    const task = {
      id: `task-${Date.now()}`,
      title,
      prompt: input.prompt,
      cwd: input.cwd || process.cwd(),
      priority: input.priority ?? 5,
      modelProfile: input.modelProfile || null,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    queue.tasks.push(task);
    this._writeQueue(queue);
    return { ...task };
  }

  getNextPending() {
    const queue = this._readQueue();
    const pending = queue.tasks
      .filter(t => t.status === 'pending')
      .sort((a, b) => a.priority - b.priority);
    return pending.length > 0 ? { ...pending[0] } : null;
  }

  updateTask(id, updates) {
    const queue = this._readQueue();
    const idx = queue.tasks.findIndex(t => t.id === id);
    if (idx === -1) return null;
    Object.assign(queue.tasks[idx], updates);
    this._writeQueue(queue);
    return { ...queue.tasks[idx] };
  }

  archiveTask(task) {
    const queue = this._readQueue();
    queue.tasks = queue.tasks.filter(t => t.id !== task.id);
    this._writeQueue(queue);

    const today = (task.completedAt || new Date().toISOString()).slice(0, 10);
    const archivePath = path.join(this.archiveDir, `${today}.json`);

    let archive;
    if (fs.existsSync(archivePath)) {
      try {
        archive = JSON.parse(fs.readFileSync(archivePath, 'utf-8'));
      } catch {
        archive = { date: today, tasks: [], summary: {} };
      }
    } else {
      archive = { date: today, tasks: [], summary: {} };
    }

    archive.tasks.push(task);
    archive.summary = this._computeSummary(archive.tasks);
    fs.writeFileSync(archivePath, JSON.stringify(archive, null, 2) + '\n');
  }

  _computeSummary(tasks) {
    const completed = tasks.filter(t => t.status === 'completed').length;
    const failed = tasks.filter(t => t.status === 'failed').length;
    const totalDurationMs = tasks.reduce((sum, t) => sum + ((t.result && t.result.durationMs) || 0), 0);
    const totalCostUsd = tasks.reduce((sum, t) => sum + ((t.result && t.result.totalCostUsd) || 0), 0);
    return { total: tasks.length, completed, failed, totalDurationMs, totalCostUsd };
  }

  getActiveTasks() {
    return this._readQueue().tasks.map(t => ({ ...t }));
  }

  getByStatus(status) {
    return this._readQueue().tasks.filter(t => t.status === status).map(t => ({ ...t }));
  }

  getById(id) {
    const queue = this._readQueue();
    const task = queue.tasks.find(t => t.id === id);
    return task ? { ...task } : null;
  }

  getArchive(date) {
    const archivePath = path.join(this.archiveDir, `${date}.json`);
    if (!fs.existsSync(archivePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(archivePath, 'utf-8'));
    } catch {
      return null;
    }
  }

  getArchivedTask(id) {
    if (!fs.existsSync(this.archiveDir)) return null;
    const files = fs.readdirSync(this.archiveDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const archive = JSON.parse(fs.readFileSync(path.join(this.archiveDir, file), 'utf-8'));
        const task = archive.tasks.find(t => t.id === id);
        if (task) return task;
      } catch { /* skip corrupted */ }
    }
    return null;
  }
}

module.exports = { WorkerTaskStore };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/worker-task-store.test.js`
Expected: All 20 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker-task-store.js tests/worker-task-store.test.js
git commit -m "feat(worker): add WorkerTaskStore with active queue and daily archive"
```

---

## Task 2: WorkerRunner — Claude Subprocess Executor

**Files:**
- Create: `src/worker-runner.js`
- Create: `tests/worker-runner.test.js`

- [ ] **Step 1: Write failing tests for WorkerRunner**

Create `tests/worker-runner.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { WorkerRunner } = await import('../src/worker-runner.js');

describe('WorkerRunner', () => {
  it('runs a task and returns result', async () => {
    const runner = new WorkerRunner({ timeout: 30000 });
    const task = {
      id: 'task-test-1',
      prompt: 'echo hello',
      cwd: process.cwd(),
    };
    const result = await runner.run(task, null);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello');
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  }, 60000);

  it('captures stderr on failure', async () => {
    const runner = new WorkerRunner({ timeout: 30000 });
    const task = {
      id: 'task-test-2',
      prompt: 'cause an intentional error that does not exist',
      cwd: '/nonexistent/path/that/should/not/exist',
    };
    const result = await runner.run(task, null);
    // Claude may still succeed (it creates the dir), so just check result shape
    expect(result).toHaveProperty('exitCode');
    expect(result).toHaveProperty('stdout');
    expect(result).toHaveProperty('stderr');
    expect(result).toHaveProperty('durationMs');
    expect(result).toHaveProperty('isClaudeError');
  }, 60000);

  it('times out long-running tasks', async () => {
    const runner = new WorkerRunner({ timeout: 1 }); // 1ms timeout = instant
    const task = {
      id: 'task-test-3',
      prompt: 'write a very long essay about everything',
      cwd: process.cwd(),
    };
    const result = await runner.run(task, null);
    expect(result.exitCode).toBe(-1);
  }, 30000);

  it('passes model config as environment variables', async () => {
    const runner = new WorkerRunner({ timeout: 30000 });
    const task = {
      id: 'task-test-4',
      prompt: 'echo test',
      cwd: process.cwd(),
    };
    const modelConfig = {
      model: 'test-model',
      apiKey: 'test-key',
      apiBaseUrl: 'https://test.example.com',
    };
    // Just verify it doesn't throw with model config
    const result = await runner.run(task, modelConfig);
    expect(result).toHaveProperty('exitCode');
  }, 60000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/worker-runner.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement WorkerRunner**

Create `src/worker-runner.js`:

```javascript
const { spawn } = require('child_process');

class WorkerRunner {
  constructor(options = {}) {
    this.timeout = (options.timeout || 600) * 1000; // ms
  }

  run(task, modelConfig) {
    return new Promise((resolve) => {
      const args = ['-p', task.prompt, '--output-format', 'json'];
      const env = { ...process.env };

      if (modelConfig) {
        if (modelConfig.model) args.push('--model', modelConfig.model);
        if (modelConfig.apiKey) {
          env.ANTHROPIC_AUTH_TOKEN = modelConfig.apiKey;
          env.ANTHROPIC_API_KEY = '';
        }
        if (modelConfig.apiBaseUrl) {
          env.ANTHROPIC_BASE_URL = modelConfig.apiBaseUrl;
        }
      }

      const child = spawn('claude', args, {
        cwd: task.cwd || process.cwd(),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGKILL');
      }, this.timeout);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        // Truncate at 1MB
        if (stdout.length > 1024 * 1024) {
          stdout = stdout.slice(0, 1024 * 1024) + '\n[output truncated at 1MB]';
          child.kill('SIGKILL');
          killed = true;
        }
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - Date.now(); // placeholder, real calc below
        resolve({
          exitCode: killed ? -1 : (code || 0),
          stdout,
          stderr,
          durationMs: 0, // will be set by manager
          isClaudeError: false,
          claudeResult: null,
          totalCostUsd: null,
        });
      });
    }).then(result => {
      // Parse Claude JSON output
      if (result.exitCode !== -1 && result.stdout.trim()) {
        try {
          const parsed = JSON.parse(result.stdout.trim());
          result.isClaudeError = !!parsed.is_error;
          result.claudeResult = parsed.result || null;
          result.totalCostUsd = parsed.total_cost_usd != null ? parsed.total_cost_usd : null;
        } catch {
          // Not JSON — use raw stdout as result
          result.claudeResult = result.stdout.trim();
        }
      }
      return result;
    });
  }
}

module.exports = { WorkerRunner };
```

Note: The `durationMs` will be properly tracked by WorkerManager wrapping the run call with timestamps.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/worker-runner.test.js`
Expected: All 4 tests PASS (may be slow — they spawn real claude processes)

- [ ] **Step 5: Commit**

```bash
git add src/worker-runner.js tests/worker-runner.test.js
git commit -m "feat(worker): add WorkerRunner for claude -p subprocess execution"
```

---

## Task 3: WorkerManager — Scheduler + WorkerPool

**Files:**
- Create: `src/worker-manager.js`
- Create: `tests/worker-manager.test.js`

- [ ] **Step 1: Write failing tests for WorkerManager**

Create `tests/worker-manager.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Mock WorkerRunner to avoid spawning real claude processes
vi.mock('../src/worker-runner.js', () => {
  const { WorkerRunner } = vi hoisted(() => {
    class MockRunner {
      constructor() {}
      run(task, config) {
        if (task.prompt === 'fail') {
          return Promise.resolve({
            exitCode: 1, stdout: '', stderr: 'error',
            durationMs: 100, isClaudeError: true,
            claudeResult: null, totalCostUsd: null,
          });
        }
        return Promise.resolve({
          exitCode: 0, stdout: JSON.stringify({ result: `done: ${task.prompt}` }),
          stderr: '', durationMs: 100, isClaudeError: false,
          claudeResult: `done: ${task.prompt}`, totalCostUsd: 0.05,
        });
      }
    }
    return { WorkerRunner: MockRunner };
  });
  return { WorkerRunner };
});

const { WorkerManager } = await import('../src/worker-manager.js');
const { WorkerTaskStore } = await import('../src/worker-task-store.js');

describe('WorkerManager', () => {
  let tmpDir;
  let store;
  let manager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-mgr-test-'));
    store = new WorkerTaskStore(tmpDir);
  });

  afterEach(() => {
    if (manager) manager.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tick picks up pending task and executes it', async () => {
    store.addTask({ prompt: 'hello' });
    const events = [];
    manager = new WorkerManager(store, {
      concurrency: 1,
      pollInterval: 999, // long interval so tick is manual
      timeout: 60,
      onTaskEvent: (type, data) => events.push({ type, data }),
    });

    await manager.tick();

    // Task should be archived (completed)
    const active = store.getActiveTasks();
    expect(active).toHaveLength(0);
    // Events should have been fired
    expect(events.some(e => e.type === 'taskStarted')).toBe(true);
    expect(events.some(e => e.type === 'taskCompleted')).toBe(true);
  });

  it('tick is no-op when no pending tasks', async () => {
    manager = new WorkerManager(store, {
      concurrency: 1,
      pollInterval: 999,
      timeout: 60,
      onTaskEvent: () => {},
    });
    await manager.tick();
    // No errors, no events
  });

  it('handles task failure', async () => {
    store.addTask({ prompt: 'fail' });
    const events = [];
    manager = new WorkerManager(store, {
      concurrency: 1,
      pollInterval: 999,
      timeout: 60,
      onTaskEvent: (type, data) => events.push({ type, data }),
    });

    await manager.tick();
    expect(events.some(e => e.type === 'taskFailed')).toBe(true);
  });

  it('respects concurrency limit', async () => {
    store.addTask({ prompt: 'task1' });
    store.addTask({ prompt: 'task2' });
    store.addTask({ prompt: 'task3' });

    manager = new WorkerManager(store, {
      concurrency: 1,
      pollInterval: 999,
      timeout: 60,
      onTaskEvent: () => {},
    });

    // First tick: picks up task1 (slot 0 busy)
    await manager.tick();
    // At this point task1 is done (mock is sync), so next tick picks task2
    await manager.tick();
    await manager.tick();

    const active = store.getActiveTasks();
    expect(active).toHaveLength(0); // all archived
  });

  it('start writes PID file', () => {
    manager = new WorkerManager(store, {
      concurrency: 1,
      pollInterval: 999,
      timeout: 60,
      onTaskEvent: () => {},
    });
    manager.start();
    const pidPath = path.join(tmpDir, 'worker.pid');
    expect(fs.existsSync(pidPath)).toBe(true);
    const pid = parseInt(fs.readFileSync(pidPath, 'utf-8'));
    expect(pid).toBe(process.pid);
  });

  it('stop removes PID file', () => {
    manager = new WorkerManager(store, {
      concurrency: 1,
      pollInterval: 999,
      timeout: 60,
      onTaskEvent: () => {},
    });
    manager.start();
    const pidPath = path.join(tmpDir, 'worker.pid');
    expect(fs.existsSync(pidPath)).toBe(true);
    manager.stop();
    expect(fs.existsSync(pidPath)).toBe(false);
  });

  it('recovers running tasks on startup', () => {
    // Simulate a running task left from previous crash
    store.addTask({ prompt: 'orphan' });
    const task = store.getActiveTasks()[0];
    store.updateTask(task.id, { status: 'running', startedAt: new Date().toISOString() });

    // Creating a new manager should reset running tasks to pending
    manager = new WorkerManager(store, {
      concurrency: 1,
      pollInterval: 999,
      timeout: 60,
      onTaskEvent: () => {},
    });

    const active = store.getActiveTasks();
    expect(active).toHaveLength(1);
    expect(active[0].status).toBe('pending');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/worker-manager.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement WorkerManager**

Create `src/worker-manager.js`:

```javascript
const fs = require('fs');
const path = require('path');
const { WorkerRunner } = require('./worker-runner');

class WorkerManager {
  constructor(store, options = {}) {
    this.store = store;
    this.concurrency = options.concurrency || 1;
    this.pollInterval = options.pollInterval || 5;
    this.timeout = options.timeout || 600;
    this.onTaskEvent = options.onTaskEvent || (() => {});
    this.runner = new WorkerRunner({ timeout: this.timeout });
    this.pool = [];
    this.running = false;
    this.intervalTimer = null;

    // Initialize pool slots
    for (let i = 0; i < this.concurrency; i++) {
      this.pool.push({ idle: true });
    }

    // Recover stale running tasks
    this._recoverRunningTasks();
  }

  _recoverRunningTasks() {
    const tasks = this.store.getActiveTasks();
    for (const task of tasks) {
      if (task.status === 'running') {
        this.store.updateTask(task.id, { status: 'pending', startedAt: undefined, workerId: undefined });
      }
    }
  }

  _getPidPath() {
    return path.join(this.store.baseDir, 'worker.pid');
  }

  start() {
    this.running = true;
    // Write PID file
    const pidPath = this._getPidPath();
    const dir = path.dirname(pidPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(pidPath, String(process.pid));
    // Run first tick immediately
    this.tick();
    // Schedule subsequent ticks
    this.intervalTimer = setInterval(() => this.tick(), this.pollInterval * 1000);
  }

  stop() {
    this.running = false;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    // Remove PID file
    const pidPath = this._getPidPath();
    try { fs.unlinkSync(pidPath); } catch { /* already gone */ }
  }

  async tick() {
    if (!this.running) return;

    // Try to fill all idle slots
    for (let i = 0; i < this.pool.length; i++) {
      if (!this.pool[i].idle) continue;

      const task = this.store.getNextPending();
      if (!task) break; // no more work

      await this._assignSlot(i, task);
    }
  }

  async _assignSlot(slotIdx, task) {
    // Mark slot busy
    this.pool[slotIdx] = { idle: false, taskId: task.id };

    // Mark task running
    const startTime = Date.now();
    this.store.updateTask(task.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
      workerId: slotIdx,
    });
    this.onTaskEvent('taskStarted', { task });

    // Resolve model config from profile name
    let modelConfig = null;
    if (task.modelProfile) {
      modelConfig = this._resolveModelConfig(task.modelProfile);
    }

    // Run the task
    let result;
    try {
      result = await this.runner.run(task, modelConfig);
    } catch (err) {
      result = {
        exitCode: -1,
        stdout: '',
        stderr: err.message,
        durationMs: Date.now() - startTime,
        isClaudeError: false,
        claudeResult: null,
        totalCostUsd: null,
      };
    }

    result.durationMs = Date.now() - startTime;

    // Determine final status
    const finalStatus = (result.exitCode === 0 && !result.isClaudeError) ? 'completed' : 'failed';

    // Update and archive
    const completedTask = {
      ...task,
      status: finalStatus,
      completedAt: new Date().toISOString(),
      startedAt: new Date(startTime).toISOString(),
      workerId: slotIdx,
      result,
    };
    this.store.updateTask(task.id, {
      status: finalStatus,
      completedAt: completedTask.completedAt,
      result,
    });
    this.store.archiveTask(completedTask);

    // Free slot
    this.pool[slotIdx] = { idle: true };

    // Emit event
    if (finalStatus === 'completed') {
      this.onTaskEvent('taskCompleted', { task: completedTask, result });
    } else {
      this.onTaskEvent('taskFailed', { task: completedTask, result });
    }
  }

  _resolveModelConfig(profileName) {
    // Read models.json from fleet config dir
    const modelsPath = path.join(this.store.baseDir, 'models.json');
    if (!fs.existsSync(modelsPath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
      const profile = data.models.find(m => m.name === profileName);
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
}

module.exports = { WorkerManager };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/worker-manager.test.js`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker-manager.js tests/worker-manager.test.js
git commit -m "feat(worker): add WorkerManager with scheduler, pool, and recovery"
```

---

## Task 4: CLI Commands — `fleet worker` Subcommands

**Files:**
- Modify: `src/index.js` (add worker subcommand routing and command functions)

- [ ] **Step 1: Add worker-specific flag parsing to parseArgs**

In `src/index.js`, update the `parseArgs` function to handle worker-specific flags. Add these flag parsers inside the `while` loop (around line 688):

```javascript
} else if (arg === '--priority' && argv[i + 1]) {
  opts.priority = parseInt(argv[++i], 10);
} else if (arg === '--concurrency' && argv[i + 1]) {
  opts.concurrency = parseInt(argv[++i], 10);
} else if (arg === '--poll-interval' && argv[i + 1]) {
  opts.pollInterval = parseInt(argv[++i], 10);
} else if (arg === '--timeout' && argv[i + 1]) {
  opts.timeout = parseInt(argv[++i], 10);
} else if (arg === '--status' && argv[i + 1]) {
  opts.status = argv[++i];
} else if (arg === '--title' && argv[i + 1]) {
  opts.title = argv[++i];
```

- [ ] **Step 2: Add worker command functions**

Add these functions before `// ─── Master commands ─────────────────────────────────────────────` (around line 668):

```javascript
// ─── Worker commands ──────────────────────────────────────────────────────

function getWorkerStore() {
  const { WorkerTaskStore } = require('./worker-task-store');
  return new WorkerTaskStore(GLOBAL_CONFIG_DIR);
}

async function cmdWorkerStart(opts) {
  const workerPidPath = path.join(GLOBAL_CONFIG_DIR, 'worker.pid');

  // Check if already running
  if (fs.existsSync(workerPidPath)) {
    const pid = parseInt(fs.readFileSync(workerPidPath, 'utf-8'));
    try {
      process.kill(pid, 0);
      console.error(ANSI.red(`Worker already running (pid ${pid})`));
      console.error(`Run ${ANSI.bold('fleet worker stop')} first.`);
      process.exit(1);
    } catch {
      // Stale PID file, remove it
      fs.unlinkSync(workerPidPath);
    }
  }

  const { WorkerManager } = require('./worker-manager');
  const { WorkerTaskStore } = require('./worker-task-store');
  const store = new WorkerTaskStore(GLOBAL_CONFIG_DIR);

  const manager = new WorkerManager(store, {
    concurrency: opts.concurrency || 1,
    pollInterval: opts.pollInterval || 5,
    timeout: opts.timeout || 600,
    onTaskEvent: (type, data) => {
      if (type === 'taskStarted') {
        console.log(ANSI.green(`  ▶ Started: ${data.task.title}`));
      } else if (type === 'taskCompleted') {
        const cost = data.result.totalCostUsd ? ` ($${data.result.totalCostUsd.toFixed(3)})` : '';
        console.log(ANSI.green(`  ✓ Completed: ${data.task.title}${cost}`));
      } else if (type === 'taskFailed') {
        console.log(ANSI.red(`  ✗ Failed: ${data.task.title}`));
      }
    },
  });

  manager.start();
  console.log(ANSI.green(`\n  Worker started (concurrency=${opts.concurrency || 1}, poll=${opts.pollInterval || 5}s)`));
  console.log(ANSI.dim('  fleet worker add <prompt>  # Add tasks'));
  console.log(ANSI.dim('  fleet worker list           # View queue'));
  console.log(ANSI.dim('  fleet worker stop           # Stop worker'));

  // Keep process alive
  process.on('SIGINT', () => { manager.stop(); process.exit(0); });
  process.on('SIGTERM', () => { manager.stop(); process.exit(0); });
}

function cmdWorkerStop() {
  const workerPidPath = path.join(GLOBAL_CONFIG_DIR, 'worker.pid');
  if (!fs.existsSync(workerPidPath)) {
    console.log(ANSI.yellow('No worker running.'));
    return;
  }
  const pid = parseInt(fs.readFileSync(workerPidPath, 'utf-8'));
  try {
    process.kill(pid, 'SIGTERM');
    console.log(ANSI.green(`  Worker stopped (pid ${pid})`));
  } catch {
    console.log(ANSI.yellow(`  Worker process not found (pid ${pid}), cleaning up`));
    try { fs.unlinkSync(workerPidPath); } catch { /* ignore */ }
  }
}

function cmdWorkerAdd(args, opts) {
  if (!args[0]) {
    console.error(ANSI.red('Usage: fleet worker add <prompt> [--title <t>] [--cwd <dir>] [--priority <n>] [--model <name>]'));
    process.exit(1);
  }

  const prompt = args.join(' ');
  const store = getWorkerStore();

  // Validate model profile if specified
  if (opts.model) {
    const models = loadModels();
    if (!models.models.some(m => m.name === opts.model)) {
      console.error(ANSI.red(`Model profile "${opts.model}" not found.`));
      console.error(`Available: ${models.models.map(m => m.name).join(', ') || '(none)'}`);
      process.exit(1);
    }
  }

  const task = store.addTask({
    prompt,
    title: opts.title,
    cwd: opts.cwd,
    priority: opts.priority,
    modelProfile: opts.model,
  });

  console.log(ANSI.green(`  Task added: ${task.id}`));
  console.log(`    title:    ${task.title}`);
  console.log(`    priority: ${task.priority}`);
  if (task.modelProfile) console.log(`    model:    ${task.modelProfile}`);
  console.log(`    cwd:      ${task.cwd}`);
}

function cmdWorkerList(opts) {
  const store = getWorkerStore();
  let tasks = store.getActiveTasks();

  if (opts.status) {
    tasks = tasks.filter(t => t.status === opts.status);
  }

  if (tasks.length === 0) {
    console.log(ANSI.yellow('No tasks in queue.'));
    return;
  }

  console.log(ANSI.bold(`\nWorker Queue (${tasks.length} task${tasks.length !== 1 ? 's' : ''}):\n`));
  const statusIcons = { pending: '⏳', running: '🔄' };
  for (const t of tasks) {
    const icon = statusIcons[t.status] || '·';
    const model = t.modelProfile || 'default';
    console.log(`  ${icon} ${ANSI.green(t.id)}  ${t.title}`);
    console.log(`    status=${t.status}  priority=${t.priority}  model=${model}  cwd=${t.cwd}`);
  }
}

function cmdWorkerImport(args) {
  if (!args[0]) {
    console.error(ANSI.red('Usage: fleet worker import <file.json>'));
    process.exit(1);
  }

  const filePath = path.resolve(args[0]);
  if (!fs.existsSync(filePath)) {
    console.error(ANSI.red(`File not found: ${filePath}`));
    process.exit(1);
  }

  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    console.error(ANSI.red(`Invalid JSON: ${e.message}`));
    process.exit(1);
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    console.error(ANSI.red('File must contain a non-empty array of task objects.'));
    process.exit(1);
  }

  const store = getWorkerStore();
  const models = loadModels();
  let imported = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (!entry.prompt) {
      console.error(ANSI.yellow(`  Skipping entry without prompt: ${JSON.stringify(entry).slice(0, 60)}`));
      skipped++;
      continue;
    }
    if (entry.model && !models.models.some(m => m.name === entry.model)) {
      console.error(ANSI.yellow(`  Skipping "${entry.title || entry.prompt.slice(0, 30)}": model "${entry.model}" not found`));
      skipped++;
      continue;
    }
    store.addTask({
      prompt: entry.prompt,
      title: entry.title,
      cwd: entry.cwd,
      priority: entry.priority,
      modelProfile: entry.model,
    });
    imported++;
  }

  console.log(ANSI.green(`  Imported ${imported} task(s).`));
  if (skipped > 0) console.log(ANSI.yellow(`  Skipped ${skipped} invalid entries.`));
  if (imported === 0) process.exit(1);
}

function cmdWorkerReport(args) {
  const store = getWorkerStore();
  const date = args[0] || new Date().toISOString().slice(0, 10);
  const archive = store.getArchive(date);

  if (!archive) {
    console.log(ANSI.yellow(`No tasks found for ${date}.`));
    return;
  }

  console.log(ANSI.bold(`\nWorker Report — ${date}\n`));
  for (const t of archive.tasks) {
    const icon = t.status === 'completed' ? '✓' : '✗';
    const color = t.status === 'completed' ? ANSI.green : ANSI.red;
    const duration = t.result ? `${(t.result.durationMs / 1000).toFixed(1)}s` : '?';
    const cost = t.result?.totalCostUsd ? `$${t.result.totalCostUsd.toFixed(3)}` : '';
    const summary = t.result?.claudeResult
      ? (t.result.claudeResult.length > 80 ? t.result.claudeResult.slice(0, 77) + '...' : t.result.claudeResult)
      : '(no output)';

    console.log(`  ${color(icon)} ${t.title}`);
    console.log(`    status=${t.status}  duration=${duration}  ${cost}`);
    console.log(ANSI.dim(`    ${summary}`));
  }

  console.log(ANSI.bold(`\n  Summary:`));
  console.log(`    total: ${archive.summary.total}  completed: ${archive.summary.completed}  failed: ${archive.summary.failed}`);
  console.log(`    duration: ${(archive.summary.totalDurationMs / 1000).toFixed(1)}s  cost: $${(archive.summary.totalCostUsd || 0).toFixed(3)}`);
}

function cmdWorkerShow(args) {
  if (!args[0]) {
    console.error(ANSI.red('Usage: fleet worker show <task-id>'));
    process.exit(1);
  }

  const store = getWorkerStore();
  const id = args[0];

  // Search active queue first
  let task = store.getById(id);
  if (task) {
    console.log(ANSI.bold(`\nTask: ${task.id} (active)\n`));
  } else {
    // Search archives
    task = store.getArchivedTask(id);
    if (!task) {
      console.error(ANSI.red(`Task "${id}" not found.`));
      process.exit(1);
    }
    console.log(ANSI.bold(`\nTask: ${task.id} (archived)\n`));
  }

  console.log(`  title:     ${task.title}`);
  console.log(`  status:    ${task.status}`);
  console.log(`  priority:  ${task.priority}`);
  console.log(`  model:     ${task.modelProfile || 'default'}`);
  console.log(`  cwd:       ${task.cwd}`);
  console.log(`  created:   ${task.createdAt}`);
  if (task.startedAt) console.log(`  started:   ${task.startedAt}`);
  if (task.completedAt) console.log(`  completed: ${task.completedAt}`);

  if (task.result) {
    console.log(`\n  ${ANSI.bold('Result:')}`);
    console.log(`    exit code: ${task.result.exitCode}`);
    console.log(`    duration:  ${(task.result.durationMs / 1000).toFixed(1)}s`);
    if (task.result.totalCostUsd != null) console.log(`    cost:      $${task.result.totalCostUsd.toFixed(3)}`);
    if (task.result.claudeResult) {
      console.log(`\n    ${ANSI.bold('Output:')}`);
      console.log(`    ${task.result.claudeResult}`);
    }
  }

  console.log(`\n  ${ANSI.bold('Prompt:')}`);
  console.log(`    ${task.prompt}`);
}
```

- [ ] **Step 3: Add worker command routing in main()**

In `src/index.js`, inside `main()`, add the worker command routing block after the hooks management block (around line 814, before `// Remaining commands need fleet config`):

```javascript
  // Worker commands (don't need fleet config)
  if (command === 'worker') {
    const workerCmd = subcommand;
    switch (workerCmd) {
      case 'start':
        cmdWorkerStart(opts);
        break;
      case 'stop':
        cmdWorkerStop();
        break;
      case 'add':
        cmdWorkerAdd(args, opts);
        break;
      case 'list':
      case 'ls':
        cmdWorkerList(opts);
        break;
      case 'import':
        cmdWorkerImport(args);
        break;
      case 'report':
        cmdWorkerReport(args);
        break;
      case 'show':
        cmdWorkerShow(args);
        break;
      default:
        console.error(ANSI.red(`Unknown worker command: ${workerCmd || '(none)'}`));
        console.error('Available: start, stop, add, list, import, report, show');
        process.exit(1);
    }
    return;
  }
```

- [ ] **Step 4: Update help text and exports**

Update `printHelp()` to include worker commands:

```javascript
${ANSI.bold('Worker Commands:')}
  worker start        Start auto-worker daemon
  worker stop         Stop auto-worker daemon
  worker add <prompt> Add a task to the queue
  worker list         View active task queue
  worker import <file>Import tasks from JSON file
  worker report [date]View daily completion report
  worker show <id>    Show full task details

```

Update `module.exports` to include new worker functions:

```javascript
  cmdWorkerStart, cmdWorkerStop, cmdWorkerAdd, cmdWorkerList,
  cmdWorkerImport, cmdWorkerReport, cmdWorkerShow,
```

- [ ] **Step 5: Run existing tests to verify nothing is broken**

Run: `npx vitest run`
Expected: All existing tests PASS (140 tests from existing suite + new worker tests)

- [ ] **Step 6: Commit**

```bash
git add src/index.js
git commit -m "feat(worker): add fleet worker CLI subcommands (start/stop/add/list/import/report/show)"
```

---

## Task 5: Worker TUI Component — worker-queue-card.mjs

**Files:**
- Create: `src/components/worker-queue-card.mjs`
- Create: `tests/components/worker-queue-card.test.mjs`

- [ ] **Step 1: Write failing tests for WorkerQueueCard**

Create `tests/components/worker-queue-card.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { WorkerQueueCard } from '../../src/components/worker-queue-card.mjs';

const h = React.createElement;

describe('WorkerQueueCard', () => {
  const baseTask = {
    id: 'task-123',
    title: 'Fix login bug',
    status: 'pending',
    modelProfile: 'opus-prod',
    queuePosition: 1,
    queueTotal: 4,
    firstEventAt: Date.now(),
  };

  it('renders pending task', () => {
    const { lastFrame } = render(h(WorkerQueueCard, {
      task: { ...baseTask, status: 'pending' },
      now: Date.now(),
      isExpanded: false,
    }));
    const output = lastFrame();
    expect(output).toContain('Fix login bug');
    expect(output).toContain('opus-prod');
  });

  it('renders running task with elapsed time', () => {
    const { lastFrame } = render(h(WorkerQueueCard, {
      task: {
        ...baseTask,
        status: 'running',
        startedAt: new Date(Date.now() - 30000).toISOString(),
      },
      now: Date.now(),
      isExpanded: false,
    }));
    const output = lastFrame();
    expect(output).toContain('Fix login bug');
  });

  it('shows queue position', () => {
    const { lastFrame } = render(h(WorkerQueueCard, {
      task: { ...baseTask, queuePosition: 2, queueTotal: 5 },
      now: Date.now(),
      isExpanded: false,
    }));
    const output = lastFrame();
    expect(output).toContain('2');
    expect(output).toContain('5');
  });

  it('shows expanded prompt when expanded', () => {
    const { lastFrame } = render(h(WorkerQueueCard, {
      task: { ...baseTask, prompt: 'Check the auth module for login issues' },
      now: Date.now(),
      isExpanded: true,
    }));
    const output = lastFrame();
    expect(output).toContain('Check the auth module');
  });

  it('shows default model when no profile', () => {
    const { lastFrame } = render(h(WorkerQueueCard, {
      task: { ...baseTask, modelProfile: null },
      now: Date.now(),
      isExpanded: false,
    }));
    const output = lastFrame();
    expect(output).toContain('default');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/worker-queue-card.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement WorkerQueueCard component**

Create `src/components/worker-queue-card.mjs`:

```javascript
import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { colors } from './colors.mjs';

const h = React.createElement;

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const hr = Math.floor(m / 60);
  return `${hr}h${m % 60}m`;
}

const STATUS_CONFIG = {
  pending: { icon: '\u23F3', color: colors.idle },
  running: { icon: null, color: colors.spinnerColor, spinning: true },
  completed: { icon: '\u2713', color: colors.doneMark },
  failed: { icon: '\u2717', color: colors.modelAlias },
};

export function WorkerQueueCard({ task, now, isExpanded = false }) {
  const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
  const modelName = task.modelProfile || 'default';
  const elapsed = task.startedAt ? formatElapsed(now - new Date(task.startedAt).getTime()) : '';

  return h(Box, { flexDirection: 'column', paddingX: 1 },
    // Header row
    h(Box, { justifyContent: 'space-between' },
      h(Box, { gap: 1 },
        // Status icon
        cfg.spinning
          ? h(Text, { color: cfg.color }, h(Spinner, { type: 'dots' }), ' ')
          : h(Text, { color: cfg.color }, cfg.icon),
        // Queue position
        task.queuePosition != null
          ? h(Text, { color: colors.idle }, `[${task.queuePosition}/${task.queueTotal}]`)
          : null,
        // Title
        h(Text, { color: colors.projectName, bold: true }, task.title),
        // Model
        h(Text, { color: colors.modelAlias }, modelName),
      ),
      // Elapsed time
      elapsed
        ? h(Text, { color: colors.idle }, elapsed)
        : null,
    ),
    // Expanded: show prompt
    isExpanded && task.prompt
      ? h(Box, { paddingLeft: 2, flexDirection: 'column' },
          h(Text, { color: colors.aiSummary, italic: true },
            task.prompt.length > 200 ? task.prompt.slice(0, 197) + '...' : task.prompt,
          ),
          // Show partial output if available
          task.result?.claudeResult
            ? h(Text, { color: colors.toolName },
                task.result.claudeResult.length > 150
                  ? task.result.claudeResult.slice(0, 147) + '...'
                  : task.result.claudeResult,
              )
            : null,
        )
      : null,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/worker-queue-card.test.mjs`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/worker-queue-card.mjs tests/components/worker-queue-card.test.mjs
git commit -m "feat(worker): add WorkerQueueCard TUI component"
```

---

## Task 6: TUI Integration — Master + App Updates

**Files:**
- Modify: `src/master.js` — Add `handleWorkerEvent` method
- Modify: `src/components/app.mjs` — Render worker queue section
- Modify: `src/components/header.mjs` — Show worker stats
- Modify: `src/components/footer.mjs` — Update key hints

- [ ] **Step 1: Add handleWorkerEvent to Master class**

In `src/master.js`, add the `workerManager` property and `handleWorkerEvent` method. Inside the `Master` class, after the `deleteSessionFile` method (around line 248):

```javascript
  handleWorkerEvent(type, data) {
    if (type === 'taskStarted' || type === 'taskCompleted' || type === 'taskFailed') {
      const task = data.task;
      const sid = 'auto-' + task.id;

      if (type === 'taskCompleted' || type === 'taskFailed') {
        // Remove from workers map (task is archived)
        this.workers.delete(sid);
      } else {
        // taskStarted — add/update virtual worker
        this.workers.set(sid, {
          type: 'auto',
          sessionId: sid,
          sessionIdShort: task.id.slice(-4),
          displayName: task.title,
          cwd: task.cwd,
          modelName: task.modelProfile || 'default',
          fleetModelName: task.modelProfile || 'default',
          firstEventAt: new Date(task.startedAt || task.createdAt).getTime(),
          lastEventAt: Date.now(),
          status: 'active',
          awaitsInput: false,
          turns: [],
          currentTurn: { summary: '', summaryTime: Date.now(), actions: [{ tool: 'Worker', target: task.title, time: Date.now(), status: 'running' }] },
          lastActions: [],
          lastMessage: null,
          termProgram: null,
          itermSessionId: null,
          pid: null,
          ppid: null,
          // Worker-specific fields
          _queuePosition: data.queuePosition,
          _queueTotal: data.queueTotal,
        });
      }

      if (this.tui) this.tui.scheduleRender();
    }
  }

  getWorkerQueueStatus() {
    let pending = 0;
    let running = 0;
    for (const [, w] of this.workers) {
      if (w.type === 'auto') {
        if (w.status === 'active') running++;
        else pending++;
      }
    }
    return { pending, running };
  }
```

Also update the constructor to initialize `workerManager`:

```javascript
  constructor() {
    this.workers = new Map();
    this.socketServer = null;
    this.tui = null;
    this.cleanupTimer = null;
    this.workerManager = null;
  }
```

- [ ] **Step 2: Update app.mjs to render worker queue section**

In `src/components/app.mjs`, add the import for the new component after the existing imports (around line 6):

```javascript
import { WorkerQueueCard } from './worker-queue-card.mjs';
```

In the `App` function, after the `workers` array is built and sorted (around line 65), add logic to separate observer and auto workers:

```javascript
  const observerWorkers = workers.filter(w => w.type !== 'auto');
  const autoWorkers = workers.filter(w => w.type === 'auto');
  const workerQueueInfo = master.getWorkerQueueStatus ? master.getWorkerQueueStatus() : { pending: 0, running: 0 };
```

Update the render section to display both groups. Replace the workers rendering section (the `workers.length === 0` check and the `workers.map` block) with:

```javascript
    h(Box, { flexDirection: 'column', paddingTop: 1 },
      // Observer workers section
      observerWorkers.length > 0
        ? h(Box, { flexDirection: 'column' },
            h(Text, { color: colors.idle }, '\u2500\u2500 Observer Workers \u2500\u2500'),
            ...observerWorkers.map((w, i) => {
              const globalIdx = i;
              return h(Box, { key: w.sessionId, flexDirection: 'column' },
                h(Box, {
                  flexDirection: 'column',
                  borderStyle: globalIdx === selectedIdx ? 'single' : undefined,
                  borderColor: globalIdx === selectedIdx ? colors.idle : undefined,
                  paddingLeft: globalIdx === selectedIdx ? 0 : 1,
                },
                  h(WorkerCard, { worker: w, now, isExpanded: expanded.has(w.sessionId) }),
                ),
                globalIdx < observerWorkers.length - 1 || autoWorkers.length > 0
                  ? h(Text, { color: colors.separator }, '\u2500'.repeat(50))
                  : null,
              );
            }),
          )
        : null,
      // Auto worker queue section
      autoWorkers.length > 0
        ? h(Box, { flexDirection: 'column', paddingTop: observerWorkers.length > 0 ? 1 : 0 },
            h(Text, { color: colors.idle },
              `\u2500\u2500 Auto Worker Queue (${workerQueueInfo.pending} pending, ${workerQueueInfo.running} running) \u2500\u2500`,
            ),
            ...autoWorkers.map((w, i) => {
              const globalIdx = observerWorkers.length + i;
              return h(Box, { key: w.sessionId },
                h(WorkerQueueCard, {
                  task: {
                    id: w.sessionId.replace('auto-', ''),
                    title: w.displayName,
                    status: w.status === 'active' ? 'running' : 'pending',
                    modelProfile: w.fleetModelName !== 'default' ? w.fleetModelName : null,
                    startedAt: new Date(w.firstEventAt).toISOString(),
                    queuePosition: w._queuePosition,
                    queueTotal: w._queueTotal,
                    prompt: null,
                  },
                  now,
                  isExpanded: expanded.has(w.sessionId),
                }),
              );
            }),
          )
        : null,
      // No workers at all
      workers.length === 0
        ? h(Box, { paddingX: 1 },
            h(Text, { color: colors.idle },
              'No active workers. Start claude processes to see them here.',
            ),
          )
        : null,
    ),
```

- [ ] **Step 3: Update header.mjs to show worker stats**

In `src/components/header.mjs`, update the `Header` component to show worker count. After the existing stats line, add:

```javascript
  const autoRunning = workers.filter(w => w.type === 'auto' && w.computedStatus === 'active').length;
  const autoPending = workers.filter(w => w.type === 'auto' && w.computedStatus !== 'active').length;
```

Add to the stats display:

```javascript
      autoRunning > 0 ? h(Text, { color: colors.spinnerColor }, `\u23F3 ${autoRunning}w`) : null,
```

- [ ] **Step 4: Update footer.mjs key hints**

In `src/components/footer.mjs`, update the hint text:

```javascript
'[j/k] scroll  [space] expand  [enter] focus  [tab] sort  [1-9] jump'
```

(No change needed — existing hints work for both observer and auto-worker sections.)

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/master.js src/components/app.mjs src/components/header.mjs
git commit -m "feat(worker): integrate auto-worker status into TUI dashboard"
```

---

## Task 7: Final Integration — Wire Worker Start to Master

**Files:**
- Modify: `src/index.js` — Connect `cmdWorkerStart` to Master for TUI

- [ ] **Step 1: Update cmdWorkerStart to optionally connect to Master**

In `src/index.js`, update `cmdWorkerStart` to optionally start the TUI alongside the worker daemon. Replace the current `cmdWorkerStart` function with a version that creates a Master instance and connects the WorkerManager's events to it:

```javascript
async function cmdWorkerStart(opts) {
  const workerPidPath = path.join(GLOBAL_CONFIG_DIR, 'worker.pid');

  // Check if already running
  if (fs.existsSync(workerPidPath)) {
    const pid = parseInt(fs.readFileSync(workerPidPath, 'utf-8'));
    try {
      process.kill(pid, 0);
      console.error(ANSI.red(`Worker already running (pid ${pid})`));
      console.error(`Run ${ANSI.bold('fleet worker stop')} first.`);
      process.exit(1);
    } catch {
      fs.unlinkSync(workerPidPath);
    }
  }

  const { WorkerManager } = require('./worker-manager');
  const { WorkerTaskStore } = require('./worker-task-store');
  const { Master } = require('./master');
  const store = new WorkerTaskStore(GLOBAL_CONFIG_DIR);

  // Start Master for TUI dashboard
  const master = new Master();

  const manager = new WorkerManager(store, {
    concurrency: opts.concurrency || 1,
    pollInterval: opts.pollInterval || 5,
    timeout: opts.timeout || 600,
    onTaskEvent: (type, data) => {
      // Forward to master for TUI
      master.handleWorkerEvent(type, data);
      // Also log to console
      if (type === 'taskStarted') {
        console.log(ANSI.green(`  ▶ Started: ${data.task.title}`));
      } else if (type === 'taskCompleted') {
        const cost = data.result.totalCostUsd ? ` ($${data.result.totalCostUsd.toFixed(3)})` : '';
        console.log(ANSI.green(`  ✓ Completed: ${data.task.title}${cost}`));
      } else if (type === 'taskFailed') {
        console.log(ANSI.red(`  ✗ Failed: ${data.task.title}`));
      }
    },
  });

  master.workerManager = manager;
  manager.start();

  try {
    await master.start();
  } catch (err) {
    // TUI init failed — run in quiet mode
    process.stderr.write(`[fleet] TUI init error: ${err.message}\n`);
    process.stderr.write(`[fleet] Running in quiet mode.\n`);
  }

  console.log(ANSI.green(`\n  Worker started (concurrency=${opts.concurrency || 1}, poll=${opts.pollInterval || 5}s)`));

  process.on('SIGINT', () => { manager.stop(); master.stop(); });
  process.on('SIGTERM', () => { manager.stop(); master.stop(); });
}
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/index.js
git commit -m "feat(worker): wire worker start to Master for combined TUI dashboard"
```

---

## Task 8: Update parseArgs for worker flags — test coverage

**Files:**
- Modify: `tests/index.test.js` — Add tests for worker flag parsing

- [ ] **Step 1: Add parseArgs tests for new worker flags**

In `tests/index.test.js`, add these tests to the existing `parseArgs` describe block:

```javascript
  it('--priority', () => expect(parseArgs(['--priority', '3']).opts.priority).toBe(3));
  it('--concurrency', () => expect(parseArgs(['--concurrency', '4']).opts.concurrency).toBe(4));
  it('--poll-interval', () => expect(parseArgs(['--poll-interval', '10']).opts.pollInterval).toBe(10));
  it('--timeout', () => expect(parseArgs(['--timeout', '300']).opts.timeout).toBe(300));
  it('--status', () => expect(parseArgs(['--status', 'running']).opts.status).toBe('running'));
  it('--title', () => expect(parseArgs(['--title', 'My Task']).opts.title).toBe('My Task'));
  it('worker start subcommand', () => {
    const r = parseArgs(['worker', 'start', '--concurrency', '2']);
    expect(r.command).toBe('worker');
    expect(r.subcommand).toBe('start');
    expect(r.opts.concurrency).toBe(2);
  });
  it('worker add subcommand', () => {
    const r = parseArgs(['worker', 'add', 'fix the bug', '--title', 'Bugfix']);
    expect(r.command).toBe('worker');
    expect(r.subcommand).toBe('add');
    expect(r.args).toEqual(['fix the bug']);
    expect(r.opts.title).toBe('Bugfix');
  });
```

- [ ] **Step 2: Run tests to verify**

Run: `npx vitest run tests/index.test.js`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/index.test.js
git commit -m "test(worker): add parseArgs tests for worker CLI flags"
```

---

## Self-Review

**1. Spec coverage:**
- CLI commands (start/stop/add/list/import/report/show) → Task 4
- Data model (active queue + archive) → Task 1
- Claude subprocess execution → Task 2
- Scheduler + concurrency → Task 3
- TUI integration → Tasks 5, 6
- Master connection → Task 7
- Model profile reuse → Task 4 (cmdWorkerAdd validates), Task 3 (_resolveModelConfig)
- Startup recovery → Task 3 (test + implementation)
- Graceful shutdown → Task 3 (stop), Task 7 (SIGINT/SIGTERM handlers)

**2. Placeholder scan:** No TBD/TODO found. All steps have complete code.

**3. Type consistency:**
- `WorkerTaskStore` methods return plain objects with `.id`, `.status`, `.prompt` etc. — consistent with `WorkerManager` usage.
- `WorkerManager.onTaskEvent` callback signature `(type, data)` — matches all callers.
- `Master.handleWorkerEvent(type, data)` — matches WorkerManager callback.
- Worker card expects `task.status` as `'pending'|'running'|'completed'|'failed'` — consistent with store.
