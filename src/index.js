#!/usr/bin/env node

const { spawnSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { registry } = require('./adapters');
const { loadPools, savePools, addPool, deletePool, runWithFailover } = require('./lb');

// ─── Constants ───────────────────────────────────────────────────────────────

const GLOBAL_CONFIG_DIR = path.join(process.env.HOME || '~', '.config', 'claude-code-fleet');

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
  const toolTag = m.tool ? `[${m.tool.charAt(0).toUpperCase() + m.tool.slice(1)}] ` : '';
  return {
    display: `${m.name || '(unnamed)'} (${toolTag}${m.model || 'default'})`,
    label: m.name || '(unnamed)',
    detail: `${toolTag}${m.model || 'default'}`,
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

function checkToolDeps(toolName) {
  const adapter = registry.get(toolName || 'claude');
  if (!adapter) {
    console.error(ANSI.red(`Unknown tool: ${toolName}`));
    console.error(`Available tools: ${registry.all().map(a => a.name).join(', ')}`);
    process.exit(1);
  }
  if (!adapter.isInstalled()) {
    console.error(ANSI.red(`Missing dependency: ${adapter.binary} (${adapter.displayName})`));
    process.exit(1);
  }
}

// ─── Model profiles ──────────────────────────────────────────────────────────

function getModelsPath() {
  return path.join(GLOBAL_CONFIG_DIR, 'models.json');
}

function loadModels() {
  const p = getModelsPath();
  if (!fs.existsSync(p)) return { models: [] };
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    // Auto-migrate: backfill missing tool field with 'claude'
    let migrated = false;
    for (const m of (data.models || [])) {
      if (!m.tool) { m.tool = 'claude'; migrated = true; }
    }
    if (migrated) saveModels(data);
    return data;
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

async function cmdModelAdd(toolName) {
  if (!toolName) {
    const toolItems = registry.all().map(a => ({
      label: a.displayName,
      detail: a.binary,
      value: a.name,
    }));
    toolName = await selectFromList(toolItems, 'Select a tool type');
    if (!toolName) return;
  }

  const adapter = registry.get(toolName);
  if (!adapter) {
    console.error(ANSI.red(`Unknown tool: ${toolName}`));
    process.exit(1);
  }

  const placeholders = {
    modelId: toolName === 'codex' ? 'e.g. gpt-5.4' : toolName === 'copilot' ? 'e.g. gpt-4.1' : 'e.g. claude-opus-4-6',
    apiKey: toolName === 'copilot' ? 'GitHub PAT (copilot_requests), press Enter to skip' : toolName === 'codex' ? 'sk-...' : 'sk-ant-...',
    apiBaseUrl: toolName === 'codex' ? 'https://api.openai.com/v1' : toolName === 'copilot' ? 'not required (uses GitHub models)' : 'https://api.anthropic.com',
  };

  const selectorPath = path.join(__dirname, 'components', 'selector.mjs');
  const inputMod = await import(selectorPath);
  const allRequired = toolName === 'copilot'
    ? ['Name', 'Model ID']
    : ['Name', 'Model ID', 'API Key', 'API Base URL'];

  while (true) {
    const created = await inputMod.renderInput({
      title: `Add a new ${adapter.displayName} model profile`,
      fields: [
        { label: 'Name', value: '', placeholder: 'e.g. opus-prod' },
        { label: 'Model ID', value: '', placeholder: placeholders.modelId },
        { label: 'API Key', value: '', placeholder: placeholders.apiKey },
        { label: 'API Base URL', value: '', placeholder: placeholders.apiBaseUrl },
        { label: 'Proxy URL', value: '', placeholder: 'http://127.0.0.1:7890 (optional)' },
      ],
      requiredFields: allRequired,
    });

    if (!created) return; // cancelled

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
      tool: toolName,
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
      const isCopilot = entry.tool === 'copilot';
      const placeholders = {
        modelId: isCopilot ? 'e.g. gpt-4.1' : 'e.g. claude-opus-4-6',
        apiKey: isCopilot ? 'GitHub PAT (copilot_requests), press Enter to skip' : 'required',
        apiBaseUrl: isCopilot ? 'not required (uses GitHub models)' : 'https://api.anthropic.com (leave empty for default)',
      };
      const requiredFields = isCopilot
        ? ['Name', 'Model ID']
        : ['Name', 'Model ID', 'API Key', 'API Base URL'];

      const updated = await inputMod.renderInput({
        title: `Edit "${selected || '(unnamed)'}"`,
        fields: [
          { label: 'Name', value: entry.name || '', placeholder: 'e.g. opus-prod' },
          { label: 'Model ID', value: entry.model || '', placeholder: placeholders.modelId },
          { label: 'API Key', value: entry.apiKey || '', placeholder: placeholders.apiKey },
          { label: 'API Base URL', value: entry.apiBaseUrl || '', placeholder: placeholders.apiBaseUrl },
          { label: 'Proxy URL', value: entry.proxy || '', placeholder: 'http://127.0.0.1:7890 (optional)' },
        ],
        requiredFields,
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

async function cmdRun(modelName, cwd, proxyOpt, passthrough) {
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

  const toolName = entry.tool || 'claude';
  checkToolDeps(toolName);
  const adapter = registry.get(toolName);

  const workDir = cwd ? path.resolve(cwd) : process.cwd();
  if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

  const args = adapter.buildArgs(entry);
  if (passthrough && passthrough.length > 0) args.push(...passthrough);

  const proxyUrl = resolveProxy(proxyOpt, entry.proxy);
  const proxyInfo = proxyUrl ? `  proxy: ${proxyUrl}` : '';
  console.log(ANSI.dim(`\n  Launching ${adapter.displayName} with model: ${entry.model || 'default'} (${entry.name})${proxyInfo}\n`));

  const baseEnv = { ...process.env };
  applyProxy(baseEnv, proxyUrl);
  const env = adapter.buildEnv(entry, baseEnv);

  const child = spawn(adapter.binary, args, {
    cwd: workDir,
    stdio: 'inherit',
    env,
  });
  child.on('exit', code => process.exit(code || 0));
}

function cmdHooksInstall(toolsFilter) {
  if (toolsFilter) {
    const toolNames = toolsFilter.split(',');
    const HOOKS_DIR = path.join(GLOBAL_CONFIG_DIR, 'hooks');
    const HOOK_CLIENT_DST = path.join(HOOKS_DIR, 'hook-client.js');
    if (!fs.existsSync(HOOKS_DIR)) fs.mkdirSync(HOOKS_DIR, { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'hook-client.js'), HOOK_CLIENT_DST);
    const adaptersSrc = path.join(__dirname, 'adapters');
    const adaptersDst = path.join(HOOKS_DIR, 'adapters');
    if (!fs.existsSync(adaptersDst)) fs.mkdirSync(adaptersDst, { recursive: true });
    for (const file of ['base.js', 'claude.js', 'codex.js', 'copilot.js', 'registry.js', 'index.js']) {
      const src = path.join(adaptersSrc, file);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(adaptersDst, file));
    }
    for (const t of toolNames) {
      const adapter = registry.get(t.trim());
      if (!adapter) {
        console.error(ANSI.red(`Unknown tool: ${t.trim()}`));
        continue;
      }
      if (!adapter.isInstalled()) {
        console.error(ANSI.yellow(`${adapter.displayName} not installed, skipping.`));
        continue;
      }
      // Copilot hooks are per-repo — install in CWD
      if (adapter.name === 'copilot') {
        const cwd = process.cwd();
        adapter.installHooks(HOOK_CLIENT_DST, cwd);
        console.log(ANSI.green(`Fleet hooks installed for ${adapter.displayName}`));
        console.log(ANSI.dim(`  (per-repo: ${cwd}/.github/hooks/fleet.json)`));
        continue;
      }
      adapter.installHooks(HOOK_CLIENT_DST);
      console.log(ANSI.green(`Fleet hooks installed for ${adapter.displayName}`));
    }
  } else {
    const { ensureHooks } = require('./master');
    ensureHooks();
    const installedNames = registry.installed()
      .filter(a => a.name !== 'copilot')
      .map(a => a.displayName).join(', ');
    console.log(ANSI.green(`Fleet hooks installed for: ${installedNames || 'none (no tools detected)'}`));
    // Copilot hooks are per-repo — hint user
    if (registry.get('copilot') && registry.get('copilot').isInstalled()) {
      console.log(ANSI.dim('  Copilot hooks are per-repo: use `fleet hooks install --tools copilot` in the target repo'));
    }
  }
}

function cmdHooksRemove() {
  const { removeHooks } = require('./master');
  removeHooks();

  // Also remove per-repo Copilot hooks from CWD
  const copilotAdapter = registry.get('copilot');
  if (copilotAdapter) {
    copilotAdapter.removeHooks(process.cwd());
  }

  const allNames = registry.all().map(a => a.displayName).join(', ');
  console.log(ANSI.green(`Fleet hooks removed for: ${allNames}`));
  if (copilotAdapter) {
    console.log(ANSI.dim('  (Copilot hooks removed from current directory only)'));
  }
}

function cmdHooksStatus() {
  console.log(ANSI.bold('\nFleet Hooks Status:\n'));

  for (const adapter of registry.all()) {
    const isInst = adapter.isInstalled();
    const cwd = adapter.name === 'copilot' ? process.cwd() : undefined;
    const hookOk = typeof adapter.isHookInstalled === 'function' ? adapter.isHookInstalled(cwd) : false;

    console.log(`  ${ANSI.bold(adapter.displayName)} (${adapter.binary}):`);
    if (!isInst) {
      console.log(`    ${ANSI.yellow('\u26A0')} CLI not installed`);
    } else if (hookOk) {
      console.log(`    ${ANSI.green('\u2713')} Hooks installed`);
      for (const evt of adapter.hookEvents) {
        console.log(`      ${ANSI.green('\u2713')} ${evt}`);
      }
      if (adapter.name === 'copilot') {
        console.log(`      ${ANSI.dim('(per-repo: ' + process.cwd() + '/.github/hooks/fleet.json)')}`);
      }
    } else {
      console.log(`    ${ANSI.red('\u2717')} Hooks not installed`);
      if (adapter.name === 'copilot') {
        console.log(`      ${ANSI.dim('(Copilot hooks are per-repo — run `fleet hooks install --tools copilot` in target repo)')}`);
      }
    }
    console.log();
  }
}

// ─── Notify commands ──────────────────────────────────────────────────────

function getNotifyConfigPath() {
  return path.join(GLOBAL_CONFIG_DIR, 'notify.json');
}

function loadNotifyConfigFile() {
  const p = getNotifyConfigPath();
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
  catch { return null; }
}

function saveNotifyConfig(config) {
  const dir = path.dirname(getNotifyConfigPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getNotifyConfigPath(), JSON.stringify(config, null, 2) + '\n');
}

function cmdNotify(opts) {
  const configPath = getNotifyConfigPath();

  if (opts.on) {
    const existing = loadNotifyConfigFile() || {};
    existing.enabled = true;
    saveNotifyConfig(existing);
    console.log(ANSI.green('  Notifications enabled.'));
    return;
  }

  if (opts.off) {
    const existing = loadNotifyConfigFile() || {};
    existing.enabled = false;
    saveNotifyConfig(existing);
    console.log(ANSI.yellow('  Notifications disabled.'));
    return;
  }

  if (opts.sound !== undefined) {
    const existing = loadNotifyConfigFile() || {};
    existing.sound = opts.sound;
    saveNotifyConfig(existing);
    console.log(ANSI.green(`  Notification sound ${opts.sound ? 'enabled' : 'disabled'}.`));
    return;
  }

  // Show current config
  const config = loadNotifyConfigFile();
  if (!config) {
    console.log(ANSI.bold('\nNotification Config:'));
    console.log(ANSI.dim('  No config file found. Using defaults:\n'));
    console.log('  enabled:       true');
    console.log('  sound:         true');
    console.log('  events.stop:   true');
    console.log('  events.notification: true');
  } else {
    console.log(ANSI.bold('\nNotification Config:'));
    console.log(`  file: ${ANSI.dim(configPath)}\n`);
    console.log(`  enabled:       ${config.enabled !== false ? ANSI.green('true') : ANSI.red('false')}`);
    console.log(`  sound:         ${config.sound !== false ? ANSI.green('true') : ANSI.red('false')}`);
    console.log(`  events.stop:   ${config.events?.stop !== false ? ANSI.green('true') : ANSI.red('false')}`);
    console.log(`  events.notification: ${config.events?.notification !== false ? ANSI.green('true') : ANSI.red('false')}`);
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
    if (arg === '--') {
      opts.passthrough = argv.slice(i + 1);
      break;
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
    } else if (arg === '--tools' && argv[i + 1]) {
      opts.tools = argv[++i];
    } else if (arg === '--version' || arg === '-v' || arg === '-V') {
      opts.version = true;
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--on') {
      opts.on = true;
    } else if (arg === '--off') {
      opts.off = true;
    } else if (arg === '--sound') {
      opts.sound = true;
    } else if (arg === '--no-sound') {
      opts.sound = false;
    } else {
      positional.push(arg);
    }
    i++;
  }
  return { command: positional[0] || 'run', subcommand: positional[1], args: positional.slice(2), opts };
}

function printHelp() {
  console.log(`${ANSI.bold('Claude Code Fleet')} — Manage multiple AI coding tool processes

${ANSI.bold('Usage:')}
  fleet [command] [options]

${ANSI.bold('Commands:')}
  run                 Start a tool with a model profile
  start               Start a tool with a model profile (alias for run)
  observer            Start fleet observer (TUI dashboard)
  hooks install       Install fleet hooks for all detected tools
  hooks remove        Remove fleet hooks for all tools
  hooks status        Show current hook installation status per tool
  model add [tool]    Add a new model profile (claude, codex, copilot)
  model list          List all model profiles
  model edit          Edit a model profile (interactive)
  model delete        Delete a model profile (interactive)
  notify              Configure desktop notifications

${ANSI.bold('Supported Tools:')}
  claude              Claude Code (anthropic)
  codex               Codex CLI (openai)
  copilot             GitHub Copilot CLI (github)

${ANSI.bold('Options:')}
  --model <name>    Model profile name (for run/start command)
  --cwd <path>      Working directory (for run/start command)
  --proxy [url]     Enable HTTP proxy (uses profile proxy if url omitted)
  --tools <names>   Comma-separated tool names (for hooks install)
  --                Pass remaining args to the underlying tool
  -v, --version     Show version number
  -h, --help        Show this help

${ANSI.bold('Examples:')}
  fleet start                       # Start with a model profile (interactive)
  fleet observer                    # Start observer dashboard
  fleet run --model opus-prod       # Start with a model profile
  fleet run --model opus-prod -- -p "hello"  # Pass extra args to the tool
  fleet run --proxy                 # Enable proxy using profile's saved proxy URL
  fleet run --proxy http://127.0.0.1:7890  # Enable proxy with explicit URL
  fleet hooks status                # Check hook installation status
  fleet hooks install --tools codex # Install hooks for Codex only
  fleet model add claude            # Add a Claude model profile
  fleet model add codex             # Add a Codex model profile
  fleet model add                   # Add a model profile interactively
  fleet notify                      # Show notification config
  fleet notify --on                 # Enable notifications
  fleet notify --no-sound           # Disable notification sound
  fleet notify --sound              # Enable notification sound
`);
}

// ─── Load Balancer commands ──────────────────────────────────────────────────

async function cmdLbAdd() {
  const data = loadModels();
  if (data.models.length === 0) {
    console.error(ANSI.yellow('No model profiles configured.'));
    console.error(`Run ${ANSI.bold('fleet model add')} to create one.`);
    process.exit(1);
  }

  const name = await ask('Pool name: ');
  if (!name) {
    console.error(ANSI.red('Pool name is required.'));
    process.exit(1);
  }

  const selectedModels = [];
  while (true) {
    const remaining = data.models.filter(m => !selectedModels.includes(m.name));
    if (remaining.length === 0) break;
    const items = remaining.map(m => modelItem(m));
    const pick = await selectFromList(items, `Add model to "${name}" (${selectedModels.length} selected)`);
    if (!pick) break;
    selectedModels.push(pick);
  }

  if (selectedModels.length === 0) {
    console.error(ANSI.yellow('No models selected. Aborting.'));
    return;
  }

  let pools = data.pools || [];
  try {
    pools = addPool(pools, data.models, name, selectedModels);
  } catch (err) {
    console.error(ANSI.red(err.message));
    process.exit(1);
  }
  data.pools = pools;
  saveModels(data);
  console.log(ANSI.green(`\n  Pool "${name}" created with ${selectedModels.length} model(s): ${selectedModels.join(', ')}`));
}

async function cmdLbList() {
  const data = loadModels();
  const pools = data.pools || [];
  if (pools.length === 0) {
    console.log(ANSI.yellow('No load balancer pools configured.'));
    console.log(`Run ${ANSI.bold('fleet lb add')} to create one.`);
    return;
  }
  console.log(`\n\x1b[38;2;167;139;250m\x1b[1m⬢ Load Balancer Pools\x1b[0m  \x1b[38;2;82;82;82m${pools.length} configured\x1b[0m\n`);
  for (const p of pools) {
    const models = data.models || [];
    const members = p.models.map(name => {
      const m = models.find(mod => mod.name === name);
      return m ? `${name} (${m.model || 'default'})` : `${name} \x1b[38;2;248;81;81m[missing]\x1b[0m`;
    });
    console.log(`  \x1b[38;2;167;139;250m│\x1b[0m \x1b[38;2;224;224;224m\x1b[1m${p.name}\x1b[0m  \x1b[38;2;82;82;82m${p.strategy}\x1b[0m`);
    console.log(`    \x1b[38;2;139;155;168mmembers:\x1b[0m ${members.join(', ')}`);
    console.log(`    \x1b[38;2;139;155;168mlast used:\x1b[0m ${p.state.lastIndex >= 0 ? p.models[p.state.lastIndex] : 'none'}`);
  }
}

async function cmdLbDelete() {
  const data = loadModels();
  const pools = data.pools || [];
  if (pools.length === 0) {
    console.log(ANSI.yellow('No pools to delete.'));
    return;
  }
  const items = pools.map(p => ({
    label: p.name,
    detail: `${p.models.length} model(s) · ${p.strategy}`,
    value: p.name,
  }));
  const selected = await selectFromList(items, 'Select a pool to delete', true);
  if (!selected) return;
  data.pools = deletePool(pools, selected);
  saveModels(data);
  console.log(ANSI.green(`\n  Pool "${selected}" deleted.`));
}

async function cmdLbRun(poolName, passthrough, cwd) {
  const modelsPath = getModelsPath();
  try {
    await runWithFailover(modelsPath, poolName, passthrough, { cwd });
  } catch (err) {
    console.error(ANSI.red(err.message));
    process.exit(1);
  }
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

  // Load Balancer commands
  if (command === 'lb') {
    const lbCmd = subcommand;
    if (!lbCmd || lbCmd === 'list') {
      cmdLbList();
    } else if (lbCmd === 'add') {
      cmdLbAdd();
    } else if (lbCmd === 'delete') {
      cmdLbDelete();
    } else {
      // treat subcommand as pool name for execution
      cmdLbRun(lbCmd, opts.passthrough, opts.cwd);
    }
    return;
  }

  // Model management commands
  if (command === 'model') {
    const modelCmd = subcommand || 'list';
    switch (modelCmd) {
      case 'add':
        cmdModelAdd(args[0]);
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

  // Run / Start command (both launch a tool)
  if (command === 'run' || command === 'start') {
    cmdRun(opts.model, opts.cwd, opts.proxy, opts.passthrough);
    return;
  }

  // Observer (TUI dashboard)
  if (command === 'observer') {
    cmdStart().catch(err => {
      console.error(ANSI.red(`Fatal: ${err.message}`));
      process.exit(1);
    });
    return;
  }

  // Hooks management
  if (command === 'hooks') {
    const hooksCmd = subcommand || 'status';
    switch (hooksCmd) {
      case 'install':
        cmdHooksInstall(opts.tools);
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

  // Notify configuration
  if (command === 'notify') {
    cmdNotify(opts);
    return;
  }

  console.error(ANSI.red(`Unknown command: ${command}`));
  printHelp();
  process.exit(1);
}

if (require.main === module) main();

module.exports = {
  stripAnsi, truncStr, modelMeta, modelWarning, modelItem,
  run, checkToolDeps, normalizeProxyUrl, resolveProxy, applyProxy,
  getModelsPath, loadModels, saveModels,
  cmdModelList, cmdHooksStatus,
  cmdHooksInstall, cmdHooksRemove,
  getNotifyConfigPath, loadNotifyConfigFile, saveNotifyConfig, cmdNotify,
  parseArgs, main, ANSI, GLOBAL_CONFIG_DIR,
};
