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

module.exports = { loadPools, savePools, pickNext, addPool, deletePool };
