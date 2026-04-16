const path = require('path');
const defaultFs = require('fs');
const os = require('os');
const { ToolAdapter } = require('./base');

const CODEX_DIR = path.join(os.homedir(), '.codex');
const HOOKS_PATH = path.join(CODEX_DIR, 'hooks.json');
const CONFIG_PATH = path.join(CODEX_DIR, 'config.toml');
const FLEET_IDENTIFIER = 'claude-code-fleet';

class CodexAdapter extends ToolAdapter {
  constructor({ fs } = {}) {
    super();
    this._fs = fs || defaultFs;
  }

  get name() { return 'codex'; }
  get displayName() { return 'Codex CLI'; }
  get binary() { return 'codex'; }
  get hookEvents() { return ['SessionStart', 'PostToolUse', 'Stop']; }

  buildArgs(entry) {
    const args = ['--model', entry.model, '-c', 'approval_policy="never"'];
    if (entry.apiBaseUrl) args.push('-c', `openai_base_url=${JSON.stringify(entry.apiBaseUrl)}`);
    if (entry.args) args.push(...entry.args);
    return args;
  }

  buildEnv(entry, baseEnv) {
    const env = { ...baseEnv, FLEET_MODEL_NAME: entry.name };
    delete env.OPENAI_BASE_URL;
    if (entry.apiKey) env.OPENAI_API_KEY = entry.apiKey;
    return env;
  }

  installHooks(hookClientPath) {
    const fs = this._fs;
    if (!fs.existsSync(CODEX_DIR)) fs.mkdirSync(CODEX_DIR, { recursive: true });

    let hooksConfig = {};
    try {
      if (fs.existsSync(HOOKS_PATH)) {
        hooksConfig = JSON.parse(fs.readFileSync(HOOKS_PATH, 'utf-8'));
      }
    } catch { /* corrupted → start fresh */ }

    const hookCmd = `node ${hookClientPath} --tool codex`;
    if (!hooksConfig.hooks) hooksConfig.hooks = {};

    for (const eventName of this.hookEvents) {
      if (!hooksConfig.hooks[eventName]) hooksConfig.hooks[eventName] = [];
      const exists = hooksConfig.hooks[eventName].some(
        group => (group.hooks || []).some(h => h.command && h.command.includes(FLEET_IDENTIFIER))
      );
      if (!exists) {
        hooksConfig.hooks[eventName].push({
          hooks: [{ type: 'command', command: hookCmd }]
        });
      }
    }

    fs.writeFileSync(HOOKS_PATH, JSON.stringify(hooksConfig, null, 2) + '\n');

    let toml = '';
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        toml = fs.readFileSync(CONFIG_PATH, 'utf-8');
      }
    } catch { /* start fresh */ }

    if (!toml.includes('codex_hooks')) {
      const section = toml.includes('[features]') ? '' : '\n[features]\n';
      const line = 'codex_hooks = true\n';
      if (toml.includes('[features]')) {
        toml = toml.replace('[features]', `[features]\n${line}`);
      } else {
        toml += `${section}${line}`;
      }
      fs.writeFileSync(CONFIG_PATH, toml);
    }
  }

  removeHooks() {
    const fs = this._fs;
    if (!fs.existsSync(HOOKS_PATH)) return;

    let hooksConfig = {};
    try {
      hooksConfig = JSON.parse(fs.readFileSync(HOOKS_PATH, 'utf-8'));
    } catch { return; }

    if (!hooksConfig.hooks) return;

    for (const eventName of Object.keys(hooksConfig.hooks)) {
      hooksConfig.hooks[eventName] = hooksConfig.hooks[eventName].filter(group => {
        if ((group.hooks || []).some(h => h.command && h.command.includes(FLEET_IDENTIFIER))) return false;
        if (group.command && group.command.includes(FLEET_IDENTIFIER)) return false;
        return true;
      });
      if (hooksConfig.hooks[eventName].length === 0) delete hooksConfig.hooks[eventName];
    }
    if (Object.keys(hooksConfig.hooks).length === 0) delete hooksConfig.hooks;

    fs.writeFileSync(HOOKS_PATH, JSON.stringify(hooksConfig, null, 2) + '\n');
  }

  isHookInstalled() {
    const fs = this._fs;
    if (!fs.existsSync(HOOKS_PATH)) return false;
    let hooksConfig = {};
    try {
      hooksConfig = JSON.parse(fs.readFileSync(HOOKS_PATH, 'utf-8'));
    } catch { return false; }

    if (!hooksConfig.hooks) return false;
    return this.hookEvents.every(evt => {
      const groups = hooksConfig.hooks[evt] || [];
      return groups.some(
        g => (g.hooks || []).some(h => h.command && h.command.includes(FLEET_IDENTIFIER))
      );
    });
  }

  normalizePayload(rawInput) {
    return {
      event: rawInput.hook_event_name,
      session_id: rawInput.session_id,
      cwd: rawInput.cwd,
      timestamp: Date.now(),
      model: rawInput.model || null,
      pid: rawInput.pid || process.pid,
      ppid: rawInput.ppid || process.ppid,
      term_program: rawInput.term_program || process.env.TERM_PROGRAM || null,
      iterm_session_id: rawInput.iterm_session_id || process.env.ITERM_SESSION_ID || null,
      tool_name: rawInput.tool_name || null,
      tool_input: rawInput.tool_input || null,
      last_assistant_message: rawInput.last_assistant_message
        ? rawInput.last_assistant_message.slice(0, 500)
        : null,
      message: rawInput.message || null,
    };
  }

  summarizeToolUse(toolName, toolInput) {
    const input = toolInput || {};
    if (toolName === 'Bash') return `Bash: ${(input.command || '').slice(0, 50)}`;
    return toolName;
  }
}

module.exports = { CodexAdapter };
