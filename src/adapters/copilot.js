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

  installHooks(_hookClientPath) {
    throw new Error('Not yet implemented');
  }

  removeHooks() {
    throw new Error('Not yet implemented');
  }

  normalizePayload(_rawInput) {
    throw new Error('Not yet implemented');
  }
}

module.exports = { CopilotAdapter };
