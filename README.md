# Claude Code Fleet

<!-- README-I18N:START -->

**English** | [汉语](./README.zh.md)

<!-- README-I18N:END -->

Run multiple Claude Code instances with different API keys, models, and endpoints in parallel — from one terminal, zero dependencies.

## Why

- Run multiple Claude Code workers simultaneously (e.g., Opus for architecture, Sonnet for implementation, Haiku for quick tasks)
- Use different API keys to distribute rate limits
- Route requests through different endpoints or proxies
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

### Fleet Mode (Background)

Define multiple instances in a config file and manage them as background processes.

- `fleet up` spawns each instance as a detached background process
- PIDs are tracked in `~/.config/claude-code-fleet/fleet-state.json`
- Stale entries (dead PIDs) are cleaned up automatically

### Master Mode (with TUI)

Launch a master daemon that orchestrates workers with a real-time terminal dashboard. Workers execute tasks from a queue autonomously. Progress, tool usage, and errors are reported via Claude Code hooks.

- `fleet start` launches master + all workers with a TUI dashboard
- Workers run `claude -p` with hook-injected settings for progress reporting
- Task queue per worker: tasks run sequentially, next starts automatically
- Dynamic task assignment via TUI input or `fleet task add`
- `fleet stop` (Ctrl+Q in TUI) detaches; workers continue running

## Commands

| Command | Aliases | Description |
|---------|---------|-------------|
| `fleet run` | — | Start a single interactive Claude Code session with a model profile |
| `fleet model add` | — | Interactively add a new model profile |
| `fleet model list` | `model ls` | List all saved model profiles |
| `fleet model edit` | — | Interactively edit an existing model profile |
| `fleet model delete` | `model rm` | Interactively delete a model profile |
| `fleet up` | `start` | Launch all (or `--only`) instances as background processes |
| `fleet start` | — | Start master daemon with TUI + all workers |
| `fleet task add <worker> <task>` | — | Append task to a running worker's queue |
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
| `tasks` | No | Array of task strings for the worker's queue (master mode) |

### Task Queue (Master Mode)

In master mode, each worker has an independent task queue. Define initial tasks in config:

```json
{
  "name": "opus-worker",
  "apiKey": "sk-ant-xxx",
  "model": "claude-opus-4-6",
  "cwd": "./workspace/opus",
  "tasks": [
    "Analyze project architecture",
    "Refactor src/core.js into modules",
    "Write unit tests"
  ]
}
```

Workers execute tasks sequentially. When a task completes (Claude Code's `Stop` hook fires), the master automatically dispatches the next queued task via hook response. If no tasks remain, the worker goes idle.

Tasks can be added at runtime via:
- TUI: select a worker, press Enter, type task description
- CLI: `fleet task add opus-worker "Fix the auth module"`

### Example (Simple Fleet Mode)

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

### Fleet Mode (`fleet up`)

1. Reads config file for instance definitions
2. Validates configuration (required fields, duplicate names)
3. Checks for `claude` CLI availability
4. Spawns each instance as a detached background process with the configured model and environment
5. Tracks PIDs in a state file for lifecycle management
6. Automatically cleans up stale entries on every operation

### Master Mode (`fleet start`)

1. Copies hook-client.js to `~/.config/claude-code-fleet/hooks/`
2. Starts Unix socket server at `~/.config/claude-code-fleet/fleet.sock`
3. Forks a worker.js process per instance (via IPC)
4. Worker injects hook settings into its cwd's `.claude/settings.local.json`
5. Worker spawns `claude -p "<task>"` for each queued task
6. Claude Code hooks (PostToolUse, Stop, Notification) report progress to master via Unix socket
7. On Stop hook: master checks task queue — returns next task or lets worker idle
8. TUI renders real-time status, logs, and accepts task input

## Interactive UI

The built-in arrow-key selector supports:

- Arrow keys or `j`/`k` to navigate
- Enter to confirm selection
- `q` or `Ctrl+C` to abort

## License

MIT
