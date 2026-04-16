import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import os from 'os';

const { CodexAdapter } = await import('../../src/adapters/codex.js');

const CODEX_DIR = path.join(os.homedir(), '.codex');
const HOOKS_PATH = path.join(CODEX_DIR, 'hooks.json');
const CONFIG_PATH = path.join(CODEX_DIR, 'config.toml');
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
  };
}

describe('CodexAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new CodexAdapter();
  });

  describe('identity', () => {
    it('has correct name, displayName, binary', () => {
      expect(adapter.name).toBe('codex');
      expect(adapter.displayName).toBe('Codex CLI');
      expect(adapter.binary).toBe('codex');
    });

    it('has correct hookEvents (no Notification)', () => {
      expect(adapter.hookEvents).toEqual(['SessionStart', 'PostToolUse', 'Stop']);
      expect(adapter.hookEvents).not.toContain('Notification');
    });
  });

  describe('buildArgs', () => {
    it('builds args without --dangerously-skip-permissions', () => {
      const args = adapter.buildArgs({ model: 'gpt-4o', apiKey: 'sk-xxx' });
      expect(args).not.toContain('--dangerously-skip-permissions');
      expect(args).toContain('--model');
      expect(args).toContain('gpt-4o');
      expect(args).toContain('-c');
      expect(args).toContain('approval_policy="never"');
    });

    it('appends entry.args if present', () => {
      const args = adapter.buildArgs({
        model: 'gpt-4o',
        args: ['--extra-flag'],
      });
      expect(args).toContain('--extra-flag');
    });

    it('sets openai_base_url via -c config when apiBaseUrl is present', () => {
      const args = adapter.buildArgs({
        model: 'gpt-4o',
        apiBaseUrl: 'https://custom.openai.com/v1',
      });
      expect(args).toContain('-c');
      expect(args).toContain('openai_base_url="https://custom.openai.com/v1"');
      expect(args).not.toContain('OPENAI_BASE_URL');
    });
  });

  describe('buildEnv', () => {
    it('sets OPENAI_API_KEY when present', () => {
      const env = adapter.buildEnv(
        { name: 'codex-1', apiKey: 'sk-xxx', apiBaseUrl: 'https://custom.openai.com' },
        { PATH: '/bin', OPENAI_BASE_URL: 'https://deprecated.example/v1' }
      );
      expect(env.FLEET_MODEL_NAME).toBe('codex-1');
      expect(env.OPENAI_API_KEY).toBe('sk-xxx');
      expect(env.OPENAI_BASE_URL).toBeUndefined();
      expect(env.PATH).toBe('/bin');
    });

    it('does not set OPENAI keys when not provided', () => {
      const env = adapter.buildEnv({ name: 'codex-2' }, {});
      expect(env.FLEET_MODEL_NAME).toBe('codex-2');
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.OPENAI_BASE_URL).toBeUndefined();
    });
  });

  describe('hook operations', () => {
    let mockFs;

    beforeEach(() => {
      mockFs = createMockFs();
      adapter = new CodexAdapter({ fs: mockFs });
    });

    it('installHooks creates hooks.json and config.toml', () => {
      adapter.installHooks(TEST_HOOK_CLIENT);

      expect(mockFs.store[HOOKS_PATH]).toBeDefined();
      const hooks = JSON.parse(mockFs.store[HOOKS_PATH]);
      expect(hooks.hooks.SessionStart).toHaveLength(1);
      expect(hooks.hooks.PostToolUse).toHaveLength(1);
      expect(hooks.hooks.Stop).toHaveLength(1);
      expect(hooks.hooks.Notification).toBeUndefined();
      const cmd = hooks.hooks.SessionStart[0].hooks[0].command;
      expect(cmd).toBe(`node ${TEST_HOOK_CLIENT} --tool codex`);
      expect(cmd).toContain('claude-code-fleet');

      expect(mockFs.store[CONFIG_PATH]).toBeDefined();
      expect(mockFs.store[CONFIG_PATH]).toContain('codex_hooks = true');
      expect(mockFs.store[CONFIG_PATH]).toContain('[features]');
    });

    it('installHooks does not duplicate existing hooks', () => {
      mockFs.store[HOOKS_PATH] = JSON.stringify({
        hooks: {
          SessionStart: [{
            hooks: [{ type: 'command', command: `node ${TEST_HOOK_CLIENT} --tool codex` }]
          }]
        }
      });
      mockFs.store[CONFIG_PATH] = '[features]\ncodex_hooks = true\n';

      adapter.installHooks(TEST_HOOK_CLIENT);
      const hooks = JSON.parse(mockFs.store[HOOKS_PATH]);
      expect(hooks.hooks.SessionStart).toHaveLength(1);
    });

    it('installHooks appends to existing [features] section in config.toml', () => {
      mockFs.store[CONFIG_PATH] = '[features]\nsome_flag = true\n';
      adapter.installHooks(TEST_HOOK_CLIENT);
      expect(mockFs.store[CONFIG_PATH]).toContain('codex_hooks = true');
      expect(mockFs.store[CONFIG_PATH]).toContain('some_flag = true');
    });

    it('removeHooks removes fleet hooks from hooks.json', () => {
      mockFs.store[HOOKS_PATH] = JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: 'node /x/claude-code-fleet/hook' }] },
            { hooks: [{ type: 'command', command: 'other-hook' }] },
          ],
          PostToolUse: [
            { hooks: [{ type: 'command', command: 'node /x/claude-code-fleet/hook' }] },
          ],
        }
      });
      adapter.removeHooks();
      const result = JSON.parse(mockFs.store[HOOKS_PATH]);
      expect(result.hooks.SessionStart).toHaveLength(1);
      expect(result.hooks.SessionStart[0].hooks[0].command).toBe('other-hook');
      expect(result.hooks.PostToolUse).toBeUndefined();
    });

    it('removeHooks is no-op when hooks.json missing', () => {
      const keysBefore = Object.keys(mockFs.store);
      adapter.removeHooks();
      expect(Object.keys(mockFs.store)).toEqual(keysBefore);
    });

    it('isHookInstalled returns true when all events have fleet hooks', () => {
      const hooks = {};
      for (const evt of adapter.hookEvents) {
        hooks[evt] = [{ hooks: [{ type: 'command', command: 'node /x/claude-code-fleet/hook' }] }];
      }
      mockFs.store[HOOKS_PATH] = JSON.stringify({ hooks });
      expect(adapter.isHookInstalled()).toBe(true);
    });

    it('isHookInstalled returns false when hooks are missing', () => {
      mockFs.store[HOOKS_PATH] = JSON.stringify({ hooks: {} });
      expect(adapter.isHookInstalled()).toBe(false);
    });

    it('isHookInstalled returns false when hooks.json is missing', () => {
      expect(adapter.isHookInstalled()).toBe(false);
    });
  });

  describe('normalizePayload', () => {
    it('maps Codex hook stdin to unified format (no notification_type)', () => {
      const raw = {
        hook_event_name: 'PostToolUse',
        session_id: 'codex-sess-1',
        cwd: '/project',
        model: 'gpt-4o',
        tool_name: 'Bash',
        tool_input: { command: 'ls -la' },
      };
      const result = adapter.normalizePayload(raw);
      expect(result.event).toBe('PostToolUse');
      expect(result.session_id).toBe('codex-sess-1');
      expect(result.tool_name).toBe('Bash');
      expect(result.notification_type).toBeUndefined();
      expect(result.timestamp).toBeTypeOf('number');
    });

    it('truncates last_assistant_message to 500 chars', () => {
      const raw = {
        hook_event_name: 'Stop',
        session_id: 's1',
        last_assistant_message: 'y'.repeat(1000),
      };
      const result = adapter.normalizePayload(raw);
      expect(result.last_assistant_message).toHaveLength(500);
    });
  });

  describe('summarizeToolUse', () => {
    it('Bash → Bash: command[:50]', () => {
      expect(adapter.summarizeToolUse('Bash', { command: 'npm test' })).toBe('Bash: npm test');
      const longCmd = 'c'.repeat(100);
      expect(adapter.summarizeToolUse('Bash', { command: longCmd })).toBe(`Bash: ${'c'.repeat(50)}`);
    });

    it('non-Bash tools return tool name only', () => {
      expect(adapter.summarizeToolUse('Read', { file_path: '/a.js' })).toBe('Read');
      expect(adapter.summarizeToolUse('Edit', { file_path: '/b.js' })).toBe('Edit');
      expect(adapter.summarizeToolUse('SomeOtherTool', {})).toBe('SomeOtherTool');
    });
  });
});
