# Claude Code Fleet

<!-- README-I18N:START -->

**English** | [汉语](./README.zh.md)

<!-- README-I18N:END -->

Run multiple Claude Code instances with different API keys, models, and endpoints in parallel — from one terminal, zero dependencies.

## Why

- Run multiple Claude Code workers simultaneously (e.g., Opus for architecture, Sonnet for implementation, Haiku for quick tasks)
- Use different API keys to distribute rate limits
- Route requests through different endpoints or proxies
- **Observe all active Claude Code processes** from a single terminal dashboard
- Manage it all from one terminal with no external dependencies

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`npm install -g @anthropic-ai/claude-code`)

## Quick Start

```bash
# Install globally
npm install -g @dking/claude-code-fleet

# Or run directly from source
git clone https://github.com/<your-username>/claude-code-fleet.git
cd claude-code-fleet

# Add a model profile (interactive)
fleet model add

# Run a single instance (interactive picker)
fleet run

# Start the observer dashboard
fleet start

# Or initialize fleet config for multi-instance management
fleet init
# Edit fleet.config.json with your API keys, then:
fleet up

# List running instances
fleet ls

# Stop all instances
fleet down
```

## Three Modes

### Model Profile Mode

Manage named model profiles and launch single interactive Claude Code sessions.

- Profiles are stored globally at `~/.config/claude-code-fleet/models.json`
- `fleet run` launches a foreground interactive session with `stdio` inherited
- If no `--model` flag is given, an interactive arrow-key menu appears

### Observer Mode (Dashboard)

Start a real-time terminal dashboard that observes all active Claude Code processes.

- `fleet start` launches the observer TUI
- Automatically discovers all Claude Code processes via async hooks
- Shows session ID, model name, working directory, and recent operations per worker
- Workers appear when they start (SessionStart hook) and disappear when they stop (Stop hook)
- Inactive workers (3+ hours without events) are automatically cleaned up
- No config file required — just run `fleet start` and launch Claude Code processes

### Fleet Mode (Background)

Define multiple instances in a config file and manage them as background processes.

- `fleet up` spawns each instance as a detached background process
- PIDs are tracked in `~/.config/claude-code-fleet/fleet-state.json`
- Stale entries (dead PIDs) are cleaned up automatically

## Commands

| Command | Aliases | Description |
|---------|---------|-------------|
| `fleet start` | — | Start observer dashboard (TUI) |
| `fleet hooks install` | — | Install fleet hooks to ~/.claude/settings.json |
| `fleet hooks remove` | — | Remove fleet hooks from ~/.claude/settings.json |
| `fleet hooks status` | — | Show current hook installation status |
| `fleet run` | — | Start a single interactive Claude Code session with a model profile |
| `fleet model add` | — | Interactively add a new model profile |
| `fleet model list` | `model ls` | List all saved model profiles |
| `fleet model edit` | — | Interactively edit an existing model profile |
| `fleet model delete` | `model rm` | Interactively delete a model profile |
| `fleet up` | — | Launch all (or `--only`) instances as background processes |
| `fleet down` | `stop` | Stop all running background instances |
| `fleet restart` | — | Stop then start all (or `--only`) instances |
| `fleet ls` | `list` | List currently running background instances with PID and model |
| `fleet status` | — | Show detailed configuration for all instances |
| `fleet init` | — | Create `fleet.config.json` from template in the current directory |

### Global Options

| Flag | Description |
|------|-------------|
| `--config <path>` | Use a specific config file instead of auto-searching |
| `--only <names>` | Target only specific named instances (comma-separated, for `up`/`restart`) |
| `--model <name>` | Specify model profile (for `run` command) |
| `--cwd <path>` | Set working directory (for `run` command) |

## Configuration

### Config file search order

1. `fleet.config.local.json` in the current directory (gitignored, for local secrets)
2. `fleet.config.json` in the current directory
3. `~/.config/claude-code-fleet/config.json` (global fallback)

### Instance options

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique instance name |
| `apiKey` | Yes | Anthropic API key (set as `ANTHROPIC_AUTH_TOKEN`) |
| `model` | No | Claude model ID (e.g., `claude-opus-4-6`, `claude-sonnet-4-6`) |
| `apiBaseUrl` | No | Custom API endpoint (set as `ANTHROPIC_BASE_URL`) |
| `cwd` | No | Working directory for the instance (created if missing) |
| `env` | No | Additional environment variables as key-value pairs |
| `args` | No | Extra CLI arguments passed to `claude` |

### Example Config

```json
{
  "instances": [
    {
      "name": "opus-worker",
      "apiKey": "sk-ant-api03-xxxxx",
      "model": "claude-opus-4-6",
      "apiBaseUrl": "https://api.anthropic.com",
      "cwd": "./workspace/opus"
    },
    {
      "name": "sonnet-worker",
      "apiKey": "sk-ant-api03-yyyyy",
      "model": "claude-sonnet-4-6",
      "cwd": "./workspace/sonnet"
    },
    {
      "name": "custom-endpoint",
      "apiKey": "your-key",
      "model": "claude-sonnet-4-6",
      "apiBaseUrl": "https://your-proxy.example.com/v1",
      "env": { "CUSTOM_HEADER": "value" },
      "args": ["--verbose"],
      "cwd": "./workspace/custom"
    }
  ]
}
```

## How It Works

### Observer Mode (`fleet start`)

1. Copies hook-client.js to `~/.config/claude-code-fleet/hooks/`
2. Injects async hooks into `~/.claude/settings.json` (SessionStart, PostToolUse, Stop, Notification)
3. Starts Unix socket server at `~/.config/claude-code-fleet/fleet.sock`
4. When any Claude Code process starts, hooks fire and send events to the socket
5. Master tracks each session by `session_id`, recording operations and model info
6. TUI renders real-time status with 100ms debounce
7. Workers inactive for 3+ hours are automatically removed

### Fleet Mode (`fleet up`)

1. Reads config file for instance definitions
2. Validates configuration (required fields, duplicate names)
3. Checks for `claude` CLI availability
4. Spawns each instance as a detached background process with the configured model and environment
5. Tracks PIDs in a state file for lifecycle management
6. Automatically cleans up stale entries on every operation

### Hooks

Hooks are installed into `~/.claude/settings.json` and are persistent — they survive master restarts. When the master is not running, hook-client exits silently in < 1ms (Claude Code is unaffected).

```bash
fleet hooks install   # One-time setup
fleet hooks status    # Check installation
fleet hooks remove    # Clean uninstall
```

## Interactive UI

The built-in arrow-key selector supports:

- Arrow keys or `j`/`k` to navigate
- Enter to confirm selection
- `q` or `Ctrl+C` to abort

## License

MIT
