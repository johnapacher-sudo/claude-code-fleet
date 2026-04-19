import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import os from 'os';

const { CopilotAdapter } = await import('../../src/adapters/copilot.js');

const COPILOT_DIR = path.join(os.homedir(), '.copilot');
const CONFIG_PATH = path.join(COPILOT_DIR, 'config.json');
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
  });

  // ── Task 2: hook operations ──

  describe('hook operations', () => {
    let mockFs;

    beforeEach(() => {
      mockFs = createMockFs();
      adapter = new CopilotAdapter({ fs: mockFs });
    });

    describe('installHooks', () => {
      it('creates hooks in empty config with correct structure', () => {
        adapter.installHooks(TEST_HOOK_CLIENT);
        const written = JSON.parse(mockFs.store[CONFIG_PATH]);
        expect(written.hooks).toBeDefined();
        const cmd = written.hooks.sessionStart[0].hooks[0].command;
        expect(cmd).toBe(`node ${TEST_HOOK_CLIENT} --tool copilot`);
        expect(cmd).toContain('claude-code-fleet');
      });

      it('uses camelCase keys via EVENT_KEY_MAP', () => {
        adapter.installHooks(TEST_HOOK_CLIENT);
        const written = JSON.parse(mockFs.store[CONFIG_PATH]);
        expect(written.hooks.sessionStart).toHaveLength(1);
        expect(written.hooks.postToolUse).toHaveLength(1);
        expect(written.hooks.agentStop).toHaveLength(1);
        // PascalCase keys should NOT be present
        expect(written.hooks.SessionStart).toBeUndefined();
        expect(written.hooks.PostToolUse).toBeUndefined();
        expect(written.hooks.Stop).toBeUndefined();
      });

      it('does not duplicate existing fleet hooks', () => {
        mockFs.store[CONFIG_PATH] = JSON.stringify({
          hooks: {
            sessionStart: [{
              hooks: [{ type: 'command', command: `node ${TEST_HOOK_CLIENT} --tool copilot` }]
            }]
          }
        });
        adapter.installHooks(TEST_HOOK_CLIENT);
        const written = JSON.parse(mockFs.store[CONFIG_PATH]);
        expect(written.hooks.sessionStart).toHaveLength(1);
        expect(written.hooks.postToolUse).toHaveLength(1);
      });

      it('preserves non-fleet hooks', () => {
        mockFs.store[CONFIG_PATH] = JSON.stringify({
          hooks: {
            sessionStart: [{
              hooks: [{ type: 'command', command: 'some-other-hook' }]
            }]
          }
        });
        adapter.installHooks(TEST_HOOK_CLIENT);
        const written = JSON.parse(mockFs.store[CONFIG_PATH]);
        expect(written.hooks.sessionStart).toHaveLength(2);
      });
    });

    describe('removeHooks', () => {
      it('removes fleet hooks while preserving non-fleet hooks', () => {
        mockFs.store[CONFIG_PATH] = JSON.stringify({
          hooks: {
            sessionStart: [
              { hooks: [{ type: 'command', command: 'node /x/claude-code-fleet/hook' }] },
              { hooks: [{ type: 'command', command: 'other-hook' }] },
            ],
            postToolUse: [
              { hooks: [{ type: 'command', command: 'node /x/claude-code-fleet/hook' }] },
            ],
          }
        });
        adapter.removeHooks();
        const written = JSON.parse(mockFs.store[CONFIG_PATH]);
        expect(written.hooks.sessionStart).toHaveLength(1);
        expect(written.hooks.sessionStart[0].hooks[0].command).toBe('other-hook');
        expect(written.hooks.postToolUse).toBeUndefined();
      });

      it('cleans up empty hooks object', () => {
        mockFs.store[CONFIG_PATH] = JSON.stringify({
          hooks: {
            sessionStart: [
              { hooks: [{ type: 'command', command: 'node /x/claude-code-fleet/hook' }] },
            ],
          }
        });
        adapter.removeHooks();
        const written = JSON.parse(mockFs.store[CONFIG_PATH]);
        expect(written.hooks).toBeUndefined();
      });

      it('is no-op when config file is missing', () => {
        const keysBefore = Object.keys(mockFs.store);
        adapter.removeHooks();
        expect(Object.keys(mockFs.store)).toEqual(keysBefore);
      });
    });

    describe('isHookInstalled', () => {
      it('returns true when all events have fleet hooks via camelCase keys', () => {
        mockFs.store[CONFIG_PATH] = JSON.stringify({
          hooks: {
            sessionStart: [{ hooks: [{ type: 'command', command: 'node /x/claude-code-fleet/hook' }] }],
            postToolUse: [{ hooks: [{ type: 'command', command: 'node /x/claude-code-fleet/hook' }] }],
            agentStop: [{ hooks: [{ type: 'command', command: 'node /x/claude-code-fleet/hook' }] }],
          }
        });
        expect(adapter.isHookInstalled()).toBe(true);
      });

      it('returns false when some events are missing hooks', () => {
        mockFs.store[CONFIG_PATH] = JSON.stringify({
          hooks: {
            sessionStart: [{ hooks: [{ type: 'command', command: 'node /x/claude-code-fleet/hook' }] }],
          }
        });
        expect(adapter.isHookInstalled()).toBe(false);
      });

      it('returns false when config file is missing', () => {
        expect(adapter.isHookInstalled()).toBe(false);
      });
    });
  });

  // ── Task 3: normalizePayload + summarizeToolUse ──

  describe('normalizePayload', () => {
    it('maps camelCase sessionStart payload to unified format', () => {
      const raw = {
        type: 'sessionStart',
        session_id: 'sess-1',
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

    it('maps PascalCase SessionStart payload to unified format', () => {
      const raw = {
        type: 'SessionStart',
        sessionId: 'sess-2',
        cwd: '/workspace',
        model: 'o1',
      };
      const result = adapter.normalizePayload(raw);
      expect(result.event).toBe('SessionStart');
      expect(result.session_id).toBe('sess-2');
      expect(result.cwd).toBe('/workspace');
    });

    it('maps camelCase postToolUse payload to unified format', () => {
      const raw = {
        type: 'postToolUse',
        session_id: 'sess-3',
        cwd: '/app',
        model: 'gpt-4o',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
      };
      const result = adapter.normalizePayload(raw);
      expect(result.event).toBe('PostToolUse');
      expect(result.tool_name).toBe('Bash');
      expect(result.tool_input).toEqual({ command: 'ls' });
    });

    it('maps PascalCase PostToolUse payload to unified format', () => {
      const raw = {
        type: 'PostToolUse',
        sessionId: 'sess-4',
        cwd: '/app',
        model: 'o3',
        toolName: 'Edit',
        input: { file_path: '/a.js' },
      };
      const result = adapter.normalizePayload(raw);
      expect(result.event).toBe('PostToolUse');
      expect(result.tool_name).toBe('Edit');
      expect(result.tool_input).toEqual({ file_path: '/a.js' });
    });

    it('maps camelCase agentStop payload to Stop event', () => {
      const raw = {
        type: 'agentStop',
        session_id: 'sess-5',
        message: 'Task completed',
      };
      const result = adapter.normalizePayload(raw);
      expect(result.event).toBe('Stop');
      expect(result.message).toBe('Task completed');
    });

    it('maps PascalCase AgentStop payload to Stop event', () => {
      const raw = {
        type: 'AgentStop',
        sessionId: 'sess-6',
        message: 'Done',
      };
      const result = adapter.normalizePayload(raw);
      expect(result.event).toBe('Stop');
      expect(result.message).toBe('Done');
    });

    it('truncates last_assistant_message to 500 chars', () => {
      const raw = {
        type: 'sessionStart',
        session_id: 's1',
        last_assistant_message: 'x'.repeat(1000),
      };
      const result = adapter.normalizePayload(raw);
      expect(result.last_assistant_message).toHaveLength(500);
    });

    it('handles unknown event type gracefully', () => {
      const raw = {
        type: 'unknownEvent',
        session_id: 's-unknown',
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
});
