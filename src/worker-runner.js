const { spawn } = require('child_process');

const MAX_STDOUT_BYTES = 1024 * 1024; // 1MB

class WorkerRunner {
  /**
   * @param {object} options
   * @param {number} [options.timeout=600] - Timeout in seconds
   */
  constructor(options = {}) {
    const timeoutSec = options.timeout ?? 600;
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
      const args = ['-p', task.prompt, '--output-format', 'json'];

      if (modelConfig && modelConfig.model) {
        args.push('--model', modelConfig.model);
      }

      const env = { ...process.env };
      if (modelConfig) {
        if (modelConfig.apiKey) {
          env.ANTHROPIC_AUTH_TOKEN = modelConfig.apiKey;
          env.ANTHROPIC_API_KEY = '';
        }
        if (modelConfig.apiBaseUrl) {
          env.ANTHROPIC_BASE_URL = modelConfig.apiBaseUrl;
        }
      }

      const child = spawn('claude', args, {
        cwd: task.cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let truncated = false;

      child.stdout.on('data', (chunk) => {
        if (!truncated && stdout.length + chunk.length <= MAX_STDOUT_BYTES) {
          stdout += chunk;
        } else if (!truncated) {
          stdout += chunk.slice(0, MAX_STDOUT_BYTES - stdout.length);
          stdout += '\n[output truncated at 1MB]';
          truncated = true;
        }
        // After truncation, silently discard further stdout data
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
 * Parse stdout from claude CLI. If valid JSON, extract structured fields.
 * Otherwise, use raw stdout as claudeResult.
 */
function _parseClaudeOutput(stdout, truncated) {
  if (truncated) {
    return {
      isClaudeError: false,
      claudeResult: null,
      totalCostUsd: null,
    };
  }

  try {
    const parsed = JSON.parse(stdout);
    return {
      isClaudeError: !!parsed.is_error,
      claudeResult: parsed.result !== undefined ? String(parsed.result) : stdout,
      totalCostUsd: parsed.total_cost_usd ?? null,
    };
  } catch {
    // Not valid JSON — use raw stdout as result
    return {
      isClaudeError: false,
      claudeResult: stdout || null,
      totalCostUsd: null,
    };
  }
}

module.exports = { WorkerRunner };
