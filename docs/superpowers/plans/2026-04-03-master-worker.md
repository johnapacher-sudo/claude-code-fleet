# Master-Worker Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a master daemon process that manages Claude Code workers via Unix socket + hooks, with a terminal TUI for real-time monitoring and task management.

**Architecture:** Master process (`fleet start`) forks worker wrappers that spawn `claude -p` instances. Claude Code hooks (PostToolUse, Stop, Notification) communicate with master via Unix socket. Stop hook returns `decision: "block"` with next task to keep Claude working. TUI renders status/logs/input using ANSI escape codes.

**Tech Stack:** Node.js >= 18 built-in modules only (child_process, net, fs, path, readline, tty). No external dependencies.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/socket.js` | Create | Unix socket server + client, JSON protocol |
| `src/hook-client.js` | Create | Bridge: Claude Code hook → Unix socket → master |
| `src/worker.js` | Create | Worker wrapper: spawn claude, forward output, manage lifecycle |
| `src/tui.js` | Create | Terminal UI: status panel, log panel, input handling |
| `src/master.js` | Create | Master orchestrator: socket server, worker manager, task queue, TUI driver |
| `src/index.js` | Modify | Add `start`, `attach`, `task` commands to router |
| `fleet.config.example.json` | Modify | Add `tasks` field to instance config |

Build order: `socket.js` → `hook-client.js` → `worker.js` → `tui.js` → `master.js` → `index.js` changes → config update.

---

### Task 1: Unix Socket Layer (`src/socket.js`)

**Files:**
- Create: `src/socket.js`

This module provides the communication backbone. It exports a `SocketServer` class (used by master) and a `sendToSocket` function (used by hook-client.js).

- [ ] **Step 1: Create `src/socket.js` with SocketServer class and sendToSocket function**

```js
#!/usr/bin/env node

const net = require('net');
const fs = require('fs');

const DEFAULT_SOCK_PATH = require('path').join(
  process.env.HOME || '~', '.config', 'claude-code-fleet', 'fleet.sock'
);

class SocketServer {
  constructor(sockPath = DEFAULT_SOCK_PATH, handler) {
    this.sockPath = sockPath;
    this.handler = handler; // async (message) => response
    this.server = null;
  }

  start() {
    // Clean up stale socket
    if (fs.existsSync(this.sockPath)) {
      fs.unlinkSync(this.sockPath);
    }
    const dir = require('path').dirname(this.sockPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.server = net.createServer((conn) => {
      let buffer = '';
      conn.on('data', (chunk) => {
        buffer += chunk.toString();
        // Messages are newline-delimited JSON
        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.trim()) {
            try {
              const msg = JSON.parse(line);
              Promise.resolve(this.handler(msg)).then((resp) => {
                conn.write(JSON.stringify(resp) + '\n');
              }).catch(() => {
                conn.write(JSON.stringify({ ok: true }) + '\n');
              });
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

function sendToSocket(sockPath, message, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(sockPath, () => {
      sock.write(JSON.stringify(message) + '\n');
    });
    let buffer = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) { settled = true; sock.destroy(); reject(new Error('timeout')); }
    }, timeoutMs);

    sock.on('data', (chunk) => {
      buffer += chunk.toString();
      const idx = buffer.indexOf('\n');
      if (idx !== -1) {
        const line = buffer.slice(0, idx);
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          sock.destroy();
          try { resolve(JSON.parse(line)); }
          catch { resolve({ ok: true }); }
        }
      }
    });

    sock.on('error', (err) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(err); }
    });
  });
}

module.exports = { SocketServer, sendToSocket, DEFAULT_SOCK_PATH };
```

- [ ] **Step 2: Commit**

```bash
git add src/socket.js
git commit -m "feat: add Unix socket server/client for master-worker communication"
```

---

### Task 2: Hook Communication Bridge (`src/hook-client.js`)

**Files:**
- Create: `src/hook-client.js`

This script is invoked by Claude Code hooks. It reads JSON from stdin, forwards to master via Unix socket, and writes the response to stdout. On socket failure it exits cleanly (fail-open) so Claude Code is not disrupted.

- [ ] **Step 1: Create `src/hook-client.js`**

```js
#!/usr/bin/env node

const { sendToSocket } = require('./socket');

const workerName = process.env.FLEET_WORKER_NAME;
const sockPath = process.env.FLEET_SOCK_PATH;
const eventName = process.argv[2]; // PostToolUse | Stop | Notification

if (!workerName || !sockPath || !eventName) {
  // Missing config, fail open
  process.exit(0);
}

async function main() {
  // Read hook input from stdin (JSON from Claude Code)
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  let hookData = {};
  try {
    hookData = JSON.parse(Buffer.concat(chunks).toString());
  } catch { /* empty stdin is fine */ }

  const message = {
    event: eventName,
    worker: workerName,
    ...hookData,
  };

  try {
    const response = await sendToSocket(sockPath, message, 25000);
    if (eventName === 'Stop' && response && response.action === 'continue') {
      // Tell Claude Code to keep going with next task
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: response.reason,
      }));
    }
    process.exit(0);
  } catch {
    // Socket failure — fail open, don't break Claude
    process.exit(0);
  }
}

main();
```

- [ ] **Step 2: Commit**

```bash
git add src/hook-client.js
git commit -m "feat: add hook-client bridge for Claude Code hook → master communication"
```

---

### Task 3: Worker Wrapper (`src/worker.js`)

**Files:**
- Create: `src/worker.js`

Worker receives config via IPC from master, spawns `claude -p` with the first task, and reports stdout/stderr/exit events back to master. On task completion (claude exits), it reports back and waits for next task via IPC.

- [ ] **Step 1: Create `src/worker.js`**

```js
#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function buildHookSettings(workerName, sockPath, hookClientPath) {
  const hookCmd = `FLEET_WORKER_NAME=${workerName} FLEET_SOCK_PATH=${sockPath} node ${hookClientPath}`;
  return {
    hooks: {
      PostToolUse: [{
        hooks: [{ type: 'command', command: `${hookCmd} PostToolUse`, timeout: 5 }]
      }],
      Stop: [{
        hooks: [{ type: 'command', command: `${hookCmd} Stop`, timeout: 30 }]
      }],
      Notification: [{
        hooks: [{ type: 'command', command: `${hookCmd} Notification`, timeout: 5 }]
      }],
    }
  };
}

function injectHookSettings(cwd, workerName, sockPath, hookClientPath) {
  const claudeDir = path.join(cwd, '.claude');
  if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });
  const settingsPath = path.join(claudeDir, 'settings.local.json');
  const settings = buildHookSettings(workerName, sockPath, hookClientPath);
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
}

function runTask(config, task) {
  const cwd = path.resolve(config.cwd || process.cwd());
  if (!fs.existsSync(cwd)) fs.mkdirSync(cwd, { recursive: true });

  // Inject hooks before spawning
  injectHookSettings(cwd, config.name, config.sockPath, config.hookClientPath);

  const claudeArgs = [
    '-p', task,
    '--dangerously-skip-permissions',
  ];
  if (config.model) claudeArgs.push('--model', config.model);
  if (config.args) claudeArgs.push(...config.args);

  const settingsEnv = {};
  if (config.apiKey) {
    settingsEnv.ANTHROPIC_AUTH_TOKEN = config.apiKey;
    settingsEnv.ANTHROPIC_API_KEY = '';
  }
  if (config.apiBaseUrl) settingsEnv.ANTHROPIC_BASE_URL = config.apiBaseUrl;
  if (Object.keys(settingsEnv).length > 0) {
    claudeArgs.push('--settings', JSON.stringify({ env: settingsEnv }));
  }

  const env = { ...process.env };
  if (config.env) Object.assign(env, config.env);

  const child = spawn('claude', claudeArgs, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Forward stdout lines to master
  let stdoutBuf = '';
  child.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString();
    let idx;
    while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, idx);
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (line.trim()) {
        process.send({ type: 'stdout', worker: config.name, data: line });
      }
    }
  });

  // Forward stderr lines to master
  let stderrBuf = '';
  child.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString();
    let idx;
    while ((idx = stderrBuf.indexOf('\n')) !== -1) {
      const line = stderrBuf.slice(0, idx);
      stderrBuf = stderrBuf.slice(idx + 1);
      if (line.trim()) {
        process.send({ type: 'stderr', worker: config.name, data: line });
      }
    }
  });

  return new Promise((resolve) => {
    child.on('exit', (code) => {
      // Flush remaining buffers
      if (stdoutBuf.trim()) process.send({ type: 'stdout', worker: config.name, data: stdoutBuf });
      if (stderrBuf.trim()) process.send({ type: 'stderr', worker: config.name, data: stderrBuf });
      resolve(code);
    });
  });
}

async function main() {
  // Receive initial config from master via IPC
  const config = await new Promise((resolve) => {
    process.once('message', resolve);
  });

  process.send({ type: 'ready', worker: config.name });

  // Wait for task assignments via IPC
  for await (const msg of (function* () {
    while (true) {
      yield new Promise((resolve) => {
        const handler = (m) => {
          process.removeListener('message', handler);
          resolve(m);
        };
        process.on('message', handler);
      });
    }
  })()) {
    if (msg.type === 'task') {
      process.send({ type: 'status', worker: config.name, status: 'running', task: msg.task });
      const exitCode = await runTask(config, msg.task);
      if (exitCode === 0) {
        process.send({ type: 'task_done', worker: config.name, task: msg.task });
      } else {
        process.send({ type: 'task_error', worker: config.name, task: msg.task, exitCode });
      }
    } else if (msg.type === 'shutdown') {
      process.exit(0);
    }
  }
}

main();
```

- [ ] **Step 2: Commit**

```bash
git add src/worker.js
git commit -m "feat: add worker wrapper for managing claude subprocess lifecycle"
```

---

### Task 4: TUI Panel (`src/tui.js`)

**Files:**
- Create: `src/tui.js`

Renders the master dashboard using ANSI escape codes. Zero dependencies. Uses raw stdin for key input and ANSI cursor movements for rendering.

- [ ] **Step 1: Create `src/tui.js`**

```js
#!/usr/bin/env node

const readline = require('readline');

// ANSI helpers
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
  move: (row, col) => `${ESC}${row};${col}H`,
  clearLine: `${ESC}2K`,
  clearDown: `${ESC}0J`,
};

const STATUS_ICONS = {
  running: `${ANSI.green}●${ANSI.reset}`,
  idle:    `${ANSI.dim}○${ANSI.reset}`,
  error:   `${ANSI.red}!${ANSI.reset}`,
  pending: `${ANSI.dim}·${ANSI.reset}`,
};

class TUI {
  constructor(workers, onInput) {
    this.workers = workers; // Map<string, workerState> — shared reference
    this.onInput = onInput; // (action, payload) => void
    this.logs = [];         // { worker, text, type }
    this.selectedIdx = 0;
    this.filterWorker = null;
    this.inputText = '';
    this.mode = 'normal'; // 'normal' | 'input'
    this.maxLogs = 100;
    this.running = false;
  }

  start() {
    this.running = true;
    process.stdout.write(ANSI.clear + ANSI.hideCursor);
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');
    process.stdin.on('keypress', (ch, key) => this._onKey(ch, key));
    this._render();
  }

  stop() {
    this.running = false;
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write(ANSI.showCursor + ANSI.clear);
  }

  addLog(worker, text, type = 'info') {
    this.logs.push({ worker, text, type, time: Date.now() });
    if (this.logs.length > this.maxLogs) this.logs.shift();
    if (this.running) this._render();
  }

  update() {
    if (this.running) this._render();
  }

  _getWorkerNames() {
    return Object.keys(this.workers);
  }

  _onKey(ch, key) {
    if (this.mode === 'input') {
      if (key && key.name === 'escape') {
        this.mode = 'normal';
        this.inputText = '';
      } else if (key && key.name === 'return') {
        const workerNames = this._getWorkerNames();
        const target = workerNames[this.selectedIdx];
        if (target && this.inputText.trim()) {
          this.onInput('task', { worker: target, task: this.inputText.trim() });
        }
        this.inputText = '';
        this.mode = 'normal';
      } else if (key && key.name === 'backspace') {
        this.inputText = this.inputText.slice(0, -1);
      } else if (ch && !key.ctrl && !key.meta) {
        this.inputText += ch;
      }
      this._render();
      return;
    }

    // Normal mode
    const names = this._getWorkerNames();
    if (key && key.name === 'up') {
      this.selectedIdx = Math.max(0, this.selectedIdx - 1);
    } else if (key && key.name === 'down') {
      this.selectedIdx = Math.min(names.length - 1, this.selectedIdx + 1);
    } else if (key && key.name === 'return') {
      // Enter in normal mode: start input mode to send task
      this.mode = 'input';
      this.inputText = '';
    } else if (ch === 'a') {
      // Add task to selected worker
      this.mode = 'input';
      this.inputText = '';
    } else if (ch === 'f') {
      // Toggle filter
      const target = names[this.selectedIdx];
      this.filterWorker = this.filterWorker === target ? null : target;
    } else if (ch === 'q') {
      this.onInput('quit', {});
    }
    this._render();
  }

  _render() {
    const names = this._getWorkerNames();
    const termWidth = process.stdout.columns || 80;
    const termHeight = process.stdout.rows || 24;
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });

    let output = '';

    // Header
    const title = `${ANSI.bold} Claude Code Fleet ${ANSI.reset}`;
    const rightPad = Math.max(0, termWidth - title.length - time.length - 3);
    output += `${ANSI.bgBlack}${ANSI.white}${title}${' '.repeat(rightPad)}${time} ${ANSI.reset}\n`;

    // Worker status rows
    output += '\n';
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const w = this.workers[name];
      const icon = STATUS_ICONS[w.status] || STATUS_ICONS.pending;
      const statusStr = w.status.toUpperCase().padEnd(8);
      const progress = `${w.taskIndex}/${w.totalTasks}`;
      const taskStr = w.currentTask || (w.status === 'idle' ? '(no pending tasks)' : '—');
      const elapsed = w.startTime ? this._fmtElapsed(Date.now() - w.startTime) : '00:00:00';
      const selected = i === this.selectedIdx ? `${ANSI.cyan}▸${ANSI.reset}` : ' ';

      const line = ` ${selected} ${icon} ${ANSI.bold}${name.padEnd(16)}${ANSI.reset} ${statusStr} ${progress.padEnd(5)} ${ANSI.dim}${taskStr.slice(0, 40).padEnd(42)}${ANSI.reset} ${elapsed}`;
      output += line.slice(0, termWidth) + '\n';
    }
    output += '\n';

    // Log panel separator
    const logHeight = Math.max(3, termHeight - names.length - 10);
    output += `${ANSI.dim}├─ Worker Logs ${'─'.repeat(Math.max(0, termWidth - 16))}${ANSI.reset}\n`;

    // Filtered logs
    const filteredLogs = this.filterWorker
      ? this.logs.filter(l => l.worker === this.filterWorker)
      : this.logs;
    const visibleLogs = filteredLogs.slice(-logHeight);
    for (const log of visibleLogs) {
      const colorMap = { info: ANSI.dim, warn: ANSI.yellow, error: ANSI.red, success: ANSI.green };
      const color = colorMap[log.type] || ANSI.dim;
      const prefix = `[${log.worker}]`;
      const line = ` ${color}${prefix} ${log.text.slice(0, termWidth - prefix.length - 3)}${ANSI.reset}`;
      output += line.slice(0, termWidth) + '\n';
    }
    // Pad remaining log area
    for (let i = visibleLogs.length; i < logHeight; i++) {
      output += '\n';
    }

    // Input area
    output += `${ANSI.dim}├─ Input ${'─'.repeat(Math.max(0, termWidth - 10))}${ANSI.reset}\n`;
    if (this.mode === 'input') {
      const target = names[this.selectedIdx] || '?';
      output += ` ${ANSI.cyan}→ [${target}]${ANSI.reset} ${this.inputText}${ANSI.dim}_${ANSI.reset}\n`;
    } else {
      output += ` > ${ANSI.dim}Enter to send task | a add | f filter | q quit${ANSI.reset}\n`;
    }

    process.stdout.write(ANSI.clear + output);
  }

  _fmtElapsed(ms) {
    const s = Math.floor(ms / 1000);
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    return `${h}:${m}:${sec}`;
  }
}

module.exports = { TUI };
```

- [ ] **Step 2: Commit**

```bash
git add src/tui.js
git commit -m "feat: add TUI panel with worker status, logs, and input handling"
```

---

### Task 5: Master Orchestrator (`src/master.js`)

**Files:**
- Create: `src/master.js`

The master ties together the socket server, worker manager, task queue, and TUI. It handles hook messages from workers, manages task queues, and drives the TUI.

- [ ] **Step 1: Create `src/master.js`**

```js
#!/usr/bin/env node

const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');
const { SocketServer } = require('./socket');
const { TUI } = require('./tui');

const GLOBAL_CONFIG_DIR = path.join(process.env.HOME || '~', '.config', 'claude-code-fleet');
const SOCK_PATH = path.join(GLOBAL_CONFIG_DIR, 'fleet.sock');
const HOOKS_DIR = path.join(GLOBAL_CONFIG_DIR, 'hooks');
const HOOK_CLIENT_SRC = path.join(__dirname, 'hook-client.js');
const HOOK_CLIENT_DST = path.join(HOOKS_DIR, 'hook-client.js');
const STATE_FILE = path.join(GLOBAL_CONFIG_DIR, 'fleet-state.json');

class Master {
  constructor(config) {
    this.config = config;
    this.workers = {};       // name -> workerState
    this.children = {};      // name -> ChildProcess
    this.socketServer = null;
    this.tui = null;
  }

  async start() {
    // 1. Copy hook-client.js to shared location
    if (!fs.existsSync(HOOKS_DIR)) fs.mkdirSync(HOOKS_DIR, { recursive: true });
    fs.copyFileSync(HOOK_CLIENT_SRC, HOOK_CLIENT_DST);

    // 2. Initialize worker states
    for (const inst of this.config.instances) {
      this.workers[inst.name] = {
        status: inst.tasks && inst.tasks.length > 0 ? 'pending' : 'idle',
        currentTask: null,
        taskIndex: 0,
        totalTasks: (inst.tasks || []).length,
        pendingTasks: [...(inst.tasks || [])],
        completedTasks: [],
        sessionId: null,
        startTime: null,
        pid: null,
        config: inst,
      };
    }

    // 3. Start socket server
    this.socketServer = new SocketServer(SOCK_PATH, (msg) => this._handleHookMessage(msg));
    this.socketServer.start();

    // 4. Start TUI
    this.tui = new TUI(this.workers, (action, payload) => this._handleUIAction(action, payload));
    this.tui.start();
    this.tui.addLog('master', 'Fleet master started', 'success');

    // 5. Fork workers
    for (const inst of this.config.instances) {
      this._startWorker(inst);
    }

    // 6. Persist state
    this._saveState();
  }

  _startWorker(inst) {
    const w = this.workers[inst.name];
    const workerPath = path.join(__dirname, 'worker.js');

    const child = fork(workerPath, [], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
    this.children[inst.name] = child;
    w.pid = child.pid;

    child.on('message', (msg) => this._handleWorkerMessage(inst.name, msg));

    child.on('exit', (code) => {
      this.tui.addLog(inst.name, `Worker process exited (code=${code})`, code === 0 ? 'info' : 'error');
      if (w.status === 'running') {
        w.status = code === 0 ? 'idle' : 'error';
        w.currentTask = null;
        w.startTime = null;
        this.tui.update();
      }
      this._saveState();
    });

    // Send initial config
    child.send({
      name: inst.name,
      apiKey: inst.apiKey,
      model: inst.model,
      apiBaseUrl: inst.apiBaseUrl,
      cwd: inst.cwd,
      env: inst.env,
      args: inst.args,
      sockPath: SOCK_PATH,
      hookClientPath: HOOK_CLIENT_DST,
    });

    this.tui.addLog(inst.name, 'Worker forked', 'info');

    // Send first task if available
    if (w.pendingTasks.length > 0) {
      const task = w.pendingTasks.shift();
      w.currentTask = task;
      w.status = 'running';
      w.startTime = Date.now();
      child.send({ type: 'task', task });
      this.tui.addLog(inst.name, `Starting task: ${task.slice(0, 60)}`, 'info');
    }
  }

  _handleWorkerMessage(name, msg) {
    const w = this.workers[name];
    if (!w) return;

    switch (msg.type) {
      case 'ready':
        this.tui.addLog(name, 'Worker ready', 'success');
        break;
      case 'stdout':
        // Only log notable lines (skip noise)
        const line = msg.data;
        if (line.length < 200) {
          this.tui.addLog(name, line, 'info');
        }
        break;
      case 'stderr':
        this.tui.addLog(name, msg.data, 'warn');
        break;
      case 'status':
        w.status = msg.status;
        w.currentTask = msg.task;
        this.tui.update();
        break;
      case 'task_done':
        w.completedTasks.push(msg.task);
        w.taskIndex++;
        w.currentTask = null;
        this.tui.addLog(name, `Task completed: ${msg.task.slice(0, 60)}`, 'success');
        // Worker will handle next task via Stop hook + claude -p resume
        // If no more tasks, worker goes idle
        break;
      case 'task_error':
        w.status = 'error';
        w.currentTask = null;
        w.startTime = null;
        this.tui.addLog(name, `Task error (exit=${msg.exitCode}): ${msg.task.slice(0, 60)}`, 'error');
        break;
    }
    this.tui.update();
    this._saveState();
  }

  _handleHookMessage(msg) {
    const name = msg.worker;
    const w = this.workers[name];
    if (!w) return { ok: true };

    switch (msg.event) {
      case 'PostToolUse': {
        const toolName = msg.tool_name || 'unknown';
        const detail = this._summarizeToolCall(toolName, msg.tool_input);
        this.tui.addLog(name, `PostToolUse: ${toolName} ${detail}`, 'info');
        this.tui.update();
        return { ok: true };
      }
      case 'Notification': {
        const message = msg.message || 'unknown notification';
        this.tui.addLog(name, `Notification: ${message.slice(0, 100)}`, 'warn');
        this.tui.update();
        return { ok: true };
      }
      case 'Stop': {
        // Task completed — check for next task
        w.taskIndex++;
        w.completedTasks.push(w.currentTask || 'unknown');
        this.tui.addLog(name, `Task finished: ${(w.currentTask || '').slice(0, 60)}`, 'success');

        if (msg.session_id) w.sessionId = msg.session_id;

        if (w.pendingTasks.length > 0) {
          const nextTask = w.pendingTasks.shift();
          w.currentTask = nextTask;
          w.status = 'running';
          w.startTime = Date.now();
          this.tui.addLog(name, `Next task: ${nextTask.slice(0, 60)}`, 'info');
          this.tui.update();
          this._saveState();
          return { action: 'continue', reason: nextTask };
        } else {
          w.status = 'idle';
          w.currentTask = null;
          w.startTime = null;
          this.tui.addLog(name, 'All tasks completed, now idle', 'info');
          this.tui.update();
          this._saveState();
          return { action: 'stop' };
        }
      }
      default:
        return { ok: true };
    }
  }

  _handleUIAction(action, payload) {
    switch (action) {
      case 'task': {
        const { worker, task } = payload;
        const w = this.workers[worker];
        if (!w) return;
        w.pendingTasks.push(task);
        w.totalTasks++;
        this.tui.addLog(worker, `Task queued: ${task.slice(0, 60)}`, 'info');

        // If worker is idle, send task immediately
        if (w.status === 'idle' && this.children[worker]) {
          const nextTask = w.pendingTasks.shift();
          w.currentTask = nextTask;
          w.status = 'running';
          w.startTime = Date.now();
          this.children[worker].send({ type: 'task', task: nextTask });
          this.tui.addLog(worker, `Starting task: ${nextTask.slice(0, 60)}`, 'info');
        }
        this.tui.update();
        this._saveState();
        break;
      }
      case 'quit':
        this.tui.stop();
        this.socketServer.stop();
        this._saveState();
        console.log('\nFleet master detached. Workers continue running.');
        process.exit(0);
    }
  }

  _summarizeToolCall(toolName, input) {
    if (!input) return '';
    switch (toolName) {
      case 'Edit':
      case 'Write':
        return input.file_path ? `(${path.basename(input.file_path)})` : '';
      case 'Bash':
        return input.command ? `(${input.command.slice(0, 40)})` : '';
      case 'Read':
        return input.file_path ? `(${path.basename(input.file_path)})` : '';
      default:
        return '';
    }
  }

  _saveState() {
    const state = { instances: {} };
    for (const [name, w] of Object.entries(this.workers)) {
      state.instances[name] = {
        status: w.status,
        currentTask: w.currentTask,
        taskIndex: w.taskIndex,
        totalTasks: w.totalTasks,
        pendingTasks: w.pendingTasks,
        completedTasks: w.completedTasks,
        pid: w.pid,
        startTime: w.startTime,
      };
    }
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
  }
}

module.exports = { Master };
```

- [ ] **Step 2: Commit**

```bash
git add src/master.js
git commit -m "feat: add master orchestrator with socket, workers, task queue, and TUI"
```

---

### Task 6: Command Router Updates (`src/index.js`)

**Files:**
- Modify: `src/index.js`

Add `start`, `attach`, and `task` commands to the CLI router. The `start` command launches the master process. The `attach` command connects to a running master's TUI. The `task` command sends a new task to a worker via the Unix socket.

- [ ] **Step 1: Add imports and new command functions to `src/index.js`**

Add at the top of the file, after the existing requires (line 6):

```js
const { Master } = require('./master');
const { sendToSocket } = require('./socket');
```

- [ ] **Step 2: Add `cmdStart` function**

Add before the `// ─── CLI ──` section:

```js
// ─── Master commands ─────────────────────────────────────────────────────

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

async function cmdTaskAdd(workerName, task, configPath) {
  const sockPath = path.join(GLOBAL_CONFIG_DIR, 'fleet.sock');
  if (!fs.existsSync(sockPath)) {
    console.error(ANSI.red('Master is not running. Start with: fleet start'));
    process.exit(1);
  }

  try {
    const resp = await sendToSocket(sockPath, {
      event: 'TaskAdd',
      worker: workerName,
      task,
    }, 3000);
    if (resp.ok) {
      console.log(ANSI.green(`Task added to ${workerName}: ${task}`));
    } else {
      console.error(ANSI.red(`Failed: ${resp.error || 'unknown'}`));
    }
  } catch {
    console.error(ANSI.red('Cannot connect to master. Is fleet start running?'));
    process.exit(1);
  }
}
```

- [ ] **Step 3: Update `parseArgs` to support `task add` subcommand**

No change needed — the existing `parseArgs` already captures `command`, `subcommand`, and `args` which handles `fleet task add <worker> <task>`.

- [ ] **Step 4: Add command routing in `main()` function**

In the `switch (command)` block inside `main()`, add cases before the `default:` case. After the `case 'status':` block:

```js
    case 'start':
      cmdStart(config, opts.only);
      break;
    case 'task':
      if (subcommand === 'add' && args[0] && args[1]) {
        cmdTaskAdd(args[0], args.slice(1).join(' '), opts.config);
      } else {
        console.error(ANSI.red('Usage: fleet task add <worker-name> <task-description>'));
        process.exit(1);
      }
      break;
```

- [ ] **Step 5: Update `printHelp()` to include new commands**

In the `${ANSI.bold('Commands:')}` section of `printHelp()`, add after the `init` line:

```
  start               Start master + all workers (with TUI)
  task add <w> <t>    Add task to a running worker
```

And in the `${ANSI.bold('Examples:')}` section, add:

```
  fleet start                      # Start master with TUI dashboard
  fleet task add opus-worker "Fix bug in auth"
```

- [ ] **Step 6: Commit**

```bash
git add src/index.js
git commit -m "feat: add start, task commands to CLI router"
```

---

### Task 7: Config Template Update (`fleet.config.example.json`)

**Files:**
- Modify: `fleet.config.example.json`

Add the `tasks` field to instance configurations.

- [ ] **Step 1: Update example config**

Replace the full file content with:

```json
{
  "instances": [
    {
      "name": "opus-worker",
      "apiKey": "sk-ant-api03-xxxxx",
      "model": "claude-opus-4-6",
      "apiBaseUrl": "https://api.anthropic.com",
      "cwd": "./workspace/opus",
      "tasks": [
        "Analyze project architecture and output a design document"
      ]
    },
    {
      "name": "sonnet-worker",
      "apiKey": "sk-ant-api03-yyyyy",
      "model": "claude-sonnet-4-6",
      "apiBaseUrl": "https://api.anthropic.com",
      "cwd": "./workspace/sonnet",
      "tasks": [
        "Implement the API interface layer",
        "Write integration tests for the API"
      ]
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

Note: `haiku-worker` and `custom-endpoint` have no `tasks` — they start idle and wait for runtime task assignment via TUI or `fleet task add`.

- [ ] **Step 2: Commit**

```bash
git add fleet.config.example.json
git commit -m "feat: add tasks field to example config"
```

---

### Task 8: Handle `TaskAdd` in Master Socket Handler

**Files:**
- Modify: `src/master.js`

The `cmdTaskAdd` CLI command sends a `TaskAdd` event via the socket. The master's `_handleHookMessage` needs to handle this event.

- [ ] **Step 1: Add TaskAdd case to `_handleHookMessage`**

In `src/master.js`, inside the `_handleHookMessage` method's switch statement, add a new case after `default:` (or replace the default case):

```js
      case 'TaskAdd': {
        const { worker, task } = msg;
        const w = this.workers[worker];
        if (!w) return { ok: false, error: `Unknown worker: ${worker}` };

        w.pendingTasks.push(task);
        w.totalTasks++;
        this.tui.addLog(worker, `Task added via CLI: ${task.slice(0, 60)}`, 'info');

        // If idle, start immediately
        if (w.status === 'idle' && this.children[worker]) {
          const nextTask = w.pendingTasks.shift();
          w.currentTask = nextTask;
          w.status = 'running';
          w.startTime = Date.now();
          this.children[worker].send({ type: 'task', task: nextTask });
          this.tui.addLog(worker, `Starting task: ${nextTask.slice(0, 60)}`, 'info');
        }
        this.tui.update();
        this._saveState();
        return { ok: true };
      }
      default:
        return { ok: true };
```

- [ ] **Step 2: Commit**

```bash
git add src/master.js
git commit -m "feat: handle TaskAdd event from CLI in master socket handler"
```

---

### Task 9: README Update

**Files:**
- Modify: `README.md`
- Modify: `README.zh.md`

Add documentation for the new `start`, `task add` commands and the `tasks` config field.

- [ ] **Step 1: Update English README**

Add after the "Two Modes" section, a new section "### Fleet Mode (with Master)" describing the master daemon, and update the Commands table to include `fleet start` and `fleet task add`. Add a "### Task Queue" subsection under Configuration.

- [ ] **Step 2: Update Chinese README**

Mirror the same changes in Chinese.

- [ ] **Step 3: Commit**

```bash
git add README.md README.zh.md
git commit -m "docs: add master mode and task queue documentation"
```
