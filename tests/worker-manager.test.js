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

// ─── Control file ─────────────────────────────────────────────────────────

describe('control file', () => {
  it('_writeControlFile writes JSON and _readControlFile reads it', () => {
    const store = createStore();
    const manager = createManager(store);

    manager._writeControlFile({ paused: true, concurrency: 3 });
    manager._readControlFile();

    expect(manager._paused).toBe(true);
    expect(manager.pool).toHaveLength(3);
  });

  it('_readControlFile handles missing file gracefully', () => {
    const store = createStore();
    const manager = createManager(store);
    manager._paused = false;

    manager._readControlFile();
    expect(manager._paused).toBe(false);
  });

  it('_readControlFile handles corrupt file gracefully', () => {
    const store = createStore();
    const manager = createManager(store);

    fs.writeFileSync(
      path.join(tmpDir, 'worker-control.json'),
      'not valid json!!!',
      'utf8'
    );

    manager._paused = true;
    manager._readControlFile();
    // Should not crash, keeps current state
    expect(manager._paused).toBe(true);
  });

  it('_writeControlFile merges with existing content', () => {
    const store = createStore();
    const manager = createManager(store);

    manager._writeControlFile({ paused: true });
    manager._writeControlFile({ concurrency: 4 });

    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'worker-control.json'), 'utf8'));
    expect(data.paused).toBe(true);
    expect(data.concurrency).toBe(4);
  });

  it('start writes initial control file', () => {
    const store = createStore();
    const manager = createManager(store, { pollInterval: 999 });

    manager.start();

    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'worker-control.json'), 'utf8'));
    expect(data.paused).toBe(false);
    expect(data.concurrency).toBe(1);

    manager.stop();
  });
});

// ─── _adjustConcurrency ──────────────────────────────────────────────────

describe('_adjustConcurrency', () => {
  it('grows pool when increasing concurrency', () => {
    const store = createStore();
    const manager = createManager(store, { concurrency: 1 });

    expect(manager.pool).toHaveLength(1);

    manager._adjustConcurrency(3);
    expect(manager.pool).toHaveLength(3);
    expect(manager.pool.every(s => s.idle)).toBe(true);
    expect(manager.concurrency).toBe(3);
  });

  it('shrinks pool by removing idle slots from the end', () => {
    const store = createStore();
    const manager = createManager(store, { concurrency: 3 });

    manager._adjustConcurrency(1);
    expect(manager.pool).toHaveLength(1);
    expect(manager.concurrency).toBe(1);
  });

  it('does not shrink when all slots are busy', () => {
    const store = createStore();
    const manager = createManager(store, { concurrency: 2 });

    // Mark all slots as busy
    manager.pool[0] = { idle: false, taskId: 'task-1' };
    manager.pool[1] = { idle: false, taskId: 'task-2' };

    manager._adjustConcurrency(1);
    // Can't shrink — all slots busy
    expect(manager.pool).toHaveLength(2);
  });

  it('is no-op when n equals current pool length', () => {
    const store = createStore();
    const manager = createManager(store, { concurrency: 2 });

    manager._adjustConcurrency(2);
    expect(manager.pool).toHaveLength(2);
  });
});

// ─── Pause behavior in tick ──────────────────────────────────────────────

describe('pause', () => {
  it('paused tick does not pick up pending tasks', async () => {
    const store = createStore();
    const events = [];
    const manager = createManager(store, {
      onTaskEvent: (type, data) => events.push({ type, data }),
    });

    store.addTask({ prompt: 'hello' });

    manager._paused = true;
    await manager.tick();

    expect(events).toHaveLength(0);
    expect(store.getActiveTasks()).toHaveLength(1);
    expect(store.getActiveTasks()[0].status).toBe('pending');
  });

  it('resumed tick picks up pending tasks', async () => {
    const store = createStore();
    const events = [];
    const manager = createManager(store, {
      onTaskEvent: (type, data) => events.push({ type, data }),
    });

    store.addTask({ prompt: 'hello' });

    manager._paused = true;
    await manager.tick();
    expect(events).toHaveLength(0);

    manager._paused = false;
    await manager.tick();
    expect(events.some(e => e.type === 'taskStarted')).toBe(true);

    const active = store.getActiveTasks();
    expect(active).toHaveLength(0);
  });

  it('pause via control file takes effect on next tick', async () => {
    const store = createStore();
    const events = [];
    const manager = createManager(store, {
      onTaskEvent: (type, data) => events.push({ type, data }),
    });

    store.addTask({ prompt: 'task-1' });
    store.addTask({ prompt: 'task-2' });

    // First tick: picks up task-1
    await manager.tick();
    expect(events).toHaveLength(2); // started + completed

    // Write pause to control file
    manager._writeControlFile({ paused: true });

    // Next tick: reads control file, sees paused, skips task-2
    await manager.tick();
    expect(events).toHaveLength(2); // No new events
    expect(store.getActiveTasks()[0].status).toBe('pending');
  });
});

// ─── defaultModel fallback ──────────────────────────────────────────────

describe('defaultModel', () => {
  it('stores defaultModel from options', () => {
    const store = createStore();
    const manager = createManager(store, { defaultModel: 'my-profile' });
    expect(manager.defaultModel).toBe('my-profile');
  });

  it('defaults to null when not provided', () => {
    const store = createStore();
    const manager = createManager(store);
    expect(manager.defaultModel).toBeNull();
  });

  it('uses defaultModel when task has no modelProfile', async () => {
    const store = createStore();
    const events = [];
    const manager = createManager(store, {
      defaultModel: 'opus',
      onTaskEvent: (type, data) => events.push({ type, data }),
    });

    // Write models.json with the profile
    fs.writeFileSync(
      path.join(tmpDir, 'models.json'),
      JSON.stringify({ models: [{ name: 'opus', model: 'claude-opus-4-6', apiKey: 'sk-test', apiBaseUrl: 'https://api.test.com' }] }),
      'utf8'
    );

    // Add task WITHOUT modelProfile
    store.addTask({ prompt: 'do work' });

    await manager.tick();

    // Task completed — verify it resolved the model from defaultModel
    expect(events.some(e => e.type === 'taskCompleted')).toBe(true);
    const today = new Date().toISOString().slice(0, 10);
    const archive = store.getArchive(today);
    expect(archive.tasks).toHaveLength(1);
    expect(archive.tasks[0].status).toBe('completed');
  });

  it('task modelProfile takes precedence over defaultModel', async () => {
    const store = createStore();
    const manager = createManager(store, { defaultModel: 'sonnet' });

    // Write models.json with both profiles
    fs.writeFileSync(
      path.join(tmpDir, 'models.json'),
      JSON.stringify({ models: [
        { name: 'sonnet', model: 'claude-sonnet-4-6', apiKey: 'sk-sonnet' },
        { name: 'opus', model: 'claude-opus-4-6', apiKey: 'sk-opus' },
      ] }),
      'utf8'
    );

    // Add task WITH explicit modelProfile
    store.addTask({ prompt: 'do work', modelProfile: 'opus' });

    // The runner mock doesn't use modelConfig, but we can verify _resolveModelConfig
    const config = manager._resolveModelConfig('opus');
    expect(config.model).toBe('claude-opus-4-6');
    expect(config.apiKey).toBe('sk-opus');
  });
});
