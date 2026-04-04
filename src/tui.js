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
    try {
    const workers = this._getWorkers();
    const termWidth = process.stdout.columns || 80;
    const now = Date.now();

    let output = '';

    // Header bar
    const count = workers.length;
    const headerText = ' Fleet Master ';
    const headerRight = ` ${count} worker${count !== 1 ? 's' : ''} `;
    const padLen = Math.max(0, termWidth - headerText.length - headerRight.length);
    output += `${ANSI.bgBlack}${ANSI.white}${ANSI.bold}${headerText}${ANSI.reset}${' '.repeat(padLen)}${ANSI.bgBlack}${ANSI.white}${headerRight}${ANSI.reset}\n`;

    // Separator
    output += `${ANSI.dim}${'─'.repeat(termWidth)}${ANSI.reset}\n`;

    // Worker cards
    output += '\n';
    for (let i = 0; i < workers.length; i++) {
      const w = workers[i];
      const icon = `${ANSI.green}\u25CF${ANSI.reset}`;
      const elapsed = this._fmtElapsed(now - w.firstEventAt);

      // Line 1: icon + displayName + sessionShort + model info + elapsed
      let modelInfo = '';
      if (w.fleetModelName && w.modelName) {
        modelInfo = ` \u00B7 ${ANSI.cyan}${w.fleetModelName}${ANSI.reset} (${w.modelName})`;
      } else if (w.modelName) {
        modelInfo = ` \u00B7 ${ANSI.cyan}${w.modelName}${ANSI.reset}`;
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
        const prefix = j === recentLogs.length - 1 ? '\u2514' : '\u251C';
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
        output += `   ${ANSI.dim}\u2514 waiting for events...${ANSI.reset}\n`;
      }

      output += '\n';
    }

    // Empty state
    if (workers.length === 0) {
      output += `  ${ANSI.dim}No active workers. Start claude processes to see them here.${ANSI.reset}\n\n`;
    }

    // Footer
    output += `${ANSI.dim}${'─'.repeat(termWidth)}${ANSI.reset}\n`;
    output += `${ANSI.dim} [q] Quit  [\u2191\u2193] Scroll${ANSI.reset}`;

    process.stdout.write(ANSI.clear + output);
    } catch (err) {
      // Prevent render errors from crashing the process
      process.stderr.write(`[fleet] render error: ${err.message}\n`);
    }
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
