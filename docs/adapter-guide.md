# Adapter Development Guide

## ToolAdapter Abstract Interface

Every adapter extends `ToolAdapter` (in `src/adapters/base.js`) and must implement:

### Required Getters

| Getter | Returns | Example |
|--------|---------|---------|
| `name` | Lowercase identifier string | `'claude'` |
| `displayName` | Human-readable name | `'Claude Code'` |
| `binary` | CLI binary name (for `which` check) | `'claude'` |
| `hookEvents` | Array of event names the tool supports | `['SessionStart', 'PostToolUse', 'Stop']` |

### Required Methods

| Method | Purpose | Called By |
|--------|---------|-----------|
| `buildArgs(entry)` | Build CLI arguments for spawning the tool | `index.js` cmdRun() |
| `buildEnv(entry, baseEnv)` | Build environment variables for spawning | `index.js` cmdRun() |
| `installHooks(hookClientPath)` | Write hook config into tool's settings file | `master.js` ensureHooks() |
| `removeHooks()` | Clean fleet hooks from tool's settings file | `master.js` removeHooks() |
| `normalizePayload(rawInput)` | Map tool-specific hook input to canonical format | `hook-client.js` |

### Optional Methods

| Method | Default | Purpose |
|--------|---------|---------|
| `summarizeToolUse(toolName, toolInput)` | Returns raw `toolName` | Human-readable action summary for TUI |
| `isHookInstalled()` | Not defined (treated as false) | Check if hooks are already registered |
| `isInstalled()` | Concrete: runs `which <binary>` | Check if tool CLI is on PATH |

### Constructor Pattern

Adapters accept an optional `{ fs }` dependency injection for testability:

```javascript
class MyAdapter extends ToolAdapter {
  constructor({ fs } = {}) {
    super();
    this._fs = fs || require('fs');
  }
}
```

## Existing Adapter Comparison

| Aspect | Claude | Codex | Copilot |
|--------|--------|-------|---------|
| Hook events | SessionStart, PostToolUse, Stop, Notification | SessionStart, PostToolUse, Stop | SessionStart, PostToolUse, Stop |
| Config file | `~/.claude/settings.json` | `~/.codex/hooks.json` + `~/.codex/config.toml` | `<repo>/.github/hooks/fleet.json` (per-repo) |
| Hook format | `{ hooks: [{ type: 'command', command }] }` | `{ hooks: [{ type: 'command', command }] }` | `{ version: 1, hooks: { sessionStart: [{ type: 'command', bash }] } }` |
| Event key case | PascalCase (`SessionStart`) | PascalCase (`SessionStart`) | camelCase (`sessionStart`, `sessionEnd`) |
| Auth env vars | `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` | `OPENAI_API_KEY` | `COPILOT_MODEL`, `COPILOT_GITHUB_TOKEN` |
| Auth injection | Via `--settings` JSON | Via env vars | Via env vars |
| summarizeToolUse | Rich (Edit/Write/Read/Bash/Grep/Glob) | Minimal (Bash only) | Rich (same as Claude) |
| normalizePayload | Direct field mapping | Direct field mapping | Event name normalization, JSON parsing of `toolArgs` |

## Step-by-Step: Adding a New Adapter

### 1. Create the adapter file

Create `src/adapters/<name>.js`:

```javascript
const path = require('path');
const defaultFs = require('fs');
const os = require('os');
const { ToolAdapter } = require('./base');

const CONFIG_PATH = path.join(os.homedir(), '.mytool', 'config.json');
const FLEET_IDENTIFIER = 'claude-code-fleet';

class MyToolAdapter extends ToolAdapter {
  constructor({ fs } = {}) {
    super();
    this._fs = fs || defaultFs;
  }

  get name() { return 'mytool'; }
  get displayName() { return 'My Tool'; }
  get binary() { return 'mytool'; }
  get hookEvents() { return ['SessionStart', 'PostToolUse', 'Stop']; }

  buildArgs(entry) { /* return array of CLI args */ }
  buildEnv(entry, baseEnv) { /* return env object */ }
  installHooks(hookClientPath) { /* write hooks to tool config */ }
  removeHooks() { /* clean hooks from tool config */ }
  normalizePayload(rawInput) { /* return canonical payload */ }
  summarizeToolUse(toolName, toolInput) { /* optional: return human-readable summary */ }
  isHookInstalled() { /* optional: check if hooks are present */ }
}

module.exports = { MyToolAdapter };
```

### 2. Register the adapter

In `src/adapters/index.js`, add:

```javascript
const { MyToolAdapter } = require('./mytool');
registry.register(new MyToolAdapter());
```

### 3. Update hook-client adapter file list

In `src/master.js` `ensureHooks()`, add the new adapter filename to the copy list:

```javascript
for (const file of ['base.js', 'claude.js', 'codex.js', 'copilot.js', 'mytool.js', 'registry.js', 'index.js']) {
```

Also update the same list in `src/index.js` `cmdHooksInstall()`.

### 4. Write tests

Create `tests/adapters/mytool.test.js` following the pattern of existing adapter tests. Key test cases:

- Identity getters return correct values
- `buildArgs()` produces expected CLI arguments
- `buildEnv()` sets correct environment variables
- `normalizePayload()` maps tool-specific fields to canonical format
- `installHooks()` / `removeHooks()` correctly modify tool config
- `summarizeToolUse()` returns readable summaries

### 5. Update CLI help text

In `src/index.js` `printHelp()`, add the new tool to the "Supported Tools" section.

## Canonical Payload Fields

Every `normalizePayload()` must return an object with these fields:

```javascript
{
  event: string,              // 'SessionStart' | 'PostToolUse' | 'Stop' | 'Notification'
  session_id: string | null,
  cwd: string | null,
  timestamp: number,
  model: string | null,
  pid: number,
  ppid: number,
  term_program: string | null,
  iterm_session_id: string | null,
  tool_name: string | null,         // PostToolUse only
  tool_input: object | null,        // PostToolUse only
  last_assistant_message: string | null, // Stop only (max 500 chars)
  message: string | null,           // Notification only
}
```

After normalization, `hook-client.js` adds:
- `_tool`: the adapter name (e.g., `'mytool'`)
- `fleet_model_name`: from `FLEET_MODEL_NAME` env var (if set)
