#!/usr/bin/env node

const { execFileSync, spawnSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ─── Constants ───────────────────────────────────────────────────────────────

const CONFIG_FILENAME = 'fleet.config.json';
const LOCAL_CONFIG_FILENAME = 'fleet.config.local.json';
const GLOBAL_CONFIG_DIR = path.join(process.env.HOME || '~', '.config', 'claude-code-fleet');

const ANSI = {
  bold: s => `\x1b[1m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tmuxRaw(args) {
  try {
    return execFileSync('tmux', args, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
}

function tmux(...args) {
  return tmuxRaw(args);
}

function tmuxSessionAlive(sessionName) {
  return tmux('has-session', '-t', sessionName) !== null;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf-8', stdio: 'pipe' });
  return r.status === 0;
}

// ─── Dependency checks ───────────────────────────────────────────────────────

function checkDeps() {
  const missing = [];
  if (!run('which', ['tmux'])) missing.push('tmux');
  if (!run('which', ['claude'])) missing.push('claude (Claude Code CLI)');
  if (missing.length > 0) {
    console.error(ANSI.red('Missing dependencies:'));
    missing.forEach(d => console.error(`  - ${d}`));
    process.exit(1);
  }
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
  console.log(`Edit it with your API keys and model preferences.`);
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

// ─── Instance launcher ───────────────────────────────────────────────────────

function launchInstance(inst, sessionName, isFirst) {
  const paneName = inst.name;
  const cwd = inst.cwd ? path.resolve(inst.cwd) : process.cwd();

  // Ensure working directory exists
  if (!fs.existsSync(cwd)) {
    fs.mkdirSync(cwd, { recursive: true });
  }

  // Create or reuse tmux window
  if (isFirst) {
    tmux('rename-window', '-t', `${sessionName}:0`, paneName);
  } else {
    tmux('new-window', '-t', sessionName, '-n', paneName);
  }

  const target = `${sessionName}:${paneName}`;

  // Build env file for this instance
  const envLines = [
    inst.apiKey ? `export ANTHROPIC_API_KEY=${inst.apiKey}` : '',
    inst.apiBaseUrl ? `export ANTHROPIC_BASE_URL=${inst.apiBaseUrl}` : '',
    ...(inst.env ? Object.entries(inst.env).map(([k, v]) => `export ${k}=${v}`) : []),
  ].filter(Boolean);

  if (envLines.length > 0) {
    const envFile = path.join(cwd, '.fleet-env');
    fs.writeFileSync(envFile, envLines.join('\n') + '\n');
  }

  // Build claude CLI args
  const claudeArgs = [];
  if (inst.model) claudeArgs.push('--model', inst.model);
  if (inst.apiBaseUrl) claudeArgs.push('--api-base-url', inst.apiBaseUrl);
  if (inst.args) claudeArgs.push(...inst.args);

  // Send commands to tmux pane
  tmux('send-keys', '-t', target, `cd ${cwd}`, 'C-m');

  if (envLines.length > 0) {
    tmux('send-keys', '-t', target, 'source .fleet-env', 'C-m');
  }

  tmux('send-keys', '-t', target, ['claude', ...claudeArgs].join(' '), 'C-m');

  return target;
}

// ─── Commands ────────────────────────────────────────────────────────────────

function cmdUp(config, onlyNames) {
  const sessionName = config.tmux?.sessionName || 'claude-fleet';
  const layout = config.tmux?.layout || 'tiled';

  checkDeps();

  if (tmuxSessionAlive(sessionName)) {
    console.error(ANSI.yellow(`Fleet "${sessionName}" is already running. Use ${ANSI.bold('fleet down')} first or ${ANSI.bold('fleet restart')}.`));
    process.exit(1);
  }

  tmux('new-session', '-d', '-s', sessionName);

  const instances = filterInstances(config.instances, onlyNames);

  instances.forEach((inst, i) => {
    launchInstance(inst, sessionName, i === 0);
    console.log(ANSI.green(`  [${inst.name}]`) + ` model=${ANSI.cyan(inst.model || 'default')}`);
  });

  tmux('select-layout', '-t', sessionName, layout);

  console.log(`\nFleet ${ANSI.bold(sessionName)} launched with ${instances.length} instances.`);
  console.log(ANSI.dim(`  Attach:  tmux attach -t ${sessionName}`));
  console.log(ANSI.dim(`  List:    fleet ls`));
  console.log(ANSI.dim(`  Stop:    fleet down`));
}

function cmdDown(config) {
  const sessionName = config.tmux?.sessionName || 'claude-fleet';
  if (tmuxSessionAlive(sessionName)) {
    tmux('kill-session', '-t', sessionName);
    console.log(ANSI.green(`Fleet "${sessionName}" stopped.`));
  } else {
    console.log(ANSI.yellow(`Fleet "${sessionName}" is not running.`));
  }
}

function cmdRestart(config, onlyNames) {
  cmdDown(config);
  cmdUp(config, onlyNames);
}

function cmdLs(config) {
  const sessionName = config.tmux?.sessionName || 'claude-fleet';
  if (!tmuxSessionAlive(sessionName)) {
    console.log(ANSI.yellow(`Fleet "${sessionName}" is not running.`));
    return;
  }

  const output = tmux('list-windows', '-t', sessionName, '-F', '#{window_index}::#{window_name}::#{window_active}');
  if (!output) return;

  console.log(`Fleet ${ANSI.bold(sessionName)} instances:\n`);

  for (const line of output.trim().split('\n')) {
    const [idx, name, active] = line.split('::');
    const marker = active === '1' ? ANSI.green('*') : ' ';
    console.log(`  ${marker} [${idx}] ${name}`);
  }
}

function cmdStatus(config) {
  const sessionName = config.tmux?.sessionName || 'claude-fleet';
  if (!tmuxSessionAlive(sessionName)) {
    console.log(ANSI.yellow(`Fleet "${sessionName}" is not running.`));
    return;
  }

  const instances = config.instances;
  console.log(`${ANSI.bold('Instance Configs:')}\n`);

  for (const inst of instances) {
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

function cmdAttach(config) {
  const sessionName = config.tmux?.sessionName || 'claude-fleet';
  if (!tmuxSessionAlive(sessionName)) {
    console.error(ANSI.yellow(`Fleet "${sessionName}" is not running. Start it with ${ANSI.bold('fleet up')}.`));
    process.exit(1);
  }
  const child = spawn('tmux', ['attach', '-t', sessionName], { stdio: 'inherit' });
  child.on('exit', code => process.exit(code || 0));
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
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else {
      positional.push(arg);
    }
    i++;
  }
  return { command: positional[0] || 'up', args: positional.slice(1), opts };
}

function printHelp() {
  console.log(`${ANSI.bold('Claude Code Fleet')} — Run multiple Claude Code instances in parallel

${ANSI.bold('Usage:')}
  fleet [command] [options]

${ANSI.bold('Commands:')}
  up, start     Start all (or filtered) Claude Code instances
  down, stop    Stop the fleet
  restart       Restart the fleet
  ls, list      List running instances
  status        Show instance configuration details
  attach        Attach to the tmux session
  init          Create a fleet.config.json from template

${ANSI.bold('Options:')}
  --config <path>   Use specific config file
  --only <names>    Comma-separated instance names to target
  -h, --help        Show this help

${ANSI.bold('Examples:')}
  fleet up                          # Start all instances
  fleet up --only opus,sonnet       # Start only named instances
  fleet up --config ~/my-fleet.json # Use specific config
  fleet restart --only sonnet       # Restart a specific instance
  fleet attach                      # Jump into tmux session
`);
}

function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (command === 'init') {
    cmdInit();
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
      cmdDown(config);
      break;
    case 'restart':
      cmdRestart(config, opts.only);
      break;
    case 'ls':
    case 'list':
      cmdLs(config);
      break;
    case 'status':
      cmdStatus(config);
      break;
    case 'attach':
    case 'a':
      cmdAttach(config);
      break;
    default:
      console.error(ANSI.red(`Unknown command: ${command}`));
      printHelp();
      process.exit(1);
  }
}

main();
