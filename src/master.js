#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const os = require('os');
const { SocketServer } = require('./socket');
const { TUI } = require('./tui');

const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.config', 'claude-code-fleet');
const SOCK_PATH = path.join(GLOBAL_CONFIG_DIR, 'fleet.sock');
const HOOKS_DIR = path.join(GLOBAL_CONFIG_DIR, 'hooks');
const HOOK_CLIENT_SRC = path.join(__dirname, 'hook-client.js');
const HOOK_CLIENT_DST = path.join(HOOKS_DIR, 'hook-client.js');
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

  start() {
    // 1. Copy hook-client.js to shared location
    if (!fs.existsSync(HOOKS_DIR)) fs.mkdirSync(HOOKS_DIR, { recursive: true });
    fs.copyFileSync(HOOK_CLIENT_SRC, HOOK_CLIENT_DST);

    // 2. Inject hooks into ~/.claude/settings.json
    ensureHooks();

    // 3. Start socket server
    this.socketServer = new SocketServer(SOCK_PATH, (payload) => this.handleEvent(payload));
    this.socketServer.start();

    // 4. Start cleanup timer (every 5 min, remove workers inactive > 3h)
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), CLEANUP_INTERVAL);

    // 5. Start TUI
    this.tui = new TUI(this);
    this.tui.start();

    // 6. Register exit handlers
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

    // Stop event → remove worker
    if (payload.event === 'Stop') {
      this.workers.delete(sid);
      this.tui.scheduleRender();
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
        lastEvent: '',
        logs: [],
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
    }

    // PostToolUse → record operation
    if (payload.event === 'PostToolUse') {
      worker.lastEvent = summarizeToolUse(payload);
      worker.logs.push({ summary: worker.lastEvent, time: Date.now() });
      if (worker.logs.length > 200) worker.logs.shift();
    }

    // Notification → record message
    if (payload.event === 'Notification') {
      worker.lastEvent = payload.message || 'notification';
      worker.logs.push({ summary: worker.lastEvent, time: Date.now() });
      if (worker.logs.length > 200) worker.logs.shift();
    }

    this.tui.scheduleRender();
  }

  cleanupExpired() {
    const now = Date.now();
    for (const [sid, w] of this.workers) {
      if (now - w.lastEventAt > EXPIRE_THRESHOLD) {
        this.workers.delete(sid);
      }
    }
    this.tui.scheduleRender();
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
      h => h.command && h.command.includes('claude-code-fleet')
    );
    if (!exists) {
      settings.hooks[eventName].push({ command: hookCmd, async: true });
    }
  }

  // Atomic write: temp file → rename
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
    settings.hooks[eventName] = settings.hooks[eventName].filter(
      h => !h.command || !h.command.includes('claude-code-fleet')
    );
    if (settings.hooks[eventName].length === 0) delete settings.hooks[eventName];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  const tmpPath = SETTINGS_PATH + '.fleet-tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n');
  fs.renameSync(tmpPath, SETTINGS_PATH);
}

module.exports = { Master, ensureHooks, removeHooks };
