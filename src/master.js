#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const os = require('os');
const { SocketServer } = require('./socket');
const { TUI } = require('./tui');
const { registry } = require('./adapters');

const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.config', 'claude-code-fleet');
const SOCK_PATH = path.join(GLOBAL_CONFIG_DIR, 'fleet.sock');
const HOOKS_DIR = path.join(GLOBAL_CONFIG_DIR, 'hooks');
const SESSIONS_DIR = path.join(GLOBAL_CONFIG_DIR, 'sessions');
const HOOK_CLIENT_SRC = path.join(__dirname, 'hook-client.js');
const HOOK_CLIENT_DST = path.join(HOOKS_DIR, 'hook-client.js');
const NOTIFIER_SRC = path.join(__dirname, 'notifier.js');
const NOTIFIER_DST = path.join(HOOKS_DIR, 'notifier.js');
const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const CLEANUP_INTERVAL = 5 * 60 * 1000;
const EXPIRE_THRESHOLD = 3 * 60 * 60 * 1000;

class Master {
  constructor() {
    this.workers = new Map();
    this.socketServer = null;
    this.tui = null;
    this.cleanupTimer = null;
  }

  async start() {
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
        tool: payload._tool || 'claude',
        modelName: null,
        fleetModelName: null,
        firstEventAt: Date.now(),
        lastEventAt: Date.now(),
        status: 'idle',
        awaitsInput: false,
        turns: [],
        currentTurn: null,
        lastActions: [],
        lastMessage: null,
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
      worker.awaitsInput = false;
      if (!worker.currentTurn) {
        worker.currentTurn = { summary: '', summaryTime: Date.now(), actions: [] };
      }
      const actions = worker.currentTurn.actions;
      if (actions.length > 0) {
        actions[actions.length - 1].status = 'done';
      }
      const adapter = registry.get(worker.tool || 'claude');
      const summary = adapter
        ? adapter.summarizeToolUse(payload.tool_name, payload.tool_input)
        : `${payload.tool_name}`;
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
          tool: data.tool || 'claude',
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

  killWorker(sessionId) {
    const worker = this.workers.get(sessionId);
    if (!worker || !worker.ppid) return false;

    try { process.kill(worker.ppid, 'SIGTERM'); } catch { /* already dead */ }

    worker.status = 'offline';
    worker.lastEventAt = Date.now();
    if (this.tui) this.tui.scheduleRender();

    // Force kill after 2s if still alive
    const ppid = worker.ppid;
    setTimeout(() => {
      if (this.isProcessAlive(ppid)) {
        try { process.kill(ppid, 'SIGKILL'); } catch { /* already dead */ }
      }
    }, 2000);

    return true;
  }

  isProcessAlive(pid) {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; } catch { return false; }
  }

  deleteSessionFile(sid) {
    const filePath = path.join(SESSIONS_DIR, `${sid}.json`);
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }
}

function ensureHooks() {
  if (!fs.existsSync(HOOKS_DIR)) fs.mkdirSync(HOOKS_DIR, { recursive: true });
  fs.copyFileSync(HOOK_CLIENT_SRC, HOOK_CLIENT_DST);
  if (fs.existsSync(NOTIFIER_SRC)) fs.copyFileSync(NOTIFIER_SRC, NOTIFIER_DST);

  const adaptersSrc = path.join(__dirname, 'adapters');
  const adaptersDst = path.join(HOOKS_DIR, 'adapters');
  if (!fs.existsSync(adaptersDst)) fs.mkdirSync(adaptersDst, { recursive: true });
  for (const file of ['base.js', 'claude.js', 'codex.js', 'copilot.js', 'registry.js', 'index.js']) {
    const src = path.join(adaptersSrc, file);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(adaptersDst, file));
  }

  const installedAdapters = registry.installed();
  for (const adapter of installedAdapters) {
    // Copilot hooks are per-repo (.github/hooks/fleet.json) — skip in global install
    if (adapter.name === 'copilot') continue;
    adapter.installHooks(HOOK_CLIENT_DST);
  }
}

function removeHooks() {
  for (const adapter of registry.all()) {
    // Copilot hooks are per-repo — can't remove globally
    if (adapter.name === 'copilot') continue;
    adapter.removeHooks();
  }
}

module.exports = { Master, ensureHooks, removeHooks };
