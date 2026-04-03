#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function buildHookSettings(workerName, sockPath, hookClientPath) {
  const hookCmd = `FLEET_WORKER_NAME=${workerName} FLEET_SOCK_PATH=${sockPath} node ${hookClientPath}`;
  return {
    hooks: {
      PostToolUse: [{
        hooks: [{ type: 'command', command: `${hookCmd} PostToolUse`, timeout: 5 }]
      }],
      Stop: [{
        hooks: [{ type: 'command', command: `${hookCmd} Stop`, timeout: 30 }]
      }],
      Notification: [{
        hooks: [{ type: 'command', command: `${hookCmd} Notification`, timeout: 5 }]
      }],
    }
  };
}

function injectHookSettings(cwd, workerName, sockPath, hookClientPath) {
  const claudeDir = path.join(cwd, '.claude');
  if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });
  const settingsPath = path.join(claudeDir, 'settings.local.json');
  const settings = buildHookSettings(workerName, sockPath, hookClientPath);
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
}

function runTask(config, task) {
  const cwd = path.resolve(config.cwd || process.cwd());
  if (!fs.existsSync(cwd)) fs.mkdirSync(cwd, { recursive: true });

  // Inject hooks before spawning
  injectHookSettings(cwd, config.name, config.sockPath, config.hookClientPath);

  const claudeArgs = [
    '-p', task,
    '--dangerously-skip-permissions',
  ];
  if (config.model) claudeArgs.push('--model', config.model);
  if (config.args) claudeArgs.push(...config.args);

  const settingsEnv = {};
  if (config.apiKey) {
    settingsEnv.ANTHROPIC_AUTH_TOKEN = config.apiKey;
    settingsEnv.ANTHROPIC_API_KEY = '';
  }
  if (config.apiBaseUrl) settingsEnv.ANTHROPIC_BASE_URL = config.apiBaseUrl;
  if (Object.keys(settingsEnv).length > 0) {
    claudeArgs.push('--settings', JSON.stringify({ env: settingsEnv }));
  }

  const env = { ...process.env };
  if (config.env) Object.assign(env, config.env);

  const child = spawn('claude', claudeArgs, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Forward stdout lines to master
  let stdoutBuf = '';
  child.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString();
    let idx;
    while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, idx);
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (line.trim()) {
        process.send({ type: 'stdout', worker: config.name, data: line });
      }
    }
  });

  // Forward stderr lines to master
  let stderrBuf = '';
  child.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString();
    let idx;
    while ((idx = stderrBuf.indexOf('\n')) !== -1) {
      const line = stderrBuf.slice(0, idx);
      stderrBuf = stderrBuf.slice(idx + 1);
      if (line.trim()) {
        process.send({ type: 'stderr', worker: config.name, data: line });
      }
    }
  });

  return new Promise((resolve) => {
    child.on('exit', (code) => {
      // Flush remaining buffers
      if (stdoutBuf.trim()) process.send({ type: 'stdout', worker: config.name, data: stdoutBuf });
      if (stderrBuf.trim()) process.send({ type: 'stderr', worker: config.name, data: stderrBuf });
      resolve(code);
    });
  });
}

async function main() {
  // Receive initial config from master via IPC
  const config = await new Promise((resolve) => {
    process.once('message', resolve);
  });

  process.send({ type: 'ready', worker: config.name });

  // Listen for task assignments via IPC
  process.on('message', async (msg) => {
    if (msg.type === 'task') {
      process.send({ type: 'status', worker: config.name, status: 'running', task: msg.task });
      const exitCode = await runTask(config, msg.task);
      if (exitCode === 0) {
        process.send({ type: 'task_done', worker: config.name, task: msg.task });
      } else {
        process.send({ type: 'task_error', worker: config.name, task: msg.task, exitCode });
      }
    } else if (msg.type === 'shutdown') {
      process.exit(0);
    }
  });
}

main();
