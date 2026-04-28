const path = require('path');
const defaultFs = require('fs');
const { ToolAdapter } = require('./base');

const FLEET_IDENTIFIER = 'claude-code-fleet';
const HOOK_DIR = '.github';
const HOOK_SUBDIR = 'hooks';
const HOOK_FILE = 'fleet.json';

const EVENT_KEY_MAP = {
  SessionStart: 'sessionStart',
  PostToolUse: 'postToolUse',
  Stop: 'sessionEnd',
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
    if (entry.apiKey) env.COPILOT_GITHUB_TOKEN = entry.apiKey;
    return this.applyUserEnv(entry, env);
  }

  /**
   * Copilot CLI loads hooks from .github/hooks/*.json in the repo directory.
   * This is per-repo only — there is no global hooks support.
   * @param {string} hookClientPath - Path to hook-client.js
   * @param {string} [cwd] - Target repo directory (defaults to process.cwd())
   */
  installHooks(hookClientPath, cwd) {
    const fs = this._fs;
    const targetCwd = cwd || process.cwd();
    const hookFilePath = this._hookFilePath(targetCwd);
    const hookDir = path.dirname(hookFilePath);

    if (!fs.existsSync(hookDir)) fs.mkdirSync(hookDir, { recursive: true });

    const hookCmd = `node ${hookClientPath} --tool copilot`;
    const hookEntry = { type: 'command', bash: hookCmd };

    const hookFile = {
      version: 1,
      hooks: {
        sessionStart: [hookEntry],
        postToolUse: [hookEntry],
        sessionEnd: [hookEntry],
      },
    };

    const tmpPath = hookFilePath + '.fleet-tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(hookFile, null, 2) + '\n');
    fs.renameSync(tmpPath, hookFilePath);
  }

  /**
   * Remove fleet's hook file from the repo's .github/hooks/ directory.
   * @param {string} [cwd] - Target repo directory (defaults to process.cwd())
   */
  removeHooks(cwd) {
    const fs = this._fs;
    const targetCwd = cwd || process.cwd();
    const hookFilePath = this._hookFilePath(targetCwd);

    if (!fs.existsSync(hookFilePath)) return;

    // Verify it's a Fleet-managed file before deleting
    try {
      const data = JSON.parse(fs.readFileSync(hookFilePath, 'utf-8'));
      const hooksSection = data.hooks || {};
      const isFleetFile = ['sessionStart', 'postToolUse', 'sessionEnd'].some(key => {
        const hooks = hooksSection[key] || [];
        return hooks.some(h => h.type === 'command' && h.bash && h.bash.includes(FLEET_IDENTIFIER));
      });
      if (!isFleetFile) return;
    } catch { return; }

    fs.unlinkSync(hookFilePath);
  }

  /**
   * Check if fleet hooks are installed in the repo's .github/hooks/ directory.
   * @param {string} [cwd] - Target repo directory (defaults to process.cwd())
   */
  isHookInstalled(cwd) {
    const fs = this._fs;
    const targetCwd = cwd || process.cwd();
    const hookFilePath = this._hookFilePath(targetCwd);

    if (!fs.existsSync(hookFilePath)) return false;

    try {
      const data = JSON.parse(fs.readFileSync(hookFilePath, 'utf-8'));
      const hooksSection = data.hooks || {};
      return ['sessionStart', 'postToolUse', 'sessionEnd'].every(key => {
        const hooks = hooksSection[key] || [];
        return hooks.some(h => h.type === 'command' && h.bash && h.bash.includes(FLEET_IDENTIFIER));
      });
    } catch { return false; }
  }

  normalizePayload(rawInput) {
    // Normalize event type from camelCase or PascalCase to canonical form
    const rawType = rawInput.type || '';
    const EVENT_NORMALIZE = {
      sessionStart: 'SessionStart',
      SessionStart: 'SessionStart',
      postToolUse: 'PostToolUse',
      PostToolUse: 'PostToolUse',
      sessionEnd: 'Stop',
      SessionEnd: 'Stop',
    };
    const event = EVENT_NORMALIZE[rawType] || rawType;

    // Copilot payloads: toolArgs is JSON string, toolResult has structured format
    const toolName = rawInput.toolName || null;
    let toolInput = null;
    if (rawInput.toolArgs) {
      try { toolInput = JSON.parse(rawInput.toolArgs); } catch { toolInput = rawInput.toolArgs; }
    }
    const toolOutput = rawInput.toolResult
      ? (rawInput.toolResult.textResultForLlm || JSON.stringify(rawInput.toolResult))
      : null;
    const reason = rawInput.reason || null;

    return {
      event,
      session_id: rawInput.sessionId || null,
      cwd: rawInput.cwd || null,
      timestamp: rawInput.timestamp || Date.now(),
      model: rawInput.model || null,
      pid: rawInput.pid || process.pid,
      ppid: rawInput.ppid || process.ppid,
      term_program: rawInput.term_program || process.env.TERM_PROGRAM || null,
      iterm_session_id: rawInput.iterm_session_id || process.env.ITERM_SESSION_ID || null,
      tool_name: toolName,
      tool_input: toolInput,
      tool_output: toolOutput,
      last_assistant_message: rawInput.last_assistant_message
        ? rawInput.last_assistant_message.slice(0, 500)
        : null,
      message: reason || rawInput.message || null,
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

  /** @private */
  _hookFilePath(cwd) {
    return path.join(cwd, HOOK_DIR, HOOK_SUBDIR, HOOK_FILE);
  }
}

module.exports = { CopilotAdapter };
