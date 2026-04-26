# Load Balancer Failover Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework `fleet lb` so failover can be disabled, defaults to conservative `safe-only` behavior, and only switches models on explicitly recoverable failures.

**Architecture:** Keep `src/lb.js` as the execution coordinator, but split it into small units: candidate selection, process-result collection, attempt classification, and failover orchestration. Let adapters own tool-specific failure interpretation, and let `src/index.js` own CLI parsing, failover-mode validation, and process exit mapping.

**Tech Stack:** Node.js CommonJS, existing adapter registry, Vitest, existing README/README.zh user docs.

---

### Task 1: Add core failover contracts and pure helper coverage

**Files:**
- Modify: `src/adapters/base.js`
- Modify: `src/lb.js`
- Modify: `tests/adapters/base.test.js`
- Modify: `tests/lb.test.js`

- [ ] **Step 1: Write the failing tests for the new base contract and pure lb helpers**

Update `tests/adapters/base.test.js` by adding:

```js
  it('classifyFailure defaults to terminal/unclassified', () => {
    adapter = new ToolAdapter();
    expect(adapter.classifyFailure({ stderrSnippet: '' })).toEqual({
      kind: 'terminal',
      reason: 'unclassified',
    });
  });
```

Update `tests/lb.test.js` imports and add pure-helper coverage:

```js
  let loadPools, savePools, pickNext, addPool, deletePool, runWithFailover, classifyAttempt;
```

```js
    classifyAttempt = mod.classifyAttempt;
```

```js
    it('skips attempted pool indices', () => {
      const pool = { name: 'p1', models: ['alpha', 'beta', 'gamma'], strategy: 'round-robin', state: { lastIndex: -1 } };
      const attempted = new Set([0, 1]);
      const result = pickNext(pool, models, attempted);
      expect(result.index).toBe(2);
      expect(result.entry.name).toBe('gamma');
    });

    it('returns null when all pool indices were attempted', () => {
      const pool = { name: 'p1', models: ['alpha', 'beta'], strategy: 'round-robin', state: { lastIndex: -1 } };
      const attempted = new Set([0, 1]);
      expect(pickNext(pool, models, attempted)).toBeNull();
    });
```

```js
  describe('classifyAttempt', () => {
    it('classifies clean exit as success', () => {
      expect(classifyAttempt(
        { exitCode: 0, signal: null, spawnError: null, timedOut: false, stderrSnippet: '' },
        null
      )).toEqual({ kind: 'success', reason: 'success' });
    });

    it('classifies startup timeout as failover-safe', () => {
      expect(classifyAttempt(
        { exitCode: null, signal: 'SIGTERM', spawnError: null, timedOut: true, timeoutPhase: 'startup', stderrSnippet: '' },
        null
      )).toEqual({ kind: 'failover-safe', reason: 'startup_timeout' });
    });

    it('classifies SIGINT as terminal user interruption', () => {
      expect(classifyAttempt(
        { exitCode: null, signal: 'SIGINT', spawnError: null, timedOut: false, stderrSnippet: '' },
        null
      )).toEqual({ kind: 'terminal', reason: 'user_interrupted' });
    });

    it('uses adapter classification when precedence does not decide', () => {
      expect(classifyAttempt(
        { exitCode: 1, signal: null, spawnError: null, timedOut: false, stderrSnippet: 'rate limit exceeded' },
        { kind: 'failover-safe', reason: 'rate_limited' }
      )).toEqual({ kind: 'failover-safe', reason: 'rate_limited' });
    });
  });
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `npx vitest run tests/adapters/base.test.js tests/lb.test.js`

Expected: FAIL with missing `classifyFailure`, `classifyAttempt`, and new `pickNext(..., attempted)` behavior.

- [ ] **Step 3: Implement the base contract and pure helpers**

Update `src/adapters/base.js`:

```js
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
  installHooks(_hookClientPath) { throw new Error('ToolAdapter.installHooks must be implemented'); }
  removeHooks() { throw new Error('ToolAdapter.removeHooks must be implemented'); }
  normalizePayload(_rawInput) { throw new Error('ToolAdapter.normalizePayload must be implemented'); }

  classifyFailure(_result) {
    return { kind: 'terminal', reason: 'unclassified' };
  }

  summarizeToolUse(toolName, _toolInput) {
    return toolName;
  }
}
```

Update the pure portion of `src/lb.js`:

```js
function pickNext(pool, models, attemptedIndices = new Set()) {
  if (!pool.models || pool.models.length === 0) return null;

  for (let offset = 1; offset <= pool.models.length; offset++) {
    const nextIndex = (pool.state.lastIndex + offset) % pool.models.length;
    if (attemptedIndices.has(nextIndex)) continue;
    const modelName = pool.models[nextIndex];
    const entry = models.find(m => m.name === modelName);
    if (!entry) {
      throw new Error(`Model "${modelName}" not found in models array`);
    }
    return { entry, index: nextIndex };
  }

  return null;
}

function classifyAttempt(result, adapterClassification) {
  if (
    result.exitCode === 0 &&
    result.signal === null &&
    result.spawnError === null &&
    result.timedOut === false
  ) {
    return { kind: 'success', reason: 'success' };
  }

  if (result.timedOut === true && result.timeoutPhase === 'startup') {
    return { kind: 'failover-safe', reason: 'startup_timeout' };
  }

  if ((result.signal === 'SIGINT' || result.signal === 'SIGTERM') && result.timedOut !== true) {
    return { kind: 'terminal', reason: 'user_interrupted' };
  }

  if (result.spawnError) {
    throw result.spawnError;
  }

  if (adapterClassification) {
    return adapterClassification;
  }

  return { kind: 'terminal', reason: 'unclassified' };
}
```

Update the export list at the bottom of `src/lb.js`:

```js
module.exports = {
  loadPools,
  savePools,
  pickNext,
  addPool,
  deletePool,
  classifyAttempt,
  runWithFailover,
};
```

- [ ] **Step 4: Run the targeted pure-helper tests to verify they pass**

Run: `npx vitest run tests/adapters/base.test.js -t "classifyFailure defaults to terminal/unclassified"`

Expected: PASS.

Run: `npx vitest run tests/lb.test.js -t "skips attempted pool indices|returns null when all pool indices were attempted|classifyAttempt"`

Expected: PASS.

- [ ] **Step 5: Commit the helper-contract work**

```bash
git add src/adapters/base.js src/lb.js tests/adapters/base.test.js tests/lb.test.js
git commit -m "refactor(lb): add failover classification helpers"
```

### Task 2: Add adapter-owned failure classification

**Files:**
- Modify: `src/adapters/claude.js`
- Modify: `src/adapters/codex.js`
- Modify: `src/adapters/copilot.js`
- Modify: `tests/adapters/claude.test.js`
- Modify: `tests/adapters/codex.test.js`
- Modify: `tests/adapters/copilot.test.js`

- [ ] **Step 1: Write the failing adapter classification tests**

Add to `tests/adapters/claude.test.js`:

```js
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
        stderrSnippet: 'upstream connection error',
        exitCode: 1,
        signal: null,
        timedOut: false,
      })).toEqual({ kind: 'failover-safe', reason: 'upstream_unreachable' });
    });
  });
```

Add the same shape to `tests/adapters/codex.test.js` and `tests/adapters/copilot.test.js`, plus one default-terminal assertion per file:

```js
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
```

- [ ] **Step 2: Run the adapter tests to verify they fail**

Run: `npx vitest run tests/adapters/claude.test.js tests/adapters/codex.test.js tests/adapters/copilot.test.js`

Expected: FAIL because the concrete adapters do not implement `classifyFailure`.

- [ ] **Step 3: Implement conservative adapter classifiers**

Add the same method shape to each adapter, with tool-specific regexes kept local to the adapter file.

Update `src/adapters/claude.js`:

```js
  classifyFailure(result) {
    const stderr = (result.stderrSnippet || '').toLowerCase();

    if (/rate limit|too many requests|429/.test(stderr)) {
      return { kind: 'failover-safe', reason: 'rate_limited' };
    }
    if (/tls handshake failed|socket hang up before startup completed|proxy connect aborted/.test(stderr)) {
      return { kind: 'failover-safe', reason: 'startup_transient_error' };
    }
    if (/econnrefused|econnreset|upstream connect error|service unavailable/.test(stderr)) {
      return { kind: 'failover-safe', reason: 'upstream_unreachable' };
    }
    if (/temporarily unavailable|try again later|auth.*temporar/.test(stderr)) {
      return { kind: 'failover-safe', reason: 'auth_temporarily_unusable' };
    }
    return { kind: 'terminal', reason: 'unclassified' };
  }
```

Apply the same shape in `src/adapters/codex.js` and `src/adapters/copilot.js`, but keep the matcher list conservative and tool-specific. Only add phrases already covered by tests, such as `rate limit exceeded`, `tls handshake failed`, `socket hang up before startup completed`, `proxy connect aborted`, `econnrefused`, and `service unavailable`.

- [ ] **Step 4: Run the adapter tests to verify they pass**

Run: `npx vitest run tests/adapters/claude.test.js tests/adapters/codex.test.js tests/adapters/copilot.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the adapter classification work**

```bash
git add src/adapters/claude.js src/adapters/codex.js src/adapters/copilot.js tests/adapters/claude.test.js tests/adapters/codex.test.js tests/adapters/copilot.test.js
git commit -m "feat(lb): classify recoverable adapter failures"
```

### Task 3: Rebuild `runWithFailover()` around collected process results

**Files:**
- Modify: `src/lb.js`
- Modify: `tests/lb.test.js`

- [ ] **Step 1: Write the failing execution-path tests**

Extend `tests/lb.test.js` with a fake child helper:

```js
    function makeFakeChild({ code = null, signal = null, stderrChunks = [], stdoutChunks = [], error = null, exitDelay = 10 } = {}) {
      const listeners = new Map();
      const child = {
        stdout: { on: (evt, cb) => { listeners.set(`stdout:${evt}`, cb); } },
        stderr: { on: (evt, cb) => { listeners.set(`stderr:${evt}`, cb); } },
        on: (evt, cb) => { listeners.set(evt, cb); return child; },
        kill: () => {
          const closeCb = listeners.get('close');
          if (closeCb) closeCb(null, 'SIGTERM');
        },
      };

      setTimeout(() => {
        for (const chunk of stdoutChunks) listeners.get('stdout:data')?.(Buffer.from(chunk));
        for (const chunk of stderrChunks) listeners.get('stderr:data')?.(Buffer.from(chunk));
        if (error) {
          listeners.get('error')?.(error);
          return;
        }
        listeners.get('close')?.(code, signal);
      }, exitDelay);

      return child;
    }
```

Add the new `runWithFailover` tests:

```js
    it('returns structured success result and persists lastIndex only on success', async () => {
      writeConfig(modelsPath);
      const spawned = [];
      const mockSpawn = (cmd, args, opts) => {
        spawned.push({ cmd, args, opts });
        return makeFakeChild({ code: 0 });
      };

      const result = await runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
        spawn: mockSpawn,
        registry: {
          get: () => ({
            binary: 'claude',
            displayName: 'Claude Code',
            isInstalled: () => true,
            buildArgs: () => ['--model', 'model-a'],
            buildEnv: (_entry, env) => ({ ...env, FLEET_MODEL_NAME: 'alpha' }),
            classifyFailure: () => ({ kind: 'terminal', reason: 'unclassified' }),
          }),
        },
      });

      expect(result.finalKind).toBe('success');
      expect(result.finalReason).toBe('success');
      expect(result.attempts).toHaveLength(1);
      expect(spawned[0].opts.stdio).toEqual(['inherit', 'pipe', 'pipe']);
      const written = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
      expect(written.pools[0].state.lastIndex).toBe(0);
    });

    it('does not fail over on unclassified non-zero exit under safe-only', async () => {
      writeConfig(modelsPath);
      const mockSpawn = () => makeFakeChild({ code: 1, stderrChunks: ['validation failed'] });

      const result = await runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
        spawn: mockSpawn,
        registry: {
          get: () => ({
            binary: 'claude',
            displayName: 'Claude Code',
            isInstalled: () => true,
            buildArgs: () => ['--model', 'model-a'],
            buildEnv: (_entry, env) => env,
            classifyFailure: () => ({ kind: 'terminal', reason: 'unclassified' }),
          }),
        },
      });

      expect(result.finalKind).toBe('terminal');
      expect(result.attempts).toHaveLength(1);
    });

    it('fails over on startup timeout before any output', async () => {
      writeConfig(modelsPath);
      let callCount = 0;
      const mockSpawn = () => {
        callCount++;
        return callCount === 1
          ? makeFakeChild({ code: null, signal: null, exitDelay: 50 })
          : makeFakeChild({ code: 0 });
      };

      const result = await runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
        spawn: mockSpawn,
        startupTimeoutMs: 5,
        registry: {
          get: () => ({
            binary: 'claude',
            displayName: 'Claude Code',
            isInstalled: () => true,
            buildArgs: () => ['--model', 'model-a'],
            buildEnv: (_entry, env) => env,
            classifyFailure: () => ({ kind: 'terminal', reason: 'unclassified' }),
          }),
        },
      });

      expect(callCount).toBe(2);
      expect(result.attempts[0].reason).toBe('startup_timeout');
      expect(result.finalKind).toBe('success');
    });

    it('cancels startup timeout when stdout output arrives', async () => {
      writeConfig(modelsPath);
      const result = await runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
        spawn: () => makeFakeChild({ code: 0, stdoutChunks: ['started'] }),
        startupTimeoutMs: 5,
        registry: {
          get: () => ({
            binary: 'claude',
            displayName: 'Claude Code',
            isInstalled: () => true,
            buildArgs: () => ['--model', 'model-a'],
            buildEnv: (_entry, env) => env,
            classifyFailure: () => ({ kind: 'terminal', reason: 'unclassified' }),
          }),
        },
      });

      expect(result.finalKind).toBe('success');
    });

    it('failovers on recoverable adapter classification under safe-only', async () => {
      writeConfig(modelsPath);
      let callCount = 0;
      const mockSpawn = () => {
        callCount++;
        return callCount === 1
          ? makeFakeChild({ code: 1, stderrChunks: ['rate limit exceeded'] })
          : makeFakeChild({ code: 0 });
      };

      const result = await runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
        spawn: mockSpawn,
        registry: {
          get: () => ({
            binary: 'claude',
            displayName: 'Claude Code',
            isInstalled: () => true,
            buildArgs: () => ['--model', 'model-a'],
            buildEnv: (_entry, env) => env,
            classifyFailure: (attempt) => (
              /rate limit/i.test(attempt.stderrSnippet)
                ? { kind: 'failover-safe', reason: 'rate_limited' }
                : { kind: 'terminal', reason: 'unclassified' }
            ),
          }),
        },
      });

      expect(result.finalKind).toBe('success');
      expect(result.attempts).toHaveLength(2);
      expect(result.attempts[0].reason).toBe('rate_limited');
    });

    it('stops after one attempt when failover policy is off', async () => {
      writeConfig(modelsPath);
      let callCount = 0;
      const mockSpawn = () => {
        callCount++;
        return makeFakeChild({ code: 1, stderrChunks: ['rate limit exceeded'] });
      };

      const result = await runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
        spawn: mockSpawn,
        failover: 'off',
        registry: {
          get: () => ({
            binary: 'claude',
            displayName: 'Claude Code',
            isInstalled: () => true,
            buildArgs: () => ['--model', 'model-a'],
            buildEnv: (_entry, env) => env,
            classifyFailure: () => ({ kind: 'failover-safe', reason: 'rate_limited' }),
          }),
        },
      });

      expect(callCount).toBe(1);
      expect(result.finalKind).toBe('policy_stopped');
      expect(result.finalReason).toBe('policy_off');
    });

    it('maps SIGINT to terminal user interruption', async () => {
      writeConfig(modelsPath);
      const mockSpawn = () => makeFakeChild({ signal: 'SIGINT' });

      const result = await runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
        spawn: mockSpawn,
        registry: {
          get: () => ({
            binary: 'claude',
            displayName: 'Claude Code',
            isInstalled: () => true,
            buildArgs: () => ['--model', 'model-a'],
            buildEnv: (_entry, env) => env,
            classifyFailure: () => ({ kind: 'terminal', reason: 'unclassified' }),
          }),
        },
      });

      expect(result.finalKind).toBe('terminal');
      expect(result.finalReason).toBe('user_interrupted');
    });

    it('keeps failing over in always mode until success', async () => {
      writeConfig(modelsPath);
      let callCount = 0;
      const mockSpawn = () => {
        callCount++;
        return callCount === 1
          ? makeFakeChild({ code: 1, stderrChunks: ['invalid request'] })
          : makeFakeChild({ code: 0 });
      };

      const result = await runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
        spawn: mockSpawn,
        failover: 'always',
        registry: {
          get: () => ({
            binary: 'claude',
            displayName: 'Claude Code',
            isInstalled: () => true,
            buildArgs: () => ['--model', 'model-a'],
            buildEnv: (_entry, env) => env,
            classifyFailure: () => ({ kind: 'terminal', reason: 'unclassified' }),
          }),
        },
      });

      expect(callCount).toBe(2);
      expect(result.finalKind).toBe('success');
    });

    it('returns exhausted summary after recoverable failures across the whole pool', async () => {
      writeConfig(modelsPath);
      const logs = [];
      const mockSpawn = () => makeFakeChild({ code: 1, stderrChunks: ['rate limit exceeded'] });

      const result = await runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
        spawn: mockSpawn,
        log: line => logs.push(line),
        registry: {
          get: () => ({
            binary: 'claude',
            displayName: 'Claude Code',
            isInstalled: () => true,
            buildArgs: () => ['--model', 'model-a'],
            buildEnv: (_entry, env) => env,
            classifyFailure: () => ({ kind: 'failover-safe', reason: 'rate_limited' }),
          }),
        },
      });

      expect(result.finalKind).toBe('exhausted');
      expect(result.finalReason).toBe('recoverable_exhausted');
      expect(logs.some(line => line.includes('try 1/2'))).toBe(true);
      expect(logs.some(line => line.includes('trying next model'))).toBe(true);
      expect(logs.some(line => line.includes('recoverable_exhausted'))).toBe(true);
    });

    it('throws setup errors instead of failing over when cwd is invalid', async () => {
      writeConfig(modelsPath);

      await expect(
        runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
          cwd: path.join(tmpDir, 'missing-dir'),
          spawn: () => makeFakeChild({ code: 0 }),
          registry: {
            get: () => ({
              binary: 'claude',
              displayName: 'Claude Code',
              isInstalled: () => true,
              buildArgs: () => ['--model', 'model-a'],
              buildEnv: (_entry, env) => env,
              classifyFailure: () => ({ kind: 'terminal', reason: 'unclassified' }),
            }),
          },
        })
      ).rejects.toThrow(/Working directory not found/);
    });

    it('throws when cwd exists but is not a directory', async () => {
      writeConfig(modelsPath);
      const filePath = path.join(tmpDir, 'not-a-dir');
      fs.writeFileSync(filePath, 'hello');

      await expect(
        runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
          cwd: filePath,
          spawn: () => makeFakeChild({ code: 0 }),
          registry: {
            get: () => ({
              binary: 'claude',
              displayName: 'Claude Code',
              isInstalled: () => true,
              buildArgs: () => ['--model', 'model-a'],
              buildEnv: (_entry, env) => env,
              classifyFailure: () => ({ kind: 'terminal', reason: 'unclassified' }),
            }),
          },
        })
      ).rejects.toThrow(/Working directory is not usable/);
    });

    it('throws immediately when the adapter is missing', async () => {
      writeConfig(modelsPath);

      await expect(
        runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
          spawn: () => makeFakeChild({ code: 0 }),
          registry: { get: () => null },
        })
      ).rejects.toThrow(/Unknown tool adapter/);
    });

    it('throws immediately when the binary is missing', async () => {
      writeConfig(modelsPath);

      await expect(
        runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
          spawn: () => makeFakeChild({ code: 0 }),
          registry: {
            get: () => ({
              binary: 'claude',
              displayName: 'Claude Code',
              isInstalled: () => false,
              buildArgs: () => ['--model', 'model-a'],
              buildEnv: (_entry, env) => env,
              classifyFailure: () => ({ kind: 'terminal', reason: 'unclassified' }),
            }),
          },
        })
      ).rejects.toThrow(/Missing dependency/);
    });
```

In the same edit, remove or rewrite the legacy assertions that no longer match the spec:

```js
    // delete these legacy tests before expecting the suite to pass:
    // - it('failovers on non-zero exit', ...)
    // - it('throws when all models fail', ...)
```

- [ ] **Step 2: Run the lb tests to verify they fail**

Run: `npx vitest run tests/lb.test.js`

Expected: FAIL because `runWithFailover()` still returns `undefined`, still mutates in-memory state on failure, and does not understand `failover` policy or structured results.

- [ ] **Step 3: Implement result collection and policy-aware orchestration**

Refactor `src/lb.js` so `runWithFailover()` is built around small helpers.

Add a stderr ring buffer and collector:

```js
function createRingBuffer(limit) {
  let value = '';
  return {
    push(chunk) {
      value += chunk;
      if (Buffer.byteLength(value, 'utf8') > limit) {
        const buf = Buffer.from(value, 'utf8');
        value = buf.subarray(buf.length - limit).toString('utf8');
      }
    },
    toString() {
      return value;
    },
  };
}

function collectProcessResult(child, {
  startupTimeoutMs = 3000,
  killGraceMs = 500,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  return new Promise(resolve => {
    const stderrBuffer = createRingBuffer(4096);
    let timedOut = false;
    let timeoutPhase = null;
    let started = false;
    let killTimer = null;

    const startupTimer = setTimeout(() => {
      if (started) return;
      timedOut = true;
      timeoutPhase = 'startup';
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
    }, startupTimeoutMs);

    child.stdout?.on('data', chunk => {
      started = true;
      clearTimeout(startupTimer);
      stdout.write(chunk);
    });

    child.stderr?.on('data', chunk => {
      started = true;
      clearTimeout(startupTimer);
      stderr.write(chunk);
      stderrBuffer.push(chunk.toString());
    });

    child.on('error', error => {
      clearTimeout(startupTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        spawnError: error,
        exitCode: null,
        signal: null,
        timedOut,
        timeoutPhase,
        stderrSnippet: '',
      });
    });

    child.on('close', (exitCode, signal) => {
      clearTimeout(startupTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        spawnError: null,
        exitCode,
        signal,
        timedOut,
        timeoutPhase,
        stderrSnippet: stderrBuffer.toString(),
      });
    });
  });
}
```

Refactor `runWithFailover()` to:

```js
async function runWithFailover(modelsPath, poolName, passthrough, deps = {}) {
  const spawn = deps.spawn || require('child_process').spawn;
  const cwd = deps.cwd || process.cwd();
  const failover = deps.failover || 'safe-only';
  const startupTimeoutMs = deps.startupTimeoutMs || 3000;
  const killGraceMs = deps.killGraceMs || 500;
  const registry = deps.registry || require('./adapters').registry;
  const log = deps.log || (line => console.log(line));

  const raw = fs.readFileSync(modelsPath, 'utf-8');
  const data = JSON.parse(raw);
  const models = Array.isArray(data.models) ? data.models : [];
  const pools = Array.isArray(data.pools) ? data.pools : [];
  const pool = pools.find(p => p.name === poolName);

  if (!pool) {
    const names = pools.map(p => p.name);
    throw new Error(`Pool "${poolName}" not found. Available pools: ${names.length > 0 ? names.join(', ') : '(none)'}`);
  }
  if (!pool.models || pool.models.length === 0) {
    throw new Error(`Pool "${poolName}" has no models`);
  }

  const attempted = new Set();
  const attempts = [];

  while (true) {
    const candidate = pickNext(pool, models, attempted);
    if (!candidate) {
      return {
        status: 'failure',
        poolName,
        selectedModel: null,
        finalKind: 'exhausted',
        finalReason: 'recoverable_exhausted',
        attempts,
      };
    }

    const { entry, index } = candidate;
    attempted.add(index);

    const adapter = registry.get(entry.tool || 'claude');
    if (!adapter) throw new Error(`Unknown tool adapter: ${entry.tool || 'claude'}`);
    if (typeof adapter.isInstalled === 'function' && !adapter.isInstalled()) {
      throw new Error(`Missing dependency: ${adapter.binary || entry.tool}`);
    }
    if (!fs.existsSync(cwd)) {
      throw new Error(`Working directory not found: ${cwd}`);
    }
    const cwdStat = fs.statSync(cwd);
    if (!cwdStat.isDirectory()) {
      throw new Error(`Working directory is not usable: ${cwd}`);
    }

    const adapterArgs = adapter.buildArgs(entry);
    const allArgs = [...adapterArgs, ...(passthrough || [])];
    const baseEnv = { ...process.env };
    if (entry.proxy) {
      const proxyUrl = /^https?:\/\//i.test(entry.proxy) ? entry.proxy : `http://${entry.proxy}`;
      baseEnv.HTTP_PROXY = proxyUrl;
      baseEnv.HTTPS_PROXY = proxyUrl;
    }
    const env = adapter.buildEnv(entry, baseEnv);

    log(`[lb:${poolName}] try ${attempted.size}/${pool.models.length} ${adapter.displayName}:${entry.name}`);

    // Tee stdout/stderr back to the parent terminal immediately so interactive output
    // remains visible while lb still captures startup signals and stderr snippets.
    const child = spawn(adapter.binary, allArgs, { cwd, stdio: ['inherit', 'pipe', 'pipe'], env });
    const result = await collectProcessResult(child, {
      startupTimeoutMs,
      killGraceMs,
      stdout: deps.stdout || process.stdout,
      stderr: deps.stderr || process.stderr,
    });
    const adapterClassification = result.spawnError ? null : adapter.classifyFailure(result);
    const classification = classifyAttempt(result, adapterClassification);

    attempts.push({
      modelName: entry.name,
      exitCode: result.exitCode,
      signal: result.signal,
      kind: classification.kind,
      reason: classification.reason,
    });

    if (classification.kind === 'success') {
      const updatedPools = pools.map(p =>
        p.name === poolName ? { ...p, state: { ...p.state, lastIndex: index } } : p
      );
      fs.writeFileSync(modelsPath, JSON.stringify({ ...data, pools: updatedPools }, null, 2) + '\n');
      return {
        status: 'success',
        poolName,
        selectedModel: entry.name,
        finalKind: 'success',
        finalReason: 'success',
        attempts,
      };
    }

    if (classification.reason === 'user_interrupted') {
      log(`[lb:${poolName}] ${entry.name} -> terminal (reason=user_interrupted)`);
      return {
        status: 'failure',
        poolName,
        selectedModel: null,
        finalKind: 'terminal',
        finalReason: 'user_interrupted',
        attempts,
      };
    }

    if (failover === 'off') {
      log(`[lb:${poolName}] ${entry.name} -> ${classification.kind} (reason=${classification.reason})`);
      return {
        status: 'failure',
        poolName,
        selectedModel: null,
        finalKind: 'policy_stopped',
        finalReason: 'policy_off',
        attempts,
      };
    }

    const hasMoreCandidates = attempted.size < pool.models.length;

    if (failover === 'always' && hasMoreCandidates) {
      log(`[lb:${poolName}] ${entry.name} -> ${classification.kind} (reason=${classification.reason})`);
      log(`[lb:${poolName}] trying next model...`);
      continue;
    }
    if (failover === 'safe-only' && classification.kind === 'failover-safe' && hasMoreCandidates) {
      log(`[lb:${poolName}] ${entry.name} -> failover-safe (reason=${classification.reason})`);
      log(`[lb:${poolName}] trying next model...`);
      continue;
    }

    if (classification.kind === 'failover-safe' && !hasMoreCandidates) {
      log(`[lb:${poolName}] exhausted recoverable attempts (reason=recoverable_exhausted)`);
      return {
        status: 'failure',
        poolName,
        selectedModel: null,
        finalKind: 'exhausted',
        finalReason: 'recoverable_exhausted',
        attempts,
      };
    }

    log(`[lb:${poolName}] ${entry.name} -> terminal (reason=${classification.reason})`);
    return {
      status: 'failure',
      poolName,
      selectedModel: null,
      finalKind: 'terminal',
      finalReason: 'terminal_failure',
      attempts,
    };
  }
}
```

- [ ] **Step 4: Run the lb tests to verify they pass**

Run: `npx vitest run tests/lb.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the orchestrator refactor**

```bash
git add src/lb.js tests/lb.test.js
git commit -m "refactor(lb): classify attempts before failover"
```

### Task 4: Wire the new failover surface into the CLI and user docs

**Files:**
- Modify: `src/index.js`
- Modify: `tests/index.test.js`
- Modify: `README.md`
- Modify: `README.zh.md`

- [ ] **Step 1: Write the failing CLI and documentation tests**

Add to `tests/index.test.js`:

```js
const {
  stripAnsi, truncStr, modelMeta, modelWarning, modelItem,
  ANSI, GLOBAL_CONFIG_DIR, getModelsPath, parseArgs,
  normalizeProxyUrl, resolveProxy, applyProxy,
  resolveLbFailoverMode, mapLbResultToExitCode, formatLbFailureSummary,
} = mod;
```

```js
  it('parses --failover for lb runs', () => {
    const r = parseArgs(['lb', 'my-pool', '--failover', 'always', '--', '-p', 'hello']);
    expect(r.opts.failover).toBe('always');
    expect(r.opts.passthrough).toEqual(['-p', 'hello']);
  });

  it('parses --no-failover for lb runs', () => {
    const r = parseArgs(['lb', 'my-pool', '--no-failover', '--', '-p', 'hello']);
    expect(r.opts.noFailover).toBe(true);
  });
```

```js
describe('resolveLbFailoverMode', () => {
  it('defaults to safe-only', () => {
    expect(resolveLbFailoverMode({})).toBe('safe-only');
  });

  it('maps --no-failover to off', () => {
    expect(resolveLbFailoverMode({ noFailover: true })).toBe('off');
  });

  it('accepts explicit modes', () => {
    expect(resolveLbFailoverMode({ failover: 'always' })).toBe('always');
  });

  it('rejects invalid values', () => {
    expect(() => resolveLbFailoverMode({ failover: 'bogus' })).toThrow(/Invalid --failover value/);
  });

  it('rejects conflicting flags', () => {
    expect(() => resolveLbFailoverMode({ noFailover: true, failover: 'always' })).toThrow(/cannot be combined/i);
  });
});

describe('lb CLI wiring', () => {
  it('passes resolved failover mode into cmdLbRun callers', () => {
    const r = parseArgs(['lb', 'my-pool', '--failover', 'always', '--', '-p', 'hello']);
    expect(resolveLbFailoverMode(r.opts)).toBe('always');
  });
});

describe('mapLbResultToExitCode', () => {
  it('returns 0 for success', () => {
    expect(mapLbResultToExitCode({ finalKind: 'success', finalReason: 'success' })).toBe(0);
  });

  it('returns 130 for user interruption', () => {
    expect(mapLbResultToExitCode({ finalKind: 'terminal', finalReason: 'user_interrupted' })).toBe(130);
  });

  it('returns 1 for other failures', () => {
    expect(mapLbResultToExitCode({ finalKind: 'exhausted', finalReason: 'recoverable_exhausted' })).toBe(1);
  });
});

describe('formatLbFailureSummary', () => {
  it('renders attempt lines for terminal failures', () => {
    const summary = formatLbFailureSummary({
      finalKind: 'terminal',
      finalReason: 'terminal_failure',
      attempts: [
        { modelName: 'alpha', kind: 'terminal', reason: 'unclassified', exitCode: 1, signal: null },
      ],
    });
    expect(summary).toContain('alpha');
    expect(summary).toContain('terminal');
    expect(summary).toContain('unclassified');
  });

  it('renders exhausted summaries with all attempts', () => {
    const summary = formatLbFailureSummary({
      finalKind: 'exhausted',
      finalReason: 'recoverable_exhausted',
      attempts: [
        { modelName: 'alpha', kind: 'failover-safe', reason: 'rate_limited', exitCode: 1, signal: null },
        { modelName: 'beta', kind: 'failover-safe', reason: 'rate_limited', exitCode: 1, signal: null },
      ],
    });
    expect(summary).toContain('recoverable_exhausted');
    expect(summary).toContain('alpha');
    expect(summary).toContain('beta');
  });
});
```

- [ ] **Step 2: Run the CLI tests to verify they fail**

Run: `npx vitest run tests/index.test.js`

Expected: FAIL because `parseArgs()` does not parse the new flags, and `resolveLbFailoverMode` / `mapLbResultToExitCode` do not exist.

- [ ] **Step 3: Implement CLI parsing, result handling, and help text**

Update the option parser in `src/index.js`:

```js
    } else if (arg === '--failover' && argv[i + 1]) {
      opts.failover = argv[++i];
    } else if (arg === '--no-failover') {
      opts.noFailover = true;
```

Add and export two small helpers:

```js
function resolveLbFailoverMode(opts) {
  if (opts.noFailover && opts.failover && opts.failover !== 'off') {
    throw new Error('--no-failover cannot be combined with --failover unless the mode is "off"');
  }

  if (opts.noFailover) return 'off';
  if (!opts.failover) return 'safe-only';

  if (!['off', 'safe-only', 'always'].includes(opts.failover)) {
    throw new Error(`Invalid --failover value: ${opts.failover}`);
  }

  return opts.failover;
}

function mapLbResultToExitCode(result) {
  if (result.finalKind === 'success') return 0;
  if (result.finalKind === 'terminal' && result.finalReason === 'user_interrupted') return 130;
  return 1;
}

function formatLbFailureSummary(result) {
  return [
    `lb result: ${result.finalKind} (${result.finalReason})`,
    ...result.attempts.map(attempt =>
      `- ${attempt.modelName}: ${attempt.kind} (${attempt.reason}) exit=${attempt.exitCode ?? 'null'} signal=${attempt.signal ?? 'null'}`
    ),
  ].join('\n');
}
```

Update `cmdLbRun()`:

```js
async function cmdLbRun(poolName, passthrough, cwd, opts = {}) {
  const modelsPath = getModelsPath();
  try {
    const failover = resolveLbFailoverMode(opts);
    const result = await runWithFailover(modelsPath, poolName, passthrough, { cwd, failover });
    if (result.finalKind !== 'success') {
      console.error(ANSI.red(formatLbFailureSummary(result)));
    }
    process.exit(mapLbResultToExitCode(result));
  } catch (err) {
    console.error(ANSI.red(err.message));
    process.exit(1);
  }
}
```

Update the `main()` call site so the parsed options actually reach `cmdLbRun()`:

```js
      cmdLbRun(lbCmd, opts.passthrough || args, opts.cwd, opts);
```

Update the help text examples:

```js
  lb <pool> [--failover <mode> | --no-failover] -- <args> Run instruction via pool
```

```js
  fleet lb my-pool --failover safe-only -- -p "hello"
  fleet lb my-pool --no-failover -- -p "hello"
```

Update the export list:

```js
  parseArgs, main, ANSI, GLOBAL_CONFIG_DIR,
  resolveLbFailoverMode, mapLbResultToExitCode, formatLbFailureSummary,
```

- [ ] **Step 4: Update the README files for the new public behavior**

Update `README.md` load balancer section so it says:

```md
| `fleet lb <pool> [--failover <mode> | --no-failover] -- <args>` | — | Run via pool with round-robin and classified failover |
```

```md
`fleet lb` defaults to `safe-only` failover: it only switches models when the failure is explicitly classified as recoverable. Use `--no-failover` (alias for `--failover off`) to disable retries, or `--failover always` to keep the legacy aggressive behavior.
```

```md
The pool state records the last **successful** model in `state.lastIndex`; failed attempts do not advance the persisted pointer.
```

Apply the same meaning in `README.zh.md`:

```md
`fleet lb` 默认使用 `safe-only`：只有当失败被明确分类为“切换模型可能恢复”时才会继续故障转移。使用 `--no-failover`（等价于 `--failover off`）可以关闭重试，使用 `--failover always` 可以保留旧的激进切换行为。
```

```md
`state.lastIndex` 记录的是上一次**成功路由**到的模型，失败尝试不会推进持久化指针。
```

- [ ] **Step 5: Run the CLI tests and the full test suite**

Run: `npx vitest run tests/index.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS — all existing Vitest suites green.

- [ ] **Step 6: Commit the CLI and docs integration**

```bash
git add src/index.js tests/index.test.js README.md README.zh.md
git commit -m "feat(lb): add explicit failover policy controls"
```

## Self-Review

1. **Spec coverage:**  
   - failover policies (`off`, `safe-only`, `always`) are implemented in Task 3 and wired in Task 4  
   - adapter-owned classification is implemented in Task 2  
   - process-result collection, startup timeout, stderr snippet capture, startup transient classification, structured results, and attempt logging are implemented in Tasks 2 and 3  
   - CLI exit mapping and help/doc updates are implemented in Task 4

2. **Placeholder scan:**  
   - no `TODO`/`TBD` markers  
   - each task lists exact files, commands, and code blocks  
   - each test step names the exact command and expected failure/pass condition

3. **Type consistency:**  
   - helper names are consistent across tasks: `pickNext`, `classifyAttempt`, `collectProcessResult`, `resolveLbFailoverMode`, `mapLbResultToExitCode`  
   - result shape uses the same `finalKind` / `finalReason` contract everywhere  
   - adapter classifier output stays `{ kind, reason }` in both tests and implementation
