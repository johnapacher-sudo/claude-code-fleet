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
    this.workers = {};       // name -> workerState (shared with TUI)
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
    this.socketServer = new SocketServer(SOCK_PATH, (msg) => this._handleMessage(msg));
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
      case 'stdout': {
        const line = msg.data || '';
        if (line.length < 200) {
          this.tui.addLog(name, line, 'info');
        }
        break;
      }
      case 'stderr':
        this.tui.addLog(name, msg.data || '', 'warn');
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
        this.tui.addLog(name, `Task completed: ${(msg.task || '').slice(0, 60)}`, 'success');
        break;
      case 'task_error':
        w.status = 'error';
        w.currentTask = null;
        w.startTime = null;
        this.tui.addLog(name, `Task error (exit=${msg.exitCode}): ${(msg.task || '').slice(0, 60)}`, 'error');
        break;
    }
    this.tui.update();
    this._saveState();
  }

  _handleMessage(msg) {
    const name = msg.worker;
    const w = this.workers[name];

    // Handle TaskAdd from CLI
    if (msg.event === 'TaskAdd') {
      if (!w) return { ok: false, error: `Unknown worker: ${msg.worker}` };
      return this._addTask(msg.worker, msg.task);
    }

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
        // Task completed via hook — check for next task
        if (w.currentTask) {
          w.completedTasks.push(w.currentTask);
          w.taskIndex++;
        }
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
        }
        w.status = 'idle';
        w.currentTask = null;
        w.startTime = null;
        this.tui.addLog(name, 'All tasks completed, now idle', 'success');
        this.tui.update();
        this._saveState();
        return { action: 'stop' };
      }
      default:
        return { ok: true };
    }
  }

  _handleUIAction(action, payload) {
    switch (action) {
      case 'task': {
        this._addTask(payload.worker, payload.task);
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

  _addTask(workerName, task) {
    const w = this.workers[workerName];
    if (!w) return { ok: false, error: `Unknown worker: ${workerName}` };

    w.pendingTasks.push(task);
    w.totalTasks++;
    this.tui.addLog(workerName, `Task queued: ${task.slice(0, 60)}`, 'info');

    // If worker is idle, start immediately
    if (w.status === 'idle' && this.children[workerName]) {
      const nextTask = w.pendingTasks.shift();
      w.currentTask = nextTask;
      w.status = 'running';
      w.startTime = Date.now();
      this.children[workerName].send({ type: 'task', task: nextTask });
      this.tui.addLog(workerName, `Starting task: ${nextTask.slice(0, 60)}`, 'info');
    }
    this.tui.update();
    this._saveState();
    return { ok: true };
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
