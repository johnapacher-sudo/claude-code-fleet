const fs = require('fs');
const path = require('path');

const QUEUE_FILENAME = 'worker-queue.json';
const ARCHIVE_DIR = 'worker-archive';

class WorkerTaskStore {
  constructor(baseDir) {
    this._baseDir = baseDir;
    this._queuePath = path.join(baseDir, QUEUE_FILENAME);
    this._archiveDir = path.join(baseDir, ARCHIVE_DIR);

    // Ensure archive directory exists
    if (!fs.existsSync(this._archiveDir)) {
      fs.mkdirSync(this._archiveDir, { recursive: true });
    }

    // Initialize or recover queue file
    if (!fs.existsSync(this._queuePath)) {
      this._writeQueue({ tasks: [] });
    } else {
      // Validate existing file; recover if corrupted
      try {
        const data = JSON.parse(fs.readFileSync(this._queuePath, 'utf8'));
        if (!data || !Array.isArray(data.tasks)) {
          this._writeQueue({ tasks: [] });
        }
      } catch {
        this._writeQueue({ tasks: [] });
      }
    }
  }

  // ─── Queue file helpers ──────────────────────────────────────────────────

  _readQueue() {
    try {
      const raw = fs.readFileSync(this._queuePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return { tasks: [] };
    }
  }

  _writeQueue(data) {
    fs.writeFileSync(this._queuePath, JSON.stringify(data, null, 2), 'utf8');
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  addTask(input) {
    const queue = this._readQueue();
    const task = {
      id: `task-${Date.now()}`,
      title: input.title || (input.prompt.length > 60 ? input.prompt.slice(0, 60) + '...' : input.prompt),
      prompt: input.prompt,
      priority: input.priority ?? 5,
      cwd: input.cwd || process.cwd(),
      modelProfile: input.modelProfile ?? null,
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
    // Remove from active queue
    const queue = this._readQueue();
    const idx = queue.tasks.findIndex(t => t.id === task.id);
    if (idx !== -1) {
      queue.tasks.splice(idx, 1);
      this._writeQueue(queue);
    }

    // Determine archive date from completedAt
    const date = (task.completedAt || new Date().toISOString()).slice(0, 10);
    const archivePath = path.join(this._archiveDir, `${date}.json`);

    // Read existing archive or start fresh
    let archive;
    try {
      archive = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
      if (!archive || !Array.isArray(archive.tasks)) {
        archive = { tasks: [], summary: {} };
      }
    } catch {
      archive = { tasks: [], summary: {} };
    }

    archive.tasks.push(task);

    // Recalculate summary
    let total = 0;
    let completed = 0;
    let failed = 0;
    let totalDurationMs = 0;
    let totalCostUsd = 0;

    for (const t of archive.tasks) {
      total++;
      if (t.status === 'completed') completed++;
      if (t.status === 'failed') failed++;
      if (t.result) {
        totalDurationMs += t.result.durationMs || 0;
        totalCostUsd += t.result.totalCostUsd || 0;
      }
    }

    archive.summary = {
      total,
      completed,
      failed,
      totalDurationMs,
      totalCostUsd,
    };

    fs.writeFileSync(archivePath, JSON.stringify(archive, null, 2), 'utf8');
  }

  getActiveTasks() {
    const queue = this._readQueue();
    return queue.tasks.map(t => ({ ...t }));
  }

  getByStatus(status) {
    const queue = this._readQueue();
    return queue.tasks.filter(t => t.status === status).map(t => ({ ...t }));
  }

  getById(id) {
    const queue = this._readQueue();
    const task = queue.tasks.find(t => t.id === id);
    return task ? { ...task } : null;
  }

  getArchive(date) {
    const archivePath = path.join(this._archiveDir, `${date}.json`);
    try {
      return JSON.parse(fs.readFileSync(archivePath, 'utf8'));
    } catch {
      return null;
    }
  }

  getArchivedTask(id) {
    let files;
    try {
      files = fs.readdirSync(this._archiveDir);
    } catch {
      return null;
    }

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const archive = JSON.parse(
          fs.readFileSync(path.join(this._archiveDir, file), 'utf8')
        );
        if (archive && Array.isArray(archive.tasks)) {
          const found = archive.tasks.find(t => t.id === id);
          if (found) return found;
        }
      } catch {
        // Skip corrupted files
      }
    }

    return null;
  }
}

module.exports = { WorkerTaskStore };
