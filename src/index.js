#!/usr/bin/env node

const { spawnSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const os = require('os');
const { Master } = require('./master');

// ─── Constants ───────────────────────────────────────────────────────────────

const CONFIG_FILENAME = 'fleet.config.json';
const LOCAL_CONFIG_FILENAME = 'fleet.config.local.json';
const GLOBAL_CONFIG_DIR = path.join(process.env.HOME || '~', '.config', 'claude-code-fleet');
const STATE_FILE = path.join(GLOBAL_CONFIG_DIR, 'fleet-state.json');

const ANSI = {
  bold: s => `\x1b[1m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
};

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function truncStr(s, max) {
  if (!s) return s;
  return s.length > max ? s.slice(0, max) + '...' : s;
}

function modelMeta(m) {
  const key = m.apiKey ? truncStr(m.apiKey, 12) + '...' : 'not set';
  const endpoint = truncStr(m.apiBaseUrl || 'default', 32);
  return `key: ${key} \u00B7 endpoint: ${endpoint}`;
}

function modelWarning(m) {
  const missing = [];
  if (!m.name) missing.push('Name');
  if (!m.apiKey) missing.push('API Key');
  if (!m.model) missing.push('Model ID');
  if (missing.length === 0) return undefined;
  return `incomplete: missing ${missing.join(', ')}`;
}

function modelItem(m) {
  return {
    display: `${m.name || '(unnamed)'} (${m.model || 'default'})`,
    label: m.name || '(unnamed)',
    detail: m.model || 'default',
    meta: modelMeta(m),
    warning: modelWarning(m),
    value: m.name,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf-8', stdio: 'pipe' });
  return r.status === 0;
}

// ─── Dependency checks ───────────────────────────────────────────────────────

function checkDeps() {
  if (!run('which', ['claude'])) {
    console.error(ANSI.red('Missing dependency: claude (Claude Code CLI)'));
    process.exit(1);
  }
}

// ─── Fleet state (PID tracking) ─────────────────────────────────────────────

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { instances: {} };
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return { instances: {} };
  }
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function cleanupState() {
  const state = loadState();
  let changed = false;
  for (const name of Object.keys(state.instances)) {
    const pid = state.instances[name].pid;
    if (!isProcessAlive(pid)) {
      delete state.instances[name];
      changed = true;
    }
  }
  if (changed) saveState(state);
}

// ─── Config ──────────────────────────────────────────────────────────────────

function configSearchPaths() {
  return [
    path.join(process.cwd(), LOCAL_CONFIG_FILENAME),
    path.join(process.cwd(), CONFIG_FILENAME),
    path.join(GLOBAL_CONFIG_DIR, 'config.json'),
  ];
}

function findConfigFile(cliPath) {
  if (cliPath) {
    const resolved = path.resolve(cliPath);
    if (!fs.existsSync(resolved)) {
      console.error(ANSI.red(`Config not found: ${resolved}`));
      process.exit(1);
    }
    return resolved;
  }
  for (const p of configSearchPaths()) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function loadConfig(cliPath) {
  const file = findConfigFile(cliPath);
  if (!file) {
    console.error(ANSI.red('No config file found. Searched:'));
    configSearchPaths().forEach(p => console.error(`  - ${p}`));
    console.error(`\nRun ${ANSI.bold('fleet init')} to create one, or copy fleet.config.example.json.`);
    process.exit(1);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    console.error(ANSI.red(`Invalid JSON in ${file}: ${e.message}`));
    process.exit(1);
  }

  const errors = validateConfig(raw);
  if (errors.length > 0) {
    console.error(ANSI.red(`Config errors in ${file}:`));
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }

  return { file, ...raw };
}

function validateConfig(config) {
  const errors = [];
  if (!Array.isArray(config.instances) || config.instances.length === 0) {
    errors.push('`instances` must be a non-empty array');
    return errors;
  }
  const names = new Set();
  config.instances.forEach((inst, i) => {
    const prefix = `instances[${i}]`;
    if (!inst.name || typeof inst.name !== 'string') {
      errors.push(`${prefix}: "name" is required`);
    } else if (names.has(inst.name)) {
      errors.push(`${prefix}: duplicate name "${inst.name}"`);
    } else {
      names.add(inst.name);
    }
    if (!inst.apiKey || typeof inst.apiKey !== 'string') {
      errors.push(`${prefix}: "apiKey" is required`);
    }
  });
  return errors;
}

// ─── Model profiles ──────────────────────────────────────────────────────────

function getModelsPath() {
  return path.join(GLOBAL_CONFIG_DIR, 'models.json');
}

function loadModels() {
  const p = getModelsPath();
  if (!fs.existsSync(p)) return { models: [] };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return { models: [] };
  }
}

function saveModels(data) {
  const dir = path.dirname(getModelsPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getModelsPath(), JSON.stringify(data, null, 2) + '\n');
}

// ─── Interactive helpers ─────────────────────────────────────────────────────

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function selectFromList(items, label, dangerMode = false) {
  const selectorPath = path.join(__dirname, 'components', 'selector.mjs');
  const { renderSelector } = await import(selectorPath);
  return renderSelector({
    title: label,
    items: items.map(item => ({
      label: item.label || stripAnsi(item.display),
      detail: item.detail || '',
      meta: item.meta || '',
      warning: item.warning || undefined,
      value: item.value,
    })),
    dangerMode,
  });
}

// ─── Model commands ──────────────────────────────────────────────────────────

async function cmdModelAdd() {
  const selectorPath = path.join(__dirname, 'components', 'selector.mjs');
  const inputMod = await import(selectorPath);
  const allRequired = ['Name', 'Model ID', 'API Key', 'API Base URL'];

  while (true) {
    const created = await inputMod.renderInput({
      title: 'Add a new model profile',
      fields: [
        { label: 'Name', value: '', placeholder: 'e.g. opus-prod' },
        { label: 'Model ID', value: '', placeholder: 'e.g. claude-opus-4-6' },
        { label: 'API Key', value: '', placeholder: 'sk-ant-...' },
        { label: 'API Base URL', value: '', placeholder: 'https://api.anthropic.com' },
      ],
      requiredFields: allRequired,
    });

    if (!created) return; // cancelled

    // Show confirmation
    const key = truncStr(created['API Key'], 12) + '...';
    const endpoint = truncStr(created['API Base URL'], 32);
    const confirmed = await inputMod.renderConfirm({
      title: `Add model "${created.Name}"?`,
      items: {
        label: created.Name,
        detail: created['Model ID'],
        meta: `key: ${key} \u00B7 endpoint: ${endpoint}`,
        value: created.Name,
      },
    });

    if (!confirmed) continue; // back to form

    const data = loadModels();
    if (data.models.some(m => m.name === created.Name)) {
      console.error(ANSI.red(`Model "${created.Name}" already exists.`));
      process.exit(1);
    }

    data.models.push({
      name: created.Name,
      model: created['Model ID'] || undefined,
      apiKey: created['API Key'] || undefined,
      apiBaseUrl: created['API Base URL'] || undefined,
    });
    saveModels(data);
    console.log(ANSI.green(`\n  Model "${created.Name}" added.`));
    return;
  }
}

function cmdModelList() {
  const data = loadModels();
  if (data.models.length === 0) {
    console.log(ANSI.yellow('No model profiles configured.'));
    console.log(`Run ${ANSI.bold('fleet model add')} to create one.`);
    return;
  }
  console.log(`\n\x1b[38;2;167;139;250m\x1b[1m\u2B22 Model Profiles\x1b[0m  \x1b[38;2;82;82;82m${data.models.length} configured\x1b[0m\n`);
  for (const m of data.models) {
    const key = m.apiKey ? m.apiKey.slice(0, 12) + '...' : '\x1b[38;2;248;81;81mnot set\x1b[0m';
    const endpoint = m.apiBaseUrl || '\x1b[38;2;74;222;128mdefault\x1b[0m';
    console.log(`  \x1b[38;2;167;139;250m\u2502\x1b[0m \x1b[38;2;224;224;224m\x1b[1m${m.name}\x1b[0m  \x1b[38;2;82;82;82m${m.model || 'default'}\x1b[0m`);
    console.log(`    \x1b[38;2;139;155;168mkey:\x1b[0m ${key}  \x1b[38;2;139;155;168mendpoint:\x1b[0m ${endpoint}`);
  }
}

async function cmdModelEdit() {
  const selectorPath = path.join(__dirname, 'components', 'selector.mjs');
  const inputMod = await import(selectorPath);

  selectLoop: while (true) {
    const data = loadModels();
    if (data.models.length === 0) {
      console.error(ANSI.yellow('No model profiles to edit.'));
      return;
    }

    const items = data.models.map(m => modelItem(m));
    const selected = await selectFromList(items, 'Select a model to edit');
    if (selected === null) return; // cancelled from selector

    const entry = data.models.find(m => m.name === selected);
    if (!entry) continue selectLoop; // stale data, re-show selector

    editLoop: while (true) {
      const updated = await inputMod.renderInput({
        title: `Edit "${selected || '(unnamed)'}"`,
        fields: [
          { label: 'Name', value: entry.name || '', placeholder: 'e.g. opus-prod' },
          { label: 'Model ID', value: entry.model || '', placeholder: 'e.g. claude-opus-4-6' },
          { label: 'API Key', value: entry.apiKey || '', placeholder: 'required' },
          { label: 'API Base URL', value: entry.apiBaseUrl || '', placeholder: 'https://api.anthropic.com (leave empty for default)' },
        ],
        requiredFields: ['Name', 'Model ID', 'API Key', 'API Base URL'],
      });

      if (!updated) continue selectLoop; // Esc from form → back to selector

      // Show confirmation
      const key = updated['API Key']
        ? truncStr(updated['API Key'], 12) + '...'
        : (entry.apiKey ? '(unchanged)' : 'not set');
      const endpoint = truncStr(updated['API Base URL'] || entry.apiBaseUrl || 'default', 32);
      const confirmed = await inputMod.renderConfirm({
        title: `Save changes to "${updated.Name || entry.name || '(unnamed)'}"?`,
        items: {
          label: updated.Name || entry.name || '(unnamed)',
          detail: updated['Model ID'] || entry.model || 'default',
          meta: `key: ${key} \u00B7 endpoint: ${endpoint}`,
          value: selected,
        },
      });

      if (!confirmed) continue editLoop; // n/Esc from confirm → back to form

      // Apply changes
      if (updated['Name'] !== undefined && updated['Name'] !== entry.name) {
        if (updated['Name'] && data.models.some(m => m.name === updated['Name'])) {
          console.error(ANSI.red(`Name "${updated['Name']}" already exists.`));
          process.exit(1);
        }
        entry.name = updated['Name'];
      }
      if (updated['Model ID'] !== undefined) entry.model = updated['Model ID'] || undefined;
      if (updated['API Key']) entry.apiKey = updated['API Key'];
      if (updated['API Base URL'] !== undefined) entry.apiBaseUrl = updated['API Base URL'] || undefined;

      saveModels(data);
      console.log(ANSI.green(`\n  Model "${updated.Name || selected}" updated.`));
      return;
    }
  }
}

async function cmdModelDelete() {
  const data = loadModels();
  if (data.models.length === 0) {
    console.error(ANSI.yellow('No model profiles to delete.'));
    return;
  }

  const items = data.models.map(m => modelItem(m));
  const selected = await selectFromList(items, 'Select a model to delete', true);
  if (selected === null) return; // cancelled

  const selectorPath = path.join(__dirname, 'components', 'selector.mjs');
  const confirmMod = await import(selectorPath);
  const confirmed = await confirmMod.renderConfirm({
    title: `Delete "${selected}"?`,
    items: {
      label: selected,
      detail: 'This cannot be undone',
      value: selected,
    },
    dangerMode: true,
  });

  if (!confirmed) return; // cancelled

  data.models = data.models.filter(m => m.name !== selected);
  saveModels(data);
  console.log(ANSI.green(`  Model "${selected}" deleted.`));
}

// ─── Run command ─────────────────────────────────────────────────────────────

async function cmdRun(modelName, cwd) {
  checkDeps();

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
    if (selected === null) return; // cancelled
    entry = data.models.find(m => m.name === selected);
  }

  const workDir = cwd ? path.resolve(cwd) : process.cwd();
  if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

  // Build settings override — all config through claude's own mechanism
  const settingsEnv = {};
  if (entry.apiKey) {
    settingsEnv.ANTHROPIC_AUTH_TOKEN = entry.apiKey;
    settingsEnv.ANTHROPIC_API_KEY = '';
  }
  if (entry.apiBaseUrl) settingsEnv.ANTHROPIC_BASE_URL = entry.apiBaseUrl;

  const claudeArgs = ['--dangerously-skip-permissions'];
  if (entry.model) claudeArgs.push('--model', entry.model);
  claudeArgs.push('--settings', JSON.stringify({ env: settingsEnv }));
  console.log(ANSI.dim(`\n  Launching claude with model: ${entry.model || 'default'} (${entry.name})\n`));

  const env = { ...process.env, FLEET_MODEL_NAME: entry.name };
  const child = spawn('claude', claudeArgs, {
    cwd: workDir,
    stdio: 'inherit',
    env,
  });
  child.on('exit', code => process.exit(code || 0));
}

// ─── Config init ─────────────────────────────────────────────────────────────

function cmdInit() {
  const target = path.join(process.cwd(), CONFIG_FILENAME);
  if (fs.existsSync(target)) {
    console.error(ANSI.yellow(`${CONFIG_FILENAME} already exists.`));
    process.exit(1);
  }

  const example = path.join(__dirname, '..', 'fleet.config.example.json');
  const template = fs.existsSync(example)
    ? fs.readFileSync(example, 'utf-8')
    : JSON.stringify({
        instances: [
          {
            name: 'worker-1',
            apiKey: 'your-api-key-here',
            model: 'claude-sonnet-4-6',
          },
        ],
      }, null, 2) + '\n';

  fs.writeFileSync(target, template);
  console.log(ANSI.green(`Created ${target}`));
  console.log('Edit it with your API keys and model preferences.');
}

// ─── Instance filtering ──────────────────────────────────────────────────────

function filterInstances(instances, onlyNames) {
  if (!onlyNames || onlyNames.length === 0) return instances;
  const nameSet = new Set(onlyNames);
  const filtered = instances.filter(i => nameSet.has(i.name));
  const missing = [...nameSet].filter(n => !instances.some(i => i.name === n));
  if (missing.length > 0) {
    console.error(ANSI.yellow(`Warning: unknown instances: ${missing.join(', ')}`));
  }
  if (filtered.length === 0) {
    console.error(ANSI.red('No matching instances found.'));
    process.exit(1);
  }
  return filtered;
}

// ─── Fleet commands ──────────────────────────────────────────────────────────

function cmdUp(config, onlyNames) {
  checkDeps();
  cleanupState();

  const state = loadState();
  const instances = filterInstances(config.instances, onlyNames);

  for (const inst of instances) {
    if (state.instances[inst.name] && isProcessAlive(state.instances[inst.name].pid)) {
      console.log(ANSI.yellow(`  [${inst.name}] already running (pid ${state.instances[inst.name].pid})`));
      continue;
    }

    const cwd = inst.cwd ? path.resolve(inst.cwd) : process.cwd();
    if (!fs.existsSync(cwd)) fs.mkdirSync(cwd, { recursive: true });

    const env = { ...process.env };
    if (inst.env) Object.assign(env, inst.env);

    const claudeSettingsEnv = {};
    if (inst.apiKey) {
      claudeSettingsEnv.ANTHROPIC_AUTH_TOKEN = inst.apiKey;
      claudeSettingsEnv.ANTHROPIC_API_KEY = '';
    }
    if (inst.apiBaseUrl) claudeSettingsEnv.ANTHROPIC_BASE_URL = inst.apiBaseUrl;

    const claudeArgs = ['--dangerously-skip-permissions'];
    if (inst.model) claudeArgs.push('--model', inst.model);
    if (inst.args) claudeArgs.push(...inst.args);
    if (Object.keys(claudeSettingsEnv).length > 0) {
      claudeArgs.push('--settings', JSON.stringify({ env: claudeSettingsEnv }));
    }

    console.log(claudeArgs)

    const child = spawn('claude', claudeArgs, {
      cwd,
      env,
      stdio: 'ignore',
      detached: true,
    });
    child.unref();

    state.instances[inst.name] = {
      pid: child.pid,
      model: inst.model || 'default',
      cwd,
      startedAt: new Date().toISOString(),
    };

    console.log(ANSI.green(`  [${inst.name}]`) + ` model=${ANSI.cyan(inst.model || 'default')} pid=${child.pid}`);
  }

  saveState(state);
  console.log(`\nFleet launched with ${instances.length} instance(s).`);
  console.log(ANSI.dim('  fleet ls       # List running instances'));
  console.log(ANSI.dim('  fleet down     # Stop all instances'));
}

function cmdDown() {
  cleanupState();
  const state = loadState();
  const names = Object.keys(state.instances);
  if (names.length === 0) {
    console.log(ANSI.yellow('No running instances.'));
    return;
  }

  for (const name of names) {
    const pid = state.instances[name].pid;
    try {
      process.kill(pid, 'SIGTERM');
      console.log(ANSI.green(`  [${name}] stopped (pid ${pid})`));
    } catch {
      console.log(ANSI.yellow(`  [${name}] already exited`));
    }
  }

  state.instances = {};
  saveState(state);
  console.log('\nFleet stopped.');
}

function cmdHooksInstall() {
  const { ensureHooks } = require('./master');
  ensureHooks();
  console.log(ANSI.green('Fleet hooks installed to ~/.claude/settings.json'));
}

function cmdHooksRemove() {
  const { removeHooks } = require('./master');
  removeHooks();
  console.log(ANSI.green('Fleet hooks removed from ~/.claude/settings.json'));
}

function cmdHooksStatus() {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    console.log(ANSI.yellow('No ~/.claude/settings.json found'));
    return;
  }
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {
    console.log(ANSI.red('Cannot parse ~/.claude/settings.json'));
    return;
  }

  const events = ['SessionStart', 'PostToolUse', 'Stop', 'Notification'];
  console.log(ANSI.bold('\nFleet Hooks Status:\n'));
  for (const evt of events) {
    const groups = (settings.hooks && settings.hooks[evt]) || [];
    const fleetCount = groups.filter(
      g => (g.hooks || []).some(h => h.command && h.command.includes('claude-code-fleet'))
    ).length;
    if (fleetCount > 0) {
      console.log(`  ${ANSI.green('✓')} ${evt}: ${fleetCount} fleet hook(s)`);
    } else {
      console.log(`  ${ANSI.red('✗')} ${evt}: not installed`);
    }
  }
  console.log();
}

function cmdRestart(config, onlyNames) {
  cmdDown();
  cmdUp(config, onlyNames);
}

function cmdLs() {
  cleanupState();
  const state = loadState();
  const names = Object.keys(state.instances);
  if (names.length === 0) {
    console.log(ANSI.yellow('No running instances.'));
    return;
  }

  console.log(ANSI.bold('\nRunning instances:\n'));
  for (const name of names) {
    const inst = state.instances[name];
    console.log(`  ${ANSI.green(name)}  model=${ANSI.cyan(inst.model)}  pid=${inst.pid}`);
  }
}

function cmdStatus(config) {
  console.log(`${ANSI.bold('Instance Configs:')}\n`);
  for (const inst of config.instances) {
    const cwd = inst.cwd ? path.resolve(inst.cwd) : process.cwd();
    console.log(`  ${ANSI.green(inst.name)}`);
    console.log(`    model:    ${ANSI.cyan(inst.model || 'default')}`);
    console.log(`    endpoint: ${inst.apiBaseUrl || 'https://api.anthropic.com'}`);
    console.log(`    cwd:      ${cwd}`);
    if (inst.env && Object.keys(inst.env).length > 0) {
      console.log(`    env:      ${Object.keys(inst.env).join(', ')}`);
    }
    console.log();
  }
}

// ─── Worker commands ─────────────────────────────────────────────────────────

function getWorkerStore() {
  const { WorkerTaskStore } = require('./worker-task-store');
  return new WorkerTaskStore(GLOBAL_CONFIG_DIR);
}

function cmdWorkerStart(opts) {
  const pidPath = path.join(GLOBAL_CONFIG_DIR, 'worker.pid');
  if (fs.existsSync(pidPath)) {
    const pid = parseInt(fs.readFileSync(pidPath, 'utf8'), 10);
    if (isProcessAlive(pid)) {
      console.error(ANSI.red(`Worker already running (pid ${pid})`));
      process.exit(1);
    }
    // Stale PID file — clean up
    try { fs.unlinkSync(pidPath); } catch { /* ignore */ }
  }

  const store = getWorkerStore();
  const { WorkerManager } = require('./worker-manager');
  const manager = new WorkerManager(store, {
    concurrency: opts.concurrency ?? 1,
    pollInterval: opts.pollInterval ?? 5,
    timeout: opts.timeout ?? 600,
    onTaskEvent(type, data) {
      if (type === 'taskStarted') {
        console.log(ANSI.cyan(`  [worker] started task ${data.taskId} (slot ${data.slotIdx})`));
      } else if (type === 'taskCompleted') {
        console.log(ANSI.green(`  [worker] completed task ${data.taskId} (slot ${data.slotIdx})`));
      } else if (type === 'taskFailed') {
        console.log(ANSI.red(`  [worker] failed task ${data.taskId} (slot ${data.slotIdx})`));
      }
    },
  });

  manager.start();

  const shutdown = () => {
    console.log(ANSI.yellow('\n  Shutting down worker...'));
    manager.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(ANSI.green('  Worker started'));
  console.log(ANSI.dim(`  concurrency=${opts.concurrency ?? 1} pollInterval=${opts.pollInterval ?? 5}s timeout=${opts.timeout ?? 600}s`));
  console.log(ANSI.dim('  Press Ctrl+C to stop'));
}

function cmdWorkerStop() {
  const pidPath = path.join(GLOBAL_CONFIG_DIR, 'worker.pid');
  if (!fs.existsSync(pidPath)) {
    console.log(ANSI.yellow('Worker is not running (no PID file found).'));
    return;
  }

  const pid = parseInt(fs.readFileSync(pidPath, 'utf8'), 10);
  try {
    process.kill(pid, 'SIGTERM');
    console.log(ANSI.green(`  Worker stopped (pid ${pid})`));
  } catch {
    console.log(ANSI.yellow(`  Worker process ${pid} already exited`));
    // Clean up stale PID file
    try { fs.unlinkSync(pidPath); } catch { /* ignore */ }
  }
}

function cmdWorkerAdd(args, opts) {
  const prompt = args[0];
  if (!prompt) {
    console.error(ANSI.red('Usage: fleet worker add <prompt> [--title <title>] [--model <profile>] [--priority <n>] [--cwd <path>]'));
    process.exit(1);
  }

  let modelProfile = opts.model || null;
  if (modelProfile) {
    const data = loadModels();
    if (!data.models.some(m => m.name === modelProfile)) {
      console.error(ANSI.red(`Model profile "${modelProfile}" not found.`));
      console.error(`Available: ${data.models.map(m => m.name).join(', ') || '(none)'}`);
      process.exit(1);
    }
  }

  const store = getWorkerStore();
  const task = store.addTask({
    prompt,
    title: opts.title || null,
    cwd: opts.cwd || process.cwd(),
    priority: opts.priority ?? 5,
    modelProfile,
  });

  console.log(ANSI.green('  Task added:'));
  console.log(`    id:       ${task.id}`);
  console.log(`    title:    ${task.title}`);
  console.log(`    priority: ${task.priority}`);
  if (task.modelProfile) {
    console.log(`    model:    ${task.modelProfile}`);
  }
  console.log(`    cwd:      ${task.cwd}`);
}

function cmdWorkerList(opts) {
  const store = getWorkerStore();
  let tasks = store.getActiveTasks();

  if (opts.status) {
    tasks = tasks.filter(t => t.status === opts.status);
  }

  if (tasks.length === 0) {
    console.log(ANSI.yellow('  No tasks in queue.'));
    return;
  }

  console.log(ANSI.bold('\n  Active task queue:\n'));
  for (const t of tasks) {
    const icon = t.status === 'pending' ? '\u23F3' : '\u{1F504}';
    const statusStr = t.status === 'pending' ? ANSI.yellow(t.status) : ANSI.cyan(t.status);
    console.log(`  ${icon} ${ANSI.bold(t.id)}  [${statusStr}]  pri=${t.priority}`);
    console.log(`    ${ANSI.dim(t.title)}`);
    if (t.modelProfile) {
      console.log(`    model: ${t.modelProfile}`);
    }
  }
  console.log();
}

function cmdWorkerImport(args) {
  const filePath = args[0];
  if (!filePath) {
    console.error(ANSI.red('Usage: fleet worker import <file.json>'));
    process.exit(1);
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(ANSI.red(`File not found: ${resolved}`));
    process.exit(1);
  }

  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (e) {
    console.error(ANSI.red(`Invalid JSON: ${e.message}`));
    process.exit(1);
  }

  if (!Array.isArray(entries)) {
    console.error(ANSI.red('Import file must contain a JSON array of tasks.'));
    process.exit(1);
  }

  const store = getWorkerStore();
  const models = loadModels();
  let imported = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (!entry.prompt || typeof entry.prompt !== 'string') {
      console.log(ANSI.yellow(`  Skipping entry (missing/invalid prompt): ${JSON.stringify(entry).slice(0, 80)}`));
      skipped++;
      continue;
    }
    if (entry.modelProfile) {
      if (!models.models.some(m => m.name === entry.modelProfile)) {
        console.log(ANSI.yellow(`  Skipping "${entry.prompt.slice(0, 40)}..." (unknown model profile: ${entry.modelProfile})`));
        skipped++;
        continue;
      }
    }
    store.addTask({
      prompt: entry.prompt,
      title: entry.title || null,
      cwd: entry.cwd || process.cwd(),
      priority: entry.priority ?? 5,
      modelProfile: entry.modelProfile || null,
    });
    imported++;
  }

  console.log(ANSI.green(`  Imported: ${imported} task(s)`));
  if (skipped > 0) {
    console.log(ANSI.yellow(`  Skipped: ${skipped} task(s)`));
  }
}

function cmdWorkerReport(args) {
  const date = args[0] || new Date().toISOString().slice(0, 10);
  const store = getWorkerStore();
  const archive = store.getArchive(date);

  if (!archive || !archive.tasks || archive.tasks.length === 0) {
    console.log(ANSI.yellow(`  No tasks found for ${date}.`));
    return;
  }

  console.log(ANSI.bold(`\n  Daily report for ${date}:\n`));
  for (const t of archive.tasks) {
    const statusStr = t.status === 'completed' ? ANSI.green(t.status) : ANSI.red(t.status);
    const duration = t.result && t.result.durationMs ? `${(t.result.durationMs / 1000).toFixed(1)}s` : 'N/A';
    const cost = t.result && t.result.totalCostUsd != null ? `$${t.result.totalCostUsd.toFixed(4)}` : 'N/A';
    const summary = t.result && t.result.claudeResult ? truncStr(t.result.claudeResult, 60) : '';
    console.log(`  ${statusStr}  ${ANSI.bold(t.id)}  ${duration}  ${cost}`);
    console.log(`    ${ANSI.dim(t.title)}`);
    if (summary) {
      console.log(`    ${ANSI.dim('result:')} ${summary}`);
    }
  }

  // Aggregate summary
  const s = archive.summary || {};
  console.log(ANSI.bold('\n  Summary:'));
  console.log(`    total: ${s.total || 0}  completed: ${s.completed || 0}  failed: ${s.failed || 0}`);
  if (s.totalDurationMs) {
    console.log(`    total duration: ${(s.totalDurationMs / 1000).toFixed(1)}s`);
  }
  if (s.totalCostUsd) {
    console.log(`    total cost: $${s.totalCostUsd.toFixed(4)}`);
  }
  console.log();
}

function cmdWorkerShow(args) {
  const id = args[0];
  if (!id) {
    console.error(ANSI.red('Usage: fleet worker show <task-id>'));
    process.exit(1);
  }

  const store = getWorkerStore();

  // Search active queue first, then archives
  let task = store.getById(id);
  if (!task) {
    task = store.getArchivedTask(id);
  }

  if (!task) {
    console.error(ANSI.red(`Task not found: ${id}`));
    process.exit(1);
  }

  console.log(ANSI.bold('\n  Task details:\n'));
  console.log(`    id:          ${task.id}`);
  console.log(`    title:       ${task.title}`);
  console.log(`    status:      ${task.status}`);
  console.log(`    priority:    ${task.priority}`);
  console.log(`    cwd:         ${task.cwd}`);
  if (task.modelProfile) {
    console.log(`    model:       ${task.modelProfile}`);
  }
  console.log(`    created:     ${task.createdAt}`);
  if (task.startedAt) {
    console.log(`    started:     ${task.startedAt}`);
  }
  if (task.completedAt) {
    console.log(`    completed:   ${task.completedAt}`);
  }

  console.log(`\n    ${ANSI.bold('Prompt:')}`);
  console.log(`    ${task.prompt}`);

  if (task.result) {
    console.log(`\n    ${ANSI.bold('Result:')}`);
    if (task.result.exitCode != null) {
      console.log(`    exit code: ${task.result.exitCode}`);
    }
    if (task.result.durationMs != null) {
      console.log(`    duration: ${(task.result.durationMs / 1000).toFixed(1)}s`);
    }
    if (task.result.totalCostUsd != null) {
      console.log(`    cost: $${task.result.totalCostUsd.toFixed(4)}`);
    }
    if (task.result.claudeResult) {
      console.log(`    output:`);
      console.log(task.result.claudeResult);
    }
    if (task.result.stderr) {
      console.log(`    stderr:`);
      console.log(ANSI.red(task.result.stderr));
    }
  }
  console.log();
}

// ─── Master commands ─────────────────────────────────────────────────────

async function cmdStart() {
  const { Master } = require('./master');
  const master = new Master();
  await master.start();
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const positional = [];
  const opts = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--config' && argv[i + 1]) {
      opts.config = argv[++i];
    } else if (arg === '--only' && argv[i + 1]) {
      opts.only = argv[++i].split(',');
    } else if (arg === '--model' && argv[i + 1]) {
      opts.model = argv[++i];
    } else if (arg === '--cwd' && argv[i + 1]) {
      opts.cwd = argv[++i];
    } else if (arg === '--priority' && argv[i + 1]) {
      opts.priority = parseInt(argv[++i], 10);
    } else if (arg === '--concurrency' && argv[i + 1]) {
      opts.concurrency = parseInt(argv[++i], 10);
    } else if (arg === '--poll-interval' && argv[i + 1]) {
      opts.pollInterval = parseInt(argv[++i], 10);
    } else if (arg === '--timeout' && argv[i + 1]) {
      opts.timeout = parseInt(argv[++i], 10);
    } else if (arg === '--status' && argv[i + 1]) {
      opts.status = argv[++i];
    } else if (arg === '--title' && argv[i + 1]) {
      opts.title = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else {
      positional.push(arg);
    }
    i++;
  }
  return { command: positional[0] || 'run', subcommand: positional[1], args: positional.slice(2), opts };
}

function printHelp() {
  console.log(`${ANSI.bold('Claude Code Fleet')} — Observe multiple Claude Code processes

${ANSI.bold('Usage:')}
  fleet [command] [options]

${ANSI.bold('Commands:')}
  run                 Start Claude Code with a model profile
  start               Start fleet observer (TUI dashboard)
  hooks install       Install fleet hooks to ~/.claude/settings.json
  hooks remove        Remove fleet hooks from ~/.claude/settings.json
  hooks status        Show current hook installation status
  model add           Add a new model profile
  model list          List all model profiles
  model edit          Edit a model profile (interactive)
  model delete        Delete a model profile (interactive)
  up                  Start instances from config (background)
  down                Stop all background instances
  restart             Restart instances
  ls                  List running instances
  status              Show instance configuration details
  init                Create a fleet.config.json from template

${ANSI.bold('Worker Commands:')}
  worker start        Start auto-worker daemon
  worker stop         Stop auto-worker daemon
  worker add <prompt> Add a task to the queue
  worker list         View active task queue
  worker import <file>Import tasks from JSON file
  worker report [date]View daily completion report
  worker show <id>    Show full task details

${ANSI.bold('Options:')}
  --config <path>   Use specific config file
  --only <names>    Comma-separated instance names to target
  --model <name>    Model profile name (for run command)
  --cwd <path>      Working directory (for run command)
  -h, --help        Show this help

${ANSI.bold('Examples:')}
  fleet start                       # Start observer dashboard
  fleet run --model opus-prod       # Start Claude Code with a model profile
  fleet hooks status                # Check hook installation status
  fleet model add                   # Add a model profile interactively
  fleet up                          # Start all instances (background)
`);
}

function main() {
  const { command, subcommand, args, opts } = parseArgs(process.argv.slice(2));

  if (opts.help || command === 'help') {
    printHelp();
    process.exit(0);
  }

  if (command === 'init') {
    cmdInit();
    return;
  }

  // Model management commands (don't need fleet config)
  if (command === 'model') {
    const modelCmd = subcommand || 'list';
    switch (modelCmd) {
      case 'add':
        cmdModelAdd();
        break;
      case 'list':
      case 'ls':
        cmdModelList();
        break;
      case 'edit':
        cmdModelEdit();
        break;
      case 'delete':
      case 'rm':
        cmdModelDelete();
        break;
      default:
        console.error(ANSI.red(`Unknown model command: ${modelCmd}`));
        console.error('Available: add, list, edit, delete');
        process.exit(1);
    }
    return;
  }

  // Run command (doesn't need fleet config)
  if (command === 'run') {
    cmdRun(opts.model, opts.cwd);
    return;
  }

  // Observer start (doesn't need fleet config)
  if (command === 'start') {
    cmdStart().catch(err => {
      console.error(ANSI.red(`Fatal: ${err.message}`));
      process.exit(1);
    });
    return;
  }

  // Hooks management (doesn't need fleet config)
  if (command === 'hooks') {
    const hooksCmd = subcommand || 'status';
    switch (hooksCmd) {
      case 'install':
        cmdHooksInstall();
        break;
      case 'remove':
        cmdHooksRemove();
        break;
      case 'status':
        cmdHooksStatus();
        break;
      default:
        console.error(ANSI.red(`Unknown hooks command: ${hooksCmd}`));
        console.error('Available: install, remove, status');
        process.exit(1);
    }
    return;
  }

  // Worker commands (don't need fleet config)
  if (command === 'worker') {
    const workerCmd = subcommand;
    switch (workerCmd) {
      case 'start': cmdWorkerStart(opts); break;
      case 'stop': cmdWorkerStop(); break;
      case 'add': cmdWorkerAdd(args, opts); break;
      case 'list': case 'ls': cmdWorkerList(opts); break;
      case 'import': cmdWorkerImport(args); break;
      case 'report': cmdWorkerReport(args); break;
      case 'show': cmdWorkerShow(args); break;
      default:
        console.error(ANSI.red(`Unknown worker command: ${workerCmd || '(none)'}`));
        console.error('Available: start, stop, add, list, import, report, show');
        process.exit(1);
    }
    return;
  }

  // Remaining commands need fleet config
  const config = loadConfig(opts.config);

  switch (command) {
    case 'up':
      cmdUp(config, opts.only);
      break;
    case 'down':
    case 'stop':
      cmdDown();
      break;
    case 'restart':
      cmdRestart(config, opts.only);
      break;
    case 'ls':
    case 'list':
      cmdLs();
      break;
    case 'status':
      cmdStatus(config);
      break;
    default:
      console.error(ANSI.red(`Unknown command: ${command}`));
      printHelp();
      process.exit(1);
  }
}

if (require.main === module) main();

module.exports = {
  stripAnsi, truncStr, modelMeta, modelWarning, modelItem,
  run, checkDeps,
  loadState, saveState, isProcessAlive, cleanupState,
  configSearchPaths, findConfigFile, loadConfig, validateConfig,
  getModelsPath, loadModels, saveModels,
  cmdModelList, cmdInit, cmdHooksStatus, cmdLs, cmdStatus, cmdDown,
  cmdHooksInstall, cmdHooksRemove,
  cmdWorkerStart, cmdWorkerStop, cmdWorkerAdd, cmdWorkerList,
  cmdWorkerImport, cmdWorkerReport, cmdWorkerShow,
  filterInstances,
  parseArgs, main, ANSI, CONFIG_FILENAME, GLOBAL_CONFIG_DIR, STATE_FILE,
};
