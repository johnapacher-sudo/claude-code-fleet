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
    if (!fs.existsSync(HOOKS_DIR)) fs.mkdirSync(HOOKS_DIR, { recursive: true });
    fs.copyFileSync(HOOK_CLIENT_SRC, HOOK_CLIENT_DST);
    ensureHooks();
    this.socketServer = new SocketServer(SOCK_PATH, (payload) => this.handleEvent(payload));
    this.socketServer.start();
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), CLEANUP_INTERVAL);
    this.tui = new TUI(this);
    this.tui.start();
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

    // Stop event → complete current round, keep worker
    if (payload.event === 'Stop') {
      if (this.workers.has(sid)) {
        const worker = this.workers.get(sid);
        worker.lastEventAt = Date.now();
        worker.status = 'idle';
        worker.lastResponse = (payload.last_assistant_message || '').slice(0, 500);

        // Complete current round
        const round = {
          actions: [...worker.currentRound.actions],
          response: worker.lastResponse,
          endTime: Date.now(),
        };
        worker.rounds.push(round);
        if (worker.rounds.length > 10) worker.rounds.shift();
        worker.currentRound = { actions: [] };
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
        currentRound: { actions: [] },
        rounds: [],
        lastResponse: '',
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

    // PostToolUse → add action to current round
    if (payload.event === 'PostToolUse') {
      worker.status = 'active';
      const summary = summarizeToolUse(payload);
      worker.currentRound.actions.push({ summary, time: Date.now() });
      if (worker.currentRound.actions.length > 30) worker.currentRound.actions.shift();
    }

    // Notification → record message
    if (payload.event === 'Notification') {
      worker.status = 'active';
      worker.currentRound.actions.push({
        summary: payload.message || 'notification',
        time: Date.now(),
      });
      if (worker.currentRound.actions.length > 30) worker.currentRound.actions.shift();
    }

    if (this.tui) this.tui.scheduleRender();
  }

  cleanupExpired() {
    const now = Date.now();
    for (const [sid, w] of this.workers) {
      if (now - w.lastEventAt > EXPIRE_THRESHOLD) {
        this.workers.delete(sid);
      }
    }
    if (this.tui) this.tui.scheduleRender();
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
