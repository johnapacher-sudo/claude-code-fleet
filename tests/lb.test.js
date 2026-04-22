import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('lb', () => {
  let loadPools, savePools, pickNext, addPool, deletePool, runWithFailover;
  let tmpDir, modelsPath;

  beforeEach(async () => {
    const mod = await import('../src/lb.js');
    loadPools = mod.loadPools;
    savePools = mod.savePools;
    pickNext = mod.pickNext;
    addPool = mod.addPool;
    deletePool = mod.deletePool;
    runWithFailover = mod.runWithFailover;

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-lb-test-'));
    modelsPath = path.join(tmpDir, 'models.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── pickNext ─────────────────────────────────────────────────────────────

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

    it('throws when model name not found in models array', () => {
      const pool = { name: 'p1', models: ['nonexistent'], strategy: 'round-robin', state: { lastIndex: -1 } };
      expect(() => pickNext(pool, models)).toThrow();
    });
  });

  // ─── loadPools / savePools ────────────────────────────────────────────────

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

  // ─── addPool ──────────────────────────────────────────────────────────────

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
  });

  // ─── deletePool ───────────────────────────────────────────────────────────

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

  // ─── runWithFailover ───────────────────────────────────────────────────────

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
      fs.writeFileSync(
        modelsPathOverride,
        JSON.stringify({ models, pools: [pool] })
      );
    }

    function makeMockSpawn(exitCodes) {
      const spawned = [];
      let callIdx = 0;
      const mockSpawn = (cmd, args, opts) => {
        const code = exitCodes[callIdx] ?? 0;
        callIdx++;
        spawned.push({ cmd, args, opts });
        return {
          on: (evt, cb) => {
            if (evt === 'exit') setTimeout(() => cb(code), 10);
          },
        };
      };
      return { spawned, mockSpawn };
    }

    it('picks next model and spawns tool', async () => {
      writeConfig(modelsPath);
      const { spawned, mockSpawn } = makeMockSpawn([0]);

      await runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
        spawn: mockSpawn,
      });

      expect(spawned).toHaveLength(1);
      // passthrough args should be appended after adapter args
      expect(spawned[0].args).toEqual(
        expect.arrayContaining(['-p', 'hello'])
      );
    });

    it('failovers on non-zero exit', async () => {
      writeConfig(modelsPath);
      const { spawned, mockSpawn } = makeMockSpawn([1, 0]);

      await runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
        spawn: mockSpawn,
      });

      expect(spawned).toHaveLength(2);
    });

    it('throws when all models fail', async () => {
      writeConfig(modelsPath);
      const { mockSpawn } = makeMockSpawn([1, 1]);

      await expect(
        runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
          spawn: mockSpawn,
        })
      ).rejects.toThrow(/All models failed/);
    });

    it('updates state.lastIndex on success', async () => {
      writeConfig(modelsPath);
      const { mockSpawn } = makeMockSpawn([0]);

      await runWithFailover(modelsPath, 'test-pool', ['-p', 'hello'], {
        spawn: mockSpawn,
      });

      const written = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
      expect(written.pools[0].state.lastIndex).toBe(0);
    });
  });
});
