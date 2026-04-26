import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import os from 'os';

const { ClaudeAdapter } = await import('../../src/adapters/claude.js');

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
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
  };
}

describe('ClaudeAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new ClaudeAdapter();
  });

  describe('identity', () => {
    it('has correct name, displayName, binary', () => {
      expect(adapter.name).toBe('claude');
      expect(adapter.displayName).toBe('Claude Code');
      expect(adapter.binary).toBe('claude');
    });

    it('has correct hookEvents', () => {
      expect(adapter.hookEvents).toEqual(['SessionStart', 'PostToolUse', 'Stop', 'Notification']);
    });
  });

  describe('buildArgs', () => {
    it('builds args with apiKey and model', () => {
      const args = adapter.buildArgs({
        apiKey: 'sk-ant-123',
        model: 'claude-opus-4-6',
        apiBaseUrl: 'https://custom.api.com',
      });
      expect(args[0]).toBe('--dangerously-skip-permissions');
      expect(args).toContain('--model');
      expect(args).toContain('claude-opus-4-6');
      expect(args).toContain('--settings');
      const settingsIdx = args.indexOf('--settings');
      const settingsJson = JSON.parse(args[settingsIdx + 1]);
      expect(settingsJson.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-ant-123');
      expect(settingsJson.env.ANTHROPIC_API_KEY).toBe('');
      expect(settingsJson.env.ANTHROPIC_BASE_URL).toBe('https://custom.api.com');
    });

    it('appends entry.args if present', () => {
      const args = adapter.buildArgs({
        model: 'opus',
        args: ['--verbose', '--debug'],
      });
      expect(args).toContain('--verbose');
      expect(args).toContain('--debug');
    });

    it('works without optional fields', () => {
      const args = adapter.buildArgs({});
      expect(args[0]).toBe('--dangerously-skip-permissions');
      expect(args).toContain('--settings');
      expect(args).not.toContain('--model');
    });
  });

  describe('buildEnv', () => {
    it('adds FLEET_MODEL_NAME to base env', () => {
      const env = adapter.buildEnv({ name: 'my-worker' }, { PATH: '/bin' });
      expect(env.PATH).toBe('/bin');
      expect(env.FLEET_MODEL_NAME).toBe('my-worker');
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
        stderrSnippet: 'upstream connect error',
        exitCode: 1,
        signal: null,
        timedOut: false,
      })).toEqual({ kind: 'failover-safe', reason: 'upstream_unreachable' });
    });

    it('marks startup transient errors as failover-safe', () => {
      expect(adapter.classifyFailure({
        stderrSnippet: 'tls handshake failed before startup completed',
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
  });

  describe('hook operations', () => {
    let mockFs;

    beforeEach(() => {
      mockFs = createMockFs();
      adapter = new ClaudeAdapter({ fs: mockFs });
    });

    it('installHooks creates hooks in empty settings', () => {
      adapter.installHooks(TEST_HOOK_CLIENT);
      const written = JSON.parse(mockFs.store[SETTINGS_PATH]);
      expect(written.hooks.SessionStart).toHaveLength(1);
      expect(written.hooks.PostToolUse).toHaveLength(1);
      expect(written.hooks.Stop).toHaveLength(1);
      expect(written.hooks.Notification).toHaveLength(1);
      const cmd = written.hooks.SessionStart[0].hooks[0].command;
      expect(cmd).toBe(`node ${TEST_HOOK_CLIENT} --tool claude`);
      expect(cmd).toContain('claude-code-fleet');
    });

    it('installHooks does not duplicate existing hooks', () => {
      mockFs.store[SETTINGS_PATH] = JSON.stringify({
        hooks: {
          SessionStart: [{
            hooks: [{ type: 'command', command: `node ${TEST_HOOK_CLIENT} --tool claude` }]
          }]
        }
      });
      adapter.installHooks(TEST_HOOK_CLIENT);
      const written = JSON.parse(mockFs.store[SETTINGS_PATH]);
      expect(written.hooks.SessionStart).toHaveLength(1);
      expect(written.hooks.PostToolUse).toHaveLength(1);
    });

    it('removeHooks removes fleet hooks', () => {
      mockFs.store[SETTINGS_PATH] = JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: 'node /x/claude-code-fleet/hook' }] },
            { hooks: [{ type: 'command', command: 'some-other-hook' }] },
          ],
          PostToolUse: [
            { hooks: [{ type: 'command', command: 'node /x/claude-code-fleet/hook' }] },
          ],
        }
      });
      adapter.removeHooks();
      const written = JSON.parse(mockFs.store[SETTINGS_PATH]);
      expect(written.hooks.SessionStart).toHaveLength(1);
      expect(written.hooks.SessionStart[0].hooks[0].command).toBe('some-other-hook');
      expect(written.hooks.PostToolUse).toBeUndefined();
    });

    it('removeHooks is no-op when settings file missing', () => {
      const keysBefore = Object.keys(mockFs.store);
      adapter.removeHooks();
      expect(Object.keys(mockFs.store)).toEqual(keysBefore);
    });

    it('isHookInstalled returns true when all events have fleet hooks', () => {
      const hooks = {};
      for (const evt of adapter.hookEvents) {
        hooks[evt] = [{ hooks: [{ type: 'command', command: 'node /x/claude-code-fleet/hook' }] }];
      }
      mockFs.store[SETTINGS_PATH] = JSON.stringify({ hooks });
      expect(adapter.isHookInstalled()).toBe(true);
    });

    it('isHookInstalled returns false when hooks are missing', () => {
      mockFs.store[SETTINGS_PATH] = JSON.stringify({ hooks: {} });
      expect(adapter.isHookInstalled()).toBe(false);
    });

    it('isHookInstalled returns false when settings file is missing', () => {
      expect(adapter.isHookInstalled()).toBe(false);
    });
  });

  describe('normalizePayload', () => {
    it('maps Claude hook stdin to unified format', () => {
      const raw = {
        hook_event_name: 'PostToolUse',
        session_id: 'sess-123',
        cwd: '/project',
        model: 'claude-opus-4-6',
        tool_name: 'Edit',
        tool_input: { file_path: '/a.js' },
        last_assistant_message: 'Done',
        message: null,
        notification_type: null,
      };
      const result = adapter.normalizePayload(raw);
      expect(result.event).toBe('PostToolUse');
      expect(result.session_id).toBe('sess-123');
      expect(result.cwd).toBe('/project');
      expect(result.model).toBe('claude-opus-4-6');
      expect(result.tool_name).toBe('Edit');
      expect(result.tool_input).toEqual({ file_path: '/a.js' });
      expect(result.last_assistant_message).toBe('Done');
      expect(result.timestamp).toBeTypeOf('number');
    });

    it('truncates last_assistant_message to 500 chars', () => {
      const raw = {
        hook_event_name: 'Stop',
        session_id: 's1',
        last_assistant_message: 'x'.repeat(1000),
      };
      const result = adapter.normalizePayload(raw);
      expect(result.last_assistant_message).toHaveLength(500);
    });
  });

  describe('summarizeToolUse', () => {
    it('Edit → Edit basename', () => {
      expect(adapter.summarizeToolUse('Edit', { file_path: '/src/app.js' })).toBe('Edit app.js');
    });

    it('Write → Write basename', () => {
      expect(adapter.summarizeToolUse('Write', { file_path: '/src/index.ts' })).toBe('Write index.ts');
    });

    it('Read → Read basename', () => {
      expect(adapter.summarizeToolUse('Read', { file_path: '/a/b/c.json' })).toBe('Read c.json');
    });

    it('Bash → Bash: command[:50]', () => {
      expect(adapter.summarizeToolUse('Bash', { command: 'npm test' })).toBe('Bash: npm test');
      const longCmd = 'a'.repeat(100);
      expect(adapter.summarizeToolUse('Bash', { command: longCmd })).toBe(`Bash: ${'a'.repeat(50)}`);
    });

    it('Grep → Grep "pattern[:30]"', () => {
      expect(adapter.summarizeToolUse('Grep', { pattern: 'TODO' })).toBe('Grep "TODO"');
      const longPattern = 'b'.repeat(60);
      expect(adapter.summarizeToolUse('Grep', { pattern: longPattern })).toBe(`Grep "${'b'.repeat(30)}"`);
    });

    it('Glob → Glob pattern', () => {
      expect(adapter.summarizeToolUse('Glob', { pattern: '**/*.js' })).toBe('Glob **/*.js');
    });

    it('unknown tool → returns tool name', () => {
      expect(adapter.summarizeToolUse('WebSearch', { query: 'foo' })).toBe('WebSearch');
    });
  });
});
