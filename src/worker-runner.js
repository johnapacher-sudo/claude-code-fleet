const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_STDOUT = 1_000_000; // ~1MB in character count
const USER_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

const SYSTEM_PROMPT = `You are a background autonomous worker. No human will read your output until the task completes.

Execution rules:
1. NEVER ask questions or wait for input. Proceed autonomously with best judgment.
2. When a skill or workflow requires interaction, skip the interactive parts and make autonomous decisions.
3. When encountering errors, attempt to resolve them independently. Try alternative approaches, search for solutions, and debug systematically. Only give up after exhausting reasonable options.
4. When you modify project files (code, tests, docs), commit each logical change with a descriptive message using git.
5. Produce a structured summary at the end of your work:
   ## Summary
   - What was done
   ## Changes
   - Files modified and why
   ## Result
   - Final status and any noteworthy findings
   ## Issues (if any)
   - Unresolved problems or assumptions made`;

class WorkerRunner {
  /**
   * @param {object} options
   * @param {number} [options.timeout=600] - Timeout in seconds
   */
  constructor(options = {}) {
    const timeoutSec = options.timeout ?? 10800;
    this._timeoutMs = timeoutSec * 1000;
  }

  /**
   * Execute a single task via `claude -p` subprocess.
   *
   * @param {object} task - Task descriptor { id, prompt, cwd }
   * @param {object|null} modelConfig - Optional model configuration
   * @param {string} [modelConfig.model] - Model identifier
   * @param {string} [modelConfig.apiKey] - API key
   * @param {string} [modelConfig.apiBaseUrl] - API base URL
   * @returns {Promise<TaskResult>}
   */
  run(task, modelConfig) {
    return new Promise((resolve) => {
      const args = ['-p', task.prompt, '--dangerously-skip-permissions'];

      // Build settings override — merge with user's existing settings to preserve
      // skills, hooks, and other configuration
      const settingsEnv = {};
      if (modelConfig) {
        if (modelConfig.model) {
          args.push('--model', modelConfig.model);
        }
        if (modelConfig.apiKey) {
          settingsEnv.ANTHROPIC_AUTH_TOKEN = modelConfig.apiKey;
          settingsEnv.ANTHROPIC_API_KEY = '';
        }
        if (modelConfig.apiBaseUrl) {
          settingsEnv.ANTHROPIC_BASE_URL = modelConfig.apiBaseUrl;
        }
      }
      if (Object.keys(settingsEnv).length > 0) {
        const mergedSettings = _buildMergedSettings(settingsEnv);
        args.push('--settings', JSON.stringify(mergedSettings));
      }

      const child = spawn('claude', args, {
        cwd: task.cwd,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let truncated = false;

      child.stdout.on('data', (chunk) => {
        const str = chunk.toString();
        if (stdout.length + str.length > MAX_STDOUT) {
          stdout += str.slice(0, MAX_STDOUT - stdout.length);
          stdout += '\n[output truncated at 1MB]';
          truncated = true;
          child.kill('SIGKILL');
          return;
        }
        stdout += str;
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });

      // Timeout handling
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          child.kill('SIGKILL');
        } catch {
          // Process may have already exited
        }
        resolve({
          exitCode: -1,
          stdout,
          stderr,
          durationMs: 0,
          isClaudeError: false,
          claudeResult: null,
          totalCostUsd: null,
        });
      }, this._timeoutMs);

      child.on('close', (code) => {
        if (settled) return; // Already resolved via timeout
        settled = true;
        clearTimeout(timer);

        const result = _parseClaudeOutput(stdout, truncated);

        resolve({
          exitCode: truncated ? -1 : (code ?? -1),
          stdout,
          stderr,
          durationMs: 0,
          isClaudeError: result.isClaudeError,
          claudeResult: result.claudeResult,
          totalCostUsd: result.totalCostUsd,
        });
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        resolve({
          exitCode: -1,
          stdout,
          stderr: stderr + (stderr ? '\n' : '') + err.message,
          durationMs: 0,
          isClaudeError: false,
          claudeResult: null,
          totalCostUsd: null,
        });
      });
    });
  }
}

/**
 * Parse stdout from claude CLI.
 * Without --output-format json, claude outputs plain text.
 * If stdout happens to be valid JSON (e.g. older versions), extract structured fields.
 */
function _parseClaudeOutput(stdout, truncated) {
  if (truncated) {
    return {
      isClaudeError: false,
      claudeResult: null,
      totalCostUsd: null,
    };
  }

  // Try JSON parse — if claude emitted JSON, extract fields
  try {
    const parsed = JSON.parse(stdout);
    return {
      isClaudeError: !!parsed.is_error,
      claudeResult: parsed.result !== undefined ? String(parsed.result) : stdout,
      totalCostUsd: parsed.total_cost_usd ?? null,
    };
  } catch {
    // Plain text output — use raw stdout as result
    return {
      isClaudeError: false,
      claudeResult: stdout || null,
      totalCostUsd: null,
    };
  }
}

/**
 * Read user's ~/.claude/settings.json and merge env overrides into it.
 * This preserves skills, hooks, and other user configuration while
 * applying the model-specific env vars (API key, base URL).
 */
function _buildMergedSettings(envOverrides) {
  let settings = {};
  try {
    if (fs.existsSync(USER_SETTINGS_PATH)) {
      settings = JSON.parse(fs.readFileSync(USER_SETTINGS_PATH, 'utf8'));
    }
  } catch {
    // Corrupted or unreadable — start fresh
  }

  if (!settings.env) settings.env = {};
  Object.assign(settings.env, envOverrides);

  return settings;
}

module.exports = { WorkerRunner, SYSTEM_PROMPT };
