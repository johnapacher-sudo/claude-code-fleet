import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('lb', () => {
  let loadPools, savePools, pickNext, addPool, deletePool, classifyAttempt, runWithFailover;
  let tmpDir, modelsPath;

  beforeEach(async () => {
    const mod = await import('../src/lb.js');
    loadPools = mod.loadPools;
    savePools = mod.savePools;
    pickNext = mod.pickNext;
    addPool = mod.addPool;
    deletePool = mod.deletePool;
    classifyAttempt = mod.classifyAttempt;
    runWithFailover = mod.runWithFailover;

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-lb-test-'));
    modelsPath = path.join(tmpDir, 'models.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('pickNext', () => {
    const models = [
      { name: 'alpha', model: 'model-a' },
      { name: 'beta', model: 'model-b' },
      { name: 'gamma', model: 'model-c' },
    ];

    it('starts at index 0 when lastIndex is -1', () => {
      const pool = { name: 'p1', models: ['alpha', 'beta'], strategy: 'round-robin', state: { lastIndex: -1 } };
      const result = pickNext(pool, models);
      expect(result.index).toBe(0);
      expect(result.entry.name).toBe('alpha');
    });

    it('advances to next index', () => {
      const pool = { name: 'p1', models: ['alpha', 'beta'], strategy: 'round-robin', state: { lastIndex: 0 } };
      const result = pickNext(pool, models);
      expect(result.index).toBe(1);
      expect(result.entry.name).toBe('beta');
    });

    it('wraps around to 0 after last element', () => {
      const pool = { name: 'p1', models: ['alpha', 'beta'], strategy: 'round-robin', state: { lastIndex: 1 } };
      const result = pickNext(pool, models);
      expect(result.index).toBe(0);
      expect(result.entry.name).toBe('alpha');
    });

    it('works with a single model', () => {
      const pool = { name: 'p1', models: ['alpha'], strategy: 'round-robin', state: { lastIndex: -1 } };
      const result = pickNext(pool, models);
      expect(result.index).toBe(0);
      expect(result.entry.name).toBe('alpha');

      const result2 = pickNext(pool, models);
      expect(result2.index).toBe(0);
    });

    it('skips attempted pool indices', () => {
      const pool = { name: 'p1', models: ['alpha', 'beta', 'gamma'], strategy: 'round-robin', state: { lastIndex: -1 } };
      const attempted = new Set([0, 1]);
      const result = pickNext(pool, models, attempted);
      expect(result.index).toBe(2);
      expect(result.entry.name).toBe('gamma');
    });

    it('returns null when all pool indices were attempted', () => {
      const pool = { name: 'p1', models: ['alpha', 'beta'], strategy: 'round-robin', state: { lastIndex: -1 } };
      expect(pickNext(pool, models, new Set([0, 1]))).toBeNull();
    });

    it('throws when model name not found in models array', () => {
      const pool = { name: 'p1', models: ['nonexistent'], strategy: 'round-robin', state: { lastIndex: -1 } };
      expect(() => pickNext(pool, models)).toThrow();
    });
  });

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

  describe('loadPools', () => {
    it('returns empty array when file does not exist', () => {
      expect(loadPools(path.join(tmpDir, 'no-such.json'))).toEqual([]);
    });

    it('returns empty array when file has no pools key', () => {
      fs.writeFileSync(modelsPath, JSON.stringify({ models: [] }));
      expect(loadPools(modelsPath)).toEqual([]);
    });

    it('returns pools array from file', () => {
      const pools = [{ name: 'p1', models: ['a'], strategy: 'round-robin', state: { lastIndex: -1 } }];
      fs.writeFileSync(modelsPath, JSON.stringify({ models: [], pools }));
      expect(loadPools(modelsPath)).toEqual(pools);
    });

    it('returns empty array on invalid JSON', () => {
      fs.writeFileSync(modelsPath, 'not json');
      expect(loadPools(modelsPath)).toEqual([]);
    });
  });

  describe('savePools', () => {
    it('writes pools array into file preserving other keys', () => {
      const original = { models: [{ name: 'm1' }], pools: [] };
      fs.writeFileSync(modelsPath, JSON.stringify(original));

      const newPools = [{ name: 'p1', models: ['m1'], strategy: 'round-robin', state: { lastIndex: -1 } }];
      savePools(modelsPath, newPools);

      const written = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
      expect(written.pools).toEqual(newPools);
      expect(written.models).toEqual([{ name: 'm1' }]);
    });

    it('creates directory if needed', () => {
      const nestedPath = path.join(tmpDir, 'sub', 'dir', 'models.json');
      const pools = [{ name: 'p1', models: ['m1'], strategy: 'round-robin', state: { lastIndex: -1 } }];
      savePools(nestedPath, pools);

      const written = JSON.parse(fs.readFileSync(nestedPath, 'utf-8'));
      expect(written.pools).toEqual(pools);
    });

    it('round-trips through loadPools', () => {
      const pools = [
        { name: 'p1', models: ['a', 'b'], strategy: 'round-robin', state: { lastIndex: 1 } },
      ];
      savePools(modelsPath, pools);
      expect(loadPools(modelsPath)).toEqual(pools);
    });
  });

  describe('addPool', () => {
    const models = [
      { name: 'alpha', model: 'model-a' },
      { name: 'beta', model: 'model-b' },
    ];

    it('creates a new pool and returns new pools array', () => {
      const pools = [];
      const result = addPool(pools, models, 'my-pool', ['alpha', 'beta']);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('my-pool');
      expect(result[0].models).toEqual(['alpha', 'beta']);
      expect(result[0].strategy).toBe('round-robin');
      expect(result[0].state.lastIndex).toBe(-1);
    });

    it('does not mutate the original pools array', () => {
      const pools = [];
      addPool(pools, models, 'my-pool', ['alpha']);
      expect(pools).toHaveLength(0);
    });

    it('rejects duplicate pool name', () => {
      const pools = [{ name: 'existing', models: ['alpha'], strategy: 'round-robin', state: { lastIndex: -1 } }];
      expect(() => addPool(pools, models, 'existing', ['beta'])).toThrow(/already exists/i);
    });

    it('rejects unknown model name', () => {
      expect(() => addPool([], models, 'p1', ['unknown'])).toThrow(/not found/i);
    });

    it('rejects empty name', () => {
      expect(() => addPool([], models, '', ['alpha'])).toThrow(/name.*required/i);
    });

    it('rejects empty model list', () => {
      expect(() => addPool([], models, 'p1', [])).toThrow(/at least one model/i);
    });

    it('rejects mixed tool types in a pool', () => {
      const mixed = [
        { name: 'alpha', tool: 'claude', model: 'model-a' },
        { name: 'beta', tool: 'codex', model: 'model-b' },
      ];
      expect(() => addPool([], mixed, 'p1', ['alpha', 'beta'])).toThrow(/same tool/i);
    });
  });

  describe('deletePool', () => {
    it('removes pool by name and returns new array', () => {
      const pools = [
        { name: 'keep', models: ['a'], strategy: 'round-robin', state: { lastIndex: -1 } },
        { name: 'remove', models: ['b'], strategy: 'round-robin', state: { lastIndex: -1 } },
      ];
      const result = deletePool(pools, 'remove');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('keep');
    });

    it('does not mutate original array', () => {
      const pools = [
        { name: 'keep', models: ['a'], strategy: 'round-robin', state: { lastIndex: -1 } },
        { name: 'remove', models: ['b'], strategy: 'round-robin', state: { lastIndex: -1 } },
      ];
      deletePool(pools, 'remove');
      expect(pools).toHaveLength(2);
    });

    it('is a no-op when name not found', () => {
      const pools = [
        { name: 'keep', models: ['a'], strategy: 'round-robin', state: { lastIndex: -1 } },
      ];
      const result = deletePool(pools, 'nonexistent');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('keep');
    });
  });

  describe('runWithFailover', () => {
    const models = [
      { name: 'alpha', tool: 'claude', model: 'model-a', apiKey: 'key-a' },
      { name: 'beta', tool: 'claude', model: 'model-b', apiKey: 'key-b' },
    ];

    function writeConfig(modelsPathOverride, poolOverrides = {}) {
      const pool = {
        name: 'test-pool',
        models: ['alpha', 'beta'],
        strategy: 'round-robin',
        state: { lastIndex: -1 },
        ...poolOverrides,
      };
      fs.writeFileSync(modelsPathOverride, JSON.stringify({ models, pools: [pool] }));
    }

    function makeFakeChild({
      code = null,
      signal = null,
      stderrChunks = [],
      stdoutChunks = [],
      error = null,
      exitDelay = 10,
    } = {}) {
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

    function createRegistry(classifyFailure = () => ({ kind: 'terminal', reason: 'unclassified' })) {
      return {
        get: () => ({
          binary: 'claude',
          displayName: 'Claude Code',
          isInstalled: () => true,
          buildArgs: entry => ['--model', entry.model],
          buildEnv: (_entry, env) => env,
          classifyFailure,
        }),
      };
    }

    it('returns structured success result and persists lastIndex only on success', async () => {
      writeConfig(modelsPath);
      const spawned = [];
      const mockSpawn = (cmd, args, opts) => {
        spawned.push({ cmd, args, opts });
        return makeFakeChild({ code: 0 });
      };

      const result = await runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
        spawn: mockSpawn,
        registry: createRegistry(),
      });

      expect(result.finalKind).toBe('success');
      expect(result.finalReason).toBe('success');
      expect(result.attempts).toHaveLength(1);
      expect(spawned[0].args).toEqual(expect.arrayContaining(['-p', 'hello']));
      expect(spawned[0].opts.env).toBeDefined();
      expect(spawned[0].opts.stdio).toEqual(['inherit', 'pipe', 'pipe']);

      const written = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
      expect(written.pools[0].state.lastIndex).toBe(0);
    });

    it('sets proxy env vars when model has proxy', async () => {
      const proxyModels = [
        { name: 'alpha', tool: 'claude', model: 'model-a', apiKey: 'key-a', proxy: 'proxy.example.com:8080' },
      ];
      const pool = { name: 'test-pool', models: ['alpha'], strategy: 'round-robin', state: { lastIndex: -1 } };
      fs.writeFileSync(modelsPath, JSON.stringify({ models: proxyModels, pools: [pool] }));
      const spawned = [];

      await runWithFailover(modelsPath, 'test-pool', [], {
        spawn: (cmd, args, opts) => {
          spawned.push({ cmd, args, opts });
          return makeFakeChild({ code: 0 });
        },
        registry: createRegistry(),
      });

      expect(spawned[0].opts.env.HTTP_PROXY).toBe('http://proxy.example.com:8080');
      expect(spawned[0].opts.env.HTTPS_PROXY).toBe('http://proxy.example.com:8080');
    });

    it('does not fail over on unclassified non-zero exit under safe-only', async () => {
      writeConfig(modelsPath);
      let callCount = 0;
      const result = await runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
        spawn: () => {
          callCount++;
          return makeFakeChild({ code: 1, stderrChunks: ['validation failed'] });
        },
        registry: createRegistry(),
      });

      expect(callCount).toBe(1);
      expect(result.finalKind).toBe('terminal');
      expect(result.finalReason).toBe('terminal_failure');
      expect(result.attempts).toHaveLength(1);
      const written = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
      expect(written.pools[0].state.lastIndex).toBe(-1);
    });

    it('fails over on startup timeout before any output', async () => {
      writeConfig(modelsPath);
      let callCount = 0;
      const result = await runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
        spawn: () => {
          callCount++;
          return callCount === 1
            ? makeFakeChild({ code: null, signal: null, exitDelay: 50 })
            : makeFakeChild({ code: 0, exitDelay: 1 });
        },
        startupTimeoutMs: 5,
        registry: createRegistry(),
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      });

      expect(callCount).toBe(2);
      expect(result.attempts[0].reason).toBe('startup_timeout');
      expect(result.finalKind).toBe('success');
    });

    it('cancels startup timeout when stdout output arrives', async () => {
      writeConfig(modelsPath);
      const result = await runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
        spawn: () => makeFakeChild({ code: 0, stdoutChunks: ['started'], exitDelay: 1 }),
        startupTimeoutMs: 5,
        registry: createRegistry(),
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      });

      expect(result.finalKind).toBe('success');
    });

    it('failovers on recoverable adapter classification under safe-only', async () => {
      writeConfig(modelsPath);
      let callCount = 0;
      const result = await runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
        spawn: () => {
          callCount++;
          return callCount === 1
            ? makeFakeChild({ code: 1, stderrChunks: ['rate limit exceeded'] })
            : makeFakeChild({ code: 0 });
        },
        registry: createRegistry(attempt => (
          /rate limit/i.test(attempt.stderrSnippet)
            ? { kind: 'failover-safe', reason: 'rate_limited' }
            : { kind: 'terminal', reason: 'unclassified' }
        )),
      });

      expect(callCount).toBe(2);
      expect(result.finalKind).toBe('success');
      expect(result.attempts).toHaveLength(2);
      expect(result.attempts[0].reason).toBe('rate_limited');
    });

    it('stops after one attempt when failover policy is off', async () => {
      writeConfig(modelsPath);
      let callCount = 0;
      const result = await runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
        spawn: () => {
          callCount++;
          return makeFakeChild({ code: 1, stderrChunks: ['rate limit exceeded'] });
        },
        failover: 'off',
        registry: createRegistry(() => ({ kind: 'failover-safe', reason: 'rate_limited' })),
      });

      expect(callCount).toBe(1);
      expect(result.finalKind).toBe('policy_stopped');
      expect(result.finalReason).toBe('policy_off');
    });

    it('defaults to one retry even when more pool members are available', async () => {
      fs.writeFileSync(modelsPath, JSON.stringify({
        models: [
          { name: 'alpha', tool: 'claude', model: 'model-a' },
          { name: 'beta', tool: 'claude', model: 'model-b' },
          { name: 'gamma', tool: 'claude', model: 'model-c' },
        ],
        pools: [
          { name: 'test-pool', models: ['alpha', 'beta', 'gamma'], strategy: 'round-robin', state: { lastIndex: -1 } },
        ],
      }, null, 2));

      let callCount = 0;
      const result = await runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
        spawn: () => {
          callCount++;
          return makeFakeChild({ code: 1, stderrChunks: ['rate limit exceeded'] });
        },
        registry: createRegistry(() => ({ kind: 'failover-safe', reason: 'rate_limited' })),
      });

      expect(callCount).toBe(2);
      expect(result.finalKind).toBe('policy_stopped');
      expect(result.finalReason).toBe('retry_limit');
      expect(result.attempts).toHaveLength(2);
    });

    it('allows configuring more retries explicitly', async () => {
      fs.writeFileSync(modelsPath, JSON.stringify({
        models: [
          { name: 'alpha', tool: 'claude', model: 'model-a' },
          { name: 'beta', tool: 'claude', model: 'model-b' },
          { name: 'gamma', tool: 'claude', model: 'model-c' },
        ],
        pools: [
          { name: 'test-pool', models: ['alpha', 'beta', 'gamma'], strategy: 'round-robin', state: { lastIndex: -1 } },
        ],
      }, null, 2));

      let callCount = 0;
      const result = await runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
        spawn: () => {
          callCount++;
          return callCount < 3
            ? makeFakeChild({ code: 1, stderrChunks: ['rate limit exceeded'] })
            : makeFakeChild({ code: 0 });
        },
        maxRetries: 2,
        registry: createRegistry(() => ({ kind: 'failover-safe', reason: 'rate_limited' })),
      });

      expect(callCount).toBe(3);
      expect(result.finalKind).toBe('success');
      expect(result.attempts).toHaveLength(3);
    });

    it('maps SIGINT to terminal user interruption', async () => {
      writeConfig(modelsPath);
      const result = await runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
        spawn: () => makeFakeChild({ signal: 'SIGINT' }),
        registry: createRegistry(),
      });

      expect(result.finalKind).toBe('terminal');
      expect(result.finalReason).toBe('user_interrupted');
    });

    it('keeps failing over in always mode until success', async () => {
      writeConfig(modelsPath);
      let callCount = 0;
      const result = await runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
        spawn: () => {
          callCount++;
          return callCount === 1
            ? makeFakeChild({ code: 1, stderrChunks: ['invalid request'] })
            : makeFakeChild({ code: 0 });
        },
        failover: 'always',
        registry: createRegistry(),
      });

      expect(callCount).toBe(2);
      expect(result.finalKind).toBe('success');
    });

    it('returns exhausted summary after recoverable failures across the whole pool', async () => {
      writeConfig(modelsPath);
      const logs = [];
      const result = await runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
        spawn: () => makeFakeChild({ code: 1, stderrChunks: ['rate limit exceeded'] }),
        log: line => logs.push(line),
        registry: createRegistry(() => ({ kind: 'failover-safe', reason: 'rate_limited' })),
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
          registry: createRegistry(),
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
          registry: createRegistry(),
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
  });
});
