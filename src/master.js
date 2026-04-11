#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const os = require('os');
const { SocketServer } = require('./socket');
const { TUI } = require('./tui');

const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.config', 'claude-code-fleet');
const SOCK_PATH = path.join(GLOBAL_CONFIG_DIR, 'fleet.sock');
const HOOKS_DIR = path.join(GLOBAL_CONFIG_DIR, 'hooks');
const SESSIONS_DIR = path.join(GLOBAL_CONFIG_DIR, 'sessions');
const HOOK_CLIENT_SRC = path.join(__dirname, 'hook-client.js');
const HOOK_CLIENT_DST = path.join(HOOKS_DIR, 'hook-client.js');
const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const CLEANUP_INTERVAL = 5 * 60 * 1000;
const EXPIRE_THRESHOLD = 3 * 60 * 60 * 1000;

class Master {
  constructor() {
    this.workers = new Map();
    this.workerManager = null;
    this.socketServer = null;
    this.tui = null;
    this.cleanupTimer = null;
  }

  async start() {
    if (!fs.existsSync(HOOKS_DIR)) fs.mkdirSync(HOOKS_DIR, { recursive: true });
    fs.copyFileSync(HOOK_CLIENT_SRC, HOOK_CLIENT_DST);
    ensureHooks();
    this.loadPersistedSessions();
    // Start TUI first (async Ink init) so _renderCallback is ready before events arrive
    this.tui = new TUI(this);
    await this.tui.start();
    // Now safe to receive events
    this.socketServer = new SocketServer(SOCK_PATH, (payload) => this.handleEvent(payload));
    this.socketServer.start();
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), CLEANUP_INTERVAL);
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  stop() {
    clearInterval(this.cleanupTimer);
    if (this.socketServer) this.socketServer.stop();
    if (this.tui) this.tui.stop();
    process.exit(0);
  }

  handleEvent(payload) {
    const sid = payload.session_id;
    if (!sid) return;

    // Stop event → close current turn, save last message
    if (payload.event === 'Stop') {
      if (this.workers.has(sid)) {
        const worker = this.workers.get(sid);
        worker.lastEventAt = Date.now();
        worker.status = 'idle';
        const msg = payload.last_assistant_message || '';
        worker.awaitsInput = true; // Stopped → waiting for user input
        // Always update lastMessage (persists independently of turns)
        if (msg) {
          worker.lastMessage = { text: msg, time: Date.now() };
        }
        // Close current turn
        if (worker.currentTurn) {
          worker.currentTurn.actions.forEach(a => a.status = 'done');
          if (msg) {
            worker.currentTurn.summary = msg;
            worker.currentTurn.summaryTime = Date.now();
          }
          worker.turns.push(worker.currentTurn);
          if (worker.turns.length > 2) worker.turns.shift();
          worker.currentTurn = null;
        }
      }
      if (this.tui) this.tui.scheduleRender();
      return;
    }

    // First time seeing this session → create worker entry
    if (!this.workers.has(sid)) {
      this.workers.set(sid, {
        sessionId: sid,
        sessionIdShort: sid.slice(0, 4),
        displayName: path.basename(payload.cwd || 'unknown'),
        cwd: payload.cwd || '',
        modelName: null,
        fleetModelName: null,
        firstEventAt: Date.now(),
        lastEventAt: Date.now(),
        status: 'idle',
        awaitsInput: false,  // true after Stop, cleared by PostToolUse
        turns: [],           // completed turns (max 2)
        currentTurn: null,   // { summary, summaryTime, actions: [] } or null
        lastActions: [],     // flat list of last 3 actions (across turns)
        lastMessage: null,   // latest AI response message (never overwritten by turns)
        termProgram: null,
        itermSessionId: null,
        pid: null,
        ppid: null,
      });
    }

    const worker = this.workers.get(sid);
    worker.lastEventAt = Date.now();

    // SessionStart → capture model info
    if (payload.event === 'SessionStart') {
      worker.modelName = payload.model || null;
      if (payload.fleet_model_name) {
        worker.fleetModelName = payload.fleet_model_name;
      }
      if (payload.term_program) {
        worker.termProgram = payload.term_program;
      }
      if (payload.iterm_session_id) {
        worker.itermSessionId = payload.iterm_session_id;
      }
      if (payload.pid) {
        worker.pid = payload.pid;
      }
      if (payload.ppid) {
        worker.ppid = payload.ppid;
      }
    }

    // PostToolUse → add action to current turn
    if (payload.event === 'PostToolUse') {
      worker.status = 'active';
      worker.awaitsInput = false; // Tool use means Claude is actively working
      // Ensure a current turn exists
      if (!worker.currentTurn) {
        worker.currentTurn = { summary: '', summaryTime: Date.now(), actions: [] };
      }
      // Mark previous action as done
      const actions = worker.currentTurn.actions;
      if (actions.length > 0) {
        actions[actions.length - 1].status = 'done';
      }
      // Add new action as running
      const summary = summarizeToolUse(payload);
      const parts = summary.split(' ', 2);
      const tool = parts[0] || summary;
      const target = parts.length > 1 ? summary.slice(tool.length + 1) : '';
      actions.push({ tool, target, time: Date.now(), status: 'running' });
      // Also update flat lastActions (keep last 3)
      worker.lastActions.push({ tool, target, time: Date.now() });
      if (worker.lastActions.length > 3) worker.lastActions.shift();
    }

    // Notification → close current turn, start new one
    if (payload.event === 'Notification') {
      worker.status = 'active';
      worker.awaitsInput = false;
      if (worker.currentTurn) {
        // Close current turn: mark all actions done, set summary
        worker.currentTurn.actions.forEach(a => a.status = 'done');
        worker.currentTurn.summary = payload.message || '';
        worker.currentTurn.summaryTime = Date.now();
        // Move to turns history (keep max 2)
        worker.turns.push(worker.currentTurn);
        if (worker.turns.length > 2) worker.turns.shift();
      }
      // Start a new empty current turn
      worker.currentTurn = { summary: '', summaryTime: Date.now(), actions: [] };
    }

    if (this.tui) this.tui.scheduleRender();
  }

  cleanupExpired() {
    const now = Date.now();
    for (const [sid, w] of this.workers) {
      const dead = w.ppid && !this.isProcessAlive(w.ppid);
      // Process dead — mark offline immediately
      if (dead) {
        w.status = 'offline';
        // Delete from map only after 30 minutes (no longer useful)
        if (now - w.lastEventAt > 30 * 60 * 1000) {
          this.workers.delete(sid);
          this.deleteSessionFile(sid);
        }
        continue;
      }
      // Process alive but no events for 3 hours — likely stale
      const expired = now - w.lastEventAt > EXPIRE_THRESHOLD;
      if (expired) {
        this.workers.delete(sid);
        this.deleteSessionFile(sid);
      }
    }
    if (this.tui) this.tui.scheduleRender();
  }

  loadPersistedSessions() {
    if (!fs.existsSync(SESSIONS_DIR)) return;
    for (const file of fs.readdirSync(SESSIONS_DIR)) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(SESSIONS_DIR, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        // Verify the process is still alive
        if (data.ppid && !this.isProcessAlive(data.ppid)) {
          fs.unlinkSync(filePath);
          continue;
        }
        const sid = data.sessionId;
        if (!sid || this.workers.has(sid)) {
          fs.unlinkSync(filePath);
          continue;
        }
        this.workers.set(sid, {
          sessionId: sid,
          sessionIdShort: sid.slice(0, 4),
          displayName: path.basename(data.cwd || 'unknown'),
          cwd: data.cwd || '',
          modelName: data.model || null,
          fleetModelName: data.fleet_model_name || null,
          firstEventAt: data.timestamp || Date.now(),
          lastEventAt: data.timestamp || Date.now(),
          status: 'idle',
          turns: [],
          currentTurn: null,
          lastActions: [],
          lastMessage: data.lastMessage || null,
          termProgram: data.term_program || null,
          itermSessionId: data.iterm_session_id || null,
          pid: data.pid || null,
          ppid: data.ppid || null,
        });
      } catch {
        // Corrupted file → remove it
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    }
  }

  isProcessAlive(pid) {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; } catch { return false; }
  }

  deleteSessionFile(sid) {
    const filePath = path.join(SESSIONS_DIR, `${sid}.json`);
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }

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
          _queuePosition: null,
          _queueTotal: null,
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
}

function summarizeToolUse(payload) {
  const tool = payload.tool_name;
  const input = payload.tool_input || {};
  switch (tool) {
    case 'Edit':  return `Edit ${path.basename(input.file_path || '')}`;
    case 'Write': return `Write ${path.basename(input.file_path || '')}`;
    case 'Read':  return `Read ${path.basename(input.file_path || '')}`;
    case 'Bash':  return `Bash: ${(input.command || '').slice(0, 50)}`;
    case 'Grep':  return `Grep "${(input.pattern || '').slice(0, 30)}"`;
    case 'Glob':  return `Glob ${input.pattern || ''}`;
    default:      return tool;
  }
}

function ensureHooks() {
  let settings = {};
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    }
  } catch { /* corrupted, start fresh */ }

  const hookCmd = `node ${HOOK_CLIENT_DST}`;

  if (!settings.hooks) settings.hooks = {};

  for (const eventName of ['SessionStart', 'PostToolUse', 'Stop', 'Notification']) {
    if (!settings.hooks[eventName]) settings.hooks[eventName] = [];

    const exists = settings.hooks[eventName].some(
      group => (group.hooks || []).some(h => h.command && h.command.includes('claude-code-fleet'))
    );
    if (!exists) {
      settings.hooks[eventName].push({
        hooks: [{ type: 'command', command: hookCmd }]
      });
    }
  }

  const tmpPath = SETTINGS_PATH + '.fleet-tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n');
  fs.renameSync(tmpPath, SETTINGS_PATH);
}

function removeHooks() {
  if (!fs.existsSync(SETTINGS_PATH)) return;

  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
  } catch { return; }

  if (!settings.hooks) return;

  for (const eventName of Object.keys(settings.hooks)) {
    settings.hooks[eventName] = settings.hooks[eventName].filter(group => {
      if ((group.hooks || []).some(h => h.command && h.command.includes('claude-code-fleet'))) {
        return false;
      }
      if (group.command && group.command.includes('claude-code-fleet')) {
        return false;
      }
      return true;
    });
    if (settings.hooks[eventName].length === 0) delete settings.hooks[eventName];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  const tmpPath = SETTINGS_PATH + '.fleet-tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n');
  fs.renameSync(tmpPath, SETTINGS_PATH);
}

module.exports = { Master, ensureHooks, removeHooks };
