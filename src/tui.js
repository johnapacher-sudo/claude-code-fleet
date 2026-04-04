// src/tui.js
const path = require('path');

class TUI {
  constructor(master) {
    this.master = master;
    this.running = false;
    this.renderTimer = null;
    this.inkApp = null;
  }

  async start() {
    this.running = true;
    try {
      const { createApp } = await import(path.join(__dirname, 'components', 'app.mjs'));
      this.inkApp = createApp(this.master);
    } catch (err) {
      process.stderr.write(`[fleet] TUI init error: ${err.message}\n`);
      process.stderr.write(`[fleet] Falling back to quiet mode.\n`);
    }
  }

  stop() {
    this.running = false;
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }
    if (this.inkApp) {
      try { this.inkApp.unmount(); } catch { /* already unmounted */ }
      this.inkApp = null;
    }
  }

  scheduleRender() {
    if (!this.running) return;
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      // Trigger Ink rerender via callback set in app.mjs
      if (this.master._renderCallback) {
        this.master._renderCallback();
      }
    }, 100);
  }
}

module.exports = { TUI };
