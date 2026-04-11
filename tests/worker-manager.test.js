import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const { WorkerTaskStore } = await import('../src/worker-task-store.js');
const { WorkerManager } = await import('../src/worker-manager.js');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-test-'));
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
});

function createStore() {
  return new WorkerTaskStore(tmpDir);
}

function createMockRunner() {
  return {
    run(task, config) {
      if (task.prompt === 'fail') {
        return Promise.resolve({
          exitCode: 1,
          stdout: '',
          stderr: 'error',
          durationMs: 100,
          isClaudeError: true,
          claudeResult: null,
          totalCostUsd: null,
        });
      }
      return Promise.resolve({
        exitCode: 0,
        stdout: JSON.stringify({ result: `done: ${task.prompt}` }),
        stderr: '',
        durationMs: 100,
        isClaudeError: false,
        claudeResult: `done: ${task.prompt}`,
        totalCostUsd: 0.05,
      });
    },
  };
}

function createManager(store, options = {}) {
  return new WorkerManager(store, {
    runner: createMockRunner(),
    ...options,
  });
}

// ─── tick picks up pending task, executes it, archives it ──────────────────

describe('WorkerManager tick', () => {
  it('picks up pending task, executes it, archives it', async () => {
    const store = createStore();
    const events = [];
    const manager = createManager(store, {
      onTaskEvent: (type, data) => events.push({ type, data }),
    });

    store.addTask({ prompt: 'hello world' });
    await manager.tick();

    // Task should be archived (removed from active queue)
    const active = store.getActiveTasks();
    expect(active).toHaveLength(0);

    // Check archive exists
    const today = new Date().toISOString().slice(0, 10);
    const archive = store.getArchive(today);
    expect(archive).toBeTruthy();
    expect(archive.tasks).toHaveLength(1);
    expect(archive.tasks[0].status).toBe('completed');
    expect(archive.tasks[0].result.claudeResult).toBe('done: hello world');

    // Events emitted
    expect(events.some(e => e.type === 'taskStarted')).toBe(true);
    expect(events.some(e => e.type === 'taskCompleted')).toBe(true);
  });

  it('is no-op when no pending tasks', async () => {
    const store = createStore();
    const events = [];
    const manager = createManager(store, {
      onTaskEvent: (type, data) => events.push({ type, data }),
    });

    await manager.tick();

    expect(events).toHaveLength(0);
    expect(store.getActiveTasks()).toHaveLength(0);
  });

  it('handles task failure (exitCode=1)', async () => {
    const store = createStore();
    const events = [];
    const manager = createManager(store, {
      onTaskEvent: (type, data) => events.push({ type, data }),
    });

    store.addTask({ prompt: 'fail' });
    await manager.tick();

    // Task should be archived
    const active = store.getActiveTasks();
    expect(active).toHaveLength(0);

    const today = new Date().toISOString().slice(0, 10);
    const archive = store.getArchive(today);
    expect(archive).toBeTruthy();
    expect(archive.tasks).toHaveLength(1);
    expect(archive.tasks[0].status).toBe('failed');

    // taskFailed event emitted
    expect(events.some(e => e.type === 'taskStarted')).toBe(true);
    expect(events.some(e => e.type === 'taskFailed')).toBe(true);
  });
});

// ─── respects concurrency limit ────────────────────────────────────────────

describe('concurrency', () => {
  it('respects concurrency limit (add 3 tasks, concurrency=1, all complete)', async () => {
    const store = createStore();
    const events = [];
    const manager = createManager(store, {
      concurrency: 1,
      onTaskEvent: (type, data) => events.push({ type, data }),
    });

    store.addTask({ prompt: 'task-a' });
    store.addTask({ prompt: 'task-b' });
    store.addTask({ prompt: 'task-c' });

    // First tick: picks up 1 task (concurrency=1)
    await manager.tick();
    expect(events.filter(e => e.type === 'taskStarted')).toHaveLength(1);

    // Second tick: picks up next task
    await manager.tick();
    expect(events.filter(e => e.type === 'taskStarted')).toHaveLength(2);

    // Third tick: picks up last task
    await manager.tick();
    expect(events.filter(e => e.type === 'taskStarted')).toHaveLength(3);

    // All archived
    const active = store.getActiveTasks();
    expect(active).toHaveLength(0);

    const today = new Date().toISOString().slice(0, 10);
    const archive = store.getArchive(today);
    expect(archive.tasks).toHaveLength(3);
    expect(archive.summary.completed).toBe(3);
  });

  it('processes multiple tasks in parallel with concurrency=2', async () => {
    const store = createStore();
    const events = [];
    const manager = createManager(store, {
      concurrency: 2,
      onTaskEvent: (type, data) => events.push({ type, data }),
    });

    store.addTask({ prompt: 'task-a' });
    store.addTask({ prompt: 'task-b' });
    store.addTask({ prompt: 'task-c' });

    // First tick: picks up 2 tasks (concurrency=2)
    await manager.tick();
    expect(events.filter(e => e.type === 'taskStarted')).toHaveLength(2);

    // Second tick: picks up remaining task
    await manager.tick();
    expect(events.filter(e => e.type === 'taskStarted')).toHaveLength(3);

    // All archived
    const active = store.getActiveTasks();
    expect(active).toHaveLength(0);
  });
});

// ─── start/stop lifecycle ─────────────────────────────────────────────────

describe('start/stop', () => {
  it('start writes PID file', async () => {
    const store = createStore();
    const manager = createManager(store, { pollInterval: 999 });

    manager.start();

    const pidPath = path.join(tmpDir, 'worker.pid');
    expect(fs.existsSync(pidPath)).toBe(true);
    const pid = fs.readFileSync(pidPath, 'utf8').trim();
    expect(pid).toBe(String(process.pid));

    manager.stop();
  });

  it('stop removes PID file', async () => {
    const store = createStore();
    const manager = createManager(store, { pollInterval: 999 });

    manager.start();
    const pidPath = path.join(tmpDir, 'worker.pid');
    expect(fs.existsSync(pidPath)).toBe(true);

    manager.stop();
    expect(fs.existsSync(pidPath)).toBe(false);
  });

  it('stop sets running to false and clears interval', async () => {
    const store = createStore();
    const manager = createManager(store, { pollInterval: 999 });

    manager.start();
    expect(manager.running).toBe(true);

    manager.stop();
    expect(manager.running).toBe(false);
    expect(manager._intervalRef).toBeNull();
  });
});

// ─── recovers running tasks on startup ────────────────────────────────────

describe('task recovery', () => {
  it('resets running tasks to pending on construction', () => {
    const store = createStore();

    // Add a task and set it to running state
    const task = store.addTask({ prompt: 'was running' });
    store.updateTask(task.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
      workerId: 0,
    });

    // Verify it's running
    const active = store.getActiveTasks();
    expect(active[0].status).toBe('running');

    // Create a new WorkerManager — should recover running tasks to pending
    const manager = createManager(store);

    const afterRecovery = store.getById(task.id);
    expect(afterRecovery.status).toBe('pending');
    expect(afterRecovery.startedAt).toBeUndefined();
    expect(afterRecovery.workerId).toBeUndefined();
  });
});

// ─── _resolveModelConfig ──────────────────────────────────────────────────

describe('_resolveModelConfig', () => {
  it('reads model config from models.json', () => {
    const store = createStore();

    const modelsConfig = {
      profiles: [
        {
          name: 'opus',
          model: 'claude-opus-4-0',
          apiKey: 'sk-test-key',
          apiBaseUrl: 'https://api.example.com',
        },
      ],
    };
    fs.writeFileSync(
      path.join(tmpDir, 'models.json'),
      JSON.stringify(modelsConfig, null, 2),
      'utf8'
    );

    const manager = createManager(store);
    const config = manager._resolveModelConfig('opus');
    expect(config).toEqual({
      model: 'claude-opus-4-0',
      apiKey: 'sk-test-key',
      apiBaseUrl: 'https://api.example.com',
    });
  });

  it('returns null for unknown profile', () => {
    const store = createStore();

    fs.writeFileSync(
      path.join(tmpDir, 'models.json'),
      JSON.stringify({ profiles: [] }, null, 2),
      'utf8'
    );

    const manager = createManager(store);
    const config = manager._resolveModelConfig('nonexistent');
    expect(config).toBeNull();
  });

  it('returns null when models.json does not exist', () => {
    const store = createStore();
    const manager = createManager(store);
    const config = manager._resolveModelConfig('anything');
    expect(config).toBeNull();
  });
});
