import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wts-test-'));
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
});

function createStore() {
  // Dynamic import to get a fresh module reference each time
  // The module itself is CJS, so require-style caching applies,
  // but WorkerTaskStore reads files from disk each time.
  const { WorkerTaskStore } = require('../src/worker-task-store.js');
  return new WorkerTaskStore(tmpDir);
}

// ─── Construction ────────────────────────────────────────────────────────────

describe('WorkerTaskStore construction', () => {
  it('creates queue file on construction', () => {
    const store = createStore();
    const queuePath = path.join(tmpDir, 'worker-queue.json');
    expect(fs.existsSync(queuePath)).toBe(true);
    const data = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    expect(data).toEqual({ tasks: [] });
  });

  it('creates archive dir on construction', () => {
    const store = createStore();
    const archiveDir = path.join(tmpDir, 'worker-archive');
    expect(fs.existsSync(archiveDir)).toBe(true);
    expect(fs.statSync(archiveDir).isDirectory()).toBe(true);
  });

  it('recovers from corrupted queue file', () => {
    const queuePath = path.join(tmpDir, 'worker-queue.json');
    fs.writeFileSync(queuePath, '{ not valid json !!!', 'utf8');
    const store = createStore();
    const data = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    expect(data).toEqual({ tasks: [] });
  });
});

// ─── addTask ─────────────────────────────────────────────────────────────────

describe('addTask', () => {
  it('creates pending task with correct defaults', () => {
    const store = createStore();
    const task = store.addTask({ prompt: 'Do something' });
    expect(task.id).toMatch(/^task-\d+-[a-z0-9]+$/);
    expect(task.prompt).toBe('Do something');
    expect(task.status).toBe('pending');
    expect(task.priority).toBe(5);
    expect(task.cwd).toBe(process.cwd());
    expect(task.modelProfile).toBeNull();
    expect(task.title).toBe('Do something');
    expect(task.createdAt).toBeTruthy();
    // Verify it's a copy (modifying returned object doesn't affect store)
    task.status = 'modified';
    const fromStore = store.getById(task.id);
    expect(fromStore.status).toBe('pending');
  });

  it('respects options (cwd, priority, modelProfile, title)', () => {
    const store = createStore();
    const task = store.addTask({
      prompt: 'Do X',
      cwd: '/custom/dir',
      priority: 1,
      modelProfile: 'opus',
      title: 'Custom Title',
    });
    expect(task.cwd).toBe('/custom/dir');
    expect(task.priority).toBe(1);
    expect(task.modelProfile).toBe('opus');
    expect(task.title).toBe('Custom Title');
  });

  it('auto-generates title from long prompt (60 chars + "...")', () => {
    const store = createStore();
    const longPrompt = 'A'.repeat(100);
    const task = store.addTask({ prompt: longPrompt });
    expect(task.title).toBe('A'.repeat(60) + '...');
    expect(task.title.length).toBe(63);
  });

  it('persists to file (verify by re-reading from new instance)', () => {
    const store = createStore();
    store.addTask({ prompt: 'Persistent task' });
    // Create a new store instance pointing to the same directory
    const store2 = createStore();
    const tasks = store2.getActiveTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].prompt).toBe('Persistent task');
  });
});

// ─── getNextPending ──────────────────────────────────────────────────────────

describe('getNextPending', () => {
  it('returns highest priority (lowest number)', () => {
    const store = createStore();
    store.addTask({ prompt: 'Low priority', priority: 10 });
    store.addTask({ prompt: 'High priority', priority: 1 });
    store.addTask({ prompt: 'Med priority', priority: 5 });
    const next = store.getNextPending();
    expect(next.prompt).toBe('High priority');
  });

  it('returns null when empty', () => {
    const store = createStore();
    expect(store.getNextPending()).toBeNull();
  });

  it('skips non-pending tasks', () => {
    const store = createStore();
    const t1 = store.addTask({ prompt: 'Running', priority: 1 });
    store.updateTask(t1.id, { status: 'running' });
    store.addTask({ prompt: 'Pending', priority: 5 });
    const next = store.getNextPending();
    expect(next.prompt).toBe('Pending');
  });
});

// ─── updateTask ──────────────────────────────────────────────────────────────

describe('updateTask', () => {
  it('applies partial updates', () => {
    const store = createStore();
    const task = store.addTask({ prompt: 'Original' });
    const updated = store.updateTask(task.id, { status: 'running', priority: 3 });
    expect(updated.status).toBe('running');
    expect(updated.priority).toBe(3);
    expect(updated.prompt).toBe('Original');
  });

  it('returns null for unknown id', () => {
    const store = createStore();
    expect(store.updateTask('task-nonexistent', { status: 'done' })).toBeNull();
  });
});

// ─── getByStatus / getById ───────────────────────────────────────────────────

describe('getByStatus', () => {
  it('filters correctly', () => {
    const store = createStore();
    const t1 = store.addTask({ prompt: 'A' });
    store.addTask({ prompt: 'B' });
    store.updateTask(t1.id, { status: 'running' });
    const pending = store.getByStatus('pending');
    const running = store.getByStatus('running');
    expect(pending).toHaveLength(1);
    expect(pending[0].prompt).toBe('B');
    expect(running).toHaveLength(1);
    expect(running[0].prompt).toBe('A');
  });
});

describe('getById', () => {
  it('returns task or null', () => {
    const store = createStore();
    const task = store.addTask({ prompt: 'Find me' });
    expect(store.getById(task.id).prompt).toBe('Find me');
    expect(store.getById('task-nope')).toBeNull();
  });
});

// ─── archiveTask ─────────────────────────────────────────────────────────────

describe('archiveTask', () => {
  it('removes from queue and writes to archive with summary', () => {
    const store = createStore();
    const task = store.addTask({ prompt: 'Archive me' });
    store.updateTask(task.id, {
      status: 'completed',
      completedAt: '2025-06-15T10:30:00.000Z',
      result: { durationMs: 5000, totalCostUsd: 0.03 },
    });
    const full = store.getById(task.id);
    store.archiveTask(full);

    // Task removed from active queue
    expect(store.getById(task.id)).toBeNull();
    expect(store.getActiveTasks()).toHaveLength(0);

    // Archive file exists
    const archive = store.getArchive('2025-06-15');
    expect(archive).toBeTruthy();
    expect(archive.tasks).toHaveLength(1);
    expect(archive.tasks[0].id).toBe(task.id);
    expect(archive.summary).toEqual({
      total: 1,
      completed: 1,
      failed: 0,
      totalDurationMs: 5000,
      totalCostUsd: 0.03,
    });
  });

  it('recalculates summary with multiple archives', () => {
    const store = createStore();
    const t1 = store.addTask({ prompt: 'Task 1' });
    store.updateTask(t1.id, {
      status: 'completed',
      completedAt: '2025-06-15T10:00:00.000Z',
      result: { durationMs: 3000, totalCostUsd: 0.02 },
    });
    store.archiveTask(store.getById(t1.id));

    const t2 = store.addTask({ prompt: 'Task 2' });
    store.updateTask(t2.id, {
      status: 'failed',
      completedAt: '2025-06-15T11:00:00.000Z',
      result: { durationMs: 7000, totalCostUsd: 0.05 },
    });
    store.archiveTask(store.getById(t2.id));

    const archive = store.getArchive('2025-06-15');
    expect(archive.tasks).toHaveLength(2);
    expect(archive.summary).toEqual({
      total: 2,
      completed: 1,
      failed: 1,
      totalDurationMs: 10000,
      totalCostUsd: 0.07,
    });
  });
});

// ─── getArchive ──────────────────────────────────────────────────────────────

describe('getArchive', () => {
  it('returns null for missing date', () => {
    const store = createStore();
    expect(store.getArchive('2099-01-01')).toBeNull();
  });

  it('returns null for corrupted file', () => {
    const archiveDir = path.join(tmpDir, 'worker-archive');
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(path.join(archiveDir, '2025-06-15.json'), 'broken{json', 'utf8');
    const store = createStore();
    expect(store.getArchive('2025-06-15')).toBeNull();
  });
});

// ─── getArchivedTask ─────────────────────────────────────────────────────────

describe('getArchivedTask', () => {
  it('searches across archives', () => {
    const store = createStore();
    // Archive a task for one date
    const t1 = store.addTask({ prompt: 'Day1' });
    store.updateTask(t1.id, {
      status: 'completed',
      completedAt: '2025-06-15T10:00:00.000Z',
      result: { durationMs: 1000, totalCostUsd: 0.01 },
    });
    store.archiveTask(store.getById(t1.id));

    // Archive a task for another date
    const t2 = store.addTask({ prompt: 'Day2' });
    store.updateTask(t2.id, {
      status: 'completed',
      completedAt: '2025-06-16T10:00:00.000Z',
      result: { durationMs: 2000, totalCostUsd: 0.02 },
    });
    store.archiveTask(store.getById(t2.id));

    // Search across archives
    expect(store.getArchivedTask(t1.id).prompt).toBe('Day1');
    expect(store.getArchivedTask(t2.id).prompt).toBe('Day2');
  });

  it('returns null for unknown id', () => {
    const store = createStore();
    expect(store.getArchivedTask('task-nope')).toBeNull();
  });
});
