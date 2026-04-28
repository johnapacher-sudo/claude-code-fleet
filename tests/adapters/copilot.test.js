import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import os from 'os';

const { CopilotAdapter } = await import('../../src/adapters/copilot.js');

const TEST_CWD = '/test/project';
const HOOK_FILE_PATH = path.join(TEST_CWD, '.github', 'hooks', 'fleet.json');
const TEST_HOOK_CLIENT = path.join(os.homedir(), '.config', 'claude-code-fleet', 'hooks', 'hook-client.js');

function createMockFs() {
  const store = {};
  return {
    store,
    existsSync: (p) => p in store,
    readFileSync: (p) => {
      if (p in store) return store[p];
      throw new Error(`ENOENT: ${p}`);
    },
    writeFileSync: (p, content) => { store[p] = content; },
    mkdirSync: () => {},
    renameSync: (src, dst) => { store[dst] = store[src]; delete store[src]; },
    unlinkSync: (p) => { delete store[p]; },
  };
}

describe('CopilotAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new CopilotAdapter();
  });

  // ── Task 1: identity + buildArgs + buildEnv ──

  describe('identity', () => {
    it('has correct name, displayName, binary', () => {
      expect(adapter.name).toBe('copilot');
      expect(adapter.displayName).toBe('GitHub Copilot');
      expect(adapter.binary).toBe('copilot');
    });

    it('has correct hookEvents', () => {
      expect(adapter.hookEvents).toEqual(['SessionStart', 'PostToolUse', 'Stop']);
    });

    it('does not include Notification in hookEvents', () => {
      expect(adapter.hookEvents).not.toContain('Notification');
    });
  });

  describe('buildArgs', () => {
    it('returns --allow-all by default', () => {
      const args = adapter.buildArgs({});
      expect(args).toEqual(['--allow-all']);
    });

    it('appends entry.args when present', () => {
      const args = adapter.buildArgs({ args: ['--verbose', '--debug'] });
      expect(args).toEqual(['--allow-all', '--verbose', '--debug']);
    });

    it('does not include model or apiKey in args', () => {
      const args = adapter.buildArgs({ model: 'gpt-4o', apiKey: 'sk-xxx' });
      expect(args).not.toContain('--model');
      expect(args).not.toContain('gpt-4o');
      expect(args).toEqual(['--allow-all']);
    });
  });

  describe('buildEnv', () => {
    it('sets FLEET_MODEL_NAME and COPILOT_MODEL when model is present', () => {
      const env = adapter.buildEnv(
        { name: 'my-worker', model: 'gpt-4o' },
        { PATH: '/bin' }
      );
      expect(env.PATH).toBe('/bin');
      expect(env.FLEET_MODEL_NAME).toBe('my-worker');
      expect(env.COPILOT_MODEL).toBe('gpt-4o');
    });

    it('does not set COPILOT_MODEL when model is absent', () => {
      const env = adapter.buildEnv({ name: 'worker-2' }, { PATH: '/usr/bin' });
      expect(env.FLEET_MODEL_NAME).toBe('worker-2');
      expect(env.COPILOT_MODEL).toBeUndefined();
    });

    it('sets COPILOT_GITHUB_TOKEN when apiKey is present', () => {
      const env = adapter.buildEnv(
        { name: 'gh-worker', model: 'gpt-4o', apiKey: 'github_pat_xxxxx' },
        { PATH: '/bin' }
      );
      expect(env.COPILOT_GITHUB_TOKEN).toBe('github_pat_xxxxx');
    });

    it('does not set COPILOT_GITHUB_TOKEN when apiKey is absent', () => {
      const env = adapter.buildEnv(
        { name: 'gh-worker', model: 'gpt-4o' },
        { PATH: '/bin' }
      );
      expect(env.COPILOT_GITHUB_TOKEN).toBeUndefined();
    });

    it('sets both COPILOT_MODEL and COPILOT_GITHUB_TOKEN', () => {
      const env = adapter.buildEnv(
        { name: 'full-profile', model: 'gpt-4.1', apiKey: 'github_pat_abc123' },
        {}
      );
      expect(env.COPILOT_MODEL).toBe('gpt-4.1');
      expect(env.COPILOT_GITHUB_TOKEN).toBe('github_pat_abc123');
      expect(env.FLEET_MODEL_NAME).toBe('full-profile');
    });
  });

  describe('classifyFailure', () => {
    it('marks rate limit as failover-safe', () => {
      expect(adapter.classifyFailure({
        stderrSnippet: 'rate limit exceeded',
        exitCode: 1,
        signal: null,
        timedOut: false,
      })).toEqual({ kind: 'failover-safe', reason: 'rate_limited' });
    });

    it('marks connection failures as failover-safe', () => {
      expect(adapter.classifyFailure({
        stderrSnippet: 'econnrefused',
        exitCode: 1,
        signal: null,
        timedOut: false,
      })).toEqual({ kind: 'failover-safe', reason: 'upstream_unreachable' });
    });

    it('marks startup transient errors as failover-safe', () => {
      expect(adapter.classifyFailure({
        stderrSnippet: 'proxy connect aborted',
        exitCode: 1,
        signal: null,
        timedOut: false,
      })).toEqual({ kind: 'failover-safe', reason: 'startup_transient_error' });
    });

    it('falls back to terminal for unknown errors', () => {
      expect(adapter.classifyFailure({
        stderrSnippet: 'validation failed',
        exitCode: 1,
        signal: null,
        timedOut: false,
      })).toEqual({ kind: 'terminal', reason: 'unclassified' });
    });

    it('marks 429 status as failover-safe', () => {
      expect(adapter.classifyFailure({
        stderrSnippet: 'received 429 Too Many Requests',
        exitCode: 1,
        signal: null,
        timedOut: false,
      })).toEqual({ kind: 'failover-safe', reason: 'rate_limited' });
    });

    it('marks auth temporarily unavailable as failover-safe', () => {
      expect(adapter.classifyFailure({
        stderrSnippet: 'try again later, auth temporar issue',
        exitCode: 1,
        signal: null,
        timedOut: false,
      })).toEqual({ kind: 'failover-safe', reason: 'auth_temporarily_unusable' });
    });

    it('handles null stderrSnippet gracefully', () => {
      expect(adapter.classifyFailure({
        stderrSnippet: null,
        exitCode: 1,
        signal: null,
        timedOut: false,
      })).toEqual({ kind: 'terminal', reason: 'unclassified' });
    });

    it('handles undefined stderrSnippet gracefully', () => {
      expect(adapter.classifyFailure({
        stderrSnippet: undefined,
        exitCode: 1,
        signal: null,
        timedOut: false,
      })).toEqual({ kind: 'terminal', reason: 'unclassified' });
    });
  });

  // ── Task 2: hook operations (per-repo .github/hooks/fleet.json) ──

  describe('hook operations', () => {
    let mockFs;

    beforeEach(() => {
      mockFs = createMockFs();
      adapter = new CopilotAdapter({ fs: mockFs });
    });

    describe('installHooks', () => {
      it('creates .github/hooks/fleet.json with version:1 and hooks wrapper', () => {
        adapter.installHooks(TEST_HOOK_CLIENT, TEST_CWD);
        const written = JSON.parse(mockFs.store[HOOK_FILE_PATH]);
        expect(written.version).toBe(1);
        expect(written.hooks).toBeDefined();
        const hook = written.hooks.sessionStart[0];
        expect(hook.type).toBe('command');
        expect(hook.bash).toBe(`node ${TEST_HOOK_CLIENT} --tool copilot`);
        expect(hook.bash).toContain('claude-code-fleet');
      });

      it('uses correct Copilot event keys under hooks wrapper', () => {
        adapter.installHooks(TEST_HOOK_CLIENT, TEST_CWD);
        const written = JSON.parse(mockFs.store[HOOK_FILE_PATH]);
        expect(written.hooks.sessionStart).toHaveLength(1);
        expect(written.hooks.postToolUse).toHaveLength(1);
        expect(written.hooks.sessionEnd).toHaveLength(1);
        // Wrong keys should NOT be present at top level
        expect(written.agentStop).toBeUndefined();
        expect(written.SessionStart).toBeUndefined();
      });

      it('overwrites existing fleet.json (idempotent)', () => {
        mockFs.store[HOOK_FILE_PATH] = JSON.stringify({
          version: 1,
          hooks: {
            sessionStart: [
              { type: 'command', bash: `node ${TEST_HOOK_CLIENT} --tool copilot` }
            ],
          },
        });
        adapter.installHooks(TEST_HOOK_CLIENT, TEST_CWD);
        const written = JSON.parse(mockFs.store[HOOK_FILE_PATH]);
        expect(written.hooks.sessionStart).toHaveLength(1);
        expect(written.hooks.postToolUse).toHaveLength(1);
        expect(written.hooks.sessionEnd).toHaveLength(1);
      });

      it('defaults to process.cwd() when cwd not specified', () => {
        const originalCwd = process.cwd;
        process.cwd = () => TEST_CWD;
        try {
          adapter.installHooks(TEST_HOOK_CLIENT);
          expect(HOOK_FILE_PATH in mockFs.store).toBe(true);
        } finally {
          process.cwd = originalCwd;
        }
      });
    });

    describe('removeHooks', () => {
      it('removes fleet.json file when it is a Fleet-managed file', () => {
        mockFs.store[HOOK_FILE_PATH] = JSON.stringify({
          version: 1,
          hooks: {
            sessionStart: [{ type: 'command', bash: 'node /x/claude-code-fleet/hook' }],
            postToolUse: [{ type: 'command', bash: 'node /x/claude-code-fleet/hook' }],
            sessionEnd: [{ type: 'command', bash: 'node /x/claude-code-fleet/hook' }],
          },
        });
        adapter.removeHooks(TEST_CWD);
        expect(HOOK_FILE_PATH in mockFs.store).toBe(false);
      });

      it('does not remove fleet.json if it is not a Fleet-managed file', () => {
        mockFs.store[HOOK_FILE_PATH] = JSON.stringify({
          version: 1,
          hooks: {
            sessionStart: [{ type: 'command', bash: 'some-other-hook' }],
            postToolUse: [{ type: 'command', bash: 'some-other-hook' }],
            sessionEnd: [{ type: 'command', bash: 'some-other-hook' }],
          },
        });
        adapter.removeHooks(TEST_CWD);
        expect(HOOK_FILE_PATH in mockFs.store).toBe(true);
      });

      it('is no-op when fleet.json is missing', () => {
        const keysBefore = Object.keys(mockFs.store);
        adapter.removeHooks(TEST_CWD);
        expect(Object.keys(mockFs.store)).toEqual(keysBefore);
      });
    });

    describe('isHookInstalled', () => {
      it('returns true when all events have fleet hooks', () => {
        mockFs.store[HOOK_FILE_PATH] = JSON.stringify({
          version: 1,
          hooks: {
            sessionStart: [{ type: 'command', bash: 'node /x/claude-code-fleet/hook' }],
            postToolUse: [{ type: 'command', bash: 'node /x/claude-code-fleet/hook' }],
            sessionEnd: [{ type: 'command', bash: 'node /x/claude-code-fleet/hook' }],
          },
        });
        expect(adapter.isHookInstalled(TEST_CWD)).toBe(true);
      });

      it('returns false when some events are missing hooks', () => {
        mockFs.store[HOOK_FILE_PATH] = JSON.stringify({
          version: 1,
          hooks: {
            sessionStart: [{ type: 'command', bash: 'node /x/claude-code-fleet/hook' }],
          },
        });
        expect(adapter.isHookInstalled(TEST_CWD)).toBe(false);
      });

      it('returns false when fleet.json is missing', () => {
        expect(adapter.isHookInstalled(TEST_CWD)).toBe(false);
      });

      it('defaults to process.cwd() when cwd not specified', () => {
        const originalCwd = process.cwd;
        process.cwd = () => TEST_CWD;
        try {
          expect(adapter.isHookInstalled()).toBe(false);
        } finally {
          process.cwd = originalCwd;
        }
      });
    });
  });

  // ── Task 3: normalizePayload + summarizeToolUse ──

  describe('normalizePayload', () => {
    it('maps sessionStart payload to unified format', () => {
      const raw = {
        type: 'sessionStart',
        sessionId: 'sess-1',
        cwd: '/project',
        model: 'gpt-4o',
      };
      const result = adapter.normalizePayload(raw);
      expect(result.event).toBe('SessionStart');
      expect(result.session_id).toBe('sess-1');
      expect(result.cwd).toBe('/project');
      expect(result.model).toBe('gpt-4o');
      expect(result.timestamp).toBeTypeOf('number');
    });

    it('maps sessionEnd payload to Stop event', () => {
      const raw = {
        type: 'sessionEnd',
        sessionId: 'sess-5',
        cwd: '/project',
        reason: 'complete',
      };
      const result = adapter.normalizePayload(raw);
      expect(result.event).toBe('Stop');
      expect(result.session_id).toBe('sess-5');
      expect(result.message).toBe('complete');
    });

    it('maps postToolUse payload with toolName and toolArgs', () => {
      const raw = {
        type: 'postToolUse',
        sessionId: 'sess-3',
        cwd: '/app',
        model: 'gpt-4o',
        toolName: 'Bash',
        toolArgs: JSON.stringify({ command: 'ls -la' }),
      };
      const result = adapter.normalizePayload(raw);
      expect(result.event).toBe('PostToolUse');
      expect(result.tool_name).toBe('Bash');
      expect(result.tool_input).toEqual({ command: 'ls -la' });
    });

    it('maps postToolUse payload with toolResult', () => {
      const raw = {
        type: 'postToolUse',
        sessionId: 'sess-4',
        cwd: '/app',
        toolName: 'Edit',
        toolArgs: JSON.stringify({ file_path: '/a.js' }),
        toolResult: { resultType: 'success', textResultForLlm: 'File edited' },
      };
      const result = adapter.normalizePayload(raw);
      expect(result.event).toBe('PostToolUse');
      expect(result.tool_name).toBe('Edit');
      expect(result.tool_input).toEqual({ file_path: '/a.js' });
      expect(result.tool_output).toBe('File edited');
    });

    it('handles toolArgs that is not valid JSON as string', () => {
      const raw = {
        type: 'postToolUse',
        sessionId: 'sess-raw',
        toolName: 'Grep',
        toolArgs: 'plain-text-args',
      };
      const result = adapter.normalizePayload(raw);
      expect(result.tool_input).toBe('plain-text-args');
    });

    it('maps SessionEnd (PascalCase) to Stop event', () => {
      const raw = {
        type: 'SessionEnd',
        sessionId: 'sess-6',
        reason: 'error',
      };
      const result = adapter.normalizePayload(raw);
      expect(result.event).toBe('Stop');
      expect(result.message).toBe('error');
    });

    it('truncates last_assistant_message to 500 chars', () => {
      const raw = {
        type: 'sessionStart',
        sessionId: 's1',
        last_assistant_message: 'x'.repeat(1000),
      };
      const result = adapter.normalizePayload(raw);
      expect(result.last_assistant_message).toHaveLength(500);
    });

    it('uses timestamp from payload when present', () => {
      const ts = 1713523200000;
      const raw = {
        type: 'sessionStart',
        sessionId: 's-ts',
        timestamp: ts,
      };
      const result = adapter.normalizePayload(raw);
      expect(result.timestamp).toBe(ts);
    });

    it('handles unknown event type gracefully', () => {
      const raw = {
        type: 'unknownEvent',
        sessionId: 's-unknown',
      };
      const result = adapter.normalizePayload(raw);
      expect(result.event).toBe('unknownEvent');
      expect(result.session_id).toBe('s-unknown');
    });
  });

  describe('summarizeToolUse', () => {
    it('Edit -> Edit basename', () => {
      expect(adapter.summarizeToolUse('Edit', { file_path: '/src/app.js' })).toBe('Edit app.js');
    });

    it('Write -> Write basename', () => {
      expect(adapter.summarizeToolUse('Write', { file_path: '/src/index.ts' })).toBe('Write index.ts');
    });

    it('Read -> Read basename', () => {
      expect(adapter.summarizeToolUse('Read', { file_path: '/a/b/c.json' })).toBe('Read c.json');
    });

    it('Bash -> Bash: command[:50]', () => {
      expect(adapter.summarizeToolUse('Bash', { command: 'npm test' })).toBe('Bash: npm test');
      const longCmd = 'a'.repeat(100);
      expect(adapter.summarizeToolUse('Bash', { command: longCmd })).toBe(`Bash: ${'a'.repeat(50)}`);
    });

    it('Grep -> Grep "pattern[:30]"', () => {
      expect(adapter.summarizeToolUse('Grep', { pattern: 'TODO' })).toBe('Grep "TODO"');
      const longPattern = 'b'.repeat(60);
      expect(adapter.summarizeToolUse('Grep', { pattern: longPattern })).toBe(`Grep "${'b'.repeat(30)}"`);
    });

    it('Glob -> Glob pattern', () => {
      expect(adapter.summarizeToolUse('Glob', { pattern: '**/*.js' })).toBe('Glob **/*.js');
    });

    it('unknown tool -> returns tool name', () => {
      expect(adapter.summarizeToolUse('WebSearch', { query: 'foo' })).toBe('WebSearch');
    });
  });

  describe('buildEnv with entry.env', () => {
    it('merges entry.env into the returned env', () => {
      const env = adapter.buildEnv(
        { name: 'p', model: 'gpt-4.1', env: { CUSTOM_FLAG: '1' } },
        { PATH: '/bin' }
      );
      expect(env.CUSTOM_FLAG).toBe('1');
      expect(env.COPILOT_MODEL).toBe('gpt-4.1');
    });

    it('entry.env overrides COPILOT_GITHUB_TOKEN if present', () => {
      const env = adapter.buildEnv(
        { name: 'p', apiKey: 'pat', env: { COPILOT_GITHUB_TOKEN: 'override' } },
        {}
      );
      expect(env.COPILOT_GITHUB_TOKEN).toBe('override');
    });

    it('no-op when entry.env absent', () => {
      const env = adapter.buildEnv({ name: 'p', model: 'gpt-4.1' }, {});
      expect(env.COPILOT_MODEL).toBe('gpt-4.1');
      expect(Object.keys(env)).not.toContain('CUSTOM_FLAG');
    });
  });
});
