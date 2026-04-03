#!/usr/bin/env node

const { spawnSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

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

function selectFromList(items, label) {
  return new Promise(resolve => {
    if (items.length === 0) {
      console.error(ANSI.yellow('No items to select.'));
      process.exit(1);
    }

    let selected = 0;

    function render() {
      // Move cursor up to redraw
      if (process.stdout.isTTY) {
        process.stdout.write('\x1b[' + (items.length + 1) + 'A');
      }
      process.stdout.write(`\x1b[0J? ${label}:\n`);
      items.forEach((item, i) => {
        const marker = i === selected ? '\x1b[36m❯\x1b[0m' : ' ';
        const line = i === selected ? `\x1b[36m${item.display}\x1b[0m` : item.display;
        process.stdout.write(`  ${marker} ${line}\n`);
      });
    }

    // Initial render
    process.stdout.write(`\n? ${label}:\n`);
    items.forEach((item, i) => {
      const marker = i === 0 ? '\x1b[36m❯\x1b[0m' : ' ';
      const line = i === 0 ? `\x1b[36m${item.display}\x1b[0m` : item.display;
      process.stdout.write(`  ${marker} ${line}\n`);
    });

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');

    function cleanup() {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    }

    function onData(key) {
      if (key === '\x1b[A' || key === 'k') {
        // Up
        selected = (selected - 1 + items.length) % items.length;
        render();
      } else if (key === '\x1b[B' || key === 'j') {
        // Down
        selected = (selected + 1) % items.length;
        render();
      } else if (key === '\r' || key === '\n') {
        // Enter
        cleanup();
        // Clear the list, print final selection
        process.stdout.write('\x1b[' + (items.length + 1) + 'A');
        process.stdout.write('\x1b[0J');
        process.stdout.write(`\x1b[36m❯\x1b[0m ${items[selected].display}\n`);
        resolve(items[selected].value);
      } else if (key === '\x03' || key === 'q') {
        // Ctrl+C or q
        cleanup();
        process.stdout.write('\n');
        process.exit(1);
      }
    }

    stdin.on('data', onData);
  });
}

// ─── Model commands ──────────────────────────────────────────────────────────

async function cmdModelAdd() {
  console.log(ANSI.bold('\nAdd a new model profile\n'));

  const name = await ask('  Name (e.g. opus-prod): ');
  if (!name) {
    console.error(ANSI.red('Name is required.'));
    process.exit(1);
  }

  const data = loadModels();
  if (data.models.some(m => m.name === name)) {
    console.error(ANSI.red(`Model "${name}" already exists.`));
    process.exit(1);
  }

  const model = await ask('  Model ID (e.g. claude-opus-4-6): ');
  const apiKey = await ask('  API Key: ');
  const apiBaseUrl = await ask('  API Base URL (leave empty for default): ');

  const entry = { name };
  if (model) entry.model = model;
  if (apiKey) entry.apiKey = apiKey;
  if (apiBaseUrl) entry.apiBaseUrl = apiBaseUrl;

  data.models.push(entry);
  saveModels(data);
  console.log(ANSI.green(`\n  Model "${name}" added.`));
}

function cmdModelList() {
  const data = loadModels();
  if (data.models.length === 0) {
    console.log(ANSI.yellow('No model profiles configured.'));
    console.log(`Run ${ANSI.bold('fleet model add')} to create one.`);
    return;
  }
  console.log(ANSI.bold('\nModel Profiles:\n'));
  for (const m of data.models) {
    console.log(`  ${ANSI.green(m.name)}`);
    console.log(`    model:    ${ANSI.cyan(m.model || 'default')}`);
    console.log(`    apiKey:   ${m.apiKey ? m.apiKey.slice(0, 12) + '...' : 'not set'}`);
    if (m.apiBaseUrl) console.log(`    endpoint: ${m.apiBaseUrl}`);
    console.log();
  }
}

async function cmdModelEdit() {
  const data = loadModels();
  if (data.models.length === 0) {
    console.error(ANSI.yellow('No model profiles to edit.'));
    return;
  }

  const items = data.models.map(m => ({
    display: `${m.name} (${m.model || 'default'})`,
    value: m.name,
  }));
  const selected = await selectFromList(items, 'Select a model to edit');
  const entry = data.models.find(m => m.name === selected);

  console.log(`\nEditing ${ANSI.green(selected)}. Press Enter to keep current value.\n`);

  const newName = await ask(`  Name [${entry.name}]: `);
  const model = await ask(`  Model ID [${entry.model || ''}]: `);
  const apiKey = await ask(`  API Key [${entry.apiKey ? entry.apiKey.slice(0, 12) + '...' : ''}]: `);
  const apiBaseUrl = await ask(`  API Base URL [${entry.apiBaseUrl || ''}]: `);

  if (newName && newName !== entry.name) {
    if (data.models.some(m => m.name === newName)) {
      console.error(ANSI.red(`Name "${newName}" already exists.`));
      process.exit(1);
    }
    entry.name = newName;
  }
  if (model) entry.model = model;
  if (apiKey) entry.apiKey = apiKey;
  if (apiBaseUrl) entry.apiBaseUrl = apiBaseUrl;

  saveModels(data);
  console.log(ANSI.green(`\n  Model "${selected}" updated.`));
}

async function cmdModelDelete() {
  const data = loadModels();
  if (data.models.length === 0) {
    console.error(ANSI.yellow('No model profiles to delete.'));
    return;
  }

  const items = data.models.map(m => ({
    display: `${m.name} (${m.model || 'default'})`,
    value: m.name,
  }));
  const selected = await selectFromList(items, 'Select a model to delete');

  const confirm = await ask(`  Delete "${selected}"? (y/N): `);
  if (confirm.toLowerCase() !== 'y') {
    console.log(ANSI.dim('  Cancelled.'));
    return;
  }

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
    const items = data.models.map(m => ({
      display: `${m.name} (${ANSI.cyan(m.model || 'default')})`,
      value: m.name,
    }));
    const selected = await selectFromList(items, 'Select a model to run');
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

  const child = spawn('claude', claudeArgs, {
    cwd: workDir,
    stdio: 'inherit',
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
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else {
      positional.push(arg);
    }
    i++;
  }
  return { command: positional[0] || 'help', subcommand: positional[1], args: positional.slice(2), opts };
}

function printHelp() {
  console.log(`${ANSI.bold('Claude Code Fleet')} — Manage model profiles and run Claude Code

${ANSI.bold('Usage:')}
  fleet [command] [options]

${ANSI.bold('Commands:')}
  run                 Start Claude Code with a model profile
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
  -h, --help        Show this help

${ANSI.bold('Examples:')}
  fleet model add                   # Add a model profile interactively
  fleet model list                  # List all model profiles
  fleet run                         # Select model and start Claude Code
  fleet run --model opus-prod       # Start with a specific model profile
  fleet run --model sonnet --cwd .  # Start with model and working directory
  fleet up                          # Start all instances (background)
  fleet ls                          # List running instances
`);
}

function main() {
  const { command, subcommand, opts } = parseArgs(process.argv.slice(2));

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

  const config = loadConfig(opts.config);

  switch (command) {
    case 'up':
    case 'start':
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

main();
