# Master Observer Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Fleet Master from a task-dispatching orchestrator to a pure observer panel that passively receives Claude Code hook events.

**Architecture:** Hook-client.js (async, fire-and-forget) sends filtered events to Master via Unix socket. Master maintains a Map of active workers by session_id, auto-cleanup after 3 hours. TUI renders worker status with 100ms debounce. Hooks install into ~/.claude/settings.json at startup.

**Tech Stack:** Node.js >= 18, zero external dependencies, raw ANSI TUI, Unix domain sockets

---

### Task 1: Rewrite src/hook-client.js

**Files:**
- Rewrite: `src/hook-client.js`

- [ ] **Step 1: Write the new hook-client.js**

The new version reads stdin, extracts only necessary fields (no tool_response), detects FLEET_MODEL_NAME env var, sends to Unix socket fire-and-forget, and exits silently if master is not running.

```javascript
#!/usr/bin/env node

const net = require('net');
const os = require('os');
const path = require('path');

const SOCK_PATH = path.join(os.homedir(), '.config', 'claude-code-fleet', 'fleet.sock');

async function main() {
  let input = {};
  try {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString();
    if (raw.trim()) input = JSON.parse(raw);
  } catch { /* empty or invalid stdin */ }

  const payload = {
    event: input.hook_event_name,
    session_id: input.session_id,
    cwd: input.cwd,
    timestamp: Date.now(),
  };

  // SessionStart: extract model
  if (input.hook_event_name === 'SessionStart') {
    payload.model = input.model || null;
  }

  // PostToolUse: only tool_name and tool_input, skip tool_response
  if (input.hook_event_name === 'PostToolUse') {
    payload.tool_name = input.tool_name;
    payload.tool_input = input.tool_input;
  }

  // Notification: message and type
  if (input.hook_event_name === 'Notification') {
    payload.message = input.message;
    payload.notification_type = input.notification_type;
  }

  // fleet run environment variable
  if (process.env.FLEET_MODEL_NAME) {
    payload.fleet_model_name = process.env.FLEET_MODEL_NAME;
  }

  const client = net.connect(SOCK_PATH, () => {
    client.write(JSON.stringify(payload) + '\n');
    client.end();
  });

  // Master not running → connect fails → silent exit
  client.on('error', () => process.exit(0));

  // Timeout protection
  setTimeout(() => process.exit(0), 1000);
}

main();
```

- [ ] **Step 2: Verify it exits silently when master is not running**

Run: `echo '{"hook_event_name":"PostToolUse","session_id":"test"}' | node src/hook-client.js`
Expected: No output, exits immediately (code 0)

- [ ] **Step 3: Commit**

```bash
git add src/hook-client.js
git commit -m "refactor: rewrite hook-client as async fire-and-forget observer"
```

---

### Task 2: Rewrite src/socket.js

**Files:**
- Rewrite: `src/socket.js`

- [ ] **Step 1: Write the new socket.js**

Simplified to receive-only mode. No response sent back to clients. Removes `sendToSocket` since it's no longer needed (task queue removed).

```javascript
#!/usr/bin/env node

const net = require('net');
const fs = require('fs');
const path = require('path');

class SocketServer {
  constructor(sockPath, handler) {
    this.sockPath = sockPath;
    this.handler = handler; // (payload) => void
    this.server = null;
  }

  start() {
    // Clean up stale socket
    if (fs.existsSync(this.sockPath)) {
      fs.unlinkSync(this.sockPath);
    }
    const dir = path.dirname(this.sockPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.server = net.createServer((conn) => {
      let buffer = '';
      conn.on('data', (chunk) => {
        buffer += chunk.toString();
        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.trim()) {
            try {
              const payload = JSON.parse(line);
              this.handler(payload);
            } catch { /* ignore malformed */ }
          }
        }
      });
    });

    this.server.listen(this.sockPath);
  }

  stop() {
    if (this.server) {
      this.server.close();
      try { fs.unlinkSync(this.sockPath); } catch { /* already gone */ }
    }
  }
}

module.exports = { SocketServer };
```

- [ ] **Step 2: Commit**

```bash
git add src/socket.js
git commit -m "refactor: simplify socket to receive-only for observer mode"
```

---

### Task 3: Rewrite src/master.js

**Files:**
- Rewrite: `src/master.js`

- [ ] **Step 1: Write the new master.js**

Core changes: workers is a Map keyed by session_id (not config name). No worker spawning. 3-hour expiry cleanup. Hook injection with atomic writes. Exports `ensureHooks` and `removeHooks` for CLI commands.

```javascript
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
const CLEANUP_INTERVAL = 5 * 60 * 1000;    // 5 minutes
const EXPIRE_THRESHOLD = 3 * 60 * 60 * 1000; // 3 hours

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

  const hookPath = HOOK_CLIENT_DST;
  const hookCmd = `node ${hookPath}`;

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
```

- [ ] **Step 2: Commit**

```bash
git add src/master.js
git commit -m "refactor: rewrite master as pure observer with session tracking"
```

---

### Task 4: Rewrite src/tui.js

**Files:**
- Rewrite: `src/tui.js`

- [ ] **Step 1: Write the new tui.js**

New layout: header with worker count, worker cards showing session ID + model + cwd + recent logs, footer with controls. 100ms render debounce. Reads from `master.workers` Map.

```javascript
#!/usr/bin/env node

const os = require('os');

const ESC = '\x1b[';
const ANSI = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  cyan: `${ESC}36m`,
  white: `${ESC}37m`,
  bgBlack: `${ESC}40m`,
  clear: `${ESC}2J${ESC}H`,
  hideCursor: `${ESC}?25l`,
  showCursor: `${ESC}?25h`,
};

class TUI {
  constructor(master) {
    this.master = master;
    this.running = false;
    this.renderTimer = null;
    this.selectedIdx = 0;
  }

  start() {
    this.running = true;
    process.stdout.write(ANSI.clear + ANSI.hideCursor);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (key) => this._onKey(key));
    this._render();
  }

  stop() {
    this.running = false;
    try {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    } catch { /* already closed */ }
    process.stdout.write(ANSI.showCursor + ANSI.clear);
  }

  scheduleRender() {
    if (!this.running) return;
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      this._render();
    }, 100);
  }

  _getWorkers() {
    return [...this.master.workers.values()];
  }

  _onKey(key) {
    const workers = this._getWorkers();
    if (key === 'q' || key === '\x03') {
      this.master.stop();
    } else if (key === '\x1b[A') {
      this.selectedIdx = Math.max(0, this.selectedIdx - 1);
      this._render();
    } else if (key === '\x1b[B') {
      this.selectedIdx = Math.min(Math.max(0, workers.length - 1), this.selectedIdx + 1);
      this._render();
    }
  }

  _render() {
    const workers = this._getWorkers();
    const termWidth = process.stdout.columns || 80;
    const now = Date.now();

    let output = '';

    // Header bar
    const count = workers.length;
    const headerText = ` Fleet Master `;
    const headerRight = ` ${count} worker${count !== 1 ? 's' : ''} `;
    const padLen = Math.max(0, termWidth - headerText.length - headerRight.length);
    output += `${ANSI.bgBlack}${ANSI.white}${ANSI.bold}${headerText}${ANSI.reset}${' '.repeat(padLen)}${ANSI.bgBlack}${ANSI.white}${headerRight}${ANSI.reset}\n`;

    // Separator
    output += `${ANSI.dim}${'─'.repeat(termWidth)}${ANSI.reset}\n`;

    // Worker cards
    output += '\n';
    for (let i = 0; i < workers.length; i++) {
      const w = workers[i];
      const icon = `${ANSI.green}●${ANSI.reset}`;
      const elapsed = this._fmtElapsed(now - w.firstEventAt);

      // Line 1: icon + displayName + sessionShort + model info + elapsed
      let modelInfo = '';
      if (w.fleetModelName && w.modelName) {
        modelInfo = ` · ${ANSI.cyan}${w.fleetModelName}${ANSI.reset} (${w.modelName})`;
      } else if (w.modelName) {
        modelInfo = ` · ${ANSI.cyan}${w.modelName}${ANSI.reset}`;
      }
      const line1 = ` ${icon} ${ANSI.bold}${w.displayName}${ANSI.reset} ${ANSI.dim}${w.sessionIdShort}${ANSI.reset}${modelInfo}  ${ANSI.dim}[${elapsed}]${ANSI.reset}`;
      output += line1.slice(0, termWidth) + '\n';

      // Line 2: cwd (shortened with ~)
      const homeDir = os.homedir();
      const shortCwd = w.cwd.startsWith(homeDir) ? w.cwd.replace(homeDir, '~') : w.cwd;
      output += `   ${ANSI.dim}${shortCwd}${ANSI.reset}\n`;

      // Lines 3+: recent 3 logs with relative time
      const recentLogs = w.logs.slice(-3);
      for (let j = 0; j < recentLogs.length; j++) {
        const log = recentLogs[j];
        const ago = this._fmtAgo(now - log.time);
        const prefix = j === recentLogs.length - 1 ? '└' : '├';
        const logText = `   ${prefix} ${log.summary}`;
        const rightText = `${ANSI.dim}${ago}${ANSI.reset}`;
        const availWidth = termWidth - logText.length - ago.length - 1;
        if (availWidth > 0) {
          output += `${logText}${' '.repeat(availWidth)}${rightText}\n`;
        } else {
          output += `${logText.slice(0, termWidth)}\n`;
        }
      }
      if (recentLogs.length === 0) {
        output += `   ${ANSI.dim}└ waiting for events...${ANSI.reset}\n`;
      }

      output += '\n';
    }

    // Empty state
    if (workers.length === 0) {
      output += `  ${ANSI.dim}No active workers. Start claude processes to see them here.${ANSI.reset}\n\n`;
    }

    // Footer
    output += `${ANSI.dim}${'─'.repeat(termWidth)}${ANSI.reset}\n`;
    output += `${ANSI.dim} [q] Quit  [↑↓] Scroll${ANSI.reset}`;

    process.stdout.write(ANSI.clear + output);
  }

  _fmtElapsed(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    return `${h}h${m % 60}m`;
  }

  _fmtAgo(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ago`;
  }
}

module.exports = { TUI };
```

- [ ] **Step 2: Commit**

```bash
git add src/tui.js
git commit -m "refactor: rewrite TUI for observer layout with debounce"
```

---

### Task 5: Modify src/index.js

**Files:**
- Modify: `src/index.js`

This is a large file (785 lines). Changes are:

1. **Remove** the `sendToSocket` import (line 8) — no longer used
2. **Modify** `cmdRun()` — inject `FLEET_MODEL_NAME` env var
3. **Rewrite** `cmdStart()` — no config needed, just start Master
4. **Remove** `cmdTaskAdd()` function (lines 611-633)
5. **Add** `cmdHooksInstall()`, `cmdHooksRemove()`, `cmdHooksStatus()` functions
6. **Update** CLI router — move `start` before config loading, add `hooks` subcommands, remove `task`
7. **Update** `printHelp()`

- [ ] **Step 1: Remove sendToSocket import**

Change line 8 from:
```javascript
const { sendToSocket } = require('./socket');
```
to:
```javascript
// socket module no longer exports sendToSocket
```
(Delete the line entirely.)

- [ ] **Step 2: Modify cmdRun to inject FLEET_MODEL_NAME env var**

In the `cmdRun` function, after building `claudeArgs` and before spawning, add `FLEET_MODEL_NAME` to the child process environment. Change the spawn call from:

```javascript
  const child = spawn('claude', claudeArgs, {
    cwd: workDir,
    stdio: 'inherit',
  });
```

to:

```javascript
  const env = { ...process.env, FLEET_MODEL_NAME: entry.name };
  const child = spawn('claude', claudeArgs, {
    cwd: workDir,
    stdio: 'inherit',
    env,
  });
```

- [ ] **Step 3: Rewrite cmdStart to not require config**

Replace the existing `cmdStart` function (lines 585-609):

```javascript
function cmdStart(config, onlyNames) {
  checkDeps();

  const instances = onlyNames
    ? filterInstances(config.instances, onlyNames)
    : config.instances;

  const masterConfig = { ...config, instances };
  const master = new Master(masterConfig);

  process.on('SIGINT', () => {
    master.tui.stop();
    master.socketServer.stop();
    console.log('\nFleet master stopped.');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    master.tui.stop();
    master.socketServer.stop();
    process.exit(0);
  });

  master.start();
}
```

with:

```javascript
function cmdStart() {
  const master = new Master();
  master.start();
}
```

Note: `Master` now takes no arguments. SIGINT/SIGTERM handling is inside `Master.start()`.

- [ ] **Step 4: Remove cmdTaskAdd function**

Delete the entire `cmdTaskAdd` function (lines 611-633).

- [ ] **Step 5: Add hooks commands**

Add these three functions after the `cmdDown` function:

```javascript
function cmdHooksInstall() {
  const { ensureHooks } = require('./master');
  ensureHooks();
  console.log(ANSI.green('Fleet hooks installed to ~/.claude/settings.json'));
}

function cmdHooksRemove() {
  const { removeHooks } = require('./master');
  removeHooks();
  console.log(ANSI.green('Fleet hooks removed from ~/.claude/settings.json'));
}

function cmdHooksStatus() {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    console.log(ANSI.yellow('No ~/.claude/settings.json found'));
    return;
  }
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {
    console.log(ANSI.red('Cannot parse ~/.claude/settings.json'));
    return;
  }

  const events = ['SessionStart', 'PostToolUse', 'Stop', 'Notification'];
  console.log(ANSI.bold('\nFleet Hooks Status:\n'));
  for (const evt of events) {
    const hooks = (settings.hooks && settings.hooks[evt]) || [];
    const fleetHooks = hooks.filter(h => h.command && h.command.includes('claude-code-fleet'));
    if (fleetHooks.length > 0) {
      console.log(`  ${ANSI.green('✓')} ${evt}: ${fleetHooks.length} fleet hook(s)`);
    } else {
      console.log(`  ${ANSI.red('✗')} ${evt}: not installed`);
    }
  }
  console.log();
}
```

Note: requires `const os = require('os');` at the top of the file. Add it right after the existing `const fs = require('fs');` line:

```javascript
const os = require('os');
```

- [ ] **Step 6: Update CLI router**

The main `main()` function currently loads config for all commands except `init`, `model`, and `run`. Move `start` and `hooks` to the pre-config block too.

Replace the `main()` function's switch logic. The full replacement for the routing section:

```javascript
function main() {
  const { command, subcommand, args, opts } = parseArgs(process.argv.slice(2));

  if (opts.help || command === 'help') {
    printHelp();
    process.exit(0);
  }

  if (command === 'init') {
    cmdInit();
    return;
  }

  // Model management commands (don't need fleet config)
  if (command === 'model') {
    const modelCmd = subcommand || 'list';
    switch (modelCmd) {
      case 'add':
        cmdModelAdd();
        break;
      case 'list':
      case 'ls':
        cmdModelList();
        break;
      case 'edit':
        cmdModelEdit();
        break;
      case 'delete':
      case 'rm':
        cmdModelDelete();
        break;
      default:
        console.error(ANSI.red(`Unknown model command: ${modelCmd}`));
        console.error('Available: add, list, edit, delete');
        process.exit(1);
    }
    return;
  }

  // Run command (doesn't need fleet config)
  if (command === 'run') {
    cmdRun(opts.model, opts.cwd);
    return;
  }

  // Observer start (doesn't need fleet config)
  if (command === 'start') {
    cmdStart();
    return;
  }

  // Hooks management (doesn't need fleet config)
  if (command === 'hooks') {
    const hooksCmd = subcommand || 'status';
    switch (hooksCmd) {
      case 'install':
        cmdHooksInstall();
        break;
      case 'remove':
        cmdHooksRemove();
        break;
      case 'status':
        cmdHooksStatus();
        break;
      default:
        console.error(ANSI.red(`Unknown hooks command: ${hooksCmd}`));
        console.error('Available: install, remove, status');
        process.exit(1);
    }
    return;
  }

  // Remaining commands need fleet config
  const config = loadConfig(opts.config);

  switch (command) {
    case 'up':
      cmdUp(config, opts.only);
      break;
    case 'down':
    case 'stop':
      cmdDown();
      break;
    case 'restart':
      cmdRestart(config, opts.only);
      break;
    case 'ls':
    case 'list':
      cmdLs();
      break;
    case 'status':
      cmdStatus(config);
      break;
    default:
      console.error(ANSI.red(`Unknown command: ${command}`));
      printHelp();
      process.exit(1);
  }
}
```

- [ ] **Step 7: Update printHelp**

Replace the entire `printHelp` function with:

```javascript
function printHelp() {
  console.log(`${ANSI.bold('Claude Code Fleet')} — Observe multiple Claude Code processes

${ANSI.bold('Usage:')}
  fleet [command] [options]

${ANSI.bold('Commands:')}
  run                 Start Claude Code with a model profile
  start               Start fleet observer (TUI dashboard)
  hooks install       Install fleet hooks to ~/.claude/settings.json
  hooks remove        Remove fleet hooks from ~/.claude/settings.json
  hooks status        Show current hook installation status
  model add           Add a new model profile
  model list          List all model profiles
  model edit          Edit a model profile (interactive)
  model delete        Delete a model profile (interactive)
  up                  Start instances from config (background)
  down                Stop all background instances
  restart             Restart instances
  ls                  List running instances
  status              Show instance configuration details
  init                Create a fleet.config.json from template

${ANSI.bold('Options:')}
  --config <path>   Use specific config file
  --only <names>    Comma-separated instance names to target
  --model <name>    Model profile name (for run command)
  --cwd <path>      Working directory (for run command)
  -h, --help        Show this help

${ANSI.bold('Examples:')}
  fleet start                       # Start observer dashboard
  fleet run --model opus-prod       # Start Claude Code with a model profile
  fleet hooks status                # Check hook installation status
  fleet model add                   # Add a model profile interactively
  fleet up                          # Start all instances (background)
`);
}
```

- [ ] **Step 8: Verify the file parses correctly**

Run: `node -c src/index.js`
Expected: No syntax errors

- [ ] **Step 9: Commit**

```bash
git add src/index.js
git commit -m "refactor: update CLI for observer mode, add hooks commands"
```

---

### Task 6: Delete src/worker.js and update fleet.config.example.json

**Files:**
- Delete: `src/worker.js`
- Modify: `fleet.config.example.json`

- [ ] **Step 1: Delete worker.js**

```bash
git rm src/worker.js
```

- [ ] **Step 2: Simplify fleet.config.example.json**

Remove the `tasks` fields from all instances. Replace the file content with:

```json
{
  "instances": [
    {
      "name": "opus-worker",
      "apiKey": "sk-ant-api03-xxxxx",
      "model": "claude-opus-4-6",
      "apiBaseUrl": "https://api.anthropic.com",
      "cwd": "./workspace/opus"
    },
    {
      "name": "sonnet-worker",
      "apiKey": "sk-ant-api03-yyyyy",
      "model": "claude-sonnet-4-6",
      "apiBaseUrl": "https://api.anthropic.com",
      "cwd": "./workspace/sonnet"
    },
    {
      "name": "haiku-worker",
      "apiKey": "sk-ant-api03-zzzzz",
      "model": "claude-haiku-4-5-20251001",
      "cwd": "./workspace/haiku"
    },
    {
      "name": "custom-endpoint",
      "apiKey": "your-custom-api-key",
      "model": "claude-sonnet-4-6",
      "apiBaseUrl": "https://your-proxy.example.com/v1",
      "cwd": "./workspace/custom",
      "env": {
        "CUSTOM_HEADER": "some-value"
      },
      "args": ["--verbose"]
    }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "refactor: remove worker.js and simplify config example"
```

---

### Task 7: Smoke test

- [ ] **Step 1: Verify all files parse without errors**

```bash
node -c src/hook-client.js
node -c src/socket.js
node -c src/master.js
node -c src/tui.js
node -c src/index.js
```
Expected: All pass with no output

- [ ] **Step 2: Test fleet hooks status**

```bash
node src/index.js hooks status
```
Expected: Shows hook status for all 4 events (likely "not installed" if first run)

- [ ] **Step 3: Test fleet hooks install**

```bash
node src/index.js hooks install
node src/index.js hooks status
```
Expected: Install reports success, status shows all 4 events with fleet hooks

- [ ] **Step 4: Test fleet hooks remove**

```bash
node src/index.js hooks remove
node src/index.js hooks status
```
Expected: Remove reports success, status shows "not installed"

- [ ] **Step 5: Re-install hooks for master start test**

```bash
node src/index.js hooks install
```

- [ ] **Step 6: Test fleet start (quick visual check)**

```bash
timeout 3 node src/index.js start || true
```
Expected: TUI renders with "No active workers" message, then exits after 3 seconds. Note: `timeout` may not be available on macOS; use Ctrl+C after a few seconds if testing manually.

- [ ] **Step 7: Test hook-client silent exit**

```bash
echo '{"hook_event_name":"PostToolUse","session_id":"test123","cwd":"/tmp"}' | node src/hook-client.js
echo "exit code: $?"
```
Expected: No output, exit code 0

---

### Task 8: Update README files

**Files:**
- Modify: `README.md`
- Modify: `README.zh.md`

- [ ] **Step 1: Update README.md**

Update the commands table and master mode description to reflect observer mode. Key changes:
- Replace "Master Mode (TUI dashboard + task queues)" with "Observer Mode (TUI dashboard)"
- Remove references to task queues, task add command
- Add hooks commands to the commands table
- Update the "How it works" section for observer mode
- Note that `fleet start` no longer requires a config file

- [ ] **Step 2: Update README.zh.md**

Same changes as README.md but in Chinese.

- [ ] **Step 3: Commit**

```bash
git add README.md README.zh.md
git commit -m "docs: update READMEs for observer mode"
```
