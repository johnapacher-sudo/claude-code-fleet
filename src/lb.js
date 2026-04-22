const fs = require('fs');
const path = require('path');

/**
 * Read pools array from a JSON config file.
 * Returns [] if file is missing, has no pools key, or cannot be parsed.
 */
function loadPools(modelsPath) {
  try {
    if (!fs.existsSync(modelsPath)) return [];
    const raw = fs.readFileSync(modelsPath, 'utf-8');
    const data = JSON.parse(raw);
    if (!data.pools || !Array.isArray(data.pools)) return [];
    return data.pools;
  } catch {
    return [];
  }
}

/**
 * Write pools array into a JSON config file, preserving other keys.
 * Creates parent directories if needed.
 */
function savePools(modelsPath, pools) {
  let data = {};
  try {
    if (fs.existsSync(modelsPath)) {
      const raw = fs.readFileSync(modelsPath, 'utf-8');
      data = JSON.parse(raw);
    }
  } catch {
    // start fresh if file is corrupt
  }

  const updated = { ...data, pools };
  const dir = path.dirname(modelsPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(modelsPath, JSON.stringify(updated, null, 2) + '\n');
}

/**
 * Round-robin selection from a pool's model list.
 * Returns { entry, index } where entry is the resolved model profile.
 * Throws if the model name is not found in the models array.
 */
function pickNext(pool, models) {
  const nextIndex = (pool.state.lastIndex + 1) % pool.models.length;
  const modelName = pool.models[nextIndex];
  const entry = models.find(m => m.name === modelName);
  if (!entry) {
    throw new Error(`Model "${modelName}" not found in models array`);
  }
  return { entry, index: nextIndex };
}

/**
 * Pure function: add a new pool to the pools array.
 * Validates inputs and returns a new array with the pool appended.
 */
function addPool(pools, models, name, modelNames) {
  if (!name) {
    throw new Error('Pool name is required');
  }
  if (!modelNames || modelNames.length === 0) {
    throw new Error('Pool must contain at least one model');
  }
  if (pools.some(p => p.name === name)) {
    throw new Error(`Pool "${name}" already exists`);
  }
  const knownNames = new Set(models.map(m => m.name));
  for (const mn of modelNames) {
    if (!knownNames.has(mn)) {
      throw new Error(`Model "${mn}" not found in models`);
    }
  }

  const newPool = {
    name,
    models: [...modelNames],
    strategy: 'round-robin',
    state: { lastIndex: -1 },
  };
  return [...pools, newPool];
}

/**
 * Pure function: remove a pool by name.
 * Returns a new array without the named pool.
 * No error if the pool is not found.
 */
function deletePool(pools, name) {
  return pools.filter(p => p.name !== name);
}

/**
 * Run a tool with round-robin failover across models in a pool.
 * Spawns the tool process, retries with next model on failure.
 * Updates pool state on success; throws if all models exhausted.
 */
async function runWithFailover(modelsPath, poolName, passthrough, deps = {}) {
  const spawn = deps.spawn || require('child_process').spawn;
  const cwd = deps.cwd || process.cwd();

  const raw = fs.readFileSync(modelsPath, 'utf-8');
  const data = JSON.parse(raw);
  const models = Array.isArray(data.models) ? data.models : [];
  const pools = Array.isArray(data.pools) ? data.pools : [];
  const pool = pools.find(p => p.name === poolName);

  if (!pool) {
    const names = pools.map(p => p.name);
    throw new Error(
      `Pool "${poolName}" not found. Available pools: ${names.length > 0 ? names.join(', ') : '(none)'}`
    );
  }

  if (!pool.models || pool.models.length === 0) {
    throw new Error(`Pool "${poolName}" has no models`);
  }

  const attempted = new Set();
  const { registry } = require('./adapters');

  while (attempted.size < pool.models.length) {
    const { entry, index } = pickNext(pool, models);
    attempted.add(index);

    const adapter = registry.get(entry.tool || 'claude');
    const adapterArgs = adapter.buildArgs(entry);
    const allArgs = [...adapterArgs, ...passthrough];

    const child = spawn(adapter.binary, allArgs, { cwd, stdio: 'inherit' });

    const code = await new Promise(resolve => {
      child.on('exit', resolve);
    });

    if (code === 0) {
      pool.state.lastIndex = index;
      const updatedPools = pools.map(p =>
        p.name === poolName ? { ...p, state: { ...p.state, lastIndex: index } } : p
      );
      const updated = { ...data, pools: updatedPools };
      fs.writeFileSync(modelsPath, JSON.stringify(updated, null, 2) + '\n');
      return;
    }

    pool.state.lastIndex = index;
  }

  throw new Error(`All models failed in pool "${poolName}"`);
}

module.exports = { loadPools, savePools, pickNext, addPool, deletePool, runWithFailover };
