# Load Balancer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `fleet lb` command to distribute instructions across a pool of model profiles using round-robin with automatic failover.

**Architecture:** New module `src/lb.js` handles pool CRUD, round-robin selection, and failover execution. `src/index.js` adds the `lb` command router. Pools are stored in the existing `models.json` alongside model profiles.

**Tech Stack:** Node.js (CommonJS), Vitest for testing, existing adapter pattern for tool spawning.

---

### Task 1: Pool data helpers — loadPools, savePools, pickNext

**Files:**
- Create: `src/lb.js`
- Create: `tests/lb.test.js`

- [ ] **Step 1: Write the failing tests for pickNext and pool CRUD**

Create `tests/lb.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

const mod = await import('../src/lb.js');
const { pickNext, loadPools, savePools, addPool, deletePool } = mod;

const TMP_DIR = path.join(os.tmpdir(), `fleet-lb-test-${Date.now()}`);
const MODELS_PATH = path.join(TMP_DIR, 'models.json');

function writeTestFile(data) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(MODELS_PATH, JSON.stringify(data, null, 2));
}

beforeEach(() => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
});
afterEach(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('pickNext', () => {
  const models = [
    { name: 'a', tool: 'claude', model: 'm1' },
    { name: 'b', tool: 'claude', model: 'm2' },
    { name: 'c', tool: 'claude', model: 'm3' },
  ];

  it('starts at index 0 when lastIndex is -1', () => {
    const pool = { name: 'p', models: ['a', 'b', 'c'], strategy: 'round-robin', state: { lastIndex: -1 } };
    const result = pickNext(pool, models);
    expect(result.index).toBe(0);
    expect(result.entry.name).toBe('a');
  });

  it('advances to next index', () => {
    const pool = { name: 'p', models: ['a', 'b', 'c'], strategy: 'round-robin', state: { lastIndex: 0 } };
    const result = pickNext(pool, models);
    expect(result.index).toBe(1);
    expect(result.entry.name).toBe('b');
  });

  it('wraps around', () => {
    const pool = { name: 'p', models: ['a', 'b', 'c'], strategy: 'round-robin', state: { lastIndex: 2 } };
    const result = pickNext(pool, models);
    expect(result.index).toBe(0);
    expect(result.entry.name).toBe('a');
  });

  it('works with single model pool', () => {
    const pool = { name: 'p', models: ['a'], strategy: 'round-robin', state: { lastIndex: -1 } };
    const result = pickNext(pool, models);
    expect(result.index).toBe(0);
    expect(result.entry.name).toBe('a');
  });

  it('throws if model not found', () => {
    const pool = { name: 'p', models: ['missing'], strategy: 'round-robin', state: { lastIndex: -1 } };
    expect(() => pickNext(pool, models)).toThrow(/not found/);
  });
});

describe('loadPools / savePools', () => {
  it('returns empty array when file missing', () => {
    const result = loadPools(path.join(TMP_DIR, 'no-file.json'));
    expect(result).toEqual([]);
  });

  it('round-trips pools data', () => {
    const pools = [{ name: 'p', models: ['a', 'b'], strategy: 'round-robin', state: { lastIndex: 0 } }];
    savePools(path.join(TMP_DIR, 'models.json'), pools);
    const loaded = loadPools(path.join(TMP_DIR, 'models.json'));
    expect(loaded).toEqual(pools);
  });

  it('returns empty array when no pools key', () => {
    writeTestFile({ models: [] });
    const result = loadPools(MODELS_PATH);
    expect(result).toEqual([]);
  });
});

describe('addPool', () => {
  const models = [
    { name: 'a', tool: 'claude', model: 'm1' },
    { name: 'b', tool: 'claude', model: 'm2' },
  ];

  it('creates a pool with valid model names', () => {
    const pools = [];
    const result = addPool(pools, models, 'my-pool', ['a', 'b']);
    expect(result).toEqual([
      { name: 'my-pool', models: ['a', 'b'], strategy: 'round-robin', state: { lastIndex: -1 } },
    ]);
  });

  it('rejects duplicate pool name', () => {
    const pools = [{ name: 'my-pool', models: ['a'], strategy: 'round-robin', state: { lastIndex: -1 } }];
    expect(() => addPool(pools, models, 'my-pool', ['b'])).toThrow(/already exists/);
  });

  it('rejects unknown model name', () => {
    expect(() => addPool([], models, 'p', ['missing'])).toThrow(/not found/);
  });

  it('rejects empty name', () => {
    expect(() => addPool([], models, '', ['a'])).toThrow(/required/);
  });

  it('rejects empty model list', () => {
    expect(() => addPool([], models, 'p', [])).toThrow(/at least one/);
  });
});

describe('deletePool', () => {
  it('removes pool by name', () => {
    const pools = [
      { name: 'a', models: ['x'], strategy: 'round-robin', state: { lastIndex: -1 } },
      { name: 'b', models: ['y'], strategy: 'round-robin', state: { lastIndex: -1 } },
    ];
    const result = deletePool(pools, 'a');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('b');
  });

  it('returns unchanged array when name not found', () => {
    const pools = [{ name: 'a', models: ['x'], strategy: 'round-robin', state: { lastIndex: -1 } }];
    const result = deletePool(pools, 'missing');
    expect(result).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lb.test.js`
Expected: FAIL — `src/lb.js` does not exist.

- [ ] **Step 3: Implement src/lb.js with pool CRUD and pickNext**

Create `src/lb.js`:

```js
const fs = require('fs');

function loadPools(modelsPath) {
  if (!fs.existsSync(modelsPath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
    return data.pools || [];
  } catch {
    return [];
  }
}

function savePools(modelsPath, pools) {
  let data = {};
  if (fs.existsSync(modelsPath)) {
    try { data = JSON.parse(fs.readFileSync(modelsPath, 'utf-8')); } catch { /* ignore */ }
  }
  data.pools = pools;
  const dir = fs.mkdirSync ? require('path').dirname(modelsPath) : '';
  if (!fs.existsSync(require('path').dirname(modelsPath))) {
    fs.mkdirSync(require('path').dirname(modelsPath), { recursive: true });
  }
  fs.writeFileSync(modelsPath, JSON.stringify(data, null, 2) + '\n');
}

function pickNext(pool, models) {
  const nextIndex = (pool.state.lastIndex + 1) % pool.models.length;
  const modelName = pool.models[nextIndex];
  const entry = models.find(m => m.name === modelName);
  if (!entry) throw new Error(`Model "${modelName}" not found in profiles`);
  return { entry, index: nextIndex };
}

function addPool(pools, models, name, modelNames) {
  if (!name) throw new Error('Pool name is required');
  if (!modelNames || modelNames.length === 0) throw new Error('Pool must contain at least one model');
  if (pools.some(p => p.name === name)) throw new Error(`Pool "${name}" already exists`);
  for (const m of modelNames) {
    if (!models.find(mod => mod.name === m)) throw new Error(`Model "${m}" not found in profiles`);
  }
  return [...pools, { name, models: modelNames, strategy: 'round-robin', state: { lastIndex: -1 } }];
}

function deletePool(pools, name) {
  return pools.filter(p => p.name !== name);
}

module.exports = { loadPools, savePools, pickNext, addPool, deletePool };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lb.test.js`
Expected: All 15 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lb.js tests/lb.test.js
git commit -m "feat(lb): add pool CRUD helpers and round-robin pickNext"
```

---

### Task 2: Run with failover — runWithFailover

**Files:**
- Modify: `src/lb.js`
- Modify: `tests/lb.test.js`

- [ ] **Step 1: Write the failing test for runWithFailover**

Append to `tests/lb.test.js` (add import at top and describe block at bottom):

Add `runWithFailover` to the import:
```js
const { pickNext, loadPools, savePools, addPool, deletePool, runWithFailover } = mod;
```

Add new describe block:

```js
describe('runWithFailover', () => {
  const models = [
    { name: 'a', tool: 'claude', model: 'm1' },
    { name: 'b', tool: 'claude', model: 'm2' },
    { name: 'c', tool: 'claude', model: 'm3' },
  ];
  const poolPath = path.join(TMP_DIR, 'models.json');

  it('picks next model and spawns tool', async () => {
    writeTestFile({
      models,
      pools: [{ name: 'p', models: ['a', 'b'], strategy: 'round-robin', state: { lastIndex: -1 } }],
    });
    const spawned = [];
    const mockSpawn = (cmd, args, opts) => {
      spawned.push({ cmd, args, opts });
      const fakeChild = { on: (evt, cb) => { if (evt === 'exit') setTimeout(() => cb(0), 10); } };
      return fakeChild;
    };
    await runWithFailover(poolPath, 'p', ['-p', 'hello'], { spawn: mockSpawn });
    expect(spawned).toHaveLength(1);
    expect(spawned[0].args).toContain('-p');
    expect(spawned[0].args).toContain('hello');
  });

  it('failovers to next model on non-zero exit', async () => {
    writeTestFile({
      models,
      pools: [{ name: 'p', models: ['a', 'b'], strategy: 'round-robin', state: { lastIndex: -1 } }],
    });
    const spawned = [];
    const mockSpawn = (cmd, args, opts) => {
      const idx = spawned.length;
      spawned.push({ cmd, args });
      const fakeChild = {
        on: (evt, cb) => {
          if (evt === 'exit') setTimeout(() => cb(idx === 0 ? 1 : 0), 10);
        },
      };
      return fakeChild;
    };
    await runWithFailover(poolPath, 'p', ['-p', 'hello'], { spawn: mockSpawn });
    expect(spawned).toHaveLength(2);
  });

  it('throws when all models fail', async () => {
    writeTestFile({
      models,
      pools: [{ name: 'p', models: ['a', 'b'], strategy: 'round-robin', state: { lastIndex: -1 } }],
    });
    const mockSpawn = () => ({
      on: (evt, cb) => { if (evt === 'exit') setTimeout(() => cb(1), 10); },
    });
    await expect(runWithFailover(poolPath, 'p', ['-p', 'hello'], { spawn: mockSpawn }))
      .rejects.toThrow(/All models failed/);
  });

  it('updates state.lastIndex on success', async () => {
    writeTestFile({
      models,
      pools: [{ name: 'p', models: ['a', 'b'], strategy: 'round-robin', state: { lastIndex: -1 } }],
    });
    const mockSpawn = () => ({
      on: (evt, cb) => { if (evt === 'exit') setTimeout(() => cb(0), 10); },
    });
    await runWithFailover(poolPath, 'p', ['-p', 'hello'], { spawn: mockSpawn });
    const pools = loadPools(poolPath);
    expect(pools[0].state.lastIndex).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lb.test.js`
Expected: 4 new tests FAIL — `runWithFailover` not yet exported.

- [ ] **Step 3: Implement runWithFailover in src/lb.js**

Add to `src/lb.js`, before the `module.exports` line:

```js
const { spawn: realSpawn } = require('child_process');
const path = require('path');
const { registry } = require('./adapters');

async function runWithFailover(modelsPath, poolName, passthrough, deps = {}) {
  const { spawn: doSpawn = realSpawn, checkToolDeps, resolveProxy, applyProxy, cwd } = deps;
  const fs = require('fs');
  let data;
  try {
    data = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
  } catch {
    throw new Error(`Failed to read ${modelsPath}`);
  }
  const pools = data.pools || [];
  const pool = pools.find(p => p.name === poolName);
  if (!pool) throw new Error(`Pool "${poolName}" not found. Available: ${pools.map(p => p.name).join(', ') || 'none'}`);
  if (pool.models.length === 0) throw new Error(`Pool "${poolName}" is empty`);

  const models = data.models || [];
  const attempted = new Set();
  const workDir = cwd || process.cwd();

  while (attempted.size < pool.models.length) {
    const { entry, index } = pickNext(pool, models);
    if (attempted.has(index)) {
      // skip already-tried, advance manually
      pool.state.lastIndex = index;
      continue;
    }
    attempted.add(index);

    const toolName = entry.tool || 'claude';
    if (checkToolDeps) checkToolDeps(toolName);
    const adapter = registry.get(toolName);
    const args = adapter.buildArgs(entry);
    if (passthrough && passthrough.length > 0) args.push(...passthrough);

    const code = await new Promise(resolve => {
      const child = doSpawn(adapter.binary, args, { cwd: workDir, stdio: 'inherit', env: process.env });
      child.on('exit', resolve);
    });

    if (code === 0) {
      pool.state.lastIndex = index;
      data.pools = pools;
      fs.writeFileSync(modelsPath, JSON.stringify(data, null, 2) + '\n');
      return;
    }

    // Advance past failed model for next iteration
    pool.state.lastIndex = index;
  }

  throw new Error(`All models failed in pool "${poolName}"`);
}
```

Update `module.exports` to include `runWithFailover`:

```js
module.exports = { loadPools, savePools, pickNext, addPool, deletePool, runWithFailover };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lb.test.js`
Expected: All 19 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lb.js tests/lb.test.js
git commit -m "feat(lb): add runWithFailover with round-robin failover"
```

---

### Task 3: CLI commands — lb add, lb list, lb delete

**Files:**
- Modify: `src/index.js` — add `cmdLb` function and route `lb` command in `main()`

- [ ] **Step 1: Write the failing test for lb command routing**

Append to `tests/index.test.js`:

Add to the import destructuring:
```js
parseArgs,
```
(already imported — no change needed there)

Add new describe block:

```js
describe('parseArgs — lb command', () => {
  it('parses lb add', () => {
    const r = parseArgs(['lb', 'add']);
    expect(r.command).toBe('lb');
    expect(r.subcommand).toBe('add');
  });
  it('parses lb list', () => {
    const r = parseArgs(['lb', 'list']);
    expect(r.command).toBe('lb');
    expect(r.subcommand).toBe('list');
  });
  it('parses lb delete', () => {
    const r = parseArgs(['lb', 'delete']);
    expect(r.command).toBe('lb');
    expect(r.subcommand).toBe('delete');
  });
  it('parses lb <pool-name> with passthrough', () => {
    const r = parseArgs(['lb', 'my-pool', '--', '-p', 'hello']);
    expect(r.command).toBe('lb');
    expect(r.subcommand).toBe('my-pool');
    expect(r.opts.passthrough).toEqual(['-p', 'hello']);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass (parseArgs already handles this)**

Run: `npx vitest run tests/index.test.js`
Expected: These should already PASS — `parseArgs` treats `lb` as a command and `my-pool` as subcommand, `--` passthrough already works.

- [ ] **Step 3: Add cmdLb functions and route in main() — src/index.js**

Add import near the top of `src/index.js` (after line 7):

```js
const { loadPools, savePools, addPool, deletePool, runWithFailover } = require('./lb');
```

Add the `cmdLb` command implementations before the `main()` function (before line 687):

```js
// ─── Load Balancer commands ──────────────────────────────────────────────────

async function cmdLbAdd() {
  const data = loadModels();
  if (data.models.length === 0) {
    console.error(ANSI.yellow('No model profiles configured.'));
    console.error(`Run ${ANSI.bold('fleet model add')} to create one.`);
    process.exit(1);
  }

  const selectorPath = path.join(__dirname, 'components', 'selector.mjs');
  const inputMod = await import(selectorPath);

  const name = await ask('Pool name: ');
  if (!name) {
    console.error(ANSI.red('Pool name is required.'));
    process.exit(1);
  }

  const modelItems = data.models.map(m => modelItem(m));
  console.log(ANSI.dim('\nSelect models to add to the pool (Enter to confirm, q to cancel):\n'));
  const selectedModels = [];
  while (true) {
    const remaining = data.models.filter(m => !selectedModels.includes(m.name));
    if (remaining.length === 0) break;
    const items = remaining.map(m => modelItem(m));
    const pick = await selectFromList(items, `Add model to "${name}" (${selectedModels.length} selected) or cancel to finish`);
    if (!pick) break;
    selectedModels.push(pick);
  }

  if (selectedModels.length === 0) {
    console.error(ANSI.yellow('No models selected. Aborting.'));
    return;
  }

  let pools = data.pools || [];
  try {
    pools = addPool(pools, data.models, name, selectedModels);
  } catch (err) {
    console.error(ANSI.red(err.message));
    process.exit(1);
  }
  data.pools = pools;
  saveModels(data);
  console.log(ANSI.green(`\n  Pool "${name}" created with ${selectedModels.length} model(s): ${selectedModels.join(', ')}`));
}

async function cmdLbList() {
  const data = loadModels();
  const pools = data.pools || [];
  if (pools.length === 0) {
    console.log(ANSI.yellow('No load balancer pools configured.'));
    console.log(`Run ${ANSI.bold('fleet lb add')} to create one.`);
    return;
  }
  console.log(`\n\x1b[38;2;167;139;250m\x1b[1m⬢ Load Balancer Pools\x1b[0m  \x1b[38;2;82;82;82m${pools.length} configured\x1b[0m\n`);
  for (const p of pools) {
    const models = data.models || [];
    const members = p.models.map(name => {
      const m = models.find(mod => mod.name === name);
      return m ? `${name} (${m.model || 'default'})` : `${name} \x1b[38;2;248;81;81m[missing]\x1b[0m`;
    });
    console.log(`  \x1b[38;2;167;139;250m│\x1b[0m \x1b[38;2;224;224;224m\x1b[1m${p.name}\x1b[0m  \x1b[38;2;82;82;82m${p.strategy}\x1b[0m`);
    console.log(`    \x1b[38;2;139;155;168mmembers:\x1b[0m ${members.join(', ')}`);
    console.log(`    \x1b[38;2;139;155;168mlast used:\x1b[0m ${p.state.lastIndex >= 0 ? p.models[p.state.lastIndex] : 'none'}`);
  }
}

async function cmdLbDelete() {
  const data = loadModels();
  const pools = data.pools || [];
  if (pools.length === 0) {
    console.log(ANSI.yellow('No pools to delete.'));
    return;
  }
  const items = pools.map(p => ({
    label: p.name,
    detail: `${p.models.length} model(s) · ${p.strategy}`,
    value: p.name,
  }));
  const selected = await selectFromList(items, 'Select a pool to delete', true);
  if (!selected) return;
  data.pools = deletePool(pools, selected);
  saveModels(data);
  console.log(ANSI.green(`\n  Pool "${selected}" deleted.`));
}

async function cmdLbRun(poolName, passthrough, cwd) {
  const modelsPath = getModelsPath();
  try {
    await runWithFailover(modelsPath, poolName, passthrough, { cwd });
  } catch (err) {
    console.error(ANSI.red(err.message));
    process.exit(1);
  }
}
```

Add the `lb` command routing in `main()`, before the `model` command block (before line 701):

```js
  // Load Balancer commands
  if (command === 'lb') {
    const lbCmd = subcommand;
    if (!lbCmd || lbCmd === 'list') {
      cmdLbList();
    } else if (lbCmd === 'add') {
      cmdLbAdd();
    } else if (lbCmd === 'delete') {
      cmdLbDelete();
    } else {
      // treat subcommand as pool name for execution
      cmdLbRun(lbCmd, opts.passthrough, opts.cwd);
    }
    return;
  }
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS (existing + new lb routing tests).

- [ ] **Step 5: Commit**

```bash
git add src/index.js tests/index.test.js
git commit -m "feat(lb): add CLI commands — lb add, lb list, lb delete, lb <pool>"
```

---

### Task 4: Help text and documentation

**Files:**
- Modify: `src/index.js` — update `printHelp()`
- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update printHelp() in src/index.js**

In the `printHelp()` function, add after the `notify` line in the Commands section:

```
  lb add              Create a load balancer pool
  lb list             List all pools
  lb delete           Delete a pool
  lb <pool> -- <args> Run instruction via pool with round-robin
```

Add to the Examples section:

```
  fleet lb add                       # Create a load balancer pool
  fleet lb list                      # List all pools
  fleet lb my-pool -- -p "hello"     # Run via pool
```

- [ ] **Step 2: Update README.md**

Add to the Quick Start section after the proxy examples:

```bash
# Load balancer
fleet lb add                       # Create a pool interactively
fleet lb list                      # List all pools
fleet lb my-pool -- -p "hello"     # Distribute instruction across pool
```

Add to the Commands table:

```
| `fleet lb add` | — | Create a load balancer pool |
| `fleet lb list` | — | List all pools |
| `fleet lb delete` | — | Delete a pool (interactive) |
| `fleet lb <pool> -- <args>` | — | Run via pool with round-robin and failover |
```

- [ ] **Step 3: Update README.zh.md**

Same additions as README.md but in Chinese:

Quick Start section:
```bash
# 负载均衡
fleet lb add                       # 交互式创建负载均衡池
fleet lb list                      # 列出所有池子
fleet lb my-pool -- -p "hello"     # 通过池子分发指令
```

Commands table:
```
| `fleet lb add` | — | 创建负载均衡池 |
| `fleet lb list` | — | 列出所有池子 |
| `fleet lb delete` | — | 删除池子（交互式） |
| `fleet lb <pool> -- <args>` | — | 通过池子运行，支持轮询和故障转移 |
```

- [ ] **Step 4: Update CHANGELOG.md**

Add new version section before `[1.3.2]`:

```markdown
## [1.4.0] - 2026-04-22

### Added

- **Load Balancer** — `fleet lb` command for distributing instructions across a pool of model profiles
- Round-robin selection strategy with automatic failover on failure
- `fleet lb add` — interactive pool creation
- `fleet lb list` — show pools with members and last-used model
- `fleet lb delete` — interactive pool deletion
- `fleet lb <pool> -- <args>` — execute instruction via pool with round-robin and failover
```

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/index.js README.md README.zh.md CHANGELOG.md
git commit -m "docs: add lb command to help text, README, and CHANGELOG"
```

---

### Task 5: Bump version and final integration test

**Files:**
- Modify: `package.json` — bump version to 1.4.0

- [ ] **Step 1: Bump version**

In `package.json`, change `"version": "1.3.2"` to `"version": "1.4.0"`.

- [ ] **Step 2: Run full test suite one more time**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 3: Commit and push**

```bash
git add package.json
git commit -m "chore: bump version to 1.4.0"
git push
```
