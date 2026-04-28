const path = require('path');
const defaultFs = require('fs');
const os = require('os');
const { ToolAdapter } = require('./base');

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const FLEET_IDENTIFIER = 'claude-code-fleet';

class ClaudeAdapter extends ToolAdapter {
  constructor({ fs } = {}) {
    super();
    this._fs = fs || defaultFs;
  }

  get name() { return 'claude'; }
  get displayName() { return 'Claude Code'; }
  get binary() { return 'claude'; }
  get hookEvents() { return ['SessionStart', 'PostToolUse', 'Stop', 'Notification']; }

  get commonEnvVars() {
    return [
      { key: 'ANTHROPIC_LOG', hint: 'debug | info | warn' },
      { key: 'ANTHROPIC_BASE_URL', hint: 'API endpoint override' },
      { key: 'ANTHROPIC_AUTH_TOKEN', hint: 'Auth token (overrides apiKey)' },
    ];
  }

  buildArgs(entry) {
    const settingsEnv = {};
    if (entry.apiKey) {
      settingsEnv.ANTHROPIC_AUTH_TOKEN = entry.apiKey;
      settingsEnv.ANTHROPIC_API_KEY = '';
    }
    if (entry.apiBaseUrl) settingsEnv.ANTHROPIC_BASE_URL = entry.apiBaseUrl;
    if (entry.env && typeof entry.env === 'object') {
      for (const [k, v] of Object.entries(entry.env)) {
        if (v !== undefined && v !== null) settingsEnv[k] = String(v);
      }
    }

    const args = ['--dangerously-skip-permissions'];
    if (entry.model) args.push('--model', entry.model);
    args.push('--settings', JSON.stringify({ env: settingsEnv }));
    if (entry.args) args.push(...entry.args);
    return args;
  }

  buildEnv(entry, baseEnv) {
    const env = { ...baseEnv, FLEET_MODEL_NAME: entry.name };
    return this.applyUserEnv(entry, env);
  }

  installHooks(hookClientPath) {
    const fs = this._fs;
    let settings = {};
    try {
      if (fs.existsSync(SETTINGS_PATH)) {
        settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
      }
    } catch { /* corrupted → start fresh */ }

    const hookCmd = `node ${hookClientPath} --tool claude`;
    if (!settings.hooks) settings.hooks = {};

    for (const eventName of this.hookEvents) {
      if (!settings.hooks[eventName]) settings.hooks[eventName] = [];
      const exists = settings.hooks[eventName].some(
        group => (group.hooks || []).some(h => h.command && h.command.includes(FLEET_IDENTIFIER))
      );
      if (!exists) {
        settings.hooks[eventName].push({
          hooks: [{ type: 'command', command: hookCmd }]
        });
      }
    }

    const dir = path.dirname(SETTINGS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = SETTINGS_PATH + '.fleet-tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n');
    fs.renameSync(tmpPath, SETTINGS_PATH);
  }

  removeHooks() {
    const fs = this._fs;
    if (!fs.existsSync(SETTINGS_PATH)) return;

    let settings = {};
    try {
      settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    } catch { return; }

    if (!settings.hooks) return;

    for (const eventName of Object.keys(settings.hooks)) {
      settings.hooks[eventName] = settings.hooks[eventName].filter(group => {
        if ((group.hooks || []).some(h => h.command && h.command.includes(FLEET_IDENTIFIER))) return false;
        if (group.command && group.command.includes(FLEET_IDENTIFIER)) return false;
        return true;
      });
      if (settings.hooks[eventName].length === 0) delete settings.hooks[eventName];
    }
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

    const tmpPath = SETTINGS_PATH + '.fleet-tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n');
    fs.renameSync(tmpPath, SETTINGS_PATH);
  }

  isHookInstalled() {
    const fs = this._fs;
    if (!fs.existsSync(SETTINGS_PATH)) return false;
    let settings = {};
    try {
      settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    } catch { return false; }

    if (!settings.hooks) return false;
    return this.hookEvents.every(evt => {
      const groups = settings.hooks[evt] || [];
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
      notification_type: rawInput.notification_type || null,
    };
  }

  classifyFailure(result) {
    const stderr = (result.stderrSnippet || '').toLowerCase();

    if (/rate limit exceeded|rate_limit|too many requests|429/.test(stderr)) {
      return { kind: 'failover-safe', reason: 'rate_limited' };
    }
    if (/tls handshake failed|socket hang up before startup completed|proxy connect aborted/.test(stderr)) {
      return { kind: 'failover-safe', reason: 'startup_transient_error' };
    }
    if (/econnrefused|econnreset|upstream connect error|service unavailable/.test(stderr)) {
      return { kind: 'failover-safe', reason: 'upstream_unreachable' };
    }
    if (/temporarily unavailable|try again later|auth.*temporar/.test(stderr)) {
      return { kind: 'failover-safe', reason: 'auth_temporarily_unusable' };
    }

    return { kind: 'terminal', reason: 'unclassified' };
  }

  summarizeToolUse(toolName, toolInput) {
    const input = toolInput || {};
    switch (toolName) {
      case 'Edit':  return `Edit ${path.basename(input.file_path || '')}`;
      case 'Write': return `Write ${path.basename(input.file_path || '')}`;
      case 'Read':  return `Read ${path.basename(input.file_path || '')}`;
      case 'Bash':  return `Bash: ${(input.command || '').slice(0, 50)}`;
      case 'Grep':  return `Grep "${(input.pattern || '').slice(0, 30)}"`;
      case 'Glob':  return `Glob ${input.pattern || ''}`;
      default:      return toolName;
    }
  }
}

module.exports = { ClaudeAdapter };
