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
  const proxy = m.proxy ? ` \u00B7 proxy: ${truncStr(m.proxy, 32)}` : '';
  return `key: ${key} \u00B7 endpoint: ${endpoint}${proxy}`;
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

function normalizeProxyUrl(url) {
  if (!url) return url;
  if (!/^https?:\/\//i.test(url)) return `http://${url}`;
  return url;
}

function resolveProxy(cliProxy, profileProxy) {
  if (!cliProxy) return null;
  if (typeof cliProxy === 'string') return normalizeProxyUrl(cliProxy);
  if (cliProxy === true && profileProxy) return normalizeProxyUrl(profileProxy);
  return null;
}

function applyProxy(env, proxyUrl) {
  if (proxyUrl) {
    env.HTTP_PROXY = proxyUrl;
    env.HTTPS_PROXY = proxyUrl;
  }
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
        { label: 'Proxy URL', value: '', placeholder: 'http://127.0.0.1:7890 (optional)' },
      ],
      requiredFields: allRequired,
    });

    if (!created) return; // cancelled

    // Show confirmation
    const key = truncStr(created['API Key'], 12) + '...';
    const endpoint = truncStr(created['API Base URL'], 32);
    const proxyDisplay = created['Proxy URL'] ? ` \u00B7 proxy: ${truncStr(created['Proxy URL'], 32)}` : '';
    const confirmed = await inputMod.renderConfirm({
      title: `Add model "${created.Name}"?`,
      items: {
        label: created.Name,
        detail: created['Model ID'],
        meta: `key: ${key} \u00B7 endpoint: ${endpoint}${proxyDisplay}`,
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
      proxy: created['Proxy URL'] || undefined,
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
    const proxyInfo = m.proxy ? `  \x1b[38;2;139;155;168mproxy:\x1b[0m ${m.proxy}` : '';
    console.log(`    \x1b[38;2;139;155;168mkey:\x1b[0m ${key}  \x1b[38;2;139;155;168mendpoint:\x1b[0m ${endpoint}${proxyInfo}`);
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
          { label: 'Proxy URL', value: entry.proxy || '', placeholder: 'http://127.0.0.1:7890 (optional)' },
        ],
        requiredFields: ['Name', 'Model ID', 'API Key', 'API Base URL'],
      });

      if (!updated) continue selectLoop; // Esc from form → back to selector

      // Show confirmation
      const key = updated['API Key']
        ? truncStr(updated['API Key'], 12) + '...'
        : (entry.apiKey ? '(unchanged)' : 'not set');
      const endpoint = truncStr(updated['API Base URL'] || entry.apiBaseUrl || 'default', 32);
      const proxyDisplay = (updated['Proxy URL'] || entry.proxy)
        ? ` \u00B7 proxy: ${truncStr(updated['Proxy URL'] || entry.proxy, 32)}`
        : '';
      const confirmed = await inputMod.renderConfirm({
        title: `Save changes to "${updated.Name || entry.name || '(unnamed)'}"?`,
        items: {
          label: updated.Name || entry.name || '(unnamed)',
          detail: updated['Model ID'] || entry.model || 'default',
          meta: `key: ${key} \u00B7 endpoint: ${endpoint}${proxyDisplay}`,
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
      if (updated['Proxy URL'] !== undefined) entry.proxy = updated['Proxy URL'] || undefined;

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

async function cmdRun(modelName, cwd, proxyOpt) {
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

  const proxyUrl = resolveProxy(proxyOpt, entry.proxy);
  const proxyInfo = proxyUrl ? `  proxy: ${proxyUrl}` : '';
  console.log(ANSI.dim(`\n  Launching claude with model: ${entry.model || 'default'} (${entry.name})${proxyInfo}\n`));

  const env = { ...process.env, FLEET_MODEL_NAME: entry.name };
  applyProxy(env, proxyUrl);

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
    applyProxy(env, inst.proxy);

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

    const proxyTag = inst.proxy ? ` proxy=${inst.proxy}` : '';
    console.log(ANSI.green(`  [${inst.name}]`) + ` model=${ANSI.cyan(inst.model || 'default')} pid=${child.pid}${proxyTag}`);
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
    if (inst.proxy) {
      console.log(`    proxy:    ${inst.proxy}`);
    }
    if (inst.env && Object.keys(inst.env).length > 0) {
      console.log(`    env:      ${Object.keys(inst.env).join(', ')}`);
    }
    console.log();
  }
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
    } else if (arg === '--proxy' || arg.startsWith('--proxy=')) {
      const eqVal = arg.startsWith('--proxy=') ? arg.slice('--proxy='.length) : null;
      if (eqVal) {
        opts.proxy = eqVal;
      } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        opts.proxy = argv[++i];
      } else {
        opts.proxy = true;
      }
    } else if (arg === '--version' || arg === '-v' || arg === '-V') {
      opts.version = true;
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

${ANSI.bold('Options:')}
  --config <path>   Use specific config file
  --only <names>    Comma-separated instance names to target
  --model <name>    Model profile name (for run command)
  --cwd <path>      Working directory (for run command)
  --proxy [url]     Enable HTTP proxy (uses profile proxy if url omitted)
  -v, --version     Show version number
  -h, --help        Show this help

${ANSI.bold('Examples:')}
  fleet start                       # Start observer dashboard
  fleet run --model opus-prod       # Start Claude Code with a model profile
  fleet run --proxy                 # Enable proxy using profile's saved proxy URL
  fleet run --proxy http://127.0.0.1:7890  # Enable proxy with explicit URL
  fleet hooks status                # Check hook installation status
  fleet model add                   # Add a model profile interactively
  fleet up                          # Start all instances (background)
`);
}

function main() {
  const { command, subcommand, args, opts } = parseArgs(process.argv.slice(2));

  if (opts.version || command === 'version') {
    const pkg = require(path.join(__dirname, '..', 'package.json'));
    console.log(pkg.version);
    process.exit(0);
  }

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
    cmdRun(opts.model, opts.cwd, opts.proxy);
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
  run, checkDeps, normalizeProxyUrl, resolveProxy, applyProxy,
  loadState, saveState, isProcessAlive, cleanupState,
  configSearchPaths, findConfigFile, loadConfig, validateConfig,
  getModelsPath, loadModels, saveModels,
  cmdModelList, cmdInit, cmdHooksStatus, cmdLs, cmdStatus, cmdDown,
  cmdHooksInstall, cmdHooksRemove,
  filterInstances,
  parseArgs, main, ANSI, CONFIG_FILENAME, GLOBAL_CONFIG_DIR, STATE_FILE,
};
