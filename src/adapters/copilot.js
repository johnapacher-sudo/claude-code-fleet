const path = require('path');
const defaultFs = require('fs');
const os = require('os');
const { ToolAdapter } = require('./base');

const COPILOT_DIR = path.join(os.homedir(), '.copilot');
const CONFIG_PATH = path.join(COPILOT_DIR, 'config.json');
const FLEET_IDENTIFIER = 'claude-code-fleet';

const EVENT_KEY_MAP = {
  SessionStart: 'sessionStart',
  PostToolUse: 'postToolUse',
  Stop: 'agentStop',
};

class CopilotAdapter extends ToolAdapter {
  constructor({ fs } = {}) {
    super();
    this._fs = fs || defaultFs;
  }

  get name() { return 'copilot'; }
  get displayName() { return 'GitHub Copilot'; }
  get binary() { return 'copilot'; }
  get hookEvents() { return ['SessionStart', 'PostToolUse', 'Stop']; }

  buildArgs(entry) {
    const args = ['--allow-all'];
    if (entry.args) args.push(...entry.args);
    return args;
  }

  buildEnv(entry, baseEnv) {
    const env = { ...baseEnv, FLEET_MODEL_NAME: entry.name };
    if (entry.model) env.COPILOT_MODEL = entry.model;
    return env;
  }

  installHooks(hookClientPath) {
    const fs = this._fs;
    let config = {};
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      }
    } catch { /* corrupted -> start fresh */ }

    const hookCmd = `node ${hookClientPath} --tool copilot`;
    if (!config.hooks) config.hooks = {};

    for (const eventName of this.hookEvents) {
      const key = EVENT_KEY_MAP[eventName];
      if (!config.hooks[key]) config.hooks[key] = [];
      const exists = config.hooks[key].some(
        group => (group.hooks || []).some(h => h.command && h.command.includes(FLEET_IDENTIFIER))
      );
      if (!exists) {
        config.hooks[key].push({
          hooks: [{ type: 'command', command: hookCmd }]
        });
      }
    }

    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = CONFIG_PATH + '.fleet-tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n');
    fs.renameSync(tmpPath, CONFIG_PATH);
  }

  removeHooks() {
    const fs = this._fs;
    if (!fs.existsSync(CONFIG_PATH)) return;

    let config = {};
    try {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch { return; }

    if (!config.hooks) return;

    for (const key of Object.keys(config.hooks)) {
      config.hooks[key] = config.hooks[key].filter(group => {
        if ((group.hooks || []).some(h => h.command && h.command.includes(FLEET_IDENTIFIER))) return false;
        if (group.command && group.command.includes(FLEET_IDENTIFIER)) return false;
        return true;
      });
      if (config.hooks[key].length === 0) delete config.hooks[key];
    }
    if (Object.keys(config.hooks).length === 0) delete config.hooks;

    const tmpPath = CONFIG_PATH + '.fleet-tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n');
    fs.renameSync(tmpPath, CONFIG_PATH);
  }

  isHookInstalled() {
    const fs = this._fs;
    if (!fs.existsSync(CONFIG_PATH)) return false;
    let config = {};
    try {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch { return false; }

    if (!config.hooks) return false;
    return this.hookEvents.every(evt => {
      const key = EVENT_KEY_MAP[evt];
      const groups = config.hooks[key] || [];
      return groups.some(
        g => (g.hooks || []).some(h => h.command && h.command.includes(FLEET_IDENTIFIER))
      );
    });
  }

  normalizePayload(_rawInput) {
    throw new Error('Not yet implemented');
  }
}

module.exports = { CopilotAdapter };
