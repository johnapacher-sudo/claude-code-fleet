# Multi-Tool Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple claude-code-fleet from Claude Code CLI hardcoding, support Claude Code + Codex CLI via an Adapter pattern across all three modes (Model Profile / Observer / Fleet).

**Architecture:** Introduce a `ToolAdapter` base class with `ClaudeAdapter` and `CodexAdapter` implementations. Extract all Claude-specific logic (binary detection, CLI args, env vars, hook injection, payload normalization, tool use summary) into `ClaudeAdapter`. Registry pattern for adapter lookup by tool name. All existing config defaults to `tool: "claude"` for backward compatibility.

**Tech Stack:** Node.js (CommonJS), Ink/React (TUI), Vitest (tests)

**Spec:** `docs/superpowers/specs/2026-04-16-multi-tool-adapter-design.md`

---

### Task 1: Create ToolAdapter Base Class

**Files:**
- Create: `src/adapters/base.js`
- Test: `tests/adapters/base.test.js`

- [ ] **Step 1: Write the test for ToolAdapter base class**

```javascript
// tests/adapters/base.test.js
const { describe, it, expect } = require('vitest');
const { ToolAdapter } = require('../src/adapters/base');

describe('ToolAdapter', () => {
  it('throws on direct instantiation of abstract methods', () => {
    const adapter = new ToolAdapter();
    expect(() => adapter.name).toThrow();
    expect(() => adapter.displayName).toThrow();
    expect(() => adapter.binary).toThrow();
    expect(() => adapter.buildArgs({})).toThrow();
    expect(() => adapter.buildEnv({}, {})).toThrow();
    expect(() => adapter.installHooks()).toThrow();
    expect(() => adapter.removeHooks()).toThrow();
    expect(() => adapter.normalizePayload({})).toThrow();
    expect(() => adapter.hookEvents).toThrow();
  });

  it('provides default isInstalled using which', () => {
    const adapter = new ToolAdapter();
    // Can't test name getter (abstract), but isInstalled logic is testable via subclass
    expect(typeof adapter.isInstalled).toBe('function');
  });

  it('provides default summarizeToolUse returning tool name', () => {
    const adapter = new ToolAdapter();
    expect(adapter.summarizeToolUse('SomeTool', {})).toBe('SomeTool');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/base.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ToolAdapter base class**

```javascript
// src/adapters/base.js
const { spawnSync } = require('child_process');

class ToolAdapter {
  get name() { throw new Error('ToolAdapter.name must be implemented'); }
  get displayName() { throw new Error('ToolAdapter.displayName must be implemented'); }
  get binary() { throw new Error('ToolAdapter.binary must be implemented'); }
  get hookEvents() { throw new Error('ToolAdapter.hookEvents must be implemented'); }

  isInstalled() {
    const r = spawnSync('which', [this.binary], { encoding: 'utf-8', stdio: 'pipe' });
    return r.status === 0;
  }

  buildArgs(_entry) { throw new Error('ToolAdapter.buildArgs must be implemented'); }
  buildEnv(_entry, _baseEnv) { throw new Error('ToolAdapter.buildEnv must be implemented'); }
  installHooks() { throw new Error('ToolAdapter.installHooks must be implemented'); }
  removeHooks() { throw new Error('ToolAdapter.removeHooks must be implemented'); }
  normalizePayload(_rawInput) { throw new Error('ToolAdapter.normalizePayload must be implemented'); }

  summarizeToolUse(toolName, _toolInput) {
    return toolName;
  }
}

module.exports = { ToolAdapter };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/base.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adapters/base.js tests/adapters/base.test.js
git commit -m "feat: add ToolAdapter base class with abstract interface"
```

---

### Task 2: Create Adapter Registry

**Files:**
- Create: `src/adapters/registry.js`
- Test: `tests/adapters/registry.test.js`

- [ ] **Step 1: Write the test for registry**

```javascript
// tests/adapters/registry.test.js
const { describe, it, expect, beforeEach } = require('vitest');

// We need to test the registry in isolation, so we'll require it fresh
let registry;
beforeEach(async () => {
  // Reset module cache for clean state
  const mod = await import('../src/adapters/registry.js');
  // registry is CommonJS, use require with cache busting
});

describe('registry', () => {
  // For simplicity, test with a mock adapter
  it('register and get adapter', () => {
    const { register, get, all, installed, detect, reset } = require('../src/adapters/registry');
    reset(); // clean state for test

    const mockAdapter = {
      name: 'test-tool',
      isInstalled: () => true,
    };
    register(mockAdapter);
    expect(get('test-tool')).toBe(mockAdapter);
    expect(all()).toHaveLength(1);
    expect(installed()).toHaveLength(1);
  });

  it('get returns undefined for unknown tool', () => {
    const { get, reset } = require('../src/adapters/registry');
    reset();
    expect(get('nonexistent')).toBeUndefined();
  });

  it('detect returns _tool field or defaults to claude', () => {
    const { detect } = require('../src/adapters/registry');
    expect(detect({ _tool: 'codex' })).toBe('codex');
    expect(detect({ _tool: 'claude' })).toBe('claude');
    expect(detect({})).toBe('claude');
  });

  it('installed filters by isInstalled', () => {
    const { register, installed, reset } = require('../src/adapters/registry');
    reset();
    register({ name: 'a', isInstalled: () => true });
    register({ name: 'b', isInstalled: () => false });
    expect(installed()).toHaveLength(1);
    expect(installed()[0].name).toBe('a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/registry.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement registry**

```javascript
// src/adapters/registry.js
const adapters = new Map();

function register(adapter) {
  adapters.set(adapter.name, adapter);
}

function get(name) {
  return adapters.get(name);
}

function all() {
  return [...adapters.values()];
}

function installed() {
  return all().filter(a => a.isInstalled());
}

function detect(payload) {
  return payload._tool || 'claude';
}

function reset() {
  adapters.clear();
}

module.exports = { register, get, all, installed, detect, reset };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/registry.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adapters/registry.js tests/adapters/registry.test.js
git commit -m "feat: add adapter registry for tool lookup"
```

---

### Task 3: Create ClaudeAdapter

**Files:**
- Create: `src/adapters/claude.js`
- Test: `tests/adapters/claude.test.js`

- [ ] **Step 1: Write the test for ClaudeAdapter**

```javascript
// tests/adapters/claude.test.js
const { describe, it, expect, vi, beforeEach } = require('vitest');
const path = require('path');
const os = require('os');

// Mock fs and child_process before requiring
vi.mock('fs');
vi.mock('child_process');

const fs = require('fs');
const { spawnSync } = require('child_process');

describe('ClaudeAdapter', () => {
  let ClaudeAdapter, adapter;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    ({ ClaudeAdapter } = require('../src/adapters/claude'));
    adapter = new ClaudeAdapter();
  });

  it('has correct identity', () => {
    expect(adapter.name).toBe('claude');
    expect(adapter.displayName).toBe('Claude Code');
    expect(adapter.binary).toBe('claude');
  });

  it('hookEvents includes Notification', () => {
    expect(adapter.hookEvents).toEqual(['SessionStart', 'PostToolUse', 'Stop', 'Notification']);
  });

  describe('buildArgs', () => {
    it('builds args with model and settings', () => {
      const args = adapter.buildArgs({
        apiKey: 'sk-test',
        apiBaseUrl: 'https://proxy.example.com',
        model: 'claude-opus-4-6',
      });
      expect(args).toContain('--dangerously-skip-permissions');
      expect(args).toContain('--model');
      expect(args).toContain('claude-opus-4-6');
      expect(args.some(a => a.startsWith('--settings')
        || (args[args.indexOf('--settings') + 1] || '').includes('ANTHROPIC'))).toBe(true);
    });

    it('includes extra args from entry', () => {
      const args = adapter.buildArgs({ args: ['--verbose'] });
      expect(args).toContain('--verbose');
    });
  });

  describe('buildEnv', () => {
    it('sets ANTHROPIC env vars', () => {
      const env = adapter.buildEnv(
        { apiKey: 'sk-test', apiBaseUrl: 'https://proxy.example.com', name: 'test' },
        { PATH: '/usr/bin' }
      );
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-test');
      expect(env.ANTHROPIC_BASE_URL).toBe('https://proxy.example.com');
      expect(env.FLEET_MODEL_NAME).toBe('test');
      expect(env.PATH).toBe('/usr/bin');
    });
  });

  describe('normalizePayload', () => {
    it('normalizes SessionStart', () => {
      const p = adapter.normalizePayload({
        hook_event_name: 'SessionStart',
        session_id: 'abc',
        cwd: '/tmp',
        model: 'opus',
      });
      expect(p.event).toBe('SessionStart');
      expect(p.session_id).toBe('abc');
      expect(p.model).toBe('opus');
    });

    it('normalizes PostToolUse', () => {
      const p = adapter.normalizePayload({
        hook_event_name: 'PostToolUse',
        session_id: 'abc',
        cwd: '/tmp',
        tool_name: 'Edit',
        tool_input: { file_path: '/tmp/foo.js' },
      });
      expect(p.event).toBe('PostToolUse');
      expect(p.tool_name).toBe('Edit');
    });

    it('normalizes Notification', () => {
      const p = adapter.normalizePayload({
        hook_event_name: 'Notification',
        session_id: 'abc',
        message: 'Done',
        notification_type: 'info',
      });
      expect(p.event).toBe('Notification');
      expect(p.message).toBe('Done');
    });
  });

  describe('summarizeToolUse', () => {
    it('summarizes Edit', () => {
      expect(adapter.summarizeToolUse('Edit', { file_path: '/a/b/foo.js' })).toBe('Edit foo.js');
    });
    it('summarizes Bash', () => {
      expect(adapter.summarizeToolUse('Bash', { command: 'npm test' })).toBe('Bash: npm test');
    });
    it('summarizes Grep', () => {
      expect(adapter.summarizeToolUse('Grep', { pattern: 'hello' })).toBe('Grep "hello"');
    });
    it('falls back for unknown tools', () => {
      expect(adapter.summarizeToolUse('CustomTool', {})).toBe('CustomTool');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/claude.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ClaudeAdapter**

Extract logic from `src/index.js` (lines 469-493 for buildArgs/buildEnv) and `src/master.js` (lines 251-263 for summarizeToolUse, lines 265-297 for installHooks, lines 299-320 for removeHooks):

```javascript
// src/adapters/claude.js
const { ToolAdapter } = require('./base');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const FLEET_IDENTIFIER = 'claude-code-fleet';

class ClaudeAdapter extends ToolAdapter {
  get name() { return 'claude'; }
  get displayName() { return 'Claude Code'; }
  get binary() { return 'claude'; }
  get hookEvents() { return ['SessionStart', 'PostToolUse', 'Stop', 'Notification']; }

  buildArgs(entry) {
    const settingsEnv = {};
    if (entry.apiKey) {
      settingsEnv.ANTHROPIC_AUTH_TOKEN = entry.apiKey;
      settingsEnv.ANTHROPIC_API_KEY = '';
    }
    if (entry.apiBaseUrl) settingsEnv.ANTHROPIC_BASE_URL = entry.apiBaseUrl;

    const args = ['--dangerously-skip-permissions'];
    if (entry.model) args.push('--model', entry.model);
    if (Object.keys(settingsEnv).length > 0) {
      args.push('--settings', JSON.stringify({ env: settingsEnv }));
    }
    if (entry.args) args.push(...entry.args);
    return args;
  }

  buildEnv(entry, baseEnv) {
    const env = { ...baseEnv };
    if (entry.name) env.FLEET_MODEL_NAME = entry.name;
    return env;
  }

  installHooks(hookClientPath) {
    const hookCmd = `node ${hookClientPath} --tool claude`;
    let settings = {};
    try {
      if (fs.existsSync(SETTINGS_PATH)) {
        settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
      }
    } catch { /* corrupted, start fresh */ }

    if (!settings.hooks) settings.hooks = {};

    for (const eventName of this.hookEvents) {
      if (!settings.hooks[eventName]) settings.hooks[eventName] = [];
      const exists = settings.hooks[eventName].some(
        group => (group.hooks || []).some(h => h.command && h.command.includes(FLEET_IDENTIFIER))
      );
      if (!exists) {
        settings.hooks[eventName].push({
          hooks: [{ type: 'command', command: hookCmd }],
        });
      }
    }

    const tmpPath = SETTINGS_PATH + '.fleet-tmp';
    const dir = path.dirname(SETTINGS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n');
    fs.renameSync(tmpPath, SETTINGS_PATH);
  }

  removeHooks() {
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

    const tmpPath = SETTINGS_PATH + '.fleet-tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n');
    fs.renameSync(tmpPath, SETTINGS_PATH);
  }

  isHookInstalled() {
    if (!fs.existsSync(SETTINGS_PATH)) return false;
    try {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
      if (!settings.hooks) return false;
      return this.hookEvents.every(evt => {
        const groups = settings.hooks[evt] || [];
        return groups.some(g => (g.hooks || []).some(h => h.command && h.command.includes(FLEET_IDENTIFIER)));
      });
    } catch { return false; }
  }

  normalizePayload(rawInput) {
    const payload = {
      event: rawInput.hook_event_name,
      session_id: rawInput.session_id,
      cwd: rawInput.cwd,
      timestamp: Date.now(),
    };

    if (rawInput.hook_event_name === 'SessionStart') {
      payload.model = rawInput.model || null;
      payload.pid = process.pid;
      payload.ppid = process.ppid;
      payload.term_program = process.env.TERM_PROGRAM || null;
      payload.iterm_session_id = process.env.ITERM_SESSION_ID || null;
    }

    if (rawInput.hook_event_name === 'PostToolUse') {
      payload.tool_name = rawInput.tool_name;
      payload.tool_input = rawInput.tool_input;
    }

    if (rawInput.hook_event_name === 'Notification') {
      payload.message = rawInput.message;
      payload.notification_type = rawInput.notification_type;
    }

    if (rawInput.hook_event_name === 'Stop') {
      payload.last_assistant_message = (rawInput.last_assistant_message || '').slice(0, 500);
    }

    return payload;
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

module.exports = { ClaudeAdapter, SETTINGS_PATH, FLEET_IDENTIFIER };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/claude.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adapters/claude.js tests/adapters/claude.test.js
git commit -m "feat: extract Claude-specific logic into ClaudeAdapter"
```

---

### Task 4: Create CodexAdapter

**Files:**
- Create: `src/adapters/codex.js`
- Test: `tests/adapters/codex.test.js`

- [ ] **Step 1: Write the test for CodexAdapter**

```javascript
// tests/adapters/codex.test.js
const { describe, it, expect, vi, beforeEach } = require('vitest');

vi.mock('fs');

describe('CodexAdapter', () => {
  let CodexAdapter, adapter;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    ({ CodexAdapter } = require('../src/adapters/codex'));
    adapter = new CodexAdapter();
  });

  it('has correct identity', () => {
    expect(adapter.name).toBe('codex');
    expect(adapter.displayName).toBe('Codex CLI');
    expect(adapter.binary).toBe('codex');
  });

  it('hookEvents does not include Notification', () => {
    expect(adapter.hookEvents).toEqual(['SessionStart', 'PostToolUse', 'Stop']);
    expect(adapter.hookEvents).not.toContain('Notification');
  });

  describe('buildArgs', () => {
    it('builds args with model', () => {
      const args = adapter.buildArgs({ model: 'gpt-5.4' });
      expect(args).toContain('--model');
      expect(args).toContain('gpt-5.4');
    });

    it('does not include --dangerously-skip-permissions', () => {
      const args = adapter.buildArgs({ model: 'gpt-5.4' });
      expect(args).not.toContain('--dangerously-skip-permissions');
    });

    it('passes approval_policy via --config', () => {
      const args = adapter.buildArgs({ model: 'gpt-5.4' });
      const configIdx = args.findIndex(a => a === '-c' || a === '--config');
      expect(configIdx).toBeGreaterThanOrEqual(0);
    });
  });

  describe('buildEnv', () => {
    it('sets OPENAI_API_KEY', () => {
      const env = adapter.buildEnv(
        { apiKey: 'sk-openai-test', name: 'codex-worker' },
        { PATH: '/usr/bin' }
      );
      expect(env.OPENAI_API_KEY).toBe('sk-openai-test');
      expect(env.FLEET_MODEL_NAME).toBe('codex-worker');
    });

    it('sets OPENAI_BASE_URL when apiBaseUrl provided', () => {
      const env = adapter.buildEnv(
        { apiKey: 'sk-test', apiBaseUrl: 'https://custom.endpoint.com/v1', name: 'x' },
        {}
      );
      expect(env.OPENAI_BASE_URL).toBe('https://custom.endpoint.com/v1');
    });
  });

  describe('normalizePayload', () => {
    it('normalizes SessionStart', () => {
      const p = adapter.normalizePayload({
        hook_event_name: 'SessionStart',
        session_id: 'abc-codex',
        cwd: '/tmp',
      });
      expect(p.event).toBe('SessionStart');
      expect(p.session_id).toBe('abc-codex');
    });

    it('normalizes PostToolUse (Bash)', () => {
      const p = adapter.normalizePayload({
        hook_event_name: 'PostToolUse',
        session_id: 'abc',
        cwd: '/tmp',
        tool_name: 'Bash',
        tool_input: { command: 'ls -la' },
      });
      expect(p.tool_name).toBe('Bash');
    });
  });

  describe('summarizeToolUse', () => {
    it('summarizes Bash', () => {
      expect(adapter.summarizeToolUse('Bash', { command: 'npm test' })).toBe('Bash: npm test');
    });
    it('falls back for unknown tools', () => {
      expect(adapter.summarizeToolUse('SomeNewTool', {})).toBe('SomeNewTool');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/codex.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement CodexAdapter**

```javascript
// src/adapters/codex.js
const { ToolAdapter } = require('./base');
const path = require('path');
const fs = require('fs');
const os = require('os');

const CODEX_HOME = path.join(os.homedir(), '.codex');
const HOOKS_PATH = path.join(CODEX_HOME, 'hooks.json');
const CONFIG_PATH = path.join(CODEX_HOME, 'config.toml');
const FLEET_IDENTIFIER = 'claude-code-fleet';

class CodexAdapter extends ToolAdapter {
  get name() { return 'codex'; }
  get displayName() { return 'Codex CLI'; }
  get binary() { return 'codex'; }
  get hookEvents() { return ['SessionStart', 'PostToolUse', 'Stop']; }

  buildArgs(entry) {
    const args = [];
    if (entry.model) args.push('--model', entry.model);
    args.push('-c', 'approval_policy="never"');
    if (entry.args) args.push(...entry.args);
    return args;
  }

  buildEnv(entry, baseEnv) {
    const env = { ...baseEnv };
    if (entry.apiKey) env.OPENAI_API_KEY = entry.apiKey;
    if (entry.apiBaseUrl) env.OPENAI_BASE_URL = entry.apiBaseUrl;
    if (entry.name) env.FLEET_MODEL_NAME = entry.name;
    return env;
  }

  installHooks(hookClientPath) {
    const hookCmd = `node ${hookClientPath} --tool codex`;

    // Ensure hooks.json exists and add fleet hooks
    let hooksConfig = { hooks: {} };
    try {
      if (fs.existsSync(HOOKS_PATH)) {
        hooksConfig = JSON.parse(fs.readFileSync(HOOKS_PATH, 'utf-8'));
      }
    } catch { /* start fresh */ }

    if (!hooksConfig.hooks) hooksConfig.hooks = {};

    for (const eventName of this.hookEvents) {
      if (!hooksConfig.hooks[eventName]) hooksConfig.hooks[eventName] = [];
      const exists = hooksConfig.hooks[eventName].some(
        group => (group.hooks || []).some(h => h.command && h.command.includes(FLEET_IDENTIFIER))
      );
      if (!exists) {
        hooksConfig.hooks[eventName].push({
          hooks: [{ type: 'command', command: hookCmd }],
        });
      }
    }

    if (!fs.existsSync(CODEX_HOME)) fs.mkdirSync(CODEX_HOME, { recursive: true });
    fs.writeFileSync(HOOKS_PATH, JSON.stringify(hooksConfig, null, 2) + '\n');

    // Ensure config.toml has codex_hooks = true
    this._ensureHooksFeatureFlag();
  }

  removeHooks() {
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

    fs.writeFileSync(HOOKS_PATH, JSON.stringify(hooksConfig, null, 2) + '\n');
  }

  isHookInstalled() {
    if (!fs.existsSync(HOOKS_PATH)) return false;
    try {
      const hooksConfig = JSON.parse(fs.readFileSync(HOOKS_PATH, 'utf-8'));
      if (!hooksConfig.hooks) return false;
      return this.hookEvents.every(evt => {
        const groups = hooksConfig.hooks[evt] || [];
        return groups.some(g => (g.hooks || []).some(h => h.command && h.command.includes(FLEET_IDENTIFIER)));
      });
    } catch { return false; }
  }

  normalizePayload(rawInput) {
    const payload = {
      event: rawInput.hook_event_name,
      session_id: rawInput.session_id,
      cwd: rawInput.cwd,
      timestamp: Date.now(),
    };

    if (rawInput.hook_event_name === 'SessionStart') {
      payload.model = rawInput.model || null;
      payload.pid = process.pid;
      payload.ppid = process.ppid;
      payload.term_program = process.env.TERM_PROGRAM || null;
      payload.iterm_session_id = process.env.ITERM_SESSION_ID || null;
    }

    if (rawInput.hook_event_name === 'PostToolUse') {
      payload.tool_name = rawInput.tool_name;
      payload.tool_input = rawInput.tool_input;
    }

    if (rawInput.hook_event_name === 'Stop') {
      payload.last_assistant_message = (rawInput.last_assistant_message || '').slice(0, 500);
    }

    return payload;
  }

  summarizeToolUse(toolName, toolInput) {
    const input = toolInput || {};
    switch (toolName) {
      case 'Bash': return `Bash: ${(input.command || '').slice(0, 50)}`;
      default:     return toolName;
    }
  }

  _ensureHooksFeatureFlag() {
    let content = '';
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        content = fs.readFileSync(CONFIG_PATH, 'utf-8');
      }
    } catch { /* start fresh */ }

    if (/codex_hooks\s*=\s*true/.test(content)) return;

    if (/\[features\]/.test(content)) {
      if (/codex_hooks\s*=\s*false/.test(content)) {
        content = content.replace(/codex_hooks\s*=\s*false/, 'codex_hooks = true');
      } else {
        content = content.replace(/\[features\]/, '[features]\ncodex_hooks = true');
      }
    } else {
      content += '\n[features]\ncodex_hooks = true\n';
    }

    if (!fs.existsSync(CODEX_HOME)) fs.mkdirSync(CODEX_HOME, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, content);
  }
}

module.exports = { CodexAdapter, HOOKS_PATH, CONFIG_PATH, CODEX_HOME, FLEET_IDENTIFIER };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/codex.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adapters/codex.js tests/adapters/codex.test.js
git commit -m "feat: add CodexAdapter for Codex CLI support"
```

---

### Task 5: Wire Up Registry with Built-in Adapters

**Files:**
- Create: `src/adapters/index.js`
- Test: `tests/adapters/index.test.js`

- [ ] **Step 1: Write the test**

```javascript
// tests/adapters/index.test.js
const { describe, it, expect } = require('vitest');
const { registry } = require('../src/adapters');

describe('adapters/index', () => {
  it('registers claude and codex adapters', () => {
    const all = registry.all();
    const names = all.map(a => a.name);
    expect(names).toContain('claude');
    expect(names).toContain('codex');
  });

  it('can look up claude adapter', () => {
    const claude = registry.get('claude');
    expect(claude.displayName).toBe('Claude Code');
  });

  it('can look up codex adapter', () => {
    const codex = registry.get('codex');
    expect(codex.displayName).toBe('Codex CLI');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/index.test.js`
Expected: FAIL

- [ ] **Step 3: Implement adapters/index.js**

```javascript
// src/adapters/index.js
const registry = require('./registry');
const { ClaudeAdapter } = require('./claude');
const { CodexAdapter } = require('./codex');

registry.register(new ClaudeAdapter());
registry.register(new CodexAdapter());

module.exports = { registry };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/index.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adapters/index.js tests/adapters/index.test.js
git commit -m "feat: wire up adapter registry with claude and codex"
```

---

### Task 6: Refactor `index.js` — `cmdRun` and `cmdUp`

**Files:**
- Modify: `src/index.js`
- Modify: existing tests that cover `cmdRun`, `cmdUp`, `checkDeps`

- [ ] **Step 1: Add `require` for adapters at top of index.js**

In `src/index.js`, after the existing require block (line ~8), add:

```javascript
const { registry } = require('./adapters');
```

- [ ] **Step 2: Replace `checkDeps()` with `checkToolDeps(toolName)`**

Replace the existing `checkDeps` function (lines 91-96) with:

```javascript
function checkToolDeps(toolName) {
  const adapter = registry.get(toolName || 'claude');
  if (!adapter) {
    console.error(ANSI.red(`Unknown tool: ${toolName}`));
    console.error(`Available tools: ${registry.all().map(a => a.name).join(', ')}`);
    process.exit(1);
  }
  if (!adapter.isInstalled()) {
    console.error(ANSI.red(`Missing dependency: ${adapter.binary} (${adapter.displayName})`));
    process.exit(1);
  }
}
```

- [ ] **Step 3: Refactor `cmdRun` to use adapter**

Replace lines 441-494 of `cmdRun`. Key changes:
- Resolve `entry.tool` (default `'claude'`)
- Call `checkToolDeps(entry.tool)` instead of `checkDeps()`
- Use `adapter.buildArgs(entry)` instead of hardcoded Claude args
- Use `adapter.buildEnv(entry, baseEnv)` instead of hardcoded env vars
- `spawn(adapter.binary, ...)` instead of `spawn('claude', ...)`
- Display `adapter.displayName` in launch message

```javascript
async function cmdRun(modelName, cwd, proxyOpt) {
  const data = loadModels();
  if (data.models.length === 0) {
    console.error(ANSI.yellow('No model profiles configured.'));
    console.error(`Run ${ANSI.bold('fleet model add')} to create one.`);
    process.exit(1);
  }

  let entry;
  if (modelName) {
    entry = data.models.find(m => m.name === modelName);
    if (!entry) {
      console.error(ANSI.red(`Model "${modelName}" not found.`));
      console.error(`Available: ${data.models.map(m => m.name).join(', ')}`);
      process.exit(1);
    }
  } else {
    const items = data.models.map(m => modelItem(m));
    const selected = await selectFromList(items, 'Select a model to run');
    if (selected === null) return;
    entry = data.models.find(m => m.name === selected);
  }

  const toolName = entry.tool || 'claude';
  checkToolDeps(toolName);
  const adapter = registry.get(toolName);

  const workDir = cwd ? path.resolve(cwd) : process.cwd();
  if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

  const proxyUrl = resolveProxy(proxyOpt, entry.proxy);
  const proxyInfo = proxyUrl ? `  proxy: ${proxyUrl}` : '';
  console.log(ANSI.dim(`\n  Launching ${adapter.displayName} with model: ${entry.model || 'default'} (${entry.name})${proxyInfo}\n`));

  const args = adapter.buildArgs(entry);
  const baseEnv = { ...process.env };
  applyProxy(baseEnv, proxyUrl);
  const env = adapter.buildEnv(entry, baseEnv);

  const child = spawn(adapter.binary, args, {
    cwd: workDir,
    stdio: 'inherit',
    env,
  });
  child.on('exit', code => process.exit(code || 0));
}
```

- [ ] **Step 4: Refactor `cmdUp` to use adapter**

Replace lines 542-596 of `cmdUp`. Key changes are the same pattern — resolve `inst.tool`, get adapter, delegate:

```javascript
function cmdUp(config, onlyNames) {
  cleanupState();
  const state = loadState();
  const instances = filterInstances(config.instances, onlyNames);

  for (const inst of instances) {
    if (state.instances[inst.name] && isProcessAlive(state.instances[inst.name].pid)) {
      console.log(ANSI.yellow(`  [${inst.name}] already running (pid ${state.instances[inst.name].pid})`));
      continue;
    }

    const toolName = inst.tool || 'claude';
    checkToolDeps(toolName);
    const adapter = registry.get(toolName);

    const cwd = inst.cwd ? path.resolve(inst.cwd) : process.cwd();
    if (!fs.existsSync(cwd)) fs.mkdirSync(cwd, { recursive: true });

    const baseEnv = { ...process.env };
    if (inst.env) Object.assign(baseEnv, inst.env);
    applyProxy(baseEnv, inst.proxy);

    const args = adapter.buildArgs(inst);
    const env = adapter.buildEnv(inst, baseEnv);

    const child = spawn(adapter.binary, args, {
      cwd,
      env,
      stdio: 'ignore',
      detached: true,
    });
    child.unref();

    state.instances[inst.name] = {
      pid: child.pid,
      tool: toolName,
      model: inst.model || 'default',
      cwd,
      startedAt: new Date().toISOString(),
    };

    const proxyTag = inst.proxy ? ` proxy=${inst.proxy}` : '';
    const toolTag = toolName !== 'claude' ? ` [${adapter.displayName}]` : '';
    console.log(ANSI.green(`  [${inst.name}]`) + `${toolTag} model=${ANSI.cyan(inst.model || 'default')} pid=${child.pid}${proxyTag}`);
  }

  saveState(state);
  console.log(`\nFleet launched with ${instances.length} instance(s).`);
  console.log(ANSI.dim('  fleet ls       # List running instances'));
  console.log(ANSI.dim('  fleet down     # Stop all instances'));
}
```

- [ ] **Step 5: Update `modelItem` to show tool tag**

Modify `modelItem` function (lines 51-60) to include tool info in the display:

```javascript
function modelItem(m) {
  const toolTag = m.tool && m.tool !== 'claude' ? `[${m.tool.charAt(0).toUpperCase() + m.tool.slice(1)}] ` : '';
  return {
    display: `${m.name || '(unnamed)'} (${toolTag}${m.model || 'default'})`,
    label: m.name || '(unnamed)',
    detail: `${toolTag}${m.model || 'default'}`,
    meta: modelMeta(m),
    warning: modelWarning(m),
    value: m.name,
  };
}
```

- [ ] **Step 6: Update module.exports to export new functions**

In the `module.exports` at the end of `index.js`, replace `checkDeps` with `checkToolDeps`.

- [ ] **Step 7: Run all existing tests to verify no regressions**

Run: `npx vitest run`
Expected: All existing tests PASS (may need minor adjustments for `checkDeps` → `checkToolDeps` rename in test mocks)

- [ ] **Step 8: Commit**

```bash
git add src/index.js
git commit -m "refactor: cmdRun/cmdUp use adapter pattern for multi-tool support"
```

---

### Task 7: Refactor `master.js` — Hook Management and Event Handling

**Files:**
- Modify: `src/master.js`

- [ ] **Step 1: Add adapter registry import**

At the top of `master.js`, after existing requires (line ~7), add:

```javascript
const { registry } = require('./adapters');
```

- [ ] **Step 2: Replace `ensureHooks()` with adapter-driven hook installation**

Replace the standalone `ensureHooks` function (lines 265-297) with:

```javascript
function ensureHooks() {
  if (!fs.existsSync(HOOKS_DIR)) fs.mkdirSync(HOOKS_DIR, { recursive: true });
  fs.copyFileSync(HOOK_CLIENT_SRC, HOOK_CLIENT_DST);
  if (fs.existsSync(NOTIFIER_SRC)) fs.copyFileSync(NOTIFIER_SRC, NOTIFIER_DST);

  const installedAdapters = registry.installed();
  for (const adapter of installedAdapters) {
    adapter.installHooks(HOOK_CLIENT_DST);
  }
}
```

- [ ] **Step 3: Replace `removeHooks()` with adapter-driven removal**

Replace the standalone `removeHooks` function (lines 299-320) with:

```javascript
function removeHooks() {
  for (const adapter of registry.all()) {
    adapter.removeHooks();
  }
}
```

- [ ] **Step 4: Remove standalone `summarizeToolUse` function**

Delete lines 251-263 (the `summarizeToolUse` function). This logic now lives in each adapter.

- [ ] **Step 5: Update `handleEvent` to use adapter**

In the `handleEvent` method, add `tool` field when creating workers and delegate `summarizeToolUse`:

Worker creation (inside `if (!this.workers.has(sid))` block, ~line 84-104) — add:

```javascript
tool: payload._tool || 'claude',
```

In the PostToolUse block (~line 129-151), change:

```javascript
const summary = summarizeToolUse(payload);
```

to:

```javascript
const workerTool = worker.tool || 'claude';
const adapter = registry.get(workerTool);
const summary = adapter
  ? adapter.summarizeToolUse(payload.tool_name, payload.tool_input)
  : `${payload.tool_name}`;
```

- [ ] **Step 6: Update `loadPersistedSessions` to restore tool field**

In the `loadPersistedSessions` method (~line 197-238), when creating the worker entry, add:

```javascript
tool: data.tool || 'claude',
```

- [ ] **Step 7: Run all tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/master.js
git commit -m "refactor: master.js uses adapter registry for hooks and event handling"
```

---

### Task 8: Refactor `hook-client.js`

**Files:**
- Modify: `src/hook-client.js`

- [ ] **Step 1: Add --tool argument parsing and adapter loading**

Replace the entire `hook-client.js` with the adapter-aware version:

```javascript
#!/usr/bin/env node

const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

let notifier;
try { notifier = require('./notifier'); } catch { notifier = null; }

const CONFIG_DIR = path.join(os.homedir(), '.config', 'claude-code-fleet');
const SOCK_PATH = path.join(CONFIG_DIR, 'fleet.sock');
const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');

function parseToolArg() {
  const idx = process.argv.indexOf('--tool');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return 'claude';
}

function getAdapter(toolName) {
  try {
    const adaptersDir = path.join(__dirname, 'adapters');
    if (fs.existsSync(path.join(adaptersDir, `${toolName}.js`))) {
      const AdapterClass = require(`./adapters/${toolName}`);
      const className = Object.keys(AdapterClass).find(k => k.endsWith('Adapter'));
      if (className) return new AdapterClass[className]();
    }
  } catch { /* fall through */ }
  return null;
}

async function main() {
  const toolName = parseToolArg();
  const adapter = getAdapter(toolName);

  let input = {};
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    if (raw.trim()) input = JSON.parse(raw);
  } catch { /* empty or invalid stdin */ }

  const payload = adapter
    ? adapter.normalizePayload(input)
    : {
        event: input.hook_event_name,
        session_id: input.session_id,
        cwd: input.cwd,
        timestamp: Date.now(),
        tool_name: input.tool_name,
        tool_input: input.tool_input,
        model: input.model || null,
        last_assistant_message: (input.last_assistant_message || '').slice(0, 500),
        message: input.message,
        notification_type: input.notification_type,
      };

  payload._tool = toolName;

  if (process.env.FLEET_MODEL_NAME) {
    payload.fleet_model_name = process.env.FLEET_MODEL_NAME;
  }

  // Persist session file
  if (payload.event === 'SessionStart') {
    try {
      const sessionFile = path.join(SESSIONS_DIR, `${payload.session_id}.json`);
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
      fs.writeFileSync(sessionFile, JSON.stringify({
        sessionId: payload.session_id,
        cwd: payload.cwd,
        model: payload.model,
        tool: toolName,
        term_program: payload.term_program || process.env.TERM_PROGRAM || null,
        iterm_session_id: payload.iterm_session_id || process.env.ITERM_SESSION_ID || null,
        pid: payload.pid || process.pid,
        ppid: payload.ppid || process.ppid,
        fleet_model_name: process.env.FLEET_MODEL_NAME || null,
        timestamp: Date.now(),
      }, null, 2));
    } catch { /* ignore write failures */ }
  }

  if (payload.event === 'Stop') {
    try {
      const sessionFile = path.join(SESSIONS_DIR, `${payload.session_id}.json`);
      if (fs.existsSync(sessionFile)) {
        const data = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
        data.stoppedAt = Date.now();
        if (payload.last_assistant_message) {
          data.lastMessage = { text: payload.last_assistant_message, time: Date.now() };
        }
        fs.writeFileSync(sessionFile, JSON.stringify(data, null, 2));
      }
    } catch { /* ignore */ }
  }

  // Socket forwarding
  const client = net.connect(SOCK_PATH, () => {
    client.write(JSON.stringify(payload) + '\n');
    client.end();
  });
  client.on('error', () => { /* master not running */ });
  setTimeout(() => process.exit(0), 1000);

  // Notification
  if (notifier) {
    try {
      const config = notifier.loadNotifyConfig();
      if (!config.enabled) return;

      const displayName = adapter ? adapter.displayName : 'Claude Code';
      const sid = payload.session_id;
      const sound = config.sound;

      if (payload.event === 'Stop' && config.events.stop) {
        notifier.sendNotification({
          title: displayName,
          body: payload.last_assistant_message,
          cwd: payload.cwd,
          sessionId: sid,
          platform: process.platform,
          sound,
        });
      }

      if (payload.event === 'Notification' && config.events.notification) {
        notifier.sendNotification({
          title: displayName,
          body: payload.message,
          cwd: payload.cwd,
          sessionId: sid,
          platform: process.platform,
          sound,
        });
      }
    } catch { /* notification failures must not affect main flow */ }
  }
}

main();
```

- [ ] **Step 2: Run existing hook-client tests**

Run: `npx vitest run tests/hook-client.test.js`
Expected: PASS (or fix any broken assertions due to new `_tool` field in payload)

- [ ] **Step 3: Commit**

```bash
git add src/hook-client.js
git commit -m "refactor: hook-client supports --tool flag for multi-tool payloads"
```

---

### Task 9: Update CLI Commands — `model add`, `hooks`, Help Text

**Files:**
- Modify: `src/index.js`

- [ ] **Step 1: Update `cmdModelAdd` to accept tool argument**

Modify `cmdModelAdd` (around line 264) to accept a `toolName` parameter. If provided, auto-fill the tool field; if not, prompt user to select a tool first:

```javascript
async function cmdModelAdd(toolName) {
  const selectorPath = path.join(__dirname, 'components', 'selector.mjs');
  const inputMod = await import(selectorPath);

  // If no tool specified, ask user to choose
  if (!toolName) {
    const toolItems = registry.all().map(a => ({
      label: a.displayName,
      detail: a.binary,
      value: a.name,
    }));
    toolName = await selectFromList(toolItems, 'Select a tool type');
    if (!toolName) return; // cancelled
  }

  const adapter = registry.get(toolName);
  if (!adapter) {
    console.error(ANSI.red(`Unknown tool: ${toolName}`));
    process.exit(1);
  }

  const allRequired = ['Name', 'Model ID', 'API Key', 'API Base URL'];

  while (true) {
    const created = await inputMod.renderInput({
      title: `Add a new ${adapter.displayName} model profile`,
      fields: [
        { label: 'Name', value: '', placeholder: 'e.g. opus-prod' },
        { label: 'Model ID', value: '', placeholder: toolName === 'codex' ? 'e.g. gpt-5.4' : 'e.g. claude-opus-4-6' },
        { label: 'API Key', value: '', placeholder: toolName === 'codex' ? 'sk-...' : 'sk-ant-...' },
        { label: 'API Base URL', value: '', placeholder: toolName === 'codex' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com' },
        { label: 'Proxy URL', value: '', placeholder: 'http://127.0.0.1:7890 (optional)' },
      ],
      requiredFields: allRequired,
    });

    if (!created) return;

    const key = truncStr(created['API Key'], 12) + '...';
    const endpoint = truncStr(created['API Base URL'], 32);
    const proxyDisplay = created['Proxy URL'] ? ` · proxy: ${truncStr(created['Proxy URL'], 32)}` : '';
    const confirmed = await inputMod.renderConfirm({
      title: `Add ${adapter.displayName} model "${created.Name}"?`,
      items: {
        label: created.Name,
        detail: `[${adapter.displayName}] ${created['Model ID']}`,
        meta: `key: ${key} · endpoint: ${endpoint}${proxyDisplay}`,
        value: created.Name,
      },
    });

    if (!confirmed) continue;

    const data = loadModels();
    if (data.models.some(m => m.name === created.Name)) {
      console.error(ANSI.red(`Model "${created.Name}" already exists.`));
      process.exit(1);
    }

    data.models.push({
      name: created.Name,
      tool: toolName,
      model: created['Model ID'] || undefined,
      apiKey: created['API Key'] || undefined,
      apiBaseUrl: created['API Base URL'] || undefined,
      proxy: created['Proxy URL'] || undefined,
    });
    saveModels(data);
    console.log(ANSI.green(`\n  ${adapter.displayName} model "${created.Name}" added.`));
    return;
  }
}
```

- [ ] **Step 2: Update `model add` command dispatch to pass tool arg**

In the `main()` function, model command section (lines 893-916), change:

```javascript
case 'add':
  cmdModelAdd();
  break;
```

to:

```javascript
case 'add':
  cmdModelAdd(args[0]); // args[0] is e.g. "claude" or "codex"
  break;
```

- [ ] **Step 3: Update `cmdHooksInstall`, `cmdHooksRemove`, `cmdHooksStatus`**

Replace `cmdHooksInstall` (line 625-629):

```javascript
function cmdHooksInstall(toolsFilter) {
  const { ensureHooks } = require('./master');
  if (toolsFilter) {
    // Install hooks for specific tools only
    const toolNames = toolsFilter.split(',');
    for (const t of toolNames) {
      const adapter = registry.get(t.trim());
      if (!adapter) {
        console.error(ANSI.red(`Unknown tool: ${t.trim()}`));
        continue;
      }
      if (!adapter.isInstalled()) {
        console.error(ANSI.yellow(`${adapter.displayName} not installed, skipping.`));
        continue;
      }
      const HOOKS_DIR = path.join(GLOBAL_CONFIG_DIR, 'hooks');
      const HOOK_CLIENT_DST = path.join(HOOKS_DIR, 'hook-client.js');
      if (!fs.existsSync(HOOKS_DIR)) fs.mkdirSync(HOOKS_DIR, { recursive: true });
      fs.copyFileSync(path.join(__dirname, 'hook-client.js'), HOOK_CLIENT_DST);
      adapter.installHooks(HOOK_CLIENT_DST);
      console.log(ANSI.green(`Fleet hooks installed for ${adapter.displayName}`));
    }
  } else {
    ensureHooks();
    const installedNames = registry.installed().map(a => a.displayName).join(', ');
    console.log(ANSI.green(`Fleet hooks installed for: ${installedNames}`));
  }
}
```

Replace `cmdHooksRemove` (line 631-635):

```javascript
function cmdHooksRemove() {
  const { removeHooks } = require('./master');
  removeHooks();
  const allNames = registry.all().map(a => a.displayName).join(', ');
  console.log(ANSI.green(`Fleet hooks removed for: ${allNames}`));
}
```

Replace `cmdHooksStatus` (lines 637-665):

```javascript
function cmdHooksStatus() {
  console.log(ANSI.bold('\nFleet Hooks Status:\n'));

  for (const adapter of registry.all()) {
    const isInst = adapter.isInstalled();
    const hookOk = adapter.isHookInstalled ? adapter.isHookInstalled() : false;

    console.log(`  ${ANSI.bold(adapter.displayName)} (${adapter.binary}):`);
    if (!isInst) {
      console.log(`    ${ANSI.yellow('⚠')} CLI not installed`);
    } else if (hookOk) {
      console.log(`    ${ANSI.green('✓')} Hooks installed`);
      for (const evt of adapter.hookEvents) {
        console.log(`      ${ANSI.green('✓')} ${evt}`);
      }
    } else {
      console.log(`    ${ANSI.red('✗')} Hooks not installed`);
    }
    console.log();
  }
}
```

- [ ] **Step 4: Update `parseArgs` to handle `--tools` option**

In `parseArgs` (lines 782-823), add handling for `--tools`:

```javascript
} else if (arg === '--tools' && argv[i + 1]) {
  opts.tools = argv[++i];
```

- [ ] **Step 5: Update hooks command dispatch in `main()`**

In the hooks section of `main()` (lines 934-952), pass `opts.tools`:

```javascript
case 'install':
  cmdHooksInstall(opts.tools);
  break;
```

- [ ] **Step 6: Update `printHelp`**

Update the help text (lines 825-870) to reflect multi-tool support:

```javascript
function printHelp() {
  console.log(`${ANSI.bold('Claude Code Fleet')} — Manage multiple AI coding tool processes

${ANSI.bold('Usage:')}
  fleet [command] [options]

${ANSI.bold('Commands:')}
  run                 Start an AI coding tool with a model profile
  start               Start fleet observer (TUI dashboard)
  hooks install       Install fleet hooks for all detected tools
  hooks remove        Remove fleet hooks from all tools
  hooks status        Show current hook installation status
  model add [tool]    Add a new model profile (tool: claude, codex)
  model list          List all model profiles
  model edit          Edit a model profile (interactive)
  model delete        Delete a model profile (interactive)
  up                  Start instances from config (background)
  down                Stop all background instances
  restart             Restart instances
  ls                  List running instances
  status              Show instance configuration details
  init                Create a fleet.config.json from template
  notify              Configure desktop notifications

${ANSI.bold('Options:')}
  --config <path>     Use specific config file
  --only <names>      Comma-separated instance names to target
  --model <name>      Model profile name (for run command)
  --cwd <path>        Working directory (for run command)
  --proxy [url]       Enable HTTP proxy (uses profile proxy if url omitted)
  --tools <names>     Comma-separated tool names (for hooks install)
  -v, --version       Show version number
  -h, --help          Show this help

${ANSI.bold('Supported Tools:')}
  claude              Claude Code CLI
  codex               OpenAI Codex CLI

${ANSI.bold('Examples:')}
  fleet start                            # Start observer dashboard
  fleet run --model opus-prod            # Start with a model profile
  fleet model add claude                 # Add a Claude model profile
  fleet model add codex                  # Add a Codex model profile
  fleet hooks install                    # Install hooks for all detected tools
  fleet hooks install --tools codex      # Install hooks for Codex only
  fleet up                               # Start all instances (background)
`);
}
```

- [ ] **Step 7: Run all tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/index.js
git commit -m "feat: CLI commands support multi-tool (model add, hooks, help)"
```

---

### Task 10: Update TUI — Tool Label on Worker Cards

**Files:**
- Modify: `src/components/worker-card.mjs`
- Modify: `src/components/app.mjs`

- [ ] **Step 1: Add tool label colors to `colors.mjs` or inline**

In `src/components/worker-card.mjs`, define tool label colors:

```javascript
const TOOL_COLORS = {
  claude: '#a78bfa',  // purple
  codex: '#4ade80',   // green
};
```

- [ ] **Step 2: Update WorkerCard header to show tool label**

In the `WorkerCard` function (line 163-199 of `worker-card.mjs`), update the header row. After the status icon and before the project name, add a tool tag:

Find the header Box (around line 165-183):

```javascript
h(Box, { justifyContent: 'space-between' },
  h(Box, { gap: 1 },
    statusIcon.spinning
      ? h(Text, { color: statusIcon.color }, h(Spinner, { type: 'dots' }), ' ')
      : h(Text, { color: statusIcon.color }, statusIcon.icon),
    h(Text, { color: colors.projectName, bold: true }, worker.displayName),
```

Change to:

```javascript
h(Box, { justifyContent: 'space-between' },
  h(Box, { gap: 1 },
    statusIcon.spinning
      ? h(Text, { color: statusIcon.color }, h(Spinner, { type: 'dots' }), ' ')
      : h(Text, { color: statusIcon.color }, statusIcon.icon),
    worker.tool && worker.tool !== 'claude'
      ? h(Text, { color: TOOL_COLORS[worker.tool] || colors.idle }, `[${worker.tool.charAt(0).toUpperCase() + worker.tool.slice(1)}]`)
      : null,
    h(Text, { color: colors.projectName, bold: true }, worker.displayName),
```

- [ ] **Step 3: Update `app.mjs` empty state message**

In `src/components/app.mjs` line 147, change:

```javascript
'No active workers. Start claude processes to see them here.',
```

to:

```javascript
'No active workers. Start Claude or Codex processes to see them here.',
```

- [ ] **Step 4: Run TUI tests**

Run: `npx vitest run tests/components/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/worker-card.mjs src/components/app.mjs
git commit -m "feat: TUI worker cards show tool type label"
```

---

### Task 11: Update Config Example and Validation

**Files:**
- Modify: `fleet.config.example.json`
- Modify: `src/index.js` (validateConfig)

- [ ] **Step 1: Update `fleet.config.example.json`**

```json
{
  "instances": [
    {
      "name": "opus-worker",
      "tool": "claude",
      "apiKey": "sk-ant-api03-xxxxx",
      "model": "claude-opus-4-6",
      "apiBaseUrl": "https://api.anthropic.com",
      "cwd": "./workspace/opus"
    },
    {
      "name": "sonnet-worker",
      "tool": "claude",
      "apiKey": "sk-ant-api03-yyyyy",
      "model": "claude-sonnet-4-6",
      "apiBaseUrl": "https://api.anthropic.com",
      "cwd": "./workspace/sonnet"
    },
    {
      "name": "codex-worker",
      "tool": "codex",
      "apiKey": "sk-openai-zzzzz",
      "model": "gpt-5.4",
      "cwd": "./workspace/codex"
    },
    {
      "name": "custom-endpoint",
      "apiKey": "your-custom-api-key",
      "model": "claude-sonnet-4-6",
      "apiBaseUrl": "https://your-proxy.example.com/v1",
      "cwd": "./workspace/custom",
      "env": {
        "CUSTOM_HEADER": "some-value"
      },
      "args": ["--verbose"]
    }
  ]
}
```

- [ ] **Step 2: Update `validateConfig` to validate `tool` field**

In `validateConfig` (lines 189-210 of `src/index.js`), add tool validation inside the forEach:

```javascript
if (inst.tool && !registry.get(inst.tool)) {
  errors.push(`${prefix}: unknown tool "${inst.tool}" (available: ${registry.all().map(a => a.name).join(', ')})`);
}
```

- [ ] **Step 3: Update `cmdInit` template**

In `cmdInit` (lines 498-521), update the inline template to include a `tool` field:

```javascript
const template = fs.existsSync(example)
  ? fs.readFileSync(example, 'utf-8')
  : JSON.stringify({
      instances: [
        {
          name: 'worker-1',
          tool: 'claude',
          apiKey: 'your-api-key-here',
          model: 'claude-sonnet-4-6',
        },
      ],
    }, null, 2) + '\n';
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fleet.config.example.json src/index.js
git commit -m "feat: config examples and validation support tool field"
```

---

### Task 12: Final Integration Test and Cleanup

**Files:**
- Run full test suite
- Verify backward compatibility

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 2: Run full test suite with coverage**

Run: `npx vitest run --coverage`
Expected: Adapter modules have >80% coverage

- [ ] **Step 3: Manual smoke test — `fleet model list`**

Run: `node src/index.js model list`
Expected: Shows existing models (should work exactly as before)

- [ ] **Step 4: Manual smoke test — `fleet hooks status`**

Run: `node src/index.js hooks status`
Expected: Shows status for both Claude and Codex (Codex shows "CLI not installed" if not installed)

- [ ] **Step 5: Manual smoke test — `fleet --help`**

Run: `node src/index.js --help`
Expected: Shows updated help with multi-tool info

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: multi-tool adapter support — Claude Code + Codex CLI"
```
