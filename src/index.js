#!/usr/bin/env node

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ─── Config ──────────────────────────────────────────────────────────────────

const CONFIG_PATHS = [
  path.join(process.cwd(), 'fleet.config.json'),
  path.join(process.cwd(), 'fleet.config.local.json'),
  path.join(process.env.HOME || '~', '.config', 'claude-code-fleet', 'config.json'),
];

function loadConfig() {
  for (const p of CONFIG_PATHS) {
    if (fs.existsSync(p)) return { file: p, ...JSON.parse(fs.readFileSync(p, 'utf-8')) };
  }
  console.error('No config file found. Expected one of:');
  CONFIG_PATHS.forEach(p => console.error(`  - ${p}`));
  console.error('\nCopy fleet.config.example.json to fleet.config.json and edit it.');
  process.exit(1);
}

// ─── Tmux helpers ────────────────────────────────────────────────────────────

function tmux(...args) {
  try { return execSync(`tmux ${args.join(' ')}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { return null; }
}

function tmuxAlive(sessionName) {
  return tmux('has-session', '-t', sessionName) !== null;
}

function buildClaudeArgs(instance) {
  const args = [];
  if (instance.model) args.push('--model', instance.model);
  if (instance.apiBaseUrl) args.push('--api-base-url', instance.apiBaseUrl);
  return args;
}

// ─── Commands ────────────────────────────────────────────────────────────────

function cmdUp(config) {
  const sessionName = config.tmux?.sessionName || 'claude-fleet';
  const layout = config.tmux?.layout || 'tiled';

  if (!tmuxAlive(sessionName)) {
    tmux('new-session', '-d', '-s', sessionName);
  }

  for (let i = 0; i < config.instances.length; i++) {
    const inst = config.instances[i];
    const paneName = inst.name || `instance-${i}`;
    const cwd = inst.cwd ? path.resolve(inst.cwd) : process.cwd();

    // Ensure working directory exists
    if (!fs.existsSync(cwd)) {
      fs.mkdirSync(cwd, { recursive: true });
    }

    if (i === 0) {
      // First instance uses the initial window
      tmux('rename-window', '-t', `${sessionName}:0`, paneName);
    } else {
      tmux('new-window', '-t', sessionName, '-n', paneName);
    }

    const envExports = [
      inst.apiKey ? `ANTHROPIC_API_KEY=${inst.apiKey}` : '',
      inst.apiBaseUrl ? `ANTHROPIC_BASE_URL=${inst.apiBaseUrl}` : '',
    ].filter(Boolean).join(' ');

    const claudeArgs = buildClaudeArgs(inst).join(' ');

    // Write a small env script per instance so users can re-enter easily
    const envFile = path.join(cwd, '.fleet-env');
    fs.writeFileSync(envFile, [
      `export ANTHROPIC_API_KEY=${inst.apiKey || ''}`,
      inst.apiBaseUrl ? `export ANTHROPIC_BASE_URL=${inst.apiBaseUrl}` : '',
    ].filter(Boolean).join('\n') + '\n');

    const target = `${sessionName}:${paneName}`;
    tmux('send-keys', '-t', target, `cd ${cwd}`, 'C-m');
    tmux('send-keys', '-t', target, `source .fleet-env`, 'C-m');
    tmux('send-keys', '-t', target, `claude ${claudeArgs}`.trim(), 'C-m');
  }

  // Tile layout
  tmux('select-layout', '-t', sessionName, layout);

  console.log(`Fleet "${sessionName}" launched with ${config.instances.length} instances.`);
  console.log(`\nAttach:  tmux attach -t ${sessionName}`);
  console.log(`List:    fleet ls`);
  console.log(`Stop:    fleet down`);
}

function cmdDown(config) {
  const sessionName = config.tmux?.sessionName || 'claude-fleet';
  if (tmuxAlive(sessionName)) {
    tmux('kill-session', '-t', sessionName);
    console.log(`Fleet "${sessionName}" stopped.`);
  } else {
    console.log(`Fleet "${sessionName}" is not running.`);
  }
}

function cmdLs(config) {
  const sessionName = config.tmux?.sessionName || 'claude-fleet';
  if (!tmuxAlive(sessionName)) {
    console.log(`Fleet "${sessionName}" is not running.`);
    return;
  }
  console.log(`Fleet "${sessionName}" instances:\n`);
  const output = tmux('list-windows', '-t', sessionName, '-F', '#{window_index}  #{window_name}');
  if (output) console.log(output);
}

function cmdAttach(config) {
  const sessionName = config.tmux?.sessionName || 'claude-fleet';
  const child = spawn('tmux', ['attach', '-t', sessionName], { stdio: 'inherit' });
  child.on('exit', code => process.exit(code || 0));
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'up';

  const config = loadConfig();

  switch (command) {
    case 'up':
    case 'start':
      cmdUp(config);
      break;
    case 'down':
    case 'stop':
      cmdDown(config);
      break;
    case 'ls':
    case 'list':
      cmdLs(config);
      break;
    case 'attach':
    case 'a':
      cmdAttach(config);
      break;
    default:
      console.log(`Usage: fleet [up|down|ls|attach]`);
      console.log(`  up      Start all Claude Code instances (default)`);
      console.log(`  down    Stop the fleet`);
      console.log(`  ls      List running instances`);
      console.log(`  attach  Attach to the tmux session`);
      process.exit(1);
  }
}

main();
