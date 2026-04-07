# Comprehensive Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ~135 Vitest tests covering all modules of Claude Code Fleet.

**Architecture:** Install Vitest + ink-testing-library. Make `src/index.js` and `src/hook-client.js` testable by guarding `main()` with `require.main === module` and adding `module.exports`. One test file per source module, mirroring project layout. Heavy mocking of `fs`, `child_process`, `net`, `os`.

**Tech Stack:** Vitest, ink-testing-library, @vitest/coverage-v8

---

## File Structure

```
tests/
├── setup.js                          # Global setup: stub stdout dimensions
├── index.test.js                     # CLI functions, commands, routing (~40 tests)
├── master.test.js                    # Master class, hooks, helpers (~30 tests)
├── socket.test.js                    # SocketServer (~8 tests)
├── hook-client.test.js               # Hook payload construction, persistence (~10 tests)
├── tui.test.js                       # TUI class (~5 tests)
└── components/
    ├── colors.test.mjs               # Color constants (~1 test)
    ├── header.test.mjs               # Header rendering (~3 tests)
    ├── footer.test.mjs               # Footer rendering (~2 tests)
    ├── worker-card.test.mjs          # WorkerCard + helpers (~12 tests)
    ├── selector.test.mjs             # Selector/Confirm/Input (~10 tests)
    ├── terminal-focus.test.mjs       # focusTerminal, TERMINAL_NAMES (~6 tests)
    └── app.test.mjs                  # App, getWorkerStatus (~8 tests)
```

**Source modifications needed:**
- `src/index.js`: Guard `main()` call, add `module.exports` for all functions
- `src/hook-client.js`: Guard `main()` call, add `module.exports` for `main`

---

### Task 1: Infrastructure + Small Component Tests

**Files:**
- Create: `vitest.config.js`
- Create: `tests/setup.js`
- Create: `tests/components/colors.test.mjs`
- Create: `tests/components/header.test.mjs`
- Create: `tests/components/footer.test.mjs`

- [ ] **Step 1: Install dependencies**

Run: `npm install --save-dev vitest ink-testing-library @vitest/coverage-v8`

- [ ] **Step 2: Create vitest.config.js**

```js
// vitest.config.js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.js'],
  },
});
```

- [ ] **Step 3: Create tests/setup.js**

```js
// Stub terminal dimensions for consistent Ink rendering
process.stdout.rows = process.stdout.rows || 24;
process.stdout.columns = process.stdout.columns || 80;
```

- [ ] **Step 4: Add test script to package.json**

In `package.json` scripts, add: `"test": "vitest run"`

- [ ] **Step 5: Write tests/components/colors.test.mjs**

Core: Import `{ colors }` from `../../src/components/colors.mjs`. Assert all 16 keys exist with correct hex values:

```js
import { colors } from '../../src/components/colors.mjs';
import { describe, it, expect } from 'vitest';

describe('colors', () => {
  it('exports all color constants', () => {
    const expected = {
      title: '#a78bfa', running: '#4ade80', idle: '#525252',
      slow: '#fbbf24', alert: '#ef4444', projectName: '#e0e0e0',
      modelAlias: '#a78bfa', modelName: '#525252', aiSummary: '#8b949e',
      toolName: '#d4d4d4', target: '#8b949e', doneMark: '#4ade80',
      border: '#3a3a3a', separator: '#2a2a2a', footer: '#444444',
    };
    expect(colors).toEqual(expected);
  });
});
```

- [ ] **Step 6: Write tests/components/header.test.mjs**

Core: Use `ink-testing-library` render, pass workers array with `computedStatus`:

```js
import { render } from 'ink-testing-library';
import React from 'react';
import { Header } from '../../src/components/header.mjs';

const h = React.createElement;

describe('Header', () => {
  it('renders Fleet title and sort mode', () => {
    const { lastFrame } = render(h(Header, { workers: [], sortMode: 'time' }));
    expect(lastFrame()).toContain('Fleet');
    expect(lastFrame()).toContain('sort:time');
  });

  it('renders processing/idle/offline counts with icons', () => {
    const workers = [
      { computedStatus: 'processing' },
      { computedStatus: 'processing' },
      { computedStatus: 'idle' },
      { computedStatus: 'offline' },
    ];
    const { lastFrame } = render(h(Header, { workers, sortMode: 'name' }));
    const out = lastFrame();
    expect(out).toContain('\u25CF 2');  // processing ●
    expect(out).toContain('\u25CB 1');  // idle ○
    expect(out).toContain('\u2717 1');  // offline ✗
  });

  it('renders total count', () => {
    const workers = [{ computedStatus: 'idle' }, { computedStatus: 'idle' }];
    const { lastFrame } = render(h(Header, { workers, sortMode: 'time' }));
    expect(lastFrame()).toContain('2 total');
  });
});
```

- [ ] **Step 7: Write tests/components/footer.test.mjs**

Core: Test with/without position prop:

```js
import { render } from 'ink-testing-library';
import React from 'react';
import { Footer } from '../../src/components/footer.mjs';

const h = React.createElement;

describe('Footer', () => {
  it('renders key hints and version', () => {
    const { lastFrame } = render(h(Footer));
    const out = lastFrame();
    expect(out).toContain('j/k scroll');
    expect(out).toContain('Fleet v0.1.0');
  });

  it('shows position/total when provided', () => {
    const { lastFrame } = render(h(Footer, { position: 2, total: 5 }));
    expect(lastFrame()).toContain('[3/5]');
    // Without props — no bracket
    const { lastFrame: frame2 } = render(h(Footer));
    expect(frame2()).not.toContain('[/');
  });
});
```

- [ ] **Step 8: Run tests and verify**

Run: `npx vitest run tests/components/ tests/setup.js`
Expected: All 6 tests pass (1 + 3 + 2)

- [ ] **Step 9: Commit**

```bash
git add vitest.config.js tests/ package.json package-lock.json
git commit -m "test: add vitest infrastructure and small component tests (colors, header, footer)"
```

---

### Task 2: Core CLI + Socket Server Tests

**Files:**
- Modify: `src/index.js` (guard main, add exports)
- Create: `tests/index.test.js`
- Create: `tests/socket.test.js`

- [ ] **Step 1: Make src/index.js testable**

At bottom of `src/index.js`, replace `main();` with:
```js
if (require.main === module) main();
```

Add at the very end:
```js
module.exports = {
  stripAnsi, truncStr, modelMeta, modelWarning, modelItem,
  run, checkDeps,
  loadState, saveState, isProcessAlive, cleanupState,
  configSearchPaths, findConfigFile, loadConfig, validateConfig,
  getModelsPath, loadModels, saveModels,
  cmdModelList, cmdInit, cmdHooksStatus, cmdLs, cmdStatus, cmdDown,
  cmdHooksInstall, cmdHooksRemove,
  filterInstances,
  parseArgs, main, ANSI, CONFIG_FILENAME, GLOBAL_CONFIG_DIR, STATE_FILE,
};
```

- [ ] **Step 2: Write tests/index.test.js — Pure functions**

Mock `child_process`, `os`:

```js
const { spawnSync } = require('child_process');
vi.mock('child_process', () => ({ spawnSync: vi.fn() }));
```

Test `stripAnsi('hello \x1b[31mworld\x1b[0m')` → `'hello world'`.
Test `truncStr` with: long string (truncated), null/undefined (returned as-is), short string (unchanged).
Test `modelMeta` with apiKey and apiBaseUrl → truncated key + endpoint string.
Test `modelWarning` with missing name/apiKey/model → `'incomplete: missing Name, API Key, Model ID'`, complete model → `undefined`.
Test `modelItem` → object with display, label, detail, meta, warning, value keys.

- [ ] **Step 3: Write tests/index.test.js — Config & validation**

Test `validateConfig`:
- Non-array instances → error `'instances' must be a non-empty array`
- Empty array → same error
- Missing name → error `name is required`
- Missing apiKey → error `apiKey is required`
- Duplicate names → error `duplicate name`
- Valid config → empty errors array

Test `findConfigFile`:
- CLI path takes priority, returns resolved path
- CLI path not found → process.exit(1) (spy on process.exit)
- No CLI path → searches paths in order, returns first found

Test `loadConfig`:
- Valid config → returns merged object with `file` property
- Invalid JSON → process.exit(1)
- Validation errors → process.exit(1)

Test `configSearchPaths()` → array of 3 paths.

- [ ] **Step 4: Write tests/index.test.js — State management**

Mock `fs`:

```js
vi.mock('fs', () => ({
  existsSync: vi.fn(), readFileSync: vi.fn(),
  writeFileSync: vi.fn(), mkdirSync: vi.fn(),
}));
```

Test `loadState`: missing file → `{ instances: {} }`, valid JSON → parsed, corrupt → `{ instances: {} }`.
Test `saveState`: creates dir, writes JSON with trailing newline.
Test `isProcessAlive`: current PID → true, 99999999 → false.
Test `cleanupState`: removes dead PIDs, keeps alive, saves only when changed.

- [ ] **Step 5: Write tests/index.test.js — Commands**

Test `filterInstances`: no filter → all, filter by name → filtered, unknown names → warning, no match → process.exit.
Test `cmdModelList`: has models → prints names, empty → prints "No model profiles".
Test `cmdInit`: creates file, rejects if exists → process.exit.
Test `cmdHooksStatus`: shows status for all 4 events, handles missing settings.
Test `cmdLs`: lists instances, empty → "No running instances".
Test `cmdStatus`: shows instance config details.
Test `cmdDown`: stops running, already-exited → "already exited".
Test `cmdHooksInstall`: calls ensureHooks, prints success.
Test `cmdHooksRemove`: calls removeHooks, prints success.

- [ ] **Step 6: Write tests/index.test.js — CLI routing**

Test `parseArgs`:
- `['init']` → `{ command: 'init', subcommand: undefined }`
- `['model', 'add']` → `{ command: 'model', subcommand: 'add' }`
- `['--config', 'x.json']` → `{ opts: { config: 'x.json' } }`
- `['--only', 'a,b']` → `{ opts: { only: ['a', 'b'] } }`
- `['--help']` → `{ opts: { help: true } }`

Test `main` routing: mock process.argv, spy on process.exit, verify correct command function is called.

- [ ] **Step 7: Write tests/socket.test.js**

Mock `net`, `fs`:

```js
vi.mock('net', () => ({ createServer: vi.fn() }));
vi.mock('fs', () => ({
  existsSync: vi.fn(), unlinkSync: vi.fn(),
  mkdirSync: vi.fn(), writeFileSync: vi.fn(),
}));
```

Test `start`: cleans stale socket, creates dir, listens.
Test `stop`: closes server, removes socket.
Test data handling: buffer data, split on newlines, parse JSON, call handler.
Test error handling: malformed JSON lines ignored, empty lines skipped.
Test multiple connections handled correctly.

- [ ] **Step 8: Run tests and verify**

Run: `npx vitest run tests/index.test.js tests/socket.test.js`
Expected: All ~48 tests pass

- [ ] **Step 9: Commit**

```bash
git add src/index.js tests/index.test.js tests/socket.test.js
git commit -m "test: add CLI commands, state, config, routing and socket server tests"
```

---

### Task 3: Master + Hook Client Tests

**Files:**
- Create: `tests/master.test.js`
- Modify: `src/hook-client.js` (guard main, export main)
- Create: `tests/hook-client.test.js`

- [ ] **Step 1: Make src/hook-client.js testable**

Replace `main();` at bottom with:
```js
if (require.main === module) main();
```

Add:
```js
module.exports = { main };
```

- [ ] **Step 2: Write tests/master.test.js — Event handling**

Mock `fs`, `child_process`:

```js
vi.mock('fs', () => ({
  existsSync: vi.fn(), readFileSync: vi.fn(),
  writeFileSync: vi.fn(), mkdirSync: vi.fn(),
  renameSync: vi.fn(), unlinkSync: vi.fn(),
  readdirSync: vi.fn(), copyFileSync: vi.fn(),
}));
```

Test `handleEvent('SessionStart')`: creates worker with session metadata, sets model/term/pid.
Test `handleEvent('PostToolUse')`: sets status active, creates currentTurn, adds action, updates lastActions (max 3).
Test `handleEvent('Notification')`: closes current turn (marks done, sets summary), starts new turn.
Test `handleEvent('Stop')`: sets idle, awaitsInput true, closes turn with summary, persists lastMessage.
Test `handleEvent` without session_id → ignored (no worker created).
Test full lifecycle: SessionStart → PostToolUse → PostToolUse → Notification → PostToolUse → Stop — verify final state.

- [ ] **Step 3: Write tests/master.test.js — Cleanup**

Test `cleanupExpired`:
- Dead process → marks offline
- Dead for 30+ min → removed from workers + session file deleted
- Inactive for 3+ hours → removed
- Active workers → kept

- [ ] **Step 4: Write tests/master.test.js — Persistence**

Test `loadPersistedSessions`:
- Loads from session files, restores worker state
- Skips dead processes (deletes file)
- Stale currentTurn → moves to history
- Duplicate session IDs → skipped
- Corrupted files → handled gracefully

Test `persistSession`:
- Atomic write (tmp + rename pattern)
- Merges with existing file data
- Persists turns, currentTurn, lastActions, lastMessage, lastEventAt, awaitsInput

Test `deleteSessionFile`: removes file silently.

- [ ] **Step 5: Write tests/master.test.js — Helper functions**

Test `summarizeToolUse`:
- Edit → `'Edit filename'`
- Write → `'Write filename'`
- Read → `'Read filename'`
- Bash → `'Bash: <truncated command>'`
- Grep → `'Grep "<pattern>"'`
- Glob → `'Glob <pattern>'`
- Unknown → tool name string

Test `isProcessAlive`: null PID → false, uses `process.kill(pid, 0)`.

- [ ] **Step 6: Write tests/master.test.js — Hook management**

Test `ensureHooks`:
- Adds fleet hooks for all 4 events to empty settings
- Idempotent — no duplicates on second call
- Preserves existing non-fleet hooks
- Creates settings file if missing

Test `removeHooks`:
- Removes fleet hooks
- Preserves non-fleet hooks
- Cleans up empty hook arrays
- Handles missing settings file

- [ ] **Step 7: Write tests/hook-client.test.js — Payload construction**

Mock `net`, `fs`, `process.stdin`:

```js
vi.mock('net', () => ({
  connect: vi.fn(() => ({
    write: vi.fn(), end: vi.fn(),
    on: vi.fn(), destroy: vi.fn(),
  })),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn(), readFileSync: vi.fn(),
  writeFileSync: vi.fn(), mkdirSync: vi.fn(),
}));
```

Replace `process.stdin` with async iterator yielding JSON input. Call `main()`:

```js
const originalStdin = process.stdin;
beforeEach(() => {
  process.stdin = (async function* () {
    yield Buffer.from(JSON.stringify(input));
  })();
});
afterEach(() => { process.stdin = originalStdin; });
```

Test SessionStart payload: includes event, session_id, cwd, timestamp, model, pid, ppid, term_program, iterm_session_id.
Test PostToolUse payload: includes tool_name and tool_input.
Test Notification payload: includes message and notification_type.
Test Stop payload: includes last_assistant_message truncated to 500 chars.

- [ ] **Step 8: Write tests/hook-client.test.js — Session persistence**

Test SessionStart creates session file with sessionId, cwd, model, term_program, iterm_session_id, pid, ppid, fleet_model_name, timestamp.
Test Stop updates session file with stoppedAt and lastMessage.
Test Stop reads existing session file before updating.

- [ ] **Step 9: Write tests/hook-client.test.js — Environment & socket**

Test `FLEET_MODEL_NAME` env var included in payload when set.
Test connects to Unix socket and sends JSON + newline.
Test silent exit on connection failure.
Test timeout protection (1 second).

- [ ] **Step 10: Run tests and verify**

Run: `npx vitest run tests/master.test.js tests/hook-client.test.js`
Expected: All ~40 tests pass

- [ ] **Step 11: Commit**

```bash
git add src/hook-client.js tests/master.test.js tests/hook-client.test.js
git commit -m "test: add Master class, hook management, and hook-client tests"
```

---

### Task 4: TUI + Worker Card + Terminal Focus Tests

**Files:**
- Create: `tests/tui.test.js`
- Create: `tests/components/worker-card.test.mjs`
- Create: `tests/components/terminal-focus.test.mjs`

- [ ] **Step 1: Write tests/tui.test.js**

Mock dynamic import of `components/app.mjs`:

```js
vi.mock(path.join(__dirname, '..', 'src', 'components', 'app.mjs'), () => ({
  createApp: vi.fn(() => ({ unmount: vi.fn() })),
}));
```

Test `start()`: sets `running=true`, calls `createApp(master)`, handles import error gracefully.
Test `stop()`: sets `running=false`, clears render timer, unmounts ink app.
Test `scheduleRender()`: debounces at 100ms, calls `master._renderCallback`, ignores when not running, ignores when timer already pending.

- [ ] **Step 2: Write tests/components/worker-card.test.mjs — Helper functions**

```js
import { getProcessingColor, getStatusIcon } from '../../src/components/worker-card.mjs';
import { colors } from '../../src/components/colors.mjs';
```

Test `getProcessingColor(ms)`:
- < 3min → `colors.running`
- 3-10min → `colors.slow`
- >= 10min → `colors.alert`

Test `getStatusIcon(status)`:
- 'processing' → `{ icon: '●', color: ... }`
- 'offline' → `{ icon: '✗', color: colors.alert }`
- 'idle' → `{ icon: '○', color: colors.idle }`

- [ ] **Step 3: Write tests/components/worker-card.test.mjs — Components**

Test `WorkerCard`: renders project name, model name, status icon, processing timer, last message.
Test `ActionLine`: renders checkmark, tool name, target, time ago.
Test `CurrentTurn`: renders summary (truncated to 80 chars), recent actions (max 3), returns null for empty turn.
Test `HistoryTurn`: collapses tool names (>3 shows "+N"), renders summary and time ago.
Test `LastActions`: renders action list, returns null for empty array.

Note: Internal components (`ActionLine`, `CurrentTurn`, `HistoryTurn`, `LastActions`) are not exported. Test them indirectly through `WorkerCard` rendering output, or import them via the module's namespace if accessible. Since they are not exported, test by rendering `WorkerCard` with appropriate worker state and inspecting output.

- [ ] **Step 4: Write tests/components/terminal-focus.test.mjs — TERMINAL_NAMES**

```js
import { TERMINAL_NAMES } from '../../src/components/terminal-focus.mjs';
```

Test: maps iTerm.app, Apple_Terminal, vscode, Cursor, WarpTerminal, WezTerm correctly.

- [ ] **Step 5: Write tests/components/terminal-focus.test.mjs — focusTerminal**

Mock `child_process`:

```js
vi.mock('child_process', () => ({
  execSync: vi.fn(), execFileSync: vi.fn(),
}));
```

Mock `os.platform()` to return `'darwin'`:

```js
vi.mock('os', () => ({ platform: () => 'darwin' }));
```

Test focusTerminal dispatches:
- `termProgram: 'iTerm.app'` → calls `execSync` with iTerm AppleScript
- `termProgram: 'Apple_Terminal'` → calls `execFileSync` for tty lookup
- `termProgram: 'vscode'` → calls `execFileSync('open', ['-a', 'Visual Studio Code', cwd])`
- `os.platform() !== 'darwin'` → `{ ok: false, reason: 'unsupported' }`
- `!termProgram` → `{ ok: false, reason: 'unknown' }`

- [ ] **Step 6: Write tests/components/terminal-focus.test.mjs — Permission detection**

Test: error with `-1743` → `{ ok: false, reason: 'permission' }`.
Test: error with `not allowed` → `{ ok: false, reason: 'permission' }`.
Test: `escapeAppleScript` escapes backslashes and double quotes (test indirectly via AppleScript content in execSync calls).

- [ ] **Step 7: Run tests and verify**

Run: `npx vitest run tests/tui.test.js tests/components/worker-card.test.mjs tests/components/terminal-focus.test.mjs`
Expected: All ~23 tests pass

- [ ] **Step 8: Commit**

```bash
git add tests/tui.test.js tests/components/worker-card.test.mjs tests/components/terminal-focus.test.mjs
git commit -m "test: add TUI, worker-card helpers, and terminal-focus tests"
```

---

### Task 5: Selector + App Component Tests

**Files:**
- Create: `tests/components/selector.test.mjs`
- Create: `tests/components/app.test.mjs`

- [ ] **Step 1: Write tests/components/selector.test.mjs — Selector**

Use `ink-testing-library` render + `act` to simulate key input:

```js
import { render } from 'ink-testing-library';
import React from 'react';
```

Note: `Selector`, `ConfirmDialog`, `InputForm` are not exported — only `renderSelector`, `renderConfirm`, `renderInput` are exported. Test the promise-based wrappers:

Test `renderSelector`:
- Renders title and items
- Resolves with `item.value` on enter
- Resolves with `null` on q/cancel
- Shows warning for active item

Test `renderConfirm`:
- Resolves `true` on y/enter
- Resolves `false` on n/esc/q

Test `renderInput`:
- Resolves with field values on enter (all required filled)
- Resolves with `null` on esc/cancel
- Shows errors for empty required fields

Implementation approach: The promise-based functions call Ink `render()` internally. Wrap them in tests that verify promise resolution. For keyboard simulation, use `stdin.write()` on the Ink app's stdin.

```js
it('renderSelector resolves with value on enter', async () => {
  const promise = renderSelector({
    title: 'Pick one',
    items: [
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
    ],
  });
  // The render is internal; stdin is process.stdin
  // Simulate by writing to process.stdin (requires mock)
  // Alternative: test the internal Selector component directly
  // by importing it from the module source
});
```

Since internal components aren't exported, extract them for testing by reading the module as text and evaluating with named exports, or test via the promise wrappers by mocking `process.stdin`. The practical approach is to import the module file directly and test the promise wrappers:

```js
// Mock process.stdin to simulate keypresses
import { Writable } from 'stream';

function createMockStdin() {
  const stdin = new Writable({ write: vi.fn() });
  // ... pipe key events
}
```

Alternative practical approach: Import the module, override Ink's `render` in mock, and test component behavior directly. Use `vi.mock('ink')` to capture rendered components:

```js
vi.mock('ink', async () => {
  const actual = await vi.importActual('ink');
  return { ...actual, render: vi.fn(() => ({ unmount: vi.fn() })) };
});
```

- [ ] **Step 2: Write tests/components/selector.test.mjs — ConfirmDialog & InputForm**

Same approach as Step 1. Test `renderConfirm` and `renderInput` promise wrappers for resolve/reject behavior.

- [ ] **Step 3: Write tests/components/app.test.mjs — getWorkerStatus**

`getWorkerStatus` is not exported. It's defined inside `app.mjs`. Test it by importing and calling it, or verify its behavior through `App` component rendering.

Since `getWorkerStatus` is module-scoped (not exported), test through the `App` component. Alternatively, since the spec requires testing it directly, we can import the module and access the function:

```js
// app.mjs doesn't export getWorkerStatus
// Test via App rendering: pass workers with different statuses,
// verify they appear in correct order in the output
```

Test cases (via component output):
- Worker with `status: 'offline'` → appears in offline section
- Worker with dead ppid → appears offline
- Worker with `awaitsInput: false` → appears as processing
- Worker with `awaitsInput: true` → appears as idle

- [ ] **Step 4: Write tests/components/app.test.mjs — Sorting**

Test: processing workers appear before idle, idle before offline.
Test: within same status, sort by time when sortMode='time', by name when sortMode='name'.

- [ ] **Step 5: Write tests/components/app.test.mjs — Keyboard**

Mock `master` object:

```js
const mockMaster = {
  workers: new Map(),
  stop: vi.fn(),
  _renderCallback: null,
};
```

Test keyboard via Ink's `useInput`:
- j/k moves selection (verify selected worker changes in output)
- Tab toggles sort mode (verify sort label changes)
- q/Ctrl+C calls `master.stop()`
- Enter calls `focusTerminal` (mock it)
- 1-9 quick selects worker by index

Note: For keyboard testing, use `ink-testing-library` or simulate `stdin` writes. Since Ink uses `useInput`, the reliable approach is:

```js
import { render } from 'ink-testing-library';
// Render App, then write keypresses to stdin
```

- [ ] **Step 6: Write tests/components/app.test.mjs — Selection clamping**

Test: when workers.length decreases, selectedIdx is clamped to valid range.

- [ ] **Step 7: Run all tests**

Run: `npx vitest run`
Expected: All ~135 tests pass

- [ ] **Step 8: Commit**

```bash
git add tests/components/selector.test.mjs tests/components/app.test.mjs
git commit -m "test: add selector and app component tests, complete test suite"
```
