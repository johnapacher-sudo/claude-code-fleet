const fs = require('fs');
const path = require('path');

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
  const resolved = [];
  for (const mn of modelNames) {
    if (!knownNames.has(mn)) {
      throw new Error(`Model "${mn}" not found in models`);
    }
    resolved.push(models.find(m => m.name === mn));
  }

  const tools = new Set(resolved.map(m => m.tool || 'claude'));
  if (tools.size > 1) {
    throw new Error(`All models in a pool must use the same tool. Found: ${[...tools].join(', ')}`);
  }

  const newPool = {
    name,
    models: [...modelNames],
    strategy: 'round-robin',
    state: { lastIndex: -1 },
  };
  return [...pools, newPool];
}

function deletePool(pools, name) {
  return pools.filter(p => p.name !== name);
}

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
  startupTimeoutMs = 10000,
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
    let resolved = false;

    const finish = result => {
      if (resolved) return;
      resolved = true;
      clearTimeout(startupTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve(result);
    };

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
      finish({
        spawnError: error,
        exitCode: null,
        signal: null,
        timedOut,
        timeoutPhase,
        stderrSnippet: '',
      });
    });

    child.on('close', (exitCode, signal) => {
      finish({
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

function ensureUsableCwd(cwd) {
  if (!fs.existsSync(cwd)) {
    throw new Error(`Working directory not found: ${cwd}`);
  }

  let stat;
  try {
    stat = fs.statSync(cwd);
  } catch {
    throw new Error(`Working directory is not usable: ${cwd}`);
  }

  if (!stat.isDirectory()) {
    throw new Error(`Working directory is not usable: ${cwd}`);
  }
}

function buildAttemptSummary(poolName, entry, classification) {
  return `[lb:${poolName}] ${entry.name} -> ${classification.kind} (reason=${classification.reason})`;
}

async function runWithFailover(modelsPath, poolName, passthrough, deps = {}) {
  const spawn = deps.spawn || require('child_process').spawn;
  const cwd = deps.cwd || process.cwd();
  const failover = deps.failover || 'safe-only';
  const startupTimeoutMs = deps.startupTimeoutMs || 10000;
  const killGraceMs = deps.killGraceMs || 500;
  const maxRetries = deps.maxRetries ?? 1;
  const registry = deps.registry || require('./adapters').registry;
  const log = deps.log || (line => console.log(line));

  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new Error(`Invalid maxRetries value: ${maxRetries}`);
  }

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

  ensureUsableCwd(cwd);

  const attempted = new Set();
  const attempts = [];

  while (true) {
    const candidate = pickNext(pool, models, attempted);
    if (!candidate) {
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

    const { entry, index } = candidate;
    attempted.add(index);

    const adapter = registry.get(entry.tool || 'claude');
    if (!adapter) {
      throw new Error(`Unknown tool adapter: ${entry.tool || 'claude'}`);
    }
    if (typeof adapter.isInstalled === 'function' && !adapter.isInstalled()) {
      throw new Error(`Missing dependency: ${adapter.binary || entry.tool}`);
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

    log(buildAttemptSummary(poolName, entry, classification));

    if (classification.reason === 'user_interrupted') {
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
    const retriesUsed = attempts.length - 1;
    const hasRetryBudget = retriesUsed < maxRetries;

    if (failover === 'always' && hasMoreCandidates && hasRetryBudget) {
      log(`[lb:${poolName}] trying next model...`);
      continue;
    }

    if (failover === 'safe-only' && classification.kind === 'failover-safe' && hasMoreCandidates && hasRetryBudget) {
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

    if (hasMoreCandidates && !hasRetryBudget) {
      return {
        status: 'failure',
        poolName,
        selectedModel: null,
        finalKind: 'policy_stopped',
        finalReason: 'retry_limit',
        attempts,
      };
    }

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

module.exports = {
  loadPools,
  savePools,
  pickNext,
  addPool,
  deletePool,
  createRingBuffer,
  collectProcessResult,
  classifyAttempt,
  runWithFailover,
};
