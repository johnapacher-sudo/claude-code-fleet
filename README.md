# Claude Code Fleet

<!-- README-I18N:START -->

**English** | [汉语](./README.zh.md)

<!-- README-I18N:END -->

Run multiple Claude Code instances with different API keys, models, and endpoints in parallel — from one terminal, zero dependencies.

## Key Features

- **Observer Dashboard** — Real-time TUI that auto-discovers all Claude Code processes and shows their status, actions, and AI messages
- **Terminal Focus** — Jump to any worker's terminal window/tab with one keypress (iTerm, Terminal.app, VSCode, Cursor, Warp, WezTerm)
- **Session Persistence** — Workers survive master restarts; session state is persisted to disk and auto-resumed
- **Model Profiles** — Named profiles for quick interactive sessions with different models and API keys
- **Fleet Mode** — Define multiple instances in a config file and manage them as background processes
- **Interactive UI** — Arrow-key selectors, confirmation dialogs, and multi-field input forms, all in the terminal

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

### Observer Mode (Dashboard)

Start a real-time terminal dashboard that observes all active Claude Code processes.

- `fleet start` launches the observer TUI
- Automatically discovers all Claude Code processes via async hooks (SessionStart, PostToolUse, Stop, Notification)
- Shows session ID, model name, working directory, tool usage, and AI messages per worker
- Workers appear when they start and are cleaned up when they stop (3+ hours inactive) or their process dies (30 minutes)
- Session state is persisted to disk — workers survive master restarts
- No config file required — just run `fleet start` and launch Claude Code processes

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

## Observer Dashboard

### How It Works

1. Copies `hook-client.js` to `~/.config/claude-code-fleet/hooks/`
2. Injects async hooks into `~/.claude/settings.json` for four Claude Code events
3. Starts a Unix socket server at `~/.config/claude-code-fleet/fleet.sock`
4. When any Claude Code process fires a hook, the client sends a JSON event to the socket
5. Master tracks each session by `session_id`, recording model info, tool usage, and AI messages
6. TUI re-renders in real-time with 100ms debounce
7. Persists session metadata to disk — survives master restarts
8. Automatically removes workers whose process has died (30 min) or been inactive (3+ hours)

### Hook Events

| Event | What It Captures |
|-------|-----------------|
| `SessionStart` | Model name, process PID/PPID, terminal program, iTerm session ID |
| `PostToolUse` | Tool name and input (Edit/Write/Read show filename, Bash shows command, Grep shows pattern) |
| `Stop` | Last assistant message (truncated to 500 chars), marks worker as idle |
| `Notification` | Starts a new turn with the notification message as summary |

### Worker States

| State | Meaning |
|-------|---------|
| `active` | Worker is running a tool action |
| `thinking` | All actions in current turn are done, but activity within last 90 seconds (shows spinner) |
| `idle` | Worker finished and is awaiting user input |
| `offline` | Process is dead or master marked it |

Workers are sorted by status priority (active → thinking → idle → offline), then by last event time or alphabetically (toggle with Tab).

### Keyboard Controls

| Key | Action |
|-----|--------|
| `j` / ↓ | Scroll down |
| `k` / ↑ | Scroll up |
| `1`–`9` | Jump to worker by position |
| Space | Expand/collapse worker detail view |
| Enter | Focus the terminal window/tab where that worker is running |
| Tab | Toggle sort mode (by time / by name) |
| `q` / Ctrl+C | Quit |

### Terminal Focus

Press Enter on any worker to jump to its terminal window/tab. Supported terminals (macOS):

| Terminal | Method |
|----------|--------|
| **iTerm2** | AppleScript to select the specific session by ID |
| **Terminal.app** | Finds TTY device by PID, selects matching tab via AppleScript |
| **VSCode** | Opens the workspace folder with `open -a "Visual Studio Code"` |
| **Cursor** | Opens the workspace folder with `open -a "Cursor"` |
| **Warp** | Raises the window containing the worker via AppleScript |
| **WezTerm** | Raises the window containing the worker via AppleScript |

If automation permission is not granted, you'll get a clear error message with instructions.

## Fleet Mode

### How It Works

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

All interactive prompts are built with Ink (React for the terminal):

### Selector (Arrow-key menu)

- Arrow keys or `j`/`k` to navigate
- Enter to confirm selection
- `q` or Ctrl+C to abort
- Supports danger mode (red accent for destructive actions like delete)

### Confirm Dialog

- Yes/No confirmation with optional danger styling
- `y`/Enter to confirm, `n`/`q`/Escape to cancel

### Input Form

- Multi-field forms with up/down/tab navigation
- Inline text editing with backspace/delete support
- Required field validation with error highlighting
- Auto-jumps to first empty required field on submit

## Data & State

All state is stored under `~/.config/claude-code-fleet/`:

| Path | Purpose |
|------|---------|
| `models.json` | Saved model profiles |
| `fleet-state.json` | Background instance PIDs (Fleet mode) |
| `fleet.sock` | Unix domain socket (transient, Observer mode) |
| `hooks/hook-client.js` | Hook script for Claude Code events |
| `sessions/<id>.json` | Per-session metadata for Observer recovery |

## License

MIT
