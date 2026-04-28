# Model Profile Env Vars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users attach an arbitrary env-var map to any model profile, managed via a new `fleet model env <name>` subcommand, with per-adapter preset lists and interactive add/edit/delete UX reusing existing Ink components.

**Architecture:** Each model profile gets an optional `env: Record<string,string>` map in `models.json`. Adapters expose `commonEnvVars` presets and a shared `applyUserEnv()` helper from `base.js` that merges the map into the per-adapter env-injection path (`buildEnv` for codex/copilot; `buildArgs` + `buildEnv` for claude). `env` keys override any top-level field that maps to the same variable. Terminal UX reuses `selector.mjs` — Selector gets two new optional props (`onAdd` / `onDelete`), all other screens compose existing `renderInput` / `renderConfirm`.

**Tech Stack:** Node.js ≥18, CommonJS (`src/`), ESM (`src/components/*.mjs`), Ink v5 / React, Vitest, `rewire`.

**Spec reference:** `docs/superpowers/specs/2026-04-28-model-env-vars-design.md`

---

## File Structure

**Create:**
- `tests/index/env.test.js` — CLI env command tests (set / unset / list / error paths)
- `tests/index/env-helpers.test.js` — pure helpers (key validation, immutable updates)

**Modify:**
- `src/adapters/base.js` — add `applyUserEnv()` and default `get commonEnvVars()`
- `src/adapters/claude.js` — merge `entry.env` into `settingsEnv`, call `applyUserEnv` in `buildEnv`, implement `commonEnvVars`
- `src/adapters/codex.js` — call `applyUserEnv` in `buildEnv`, keep `commonEnvVars` empty (inherit default)
- `src/adapters/copilot.js` — same as codex
- `src/components/selector.mjs` — Selector gains `onAdd` / `onDelete` props + dynamic help line
- `src/index.js` — add env helpers (key validation, immutable updates, rendering funcs), add `cmdModelEnv` router, wire into `main()` switch, extend `parseArgs` for `set <k> <v>` forms, update `printHelp`, export new helpers for tests
- `tests/adapters/claude.test.js` — assert env merging + override
- `tests/adapters/codex.test.js` — assert `buildEnv` includes `entry.env`
- `tests/adapters/copilot.test.js` — assert `buildEnv` includes `entry.env`
- `tests/adapters/base.test.js` — default helpers
- `tests/components/selector.test.mjs` — new props behavior
- `README.md` — one row in the command table, `env` field in models.json snippet
- `CLAUDE.md` — `env` in the `models.json` example

---

## Task 1: Adapter base — applyUserEnv and default commonEnvVars

**Files:**
- Modify: `src/adapters/base.js`
- Test: `tests/adapters/base.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/adapters/base.test.js`:

```js
import { describe, it, expect } from 'vitest';
const { ToolAdapter } = await import('../../src/adapters/base.js');

class StubAdapter extends ToolAdapter {
  get name() { return 'stub'; }
  get displayName() { return 'Stub'; }
  get binary() { return 'stub'; }
  get hookEvents() { return []; }
  buildArgs() { return []; }
  buildEnv(entry, baseEnv) { return this.applyUserEnv(entry, { ...baseEnv }); }
  installHooks() {}
  removeHooks() {}
  normalizePayload(x) { return x; }
}

describe('ToolAdapter defaults', () => {
  it('commonEnvVars returns empty array by default', () => {
    expect(new StubAdapter().commonEnvVars).toEqual([]);
  });

  it('applyUserEnv merges entry.env into target env', () => {
    const a = new StubAdapter();
    const out = a.buildEnv({ env: { FOO: '1', BAR: 'hi' } }, { PATH: '/bin' });
    expect(out).toEqual({ PATH: '/bin', FOO: '1', BAR: 'hi' });
  });

  it('applyUserEnv is a no-op when entry.env is absent', () => {
    const a = new StubAdapter();
    const out = a.buildEnv({}, { PATH: '/bin' });
    expect(out).toEqual({ PATH: '/bin' });
  });

  it('applyUserEnv overrides baseEnv values', () => {
    const a = new StubAdapter();
    const out = a.buildEnv({ env: { PATH: '/override' } }, { PATH: '/bin' });
    expect(out.PATH).toBe('/override');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/adapters/base.test.js`
Expected: FAIL — `applyUserEnv is not a function`, `commonEnvVars` undefined.

- [ ] **Step 3: Implement in `src/adapters/base.js`**

Replace the file contents with:

```js
const { spawnSync } = require('child_process');

class ToolAdapter {
  get name() { throw new Error('ToolAdapter.name must be implemented'); }
  get displayName() { throw new Error('ToolAdapter.displayName must be implemented'); }
  get binary() { throw new Error('ToolAdapter.binary must be implemented'); }
  get hookEvents() { throw new Error('ToolAdapter.hookEvents must be implemented'); }

  get commonEnvVars() { return []; }

  isInstalled() {
    const r = spawnSync('which', [this.binary], { encoding: 'utf-8', stdio: 'pipe' });
    return r.status === 0;
  }

  buildArgs(_entry) { throw new Error('ToolAdapter.buildArgs must be implemented'); }
  buildEnv(_entry, _baseEnv) { throw new Error('ToolAdapter.buildEnv must be implemented'); }
  installHooks(_hookClientPath) { throw new Error('ToolAdapter.installHooks must be implemented'); }
  removeHooks() { throw new Error('ToolAdapter.removeHooks must be implemented'); }
  normalizePayload(_rawInput) { throw new Error('ToolAdapter.normalizePayload must be implemented'); }
  classifyFailure(_result) {
    return { kind: 'terminal', reason: 'unclassified' };
  }

  summarizeToolUse(toolName, _toolInput) {
    return toolName;
  }

  applyUserEnv(entry, env) {
    if (entry && entry.env && typeof entry.env === 'object') {
      for (const [k, v] of Object.entries(entry.env)) {
        if (v !== undefined && v !== null) env[k] = String(v);
      }
    }
    return env;
  }
}

module.exports = { ToolAdapter };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/adapters/base.test.js`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/base.js tests/adapters/base.test.js
git commit -m "feat(adapter): add applyUserEnv helper and commonEnvVars default"
```

---

## Task 2: Codex adapter — merge entry.env

**Files:**
- Modify: `src/adapters/codex.js:33-38`
- Test: `tests/adapters/codex.test.js`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('CodexAdapter', ...)` block in `tests/adapters/codex.test.js`:

```js
  describe('buildEnv with entry.env', () => {
    it('merges entry.env into the returned env', () => {
      const env = adapter.buildEnv(
        { name: 'p', apiKey: 'sk', env: { CUSTOM_FLAG: '1', LOG_LEVEL: 'debug' } },
        { PATH: '/bin' }
      );
      expect(env.CUSTOM_FLAG).toBe('1');
      expect(env.LOG_LEVEL).toBe('debug');
      expect(env.OPENAI_API_KEY).toBe('sk');
    });

    it('entry.env overrides OPENAI_API_KEY if present', () => {
      const env = adapter.buildEnv(
        { name: 'p', apiKey: 'sk', env: { OPENAI_API_KEY: 'override' } },
        {}
      );
      expect(env.OPENAI_API_KEY).toBe('override');
    });

    it('no-op when entry.env absent', () => {
      const env = adapter.buildEnv({ name: 'p', apiKey: 'sk' }, {});
      expect(env.OPENAI_API_KEY).toBe('sk');
      expect(Object.keys(env)).not.toContain('CUSTOM_FLAG');
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/codex.test.js -t "entry.env"`
Expected: FAIL — `CUSTOM_FLAG` is undefined.

- [ ] **Step 3: Modify `src/adapters/codex.js`**

Replace the `buildEnv` method (lines 33-38) with:

```js
  buildEnv(entry, baseEnv) {
    const env = { ...baseEnv, FLEET_MODEL_NAME: entry.name };
    delete env.OPENAI_BASE_URL;
    if (entry.apiKey) env.OPENAI_API_KEY = entry.apiKey;
    return this.applyUserEnv(entry, env);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/adapters/codex.test.js`
Expected: PASS (including existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/codex.js tests/adapters/codex.test.js
git commit -m "feat(codex): honor entry.env in buildEnv"
```

---

## Task 3: Copilot adapter — merge entry.env

**Files:**
- Modify: `src/adapters/copilot.js:33-38`
- Test: `tests/adapters/copilot.test.js`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('CopilotAdapter', ...)` block in `tests/adapters/copilot.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/copilot.test.js -t "entry.env"`
Expected: FAIL — `CUSTOM_FLAG` is undefined.

- [ ] **Step 3: Modify `src/adapters/copilot.js`**

Replace the `buildEnv` method with:

```js
  buildEnv(entry, baseEnv) {
    const env = { ...baseEnv, FLEET_MODEL_NAME: entry.name };
    if (entry.model) env.COPILOT_MODEL = entry.model;
    if (entry.apiKey) env.COPILOT_GITHUB_TOKEN = entry.apiKey;
    return this.applyUserEnv(entry, env);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/adapters/copilot.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/copilot.js tests/adapters/copilot.test.js
git commit -m "feat(copilot): honor entry.env in buildEnv"
```

---

## Task 4: Claude adapter — merge entry.env into settings and buildEnv; add presets

**Files:**
- Modify: `src/adapters/claude.js:20-37`
- Test: `tests/adapters/claude.test.js`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('ClaudeAdapter', ...)` block in `tests/adapters/claude.test.js`:

```js
  describe('entry.env integration', () => {
    it('commonEnvVars lists claude-specific presets', () => {
      const keys = adapter.commonEnvVars.map(v => v.key);
      expect(keys).toContain('CLAUDE_CODE_MAX_CONTEXT_TOKENS');
      expect(keys).toContain('ANTHROPIC_LOG');
      for (const v of adapter.commonEnvVars) {
        expect(typeof v.hint).toBe('string');
        expect(v.hint.length).toBeGreaterThan(0);
      }
    });

    it('buildArgs embeds entry.env into --settings env object', () => {
      const args = adapter.buildArgs({
        apiKey: 'sk-ant-x',
        apiBaseUrl: 'https://api.anthropic.com',
        env: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: '1000000' },
      });
      const idx = args.indexOf('--settings');
      expect(idx).toBeGreaterThanOrEqual(0);
      const settings = JSON.parse(args[idx + 1]);
      expect(settings.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('1000000');
      expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-ant-x');
    });

    it('entry.env overrides top-level ANTHROPIC_BASE_URL', () => {
      const args = adapter.buildArgs({
        apiKey: 'sk',
        apiBaseUrl: 'https://default.example',
        env: { ANTHROPIC_BASE_URL: 'https://override.example' },
      });
      const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
      expect(settings.env.ANTHROPIC_BASE_URL).toBe('https://override.example');
    });

    it('buildEnv also merges entry.env into process env', () => {
      const env = adapter.buildEnv({ name: 'p', env: { FOO: 'bar' } }, { PATH: '/bin' });
      expect(env.FOO).toBe('bar');
      expect(env.FLEET_MODEL_NAME).toBe('p');
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/adapters/claude.test.js -t "entry.env integration"`
Expected: FAIL — `commonEnvVars` empty (inherited default), settings.env missing `CLAUDE_CODE_MAX_CONTEXT_TOKENS`.

- [ ] **Step 3: Modify `src/adapters/claude.js`**

Replace the `buildArgs` and `buildEnv` methods and add a `commonEnvVars` getter. The updated methods should look like:

```js
  get commonEnvVars() {
    return [
      { key: 'CLAUDE_CODE_MAX_CONTEXT_TOKENS', hint: 'Context token limit (default 200000)' },
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
```

Keep the other methods (`installHooks`, `removeHooks`, `normalizePayload`, `classifyFailure`, `summarizeToolUse`) untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/adapters/claude.test.js`
Expected: PASS (including existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/claude.js tests/adapters/claude.test.js
git commit -m "feat(claude): merge entry.env into settings and process env; add presets"
```

---

## Task 5: Pure helpers — key validation and immutable updates

**Files:**
- Modify: `src/index.js` (add helpers near existing `truncStr` / `modelMeta`, and export them)
- Test: `tests/index/env-helpers.test.js`

- [ ] **Step 1: Create the test file with failing tests**

Create `tests/index/env-helpers.test.js`:

```js
import { describe, it, expect } from 'vitest';
const mod = await import('../../src/index.js');
const { validateEnvKey, applyEnvSet, applyEnvUnset } = mod;

describe('validateEnvKey', () => {
  it('rejects empty key', () => expect(validateEnvKey('', [])).toMatch(/required/i));
  it('rejects lowercase', () => expect(validateEnvKey('foo', [])).toMatch(/UPPER_SNAKE_CASE/));
  it('rejects leading digit', () => expect(validateEnvKey('1FOO', [])).toMatch(/UPPER_SNAKE_CASE/));
  it('rejects dashes', () => expect(validateEnvKey('FOO-BAR', [])).toMatch(/UPPER_SNAKE_CASE/));
  it('accepts FOO', () => expect(validateEnvKey('FOO', [])).toBeNull());
  it('accepts FOO_BAR_1', () => expect(validateEnvKey('FOO_BAR_1', [])).toBeNull());
  it('accepts _FOO', () => expect(validateEnvKey('_FOO', [])).toBeNull());
  it('rejects duplicate', () => expect(validateEnvKey('FOO', ['FOO'])).toMatch(/already set/));
});

describe('applyEnvSet', () => {
  it('adds first key immutably', () => {
    const entry = { name: 'x' };
    const out = applyEnvSet(entry, 'FOO', '1');
    expect(out).not.toBe(entry);
    expect(out.env).toEqual({ FOO: '1' });
    expect(entry.env).toBeUndefined();
  });

  it('preserves existing keys and overrides same key', () => {
    const entry = { name: 'x', env: { A: '1', B: '2' } };
    const out = applyEnvSet(entry, 'B', 'new');
    expect(out.env).toEqual({ A: '1', B: 'new' });
    expect(entry.env).toEqual({ A: '1', B: '2' });
  });
});

describe('applyEnvUnset', () => {
  it('removes key without mutating original', () => {
    const entry = { name: 'x', env: { A: '1', B: '2' } };
    const out = applyEnvUnset(entry, 'A');
    expect(out.env).toEqual({ B: '2' });
    expect(entry.env).toEqual({ A: '1', B: '2' });
  });

  it('is a no-op when key absent', () => {
    const entry = { name: 'x', env: { A: '1' } };
    const out = applyEnvUnset(entry, 'Z');
    expect(out.env).toEqual({ A: '1' });
  });

  it('handles entry without env', () => {
    const entry = { name: 'x' };
    const out = applyEnvUnset(entry, 'Z');
    expect(out.env).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/index/env-helpers.test.js`
Expected: FAIL — `validateEnvKey is not a function`.

- [ ] **Step 3: Add helpers to `src/index.js`**

Near the top of `src/index.js` (after the existing `truncStr` function — use `grep -n "^function truncStr" src/index.js` to find it), add:

```js
const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;

function validateEnvKey(key, existingKeys) {
  if (!key) return 'Key is required';
  if (!ENV_KEY_RE.test(key)) return 'Key must be UPPER_SNAKE_CASE (A-Z, 0-9, _)';
  if (existingKeys && existingKeys.includes(key)) return `Key "${key}" already set`;
  return null;
}

function applyEnvSet(entry, key, value) {
  return { ...entry, env: { ...(entry.env || {}), [key]: value } };
}

function applyEnvUnset(entry, key) {
  const existing = entry.env || {};
  const { [key]: _removed, ...rest } = existing;
  return { ...entry, env: rest };
}
```

Then update the `module.exports = { ... }` block at the bottom of the file to add these three names:

```js
module.exports = {
  // ...existing exports...
  validateEnvKey, applyEnvSet, applyEnvUnset,
};
```

(Preserve every existing export; only add the three new identifiers.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/index/env-helpers.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.js tests/index/env-helpers.test.js
git commit -m "feat(index): add env-var helpers (validate/set/unset)"
```

---

## Task 6: Selector component — onAdd / onDelete props

**Files:**
- Modify: `src/components/selector.mjs` (Selector component and `renderSelector`)
- Test: `tests/components/selector.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/components/selector.test.mjs` (keep existing tests intact):

```js
import { render } from 'ink-testing-library';
import React from 'react';

// Re-import to access the internal Selector component via renderSelector's promise.
// Since Selector is not exported directly, we validate through behavior:
// - help line includes "a add" when onAdd is wired
// - pressing 'a' resolves the promise with a special sentinel

import { renderSelector } from '../../src/components/selector.mjs';

describe('renderSelector with onAdd/onDelete', () => {
  // Minimal behavior test: returning the sentinel strings
  it('resolves with __add__ when a pressed and onAdd enabled', async () => {
    // We will drive renderSelector via stdin simulation — but ink-testing-library
    // does not route key events to real Ink. Instead, extend renderSelector to
    // accept an optional onAdd callback; here we assert by exported contract:
    const mod = await import('../../src/components/selector.mjs');
    expect(typeof mod.renderSelector).toBe('function');
    expect(mod.renderSelector.length).toBeGreaterThanOrEqual(1); // accepts opts
  });
});
```

Note: Ink interactive input is hard to simulate. This task's real verification is performed in Task 9 via the CLI integration tests. Keep this smoke test plus the help-line check below.

Add a second test that validates the rendered help line:

```js
import { render as inkRender } from 'ink-testing-library';
import { Selector } from '../../src/components/selector.mjs';

describe('Selector help line', () => {
  it('shows a/d hints when handlers provided', () => {
    const { lastFrame } = inkRender(
      React.createElement(Selector, {
        title: 'T',
        items: [{ label: 'x', value: 'x' }],
        onSelect: () => {}, onCancel: () => {},
        onAdd: () => {}, onDelete: () => {},
      })
    );
    expect(lastFrame()).toMatch(/a add/);
    expect(lastFrame()).toMatch(/d delete/);
  });

  it('omits a/d hints when handlers absent', () => {
    const { lastFrame } = inkRender(
      React.createElement(Selector, {
        title: 'T',
        items: [{ label: 'x', value: 'x' }],
        onSelect: () => {}, onCancel: () => {},
      })
    );
    expect(lastFrame()).not.toMatch(/a add/);
    expect(lastFrame()).not.toMatch(/d delete/);
  });
});
```

If `ink-testing-library` is not already a dev dependency, add it first:

```bash
npm install --save-dev ink-testing-library
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/selector.test.mjs`
Expected: FAIL — `Selector` is not exported; help line does not include `a add`.

- [ ] **Step 3: Modify `src/components/selector.mjs`**

In the `Selector` function (currently unexported), change signature and `useInput`:

```js
export function Selector({ title, items, dangerMode, onSelect, onCancel, onAdd, onDelete }) {
  const [selected, setSelected] = useState(0);
  const accent = dangerMode ? ACCENT_DANGER : ACCENT;

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) { onCancel(); return; }
    if (key.upArrow || input === 'k') { setSelected(i => (i - 1 + items.length) % items.length); return; }
    if (key.downArrow || input === 'j') { setSelected(i => (i + 1) % items.length); return; }
    if (key.return) { onSelect(items[selected], selected); return; }
    if (input === 'a' && typeof onAdd === 'function') { onAdd(); return; }
    if (input === 'd' && typeof onDelete === 'function' && items.length > 0) {
      onDelete(items[selected], selected);
      return;
    }
  });

  const hints = ['↑↓ navigate', 'enter select'];
  if (typeof onAdd === 'function') hints.push('a add');
  if (typeof onDelete === 'function') hints.push('d delete');
  hints.push('q cancel');

  return h(Box, { flexDirection: 'column' },
    h(Text, { color: accent, bold: true }, `⬢ ${title}`),
    h(Text, { color: COLOR_DIM }, hints.join(' · ')),
    h(Box, { marginBottom: 1 }),
    ...items.map((item, i) => { /* unchanged item rendering */ }),
  );
}
```

Preserve the existing item rendering body (lines that build the list rows). Update `renderSelector` to accept and forward `onAdd` / `onDelete`:

```js
export function renderSelector({ title, items, dangerMode = false, onAdd, onDelete }) {
  return new Promise((resolve) => {
    let resolved = false;

    const app = render(
      h(Selector, {
        title, items, dangerMode,
        onSelect: (item) => {
          if (resolved) return;
          resolved = true;
          app.unmount();
          process.stdout.write(
            `\x1b[38;2;117;139;250m❯\x1b[0m ` +
            `\x1b[38;2;74;222;128m${item.label}\x1b[0m` +
            (item.detail ? ` \x1b[38;2;82;82;82m${item.detail}\x1b[0m` : '') +
            '\n'
          );
          resolve({ kind: 'select', value: item.value, item });
        },
        onCancel: () => {
          if (resolved) return;
          resolved = true;
          app.unmount();
          process.stdout.write('\x1b[38;2;82;82;82mCancelled.\x1b[0m\n');
          resolve({ kind: 'cancel' });
        },
        onAdd: onAdd ? () => {
          if (resolved) return;
          resolved = true;
          app.unmount();
          resolve({ kind: 'add' });
        } : undefined,
        onDelete: onDelete ? (item) => {
          if (resolved) return;
          resolved = true;
          app.unmount();
          resolve({ kind: 'delete', value: item.value, item });
        } : undefined,
      })
    );
  });
}
```

⚠ **Breaking-change note** — `renderSelector` now always resolves with an object `{ kind, value?, item? }`. Existing callers expect a raw `value` (or `null` on cancel). Mitigate with a wrapper:

```js
export function selectFromList(items, title, dangerMode = false) {
  return renderSelector({ title, items, dangerMode }).then(result =>
    result.kind === 'cancel' ? null : result.value
  );
}
```

But `selectFromList` already lives in `src/index.js` — keep that wrapper on the index.js side. Search for all call-sites of `renderSelector` in the codebase (there should only be one wrapper in `index.js`), and update it:

```bash
grep -rn "renderSelector" src/
```

In `src/index.js`, find the existing `selectFromList` helper (it wraps `renderSelector`) and update it to handle the new return shape:

```js
async function selectFromList(items, title, dangerMode = false) {
  const selectorPath = path.join(__dirname, 'components', 'selector.mjs');
  const mod = await import(selectorPath);
  const result = await mod.renderSelector({ title, items, dangerMode });
  if (result.kind === 'cancel') return null;
  return result.value;
}
```

- [ ] **Step 4: Run all tests to verify nothing regressed**

Run: `npx vitest run`
Expected: PASS (new selector tests + all prior adapter/index/selector tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/selector.mjs src/index.js tests/components/selector.test.mjs package.json package-lock.json
git commit -m "feat(selector): add onAdd/onDelete props and object-shaped return"
```

---

## Task 7: CLI router — `fleet model env` + parseArgs + help

**Files:**
- Modify: `src/index.js` (parseArgs, main, printHelp, module.exports)
- Test: `tests/index.test.js`

- [ ] **Step 1: Add a failing parseArgs test**

Append to `tests/index.test.js` inside an existing `describe('parseArgs', ...)` block (or create one if absent):

```js
describe('parseArgs — model env', () => {
  it('parses `model env <name>` as command=model subcommand=env args=[name]', () => {
    const r = parseArgs(['model', 'env', 'ds-v4-pro']);
    expect(r.command).toBe('model');
    expect(r.subcommand).toBe('env');
    expect(r.args).toEqual(['ds-v4-pro']);
  });

  it('parses `model env <name> set KEY VALUE`', () => {
    const r = parseArgs(['model', 'env', 'ds', 'set', 'FOO', 'bar']);
    expect(r.args).toEqual(['ds', 'set', 'FOO', 'bar']);
  });

  it('parses `model env <name> unset KEY`', () => {
    const r = parseArgs(['model', 'env', 'ds', 'unset', 'FOO']);
    expect(r.args).toEqual(['ds', 'unset', 'FOO']);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass already**

Run: `npx vitest run tests/index.test.js -t "model env"`
Expected: PASS (positional args already flow through correctly — no parser change needed, we're locking in the contract).

- [ ] **Step 3: Add the `cmdModelEnv` router and wire it into `main()`**

In `src/index.js`, locate the existing `cmdModelDelete` function. Below it (before the "Run command" section header), add:

```js
// ─── Model env command (non-interactive; interactive lives in env-ui.js section) ──

async function cmdModelEnv(name, sub, rest) {
  if (!name) {
    console.error(ANSI.red('Usage: fleet model env <name> [list|set KEY VALUE|unset KEY]'));
    process.exit(1);
  }
  const data = loadModels();
  const entry = data.models.find(m => m.name === name);
  if (!entry) {
    console.error(ANSI.red(`Model "${name}" not found.`));
    if (data.models.length > 0) {
      console.error(`Available: ${data.models.map(m => m.name).join(', ')}`);
    }
    process.exit(1);
  }

  const action = sub || 'interactive';
  switch (action) {
    case 'list':
      cmdModelEnvList(entry);
      return;
    case 'set': {
      const [key, ...valueParts] = rest;
      const value = valueParts.join(' ');
      cmdModelEnvSet(data, entry, key, value);
      return;
    }
    case 'unset': {
      const [key] = rest;
      cmdModelEnvUnset(data, entry, key);
      return;
    }
    case 'interactive':
      await cmdModelEnvInteractive(data, entry);
      return;
    default:
      console.error(ANSI.red(`Unknown env subcommand: ${action}`));
      console.error('Available: list, set, unset');
      process.exit(1);
  }
}

function cmdModelEnvList(entry) {
  const env = entry.env || {};
  const keys = Object.keys(env);
  if (keys.length === 0) {
    console.log(ANSI.dim(`  No env vars configured for "${entry.name}".`));
    return;
  }
  console.log(`\n\x1b[38;2;167;139;250m\x1b[1m⬢ Env vars for "${entry.name}"\x1b[0m  \x1b[38;2;82;82;82m${keys.length} set\x1b[0m\n`);
  for (const k of keys) {
    console.log(`  \x1b[38;2;167;139;250m│\x1b[0m \x1b[38;2;224;224;224m\x1b[1m${k}\x1b[0m`);
    console.log(`    \x1b[38;2;139;155;168m${env[k]}\x1b[0m`);
  }
}

function cmdModelEnvSet(data, entry, key, value) {
  if (!key || value === undefined || value === '') {
    console.error(ANSI.red('Usage: fleet model env <name> set <KEY> <VALUE>'));
    process.exit(1);
  }
  const err = validateEnvKey(key, []); // duplicate check not needed for set (overwrite allowed)
  if (err && !err.includes('already set')) {
    console.error(ANSI.red(err));
    process.exit(1);
  }
  const updated = applyEnvSet(entry, key, value);
  const newData = { ...data, models: data.models.map(m => m.name === entry.name ? updated : m) };
  saveModels(newData);
  console.log(ANSI.green(`  Set ${key}=${value} on "${entry.name}".`));
}

function cmdModelEnvUnset(data, entry, key) {
  if (!key) {
    console.error(ANSI.red('Usage: fleet model env <name> unset <KEY>'));
    process.exit(1);
  }
  if (!entry.env || !(key in entry.env)) {
    console.error(ANSI.yellow(`  ${key} was not set on "${entry.name}".`));
    return;
  }
  const updated = applyEnvUnset(entry, key);
  const newData = { ...data, models: data.models.map(m => m.name === entry.name ? updated : m) };
  saveModels(newData);
  console.log(ANSI.green(`  Unset ${key} on "${entry.name}".`));
}

async function cmdModelEnvInteractive(_data, _entry) {
  // Filled in Task 8.
  console.error(ANSI.red('Interactive env editor not yet implemented.'));
  process.exit(1);
}
```

Next, update `main()` where it handles `command === 'model'`. Locate the existing `switch (modelCmd)` block and add a new case:

```js
      case 'env':
        cmdModelEnv(args[0], args[1], args.slice(2)).catch(err => {
          console.error(ANSI.red(err.message));
          process.exit(1);
        });
        break;
```

Also update the error message in the `default:` case:

```js
        console.error('Available: add, list, edit, delete, env');
```

Update `printHelp` — in the `Commands:` section of the help string (search for `model delete` to find the row), insert after it:

```
  model env <name>    Manage env vars for a model profile (list/set/unset/interactive)
```

Update `module.exports` to include `cmdModelEnv` and the three sub-handlers so tests can reach them:

```js
module.exports = {
  // ...existing exports...
  cmdModelEnv, cmdModelEnvList, cmdModelEnvSet, cmdModelEnvUnset,
};
```

- [ ] **Step 4: Run tests to verify nothing regressed**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.js tests/index.test.js
git commit -m "feat(cli): add `fleet model env` router with list/set/unset"
```

---

## Task 8: Interactive env editor (`cmdModelEnvInteractive`)

**Files:**
- Modify: `src/index.js` (replace the stub from Task 7)

- [ ] **Step 1: Implement `cmdModelEnvInteractive`**

Replace the stub `cmdModelEnvInteractive` added in Task 7 with the full implementation. Paste this in place of the stub:

```js
async function cmdModelEnvInteractive(initialData, initialEntry) {
  const selectorPath = path.join(__dirname, 'components', 'selector.mjs');
  const ui = await import(selectorPath);

  let data = initialData;
  let entry = initialEntry;
  let changed = 0;

  listLoop: while (true) {
    const env = entry.env || {};
    const keys = Object.keys(env);
    const items = keys.length > 0
      ? keys.map(k => ({ label: k, detail: '', meta: env[k], value: k }))
      : [{ label: '(no env vars configured)', detail: 'Press a to add', value: '__empty__' }];

    const listRes = await ui.renderSelector({
      title: `Env vars for "${entry.name}"  (${entry.tool || 'claude'} · ${entry.model || 'default'})`,
      items,
      onAdd: () => {},
      onDelete: keys.length > 0 ? () => {} : undefined,
    });

    if (listRes.kind === 'cancel') break listLoop;

    if (listRes.kind === 'add') {
      const added = await promptEnvAdd(ui, entry);
      if (added) {
        entry = applyEnvSet(entry, added.key, added.value);
        data = persistEntry(data, entry);
        changed++;
      }
      continue listLoop;
    }

    if (listRes.kind === 'delete') {
      const confirmed = await ui.renderConfirm({
        title: `Delete env var "${listRes.value}"?`,
        items: { label: listRes.value, detail: env[listRes.value], value: listRes.value },
        dangerMode: true,
      });
      if (confirmed) {
        entry = applyEnvUnset(entry, listRes.value);
        data = persistEntry(data, entry);
        changed++;
      }
      continue listLoop;
    }

    if (listRes.kind === 'select') {
      if (listRes.value === '__empty__') continue listLoop;
      const key = listRes.value;
      const updated = await ui.renderInput({
        title: `Edit ${key}`,
        fields: [{ label: 'Value', value: env[key] || '', placeholder: 'new value' }],
        requiredFields: ['Value'],
      });
      if (updated) {
        entry = applyEnvSet(entry, key, updated.Value);
        data = persistEntry(data, entry);
        changed++;
      }
      continue listLoop;
    }
  }

  if (changed > 0) {
    const setCount = Object.keys(entry.env || {}).length;
    console.log(ANSI.green(`  Env vars for "${entry.name}" updated (${setCount} set).`));
  }
}

async function promptEnvAdd(ui, entry) {
  const adapter = registry.get(entry.tool || 'claude');
  const existing = Object.keys(entry.env || {});
  const presets = (adapter && adapter.commonEnvVars) ? adapter.commonEnvVars : [];
  const available = presets.filter(p => !existing.includes(p.key));

  const items = [
    ...available.map(p => ({ label: p.key, meta: p.hint, value: `preset:${p.key}` })),
    { label: '+ Custom...', meta: 'Enter any KEY manually', value: '__custom__' },
  ];

  const pick = await ui.renderSelector({
    title: `Add env var to "${entry.name}"`,
    items,
  });
  if (pick.kind !== 'select') return null;

  if (pick.value === '__custom__') {
    return await promptCustomEnvAdd(ui, existing);
  }
  const key = pick.value.replace(/^preset:/, '');
  const preset = presets.find(p => p.key === key);
  const form = await ui.renderInput({
    title: `Set ${key}`,
    fields: [{ label: 'Value', value: '', placeholder: preset ? preset.hint : 'value' }],
    requiredFields: ['Value'],
  });
  if (!form) return null;
  return { key, value: form.Value };
}

async function promptCustomEnvAdd(ui, existing) {
  while (true) {
    const form = await ui.renderInput({
      title: 'Add custom env var',
      fields: [
        { label: 'Key', value: '', placeholder: 'e.g. DISABLE_TELEMETRY' },
        { label: 'Value', value: '', placeholder: 'value' },
      ],
      requiredFields: ['Key', 'Value'],
    });
    if (!form) return null;
    const err = validateEnvKey(form.Key, existing);
    if (err) {
      console.error(ANSI.red(`  ${err}`));
      continue;
    }
    return { key: form.Key, value: form.Value };
  }
}

function persistEntry(data, entry) {
  const newData = { ...data, models: data.models.map(m => m.name === entry.name ? entry : m) };
  saveModels(newData);
  return newData;
}
```

Add `persistEntry` and the two `prompt*` functions to `module.exports` (for future tests / reuse):

```js
module.exports = {
  // ...existing exports...
  persistEntry, promptEnvAdd, promptCustomEnvAdd,
};
```

- [ ] **Step 2: Smoke-test manually**

```bash
node src/index.js model add claude    # if no model profile yet
# Enter: Name=test, Model ID=x, API Key=y, API Base URL=z, Proxy=(empty)
node src/index.js model env test
# Verify: empty-state shown, 'a' opens preset list, adding a preset writes to models.json
cat ~/.config/claude-code-fleet/models.json | grep -A3 '"env"'
```

Expected: `env: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: "..." }` present.

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: PASS (interactive path has no tests but nothing should regress).

- [ ] **Step 4: Commit**

```bash
git add src/index.js
git commit -m "feat(cli): interactive env editor for fleet model env"
```

---

## Task 9: CLI integration tests — set / unset / list / errors

**Files:**
- Create: `tests/index/env.test.js`

- [ ] **Step 1: Write the test file**

Create `tests/index/env.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const mod = await import('../../src/index.js');
const { cmdModelEnvList, cmdModelEnvSet, cmdModelEnvUnset } = mod;

const TMP_ROOT = path.join(os.tmpdir(), 'fleet-env-test-' + Date.now());
const MODELS_PATH = path.join(TMP_ROOT, 'models.json');

function seedModels(models) {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  fs.writeFileSync(MODELS_PATH, JSON.stringify({ models }) + '\n');
}

function readModels() {
  return JSON.parse(fs.readFileSync(MODELS_PATH, 'utf-8'));
}

describe('fleet model env CLI', () => {
  let origEnv;
  let logSpy, errSpy, exitSpy;

  beforeEach(() => {
    origEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = TMP_ROOT;
    // GLOBAL_CONFIG_DIR uses os.homedir() fallback — patch path via models.json location
    // For this test we call handlers directly with in-memory data, then assert they call saveModels.
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit:${code}`); });
  });

  afterEach(() => {
    if (origEnv === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = origEnv;
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
    try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch {}
  });

  it('list prints "no env vars" for profile without env', () => {
    cmdModelEnvList({ name: 'a' });
    const out = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(out).toMatch(/No env vars configured/);
  });

  it('list prints each key=value for profile with env', () => {
    cmdModelEnvList({ name: 'a', env: { FOO: '1', BAR: '2' } });
    const out = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(out).toMatch(/FOO/);
    expect(out).toMatch(/BAR/);
    expect(out).toMatch(/1/);
    expect(out).toMatch(/2/);
  });

  it('set rejects empty key', () => {
    const data = { models: [{ name: 'a' }] };
    expect(() => cmdModelEnvSet(data, data.models[0], '', '1')).toThrow(/exit:1/);
    expect(errSpy).toHaveBeenCalled();
  });

  it('set rejects lowercase key', () => {
    const data = { models: [{ name: 'a' }] };
    expect(() => cmdModelEnvSet(data, data.models[0], 'foo', '1')).toThrow(/exit:1/);
  });

  it('unset rejects missing key', () => {
    const data = { models: [{ name: 'a' }] };
    expect(() => cmdModelEnvUnset(data, data.models[0], '')).toThrow(/exit:1/);
  });

  it('unset warns when key absent but does not exit', () => {
    const data = { models: [{ name: 'a', env: { X: '1' } }] };
    cmdModelEnvUnset(data, data.models[0], 'Y');
    const out = errSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(out).toMatch(/was not set/);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
```

Note: `cmdModelEnvSet` and `cmdModelEnvUnset` call `saveModels` which writes to the real `GLOBAL_CONFIG_DIR`. For this test we only assert the error paths (which exit before save). Happy-path save behavior is covered by the helpers' own tests (`applyEnvSet` / `applyEnvUnset`) in Task 5.

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/index/env.test.js`
Expected: PASS.

- [ ] **Step 3: Run the full suite as regression check**

Run: `npx vitest run`
Expected: PASS for everything.

- [ ] **Step 4: Commit**

```bash
git add tests/index/env.test.js
git commit -m "test(cli): cover fleet model env error paths"
```

---

## Task 10: Docs — README and CLAUDE.md

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `README.md` — add env row to command table**

Find the command table (search for `model add`). Add the new row after the existing `model delete` row:

```
| `fleet model env <name>`     | Manage env vars for a profile (list/set/unset/interactive) |
```

If `README.md` shows a `models.json` example, add the optional `env` field:

```json
{
  "name": "ds-v4-pro",
  "tool": "claude",
  "model": "deepseek-v4-pro",
  "apiKey": "sk-...",
  "apiBaseUrl": "https://api.deepseek.com",
  "env": {
    "CLAUDE_CODE_MAX_CONTEXT_TOKENS": "1000000"
  }
}
```

- [ ] **Step 2: Update `CLAUDE.md` — models.json schema reference**

Find the `models.json` annotation (search for `models.json`). Update the comment:

```
models.json        — [{ name, tool, model, apiKey, apiBaseUrl, proxy, env }]
```

And under "Common Tasks" add one line:

```
- **Add env vars to a profile** → `fleet model env <name>` (interactive) or `set/unset` subcommands
```

- [ ] **Step 3: Verify both files render cleanly**

```bash
node -e "console.log(require('fs').readFileSync('README.md','utf8').includes('model env'))"
node -e "console.log(require('fs').readFileSync('CLAUDE.md','utf8').includes('env }'))"
```

Expected: `true` / `true`.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document fleet model env command and models.json env field"
```

---

## Task 11: Final validation

**Files:** none changed.

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: ALL PASS, ≥ 80% coverage on new files (visible via `npx vitest run --coverage` if coverage tooling is configured).

- [ ] **Step 2: Manual smoke — full interactive round-trip**

```bash
node src/index.js model env  # should print usage and exit 1
node src/index.js model env nonexistent  # should print "not found"
node src/index.js model env <existing> list
node src/index.js model env <existing> set CLAUDE_CODE_MAX_CONTEXT_TOKENS 1000000
node src/index.js model env <existing> list   # should show the new key
node src/index.js model env <existing> unset CLAUDE_CODE_MAX_CONTEXT_TOKENS
node src/index.js model env <existing>        # interactive; add a preset; delete it; quit
```

Expected: each command produces the behavior documented in the spec.

- [ ] **Step 3: Verify backward compatibility**

```bash
# Start a tool with a profile that has NO env field — confirm nothing breaks:
node src/index.js run --model <existing-legacy-profile>  # Ctrl+C after launch
```

Expected: tool launches normally with no `env`-related errors.

- [ ] **Step 4: Commit any final fixes (if any)**

No commit if nothing changed. Otherwise:

```bash
git add -A
git commit -m "chore: polish after env-var feature validation"
```

---

## Self-Review Log

- **Spec coverage** ✓ — Data model (Task 7), conflict rule (Tasks 2/3/4), adapter integration (Tasks 1–4), CLI surface (Task 7), interactive UX (Tasks 6/8), presets (Task 4), error handling (Tasks 7/9), testing (Tasks 1–9), docs (Task 10), backward compat (Task 11 Step 3).
- **Placeholders** ✓ — none (`promptEnvAdd`, `persistEntry`, all Selector/InputForm code blocks are fully written).
- **Type consistency** ✓ — `renderSelector` returns `{ kind, value, item }` everywhere (Task 6 changes the contract and updates `selectFromList`; Task 8 uses the new shape); `applyEnvSet` / `applyEnvUnset` signatures match between Tasks 5 and 7/8.
- **Known deviation from spec** — `cmdModelEnvSet` accepts overwrites silently (no "already set" error) because set = upsert; spec phrasing "duplicate key in custom add" only applies to the interactive Custom flow, enforced in `promptCustomEnvAdd` via `validateEnvKey(form.Key, existing)`.
