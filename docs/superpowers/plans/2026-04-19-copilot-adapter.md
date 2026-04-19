# GitHub Copilot CLI Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub Copilot CLI (`@github/copilot`) as a third tool adapter to claude-code-fleet with full Observer Mode and Model Profile support.

**Architecture:** Follow the existing adapter + registry pattern. Create `CopilotAdapter` extending `ToolAdapter` base class, register it in the adapter index, and update infrastructure files (master hook deployment, TUI colors, CLI model add flow) to recognize the new tool.

**Tech Stack:** Node.js (CJS), Vitest for testing

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/adapters/copilot.js` | Create | CopilotAdapter class — hooks, args, env, payload normalization |
| `tests/adapters/copilot.test.js` | Create | Unit tests for CopilotAdapter |
| `src/adapters/index.js` | Modify | Register CopilotAdapter |
| `src/master.js` | Modify | Add `'copilot.js'` to ADAPTER_FILES |
| `src/index.js` | Modify | Skip apiKey for copilot in cmdModelAdd; add copilot placeholders; update help text; add copilot to hook file list |
| `src/components/worker-card.mjs` | Modify | Add copilot color to TOOL_COLORS |
| `tests/adapters/index.test.js` | Modify | Assert 3 adapters registered |

---

### Task 1: Create CopilotAdapter — identity + buildArgs + buildEnv

**Files:**
- Create: `src/adapters/copilot.js`
- Test: `tests/adapters/copilot.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/adapters/copilot.test.js
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

  describe('identity', () => {
    it('has correct name, displayName, binary', () => {
      expect(adapter.name).toBe('copilot');
      expect(adapter.displayName).toBe('GitHub Copilot');
      expect(adapter.binary).toBe('copilot');
    });

    it('has correct hookEvents (3 events, no Notification)', () => {
      expect(adapter.hookEvents).toEqual(['SessionStart', 'PostToolUse', 'Stop']);
      expect(adapter.hookEvents).not.toContain('Notification');
    });
  });

  describe('buildArgs', () => {
    it('returns --allow-all as base arg', () => {
      const args = adapter.buildArgs({});
      expect(args).toEqual(['--allow-all']);
    });

    it('appends entry.args if present', () => {
      const args = adapter.buildArgs({ args: ['--verbose'] });
      expect(args).toEqual(['--allow-all', '--verbose']);
    });

    it('does not include --model (model is set via env var)', () => {
      const args = adapter.buildArgs({ model: 'gpt-4.1' });
      expect(args).not.toContain('--model');
      expect(args).toEqual(['--allow-all']);
    });
  });

  describe('buildEnv', () => {
    it('sets COPILOT_MODEL when model is provided', () => {
      const env = adapter.buildEnv({ name: 'my-copilot', model: 'gpt-4.1' }, { PATH: '/bin' });
      expect(env.COPILOT_MODEL).toBe('gpt-4.1');
      expect(env.FLEET_MODEL_NAME).toBe('my-copilot');
      expect(env.PATH).toBe('/bin');
    });

    it('does not set COPILOT_MODEL when model is absent', () => {
      const env = adapter.buildEnv({ name: 'test' }, {});
      expect(env.COPILOT_MODEL).toBeUndefined();
      expect(env.FLEET_MODEL_NAME).toBe('test');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/copilot.test.js`
Expected: FAIL — module `../../src/adapters/copilot.js` not found

- [ ] **Step 3: Write minimal implementation**

```js
// src/adapters/copilot.js
const path = require('path');
const defaultFs = require('fs');
const os = require('os');
const { ToolAdapter } = require('./base');

const COPILOT_DIR = path.join(os.homedir(), '.copilot');
const CONFIG_PATH = path.join(COPILOT_DIR, 'config.json');
const FLEET_IDENTIFIER = 'claude-code-fleet';

// Map Fleet internal event names to Copilot config hook keys
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

  installHooks(_hookClientPath) { throw new Error('Not yet implemented'); }
  removeHooks() { throw new Error('Not yet implemented'); }
  normalizePayload(_rawInput) { throw new Error('Not yet implemented'); }
}

module.exports = { CopilotAdapter };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/copilot.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/adapters/copilot.js tests/adapters/copilot.test.js
git commit -m "feat(copilot): add CopilotAdapter with identity, buildArgs, buildEnv"
```

---

### Task 2: CopilotAdapter — hook installation and removal

> **NOTE:** The code samples below use `~/.copilot/config.json` as the hook target. This was later found to be incorrect — Copilot CLI loads hooks from per-repo `.github/hooks/fleet.json`, not from global config. The actual implementation uses `.github/hooks/fleet.json` with `{ version: 1, ... }` format. See the updated design spec at `docs/superpowers/specs/2026-04-19-copilot-adapter-design.md` for the correct approach.

**Files:**
- Modify: `src/adapters/copilot.js`
- Modify: `tests/adapters/copilot.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/adapters/copilot.test.js`, inside the outer `describe('CopilotAdapter', ...)` block, after the `buildEnv` describe block:

```js
  describe('hook operations', () => {
    let mockFs;

    beforeEach(() => {
      mockFs = createMockFs();
      adapter = new CopilotAdapter({ fs: mockFs });
    });

    it('installHooks creates hooks in empty config', () => {
      adapter.installHooks(TEST_HOOK_CLIENT);
      const written = JSON.parse(mockFs.store[CONFIG_PATH]);
      expect(written.hooks.sessionStart).toHaveLength(1);
      expect(written.hooks.postToolUse).toHaveLength(1);
      expect(written.hooks.agentStop).toHaveLength(1);
      const cmd = written.hooks.sessionStart[0].hooks[0].command;
      expect(cmd).toBe(`node ${TEST_HOOK_CLIENT} --tool copilot`);
      expect(cmd).toContain('claude-code-fleet');
    });

    it('installHooks uses Copilot event key names (camelCase)', () => {
      adapter.installHooks(TEST_HOOK_CLIENT);
      const written = JSON.parse(mockFs.store[CONFIG_PATH]);
      // Keys must be camelCase (copilot format), not PascalCase (Fleet internal)
      expect(written.hooks.sessionStart).toBeDefined();
      expect(written.hooks.postToolUse).toBeDefined();
      expect(written.hooks.agentStop).toBeDefined();
      // Not the Fleet-internal names
      expect(written.hooks.SessionStart).toBeUndefined();
      expect(written.hooks.PostToolUse).toBeUndefined();
      expect(written.hooks.Stop).toBeUndefined();
    });

    it('installHooks does not duplicate existing fleet hooks', () => {
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

    it('installHooks preserves existing non-fleet hooks', () => {
      mockFs.store[CONFIG_PATH] = JSON.stringify({
        hooks: {
          sessionStart: [{
            hooks: [{ type: 'command', command: 'other-hook' }]
          }]
        },
        someOtherField: true,
      });
      adapter.installHooks(TEST_HOOK_CLIENT);
      const written = JSON.parse(mockFs.store[CONFIG_PATH]);
      expect(written.hooks.sessionStart).toHaveLength(2);
      expect(written.someOtherField).toBe(true);
    });

    it('removeHooks removes fleet hooks only', () => {
      mockFs.store[CONFIG_PATH] = JSON.stringify({
        hooks: {
          sessionStart: [
            { hooks: [{ type: 'command', command: 'node /x/claude-code-fleet/hook' }] },
            { hooks: [{ type: 'command', command: 'other-hook' }] },
          ],
          postToolUse: [
            { hooks: [{ type: 'command', command: 'node /x/claude-code-fleet/hook' }] },
          ],
          agentStop: [
            { hooks: [{ type: 'command', command: 'node /x/claude-code-fleet/hook' }] },
          ],
        }
      });
      adapter.removeHooks();
      const written = JSON.parse(mockFs.store[CONFIG_PATH]);
      expect(written.hooks.sessionStart).toHaveLength(1);
      expect(written.hooks.sessionStart[0].hooks[0].command).toBe('other-hook');
      // Empty arrays removed
      expect(written.hooks.postToolUse).toBeUndefined();
      expect(written.hooks.agentStop).toBeUndefined();
    });

    it('removeHooks cleans up empty hooks object entirely', () => {
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

    it('removeHooks is no-op when config file missing', () => {
      const keysBefore = Object.keys(mockFs.store);
      adapter.removeHooks();
      expect(Object.keys(mockFs.store)).toEqual(keysBefore);
    });

    it('isHookInstalled returns true when all events have fleet hooks', () => {
      const hooks = {};
      hooks.sessionStart = [{ hooks: [{ type: 'command', command: 'node /x/claude-code-fleet/hook' }] }];
      hooks.postToolUse = [{ hooks: [{ type: 'command', command: 'node /x/claude-code-fleet/hook' }] }];
      hooks.agentStop = [{ hooks: [{ type: 'command', command: 'node /x/claude-code-fleet/hook' }] }];
      mockFs.store[CONFIG_PATH] = JSON.stringify({ hooks });
      expect(adapter.isHookInstalled()).toBe(true);
    });

    it('isHookInstalled returns false when hooks are missing', () => {
      mockFs.store[CONFIG_PATH] = JSON.stringify({ hooks: { sessionStart: [] } });
      expect(adapter.isHookInstalled()).toBe(false);
    });

    it('isHookInstalled returns false when config is missing', () => {
      expect(adapter.isHookInstalled()).toBe(false);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/copilot.test.js`
Expected: FAIL — `installHooks` throws "Not yet implemented"

- [ ] **Step 3: Implement hook methods in CopilotAdapter**

Replace the three `throw` stubs in `src/adapters/copilot.js` with:

```js
  installHooks(hookClientPath) {
    const fs = this._fs;
    let config = {};
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      }
    } catch { /* corrupted → start fresh */ }

    const hookCmd = `node ${hookClientPath} --tool copilot`;
    if (!config.hooks) config.hooks = {};

    for (const eventName of this.hookEvents) {
      const copilotKey = EVENT_KEY_MAP[eventName];
      if (!config.hooks[copilotKey]) config.hooks[copilotKey] = [];
      const exists = config.hooks[copilotKey].some(
        group => (group.hooks || []).some(h => h.command && h.command.includes(FLEET_IDENTIFIER))
      );
      if (!exists) {
        config.hooks[copilotKey].push({
          hooks: [{ type: 'command', command: hookCmd }]
        });
      }
    }

    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = CONFIG_PATH + '.fleet-tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n');
    fs.renameSync(tmpPath, CONFIG_PATH);
  }

  removeHooks() {
    const fs = this._fs;
    if (!fs.existsSync(CONFIG_PATH)) return;

    let config = {};
    try {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch { return; }

    if (!config.hooks) return;

    for (const eventName of Object.keys(config.hooks)) {
      config.hooks[eventName] = config.hooks[eventName].filter(group => {
        if ((group.hooks || []).some(h => h.command && h.command.includes(FLEET_IDENTIFIER))) return false;
        if (group.command && group.command.includes(FLEET_IDENTIFIER)) return false;
        return true;
      });
      if (config.hooks[eventName].length === 0) delete config.hooks[eventName];
    }
    if (Object.keys(config.hooks).length === 0) delete config.hooks;

    const tmpPath = CONFIG_PATH + '.fleet-tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n');
    fs.renameSync(tmpPath, CONFIG_PATH);
  }

  isHookInstalled() {
    const fs = this._fs;
    if (!fs.existsSync(CONFIG_PATH)) return false;
    let config = {};
    try {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch { return false; }

    if (!config.hooks) return false;
    return this.hookEvents.every(evt => {
      const copilotKey = EVENT_KEY_MAP[evt];
      const groups = config.hooks[copilotKey] || [];
      return groups.some(
        g => (g.hooks || []).some(h => h.command && h.command.includes(FLEET_IDENTIFIER))
      );
    });
  }

  normalizePayload(_rawInput) { throw new Error('Not yet implemented'); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/copilot.test.js`
Expected: PASS (all tests including new hook tests)

- [ ] **Step 5: Commit**

```bash
git add src/adapters/copilot.js tests/adapters/copilot.test.js
git commit -m "feat(copilot): add hook installation/removal for ~/.copilot/config.json"
```

---

### Task 3: CopilotAdapter — normalizePayload + summarizeToolUse

**Files:**
- Modify: `src/adapters/copilot.js`
- Modify: `tests/adapters/copilot.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/adapters/copilot.test.js`, inside the outer `describe('CopilotAdapter', ...)`, after the `hook operations` describe block:

```js
  describe('normalizePayload', () => {
    it('maps camelCase payload (sessionStart) to unified format', () => {
      const raw = {
        type: 'sessionStart',
        session_id: 'cop-sess-1',
        cwd: '/project',
        model: 'gpt-4.1',
      };
      const result = adapter.normalizePayload(raw);
      expect(result.event).toBe('SessionStart');
      expect(result.session_id).toBe('cop-sess-1');
      expect(result.cwd).toBe('/project');
      expect(result.model).toBe('gpt-4.1');
      expect(result.timestamp).toBeTypeOf('number');
    });

    it('maps PascalCase payload (SessionStart) to unified format', () => {
      const raw = {
        type: 'SessionStart',
        sessionId: 'cop-sess-2',
        cwd: '/project',
        model: 'gpt-4.1',
      };
      const result = adapter.normalizePayload(raw);
      expect(result.event).toBe('SessionStart');
      expect(result.session_id).toBe('cop-sess-2');
    });

    it('maps camelCase postToolUse with tool_name', () => {
      const raw = {
        type: 'postToolUse',
        session_id: 'cop-sess-3',
        tool_name: 'Edit',
        tool_input: { file_path: '/a.js' },
      };
      const result = adapter.normalizePayload(raw);
      expect(result.event).toBe('PostToolUse');
      expect(result.tool_name).toBe('Edit');
      expect(result.tool_input).toEqual({ file_path: '/a.js' });
    });

    it('maps PascalCase PostToolUse with toolName', () => {
      const raw = {
        type: 'PostToolUse',
        sessionId: 'cop-sess-4',
        toolName: 'Bash',
        input: { command: 'ls' },
      };
      const result = adapter.normalizePayload(raw);
      expect(result.event).toBe('PostToolUse');
      expect(result.tool_name).toBe('Bash');
      expect(result.tool_input).toEqual({ command: 'ls' });
    });

    it('maps agentStop to Stop', () => {
      const raw = {
        type: 'agentStop',
        session_id: 'cop-sess-5',
        last_assistant_message: 'All done',
      };
      const result = adapter.normalizePayload(raw);
      expect(result.event).toBe('Stop');
      expect(result.last_assistant_message).toBe('All done');
    });

    it('maps AgentStop to Stop', () => {
      const raw = {
        type: 'AgentStop',
        sessionId: 'cop-sess-6',
      };
      const result = adapter.normalizePayload(raw);
      expect(result.event).toBe('Stop');
    });

    it('truncates last_assistant_message to 500 chars', () => {
      const raw = {
        type: 'agentStop',
        session_id: 's1',
        last_assistant_message: 'z'.repeat(1000),
      };
      const result = adapter.normalizePayload(raw);
      expect(result.last_assistant_message).toHaveLength(500);
    });

    it('passes through unknown event types', () => {
      const raw = { type: 'unknownEvent', session_id: 's1' };
      const result = adapter.normalizePayload(raw);
      expect(result.event).toBe('unknownEvent');
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
    });

    it('Glob → Glob pattern', () => {
      expect(adapter.summarizeToolUse('Glob', { pattern: '**/*.js' })).toBe('Glob **/*.js');
    });

    it('unknown tool → returns tool name', () => {
      expect(adapter.summarizeToolUse('WebSearch', { query: 'foo' })).toBe('WebSearch');
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/copilot.test.js`
Expected: FAIL — `normalizePayload` throws "Not yet implemented"

- [ ] **Step 3: Implement normalizePayload and summarizeToolUse**

Replace the `normalizePayload` stub in `src/adapters/copilot.js` with:

```js
  normalizePayload(rawInput) {
    const eventMap = {
      'sessionStart': 'SessionStart',
      'SessionStart': 'SessionStart',
      'postToolUse': 'PostToolUse',
      'PostToolUse': 'PostToolUse',
      'agentStop': 'Stop',
      'AgentStop': 'Stop',
    };

    return {
      event: eventMap[rawInput.type] || rawInput.type,
      session_id: rawInput.session_id || rawInput.sessionId,
      cwd: rawInput.cwd,
      timestamp: Date.now(),
      model: rawInput.model || null,
      pid: process.pid,
      ppid: process.ppid,
      term_program: process.env.TERM_PROGRAM || null,
      iterm_session_id: process.env.ITERM_SESSION_ID || null,
      tool_name: rawInput.tool_name || rawInput.toolName || null,
      tool_input: rawInput.tool_input || rawInput.input || null,
      last_assistant_message: rawInput.last_assistant_message
        ? rawInput.last_assistant_message.slice(0, 500)
        : null,
      message: rawInput.message || null,
    };
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/copilot.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adapters/copilot.js tests/adapters/copilot.test.js
git commit -m "feat(copilot): add normalizePayload and summarizeToolUse"
```

---

### Task 4: Register CopilotAdapter in adapter index

**Files:**
- Modify: `src/adapters/index.js`
- Modify: `tests/adapters/index.test.js`

- [ ] **Step 1: Update the test to expect 3 adapters**

In `tests/adapters/index.test.js`, change the existing test and add a new one:

```js
// Change this test:
  it('registers both claude and codex adapters', () => {
    expect(registry.all()).toHaveLength(2);
  });

// To:
  it('registers claude, codex, and copilot adapters', () => {
    expect(registry.all()).toHaveLength(3);
  });

// Add this test after the codex test:
  it('copilot adapter is accessible by name', () => {
    const copilot = registry.get('copilot');
    expect(copilot).toBeDefined();
    expect(copilot.name).toBe('copilot');
    expect(copilot.displayName).toBe('GitHub Copilot');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/index.test.js`
Expected: FAIL — expected length 3, received 2

- [ ] **Step 3: Register CopilotAdapter in index.js**

In `src/adapters/index.js`, add the import and registration:

```js
const registry = require('./registry');
const { ClaudeAdapter } = require('./claude');
const { CodexAdapter } = require('./codex');
const { CopilotAdapter } = require('./copilot');

registry.register(new ClaudeAdapter());
registry.register(new CodexAdapter());
registry.register(new CopilotAdapter());

module.exports = { registry };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/index.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adapters/index.js tests/adapters/index.test.js
git commit -m "feat(copilot): register CopilotAdapter in adapter index"
```

---

### Task 5: Update master.js — add copilot.js to ADAPTER_FILES

**Files:**
- Modify: `src/master.js`

- [ ] **Step 1: Add 'copilot.js' to the adapter file list**

In `src/master.js`, line 262, change:

```js
for (const file of ['base.js', 'claude.js', 'codex.js', 'registry.js', 'index.js']) {
```

to:

```js
for (const file of ['base.js', 'claude.js', 'codex.js', 'copilot.js', 'registry.js', 'index.js']) {
```

- [ ] **Step 2: Run existing master tests to verify no regressions**

Run: `npx vitest run tests/master.test.js`
Expected: PASS (no regressions)

- [ ] **Step 3: Commit**

```bash
git add src/master.js
git commit -m "feat(copilot): include copilot.js in master hook deployment"
```

---

### Task 6: Update src/index.js — copilot-aware model add + help text + hook file list

**Files:**
- Modify: `src/index.js`

- [ ] **Step 1: Update cmdModelAdd placeholders for copilot**

In `src/index.js`, within `cmdModelAdd()`, change the `placeholders` object (around line 177-181) from:

```js
  const placeholders = {
    modelId: toolName === 'codex' ? 'e.g. gpt-5.4' : 'e.g. claude-opus-4-6',
    apiKey: toolName === 'codex' ? 'sk-...' : 'sk-ant-...',
    apiBaseUrl: toolName === 'codex' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com',
  };
```

to:

```js
  const placeholders = {
    modelId: toolName === 'codex' ? 'e.g. gpt-5.4' : toolName === 'copilot' ? 'e.g. gpt-4.1' : 'e.g. claude-opus-4-6',
    apiKey: toolName === 'copilot' ? 'not required (GitHub OAuth)' : toolName === 'codex' ? 'sk-...' : 'sk-ant-...',
    apiBaseUrl: toolName === 'codex' ? 'https://api.openai.com/v1' : toolName === 'copilot' ? 'not required' : 'https://api.anthropic.com',
  };
```

- [ ] **Step 2: Make apiKey optional for copilot in cmdModelAdd**

In `src/index.js`, within `cmdModelAdd()`, change the `requiredFields` and form logic (around line 185-198).

Replace:

```js
  const allRequired = ['Name', 'Model ID', 'API Key', 'API Base URL'];
```

with:

```js
  const allRequired = toolName === 'copilot'
    ? ['Name', 'Model ID']
    : ['Name', 'Model ID', 'API Key', 'API Base URL'];
```

- [ ] **Step 3: Add copilot to cmdHooksInstall file list**

In `src/index.js`, within `cmdHooksInstall()`, around line 417, change:

```js
    for (const file of ['base.js', 'claude.js', 'codex.js', 'registry.js', 'index.js']) {
```

to:

```js
    for (const file of ['base.js', 'claude.js', 'codex.js', 'copilot.js', 'registry.js', 'index.js']) {
```

- [ ] **Step 4: Update help text**

In `src/index.js`, within `printHelp()`, update the Supported Tools section (around line 606-608) from:

```
${ANSI.bold('Supported Tools:')}
  claude              Claude Code (anthropic)
  codex               Codex CLI (openai)
```

to:

```
${ANSI.bold('Supported Tools:')}
  claude              Claude Code (anthropic)
  codex               Codex CLI (openai)
  copilot             GitHub Copilot CLI (github)
```

Also update the model add help line (around line 600) from:

```
  model add [tool]    Add a new model profile (claude, codex)
```

to:

```
  model add [tool]    Add a new model profile (claude, codex, copilot)
```

- [ ] **Step 5: Run tests to verify no regressions**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/index.js
git commit -m "feat(copilot): update CLI for copilot model profiles and help text"
```

---

### Task 7: Update worker-card.mjs — add copilot color

**Files:**
- Modify: `src/components/worker-card.mjs`

- [ ] **Step 1: Add copilot color to TOOL_COLORS**

In `src/components/worker-card.mjs`, change the `TOOL_COLORS` constant (line 9-12) from:

```js
const TOOL_COLORS = {
  claude: '#a78bfa',
  codex: '#4ade80',
};
```

to:

```js
const TOOL_COLORS = {
  claude: '#a78bfa',
  codex: '#4ade80',
  copilot: '#58a6ff',
};
```

The color `#58a6ff` is GitHub's brand blue — distinct from Claude's purple and Codex's green.

- [ ] **Step 2: Run tests to verify no regressions**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/worker-card.mjs
git commit -m "feat(copilot): add copilot tool color (GitHub blue) to worker card"
```

---

### Task 8: Final integration verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS, 0 failures

- [ ] **Step 2: Verify adapter registration works end-to-end**

Run: `node -e "const {registry} = require('./src/adapters'); console.log(registry.all().map(a => a.name))"`
Expected: `[ 'claude', 'codex', 'copilot' ]`

- [ ] **Step 3: Verify hook-client can load copilot adapter**

Run: `node -e "const mod = require('./src/adapters/copilot'); const a = new mod.CopilotAdapter(); console.log(a.name, a.hookEvents)"`
Expected: `copilot [ 'SessionStart', 'PostToolUse', 'Stop' ]`

- [ ] **Step 4: Verify CLI help shows copilot**

Run: `node src/index.js --help`
Expected: Help text includes `copilot` in Supported Tools section
