#!/usr/bin/env node

const readline = require('readline');

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
    this.workers = workers; // Map<string, workerState> — shared reference with master
    this.onInput = onInput; // (action, payload) => void
    this.logs = [];
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
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');
    process.stdin.on('keypress', (ch, key) => this._onKey(ch, key));
    this._render();
  }

  stop() {
    this.running = false;
    try {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
    } catch { /* already closed */ }
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

    const names = this._getWorkerNames();
    if (key && key.name === 'up') {
      this.selectedIdx = Math.max(0, this.selectedIdx - 1);
    } else if (key && key.name === 'down') {
      this.selectedIdx = Math.min(names.length - 1, this.selectedIdx + 1);
    } else if (key && key.name === 'return') {
      this.mode = 'input';
      this.inputText = '';
    } else if (ch === 'a') {
      this.mode = 'input';
      this.inputText = '';
    } else if (ch === 'f') {
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
    const rightPad = Math.max(0, termWidth - 25 - time.length);
    output += `${ANSI.bgBlack}${ANSI.white}${title}${' '.repeat(rightPad)}${time} ${ANSI.reset}\n`;

    // Worker status rows
    output += '\n';
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const w = this.workers[name];
      const icon = STATUS_ICONS[w.status] || STATUS_ICONS.pending;
      const statusStr = (w.status || 'pending').toUpperCase().padEnd(8);
      const progress = `${w.taskIndex || 0}/${w.totalTasks || 0}`;
      const taskStr = w.currentTask || (w.status === 'idle' ? '(no pending tasks)' : '—');
      const elapsed = w.startTime ? this._fmtElapsed(Date.now() - w.startTime) : '00:00:00';
      const selected = i === this.selectedIdx ? `${ANSI.cyan}▸${ANSI.reset}` : ' ';

      const line = ` ${selected} ${icon} ${ANSI.bold}${name.padEnd(16)}${ANSI.reset} ${statusStr} ${progress.padEnd(5)} ${ANSI.dim}${taskStr.slice(0, 40).padEnd(42)}${ANSI.reset} ${elapsed}`;
      output += line.slice(0, termWidth) + '\n';
    }
    output += '\n';

    // Log panel
    const logHeight = Math.max(3, termHeight - names.length - 10);
    output += `${ANSI.dim}├─ Worker Logs ${'─'.repeat(Math.max(0, termWidth - 16))}${ANSI.reset}\n`;

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
    for (let i = visibleLogs.length; i < logHeight; i++) {
      output += '\n';
    }

    // Input area
    output += `${ANSI.dim}├─ Input ${'─'.repeat(Math.max(0, termWidth - 10))}${ANSI.reset}\n`;
    if (this.mode === 'input') {
      const target = names[this.selectedIdx] || '?';
      output += ` ${ANSI.cyan}→ [${target}]${ANSI.reset} ${this.inputText}${ANSI.dim}_${ANSI.reset}\n`;
    } else {
      output += ` > ${ANSI.dim}Enter: send task | a: add task | f: filter | q: quit${ANSI.reset}\n`;
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
