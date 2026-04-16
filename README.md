# Claude Code Fleet

<!-- README-I18N:START -->

**English** | [汉语](./README.zh.md)

<!-- README-I18N:END -->

Run multiple AI coding tool instances with different API keys, models, and endpoints in parallel — from one terminal, zero dependencies. Supports **Claude Code** and **Codex CLI**, with an extensible adapter architecture for future tools.

## Key Features

- **Multi-Tool Support** — Manage Claude Code and Codex CLI from a single interface via an Adapter pattern; easy to extend for other tools
- **Observer Dashboard** — Real-time TUI that auto-discovers all AI coding tool processes and shows their status, actions, and AI messages
- **Terminal Focus** — Jump to any worker's terminal window/tab with one keypress (iTerm, Terminal.app, VSCode, Cursor, Warp, WezTerm)
- **Session Persistence** — Workers survive master restarts; session state is persisted to disk and auto-resumed
- **Model Profiles** — Named profiles for quick interactive sessions with different models, API keys, and proxy settings
- **Fleet Mode** — Define multiple instances in a config file and manage them as background processes
- **HTTP Proxy** — Per-profile or per-run proxy support; auto-sets `HTTP_PROXY` and `HTTPS_PROXY` environment variables
- **Interactive UI** — Arrow-key selectors, confirmation dialogs, and multi-field input forms, all in the terminal
- **Desktop Notifications** — System notifications when a tool finishes a task or sends a notification, with configurable sound

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`npm install -g @anthropic-ai/claude-code`) and/or [Codex CLI](https://developers.openai.com/codex/) (`npm install -g @openai/codex`)

## Quick Start

```bash
# Install globally
npm install -g @dking/claude-code-fleet

# Or run directly from source
git clone https://github.com/<your-username>/claude-code-fleet.git
cd claude-code-fleet

# Add a model profile (interactive)
fleet model add          # Select tool type first
fleet model add claude   # Add a Claude Code profile
fleet model add codex    # Add a Codex CLI profile

# Run a single instance (interactive picker)
fleet run

# Run with proxy enabled
fleet run --proxy
fleet run --proxy http://127.0.0.1:7890
fleet run --proxy=http://127.0.0.1:7890

# Start the observer dashboard
fleet start

# Configure desktop notifications
fleet notify --on
fleet notify --no-sound

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

Start a real-time terminal dashboard that observes all active AI coding tool processes.

- `fleet start` launches the observer TUI
- Automatically discovers all Claude Code and Codex CLI processes via async hooks
- Shows session ID, model name, tool type, working directory, tool usage, and AI messages per worker
- Workers appear when they start and are cleaned up when they stop (3+ hours inactive) or their process dies (30 minutes)
- Session state is persisted to disk — workers survive master restarts
- No config file required — just run `fleet start` and launch Claude Code or Codex processes

### Model Profile Mode

Manage named model profiles and launch single interactive AI coding sessions.

- Profiles are stored globally at `~/.config/claude-code-fleet/models.json`
- Each profile stores: name, tool type, model ID, API key, API base URL, and optional proxy URL
- `fleet run` (or just `fleet` with no command) launches a foreground interactive session with `stdio` inherited
- If no `--model` flag is given, an interactive arrow-key menu appears
- Use `--proxy` to enable proxy via CLI, or rely on the profile's saved proxy URL

### Fleet Mode (Background)

Define multiple instances in a config file and manage them as background processes.

- `fleet up` spawns each instance as a detached background process
- PIDs are tracked in `~/.config/claude-code-fleet/fleet-state.json`
- Stale entries (dead PIDs) are cleaned up automatically

## Commands

| Command | Aliases | Description |
|---------|---------|-------------|
| `fleet start` | — | Start observer dashboard (TUI) |
| `fleet hooks install` | — | Install fleet hooks for all detected tools |
| `fleet hooks remove` | — | Remove fleet hooks from all tools |
| `fleet hooks status` | — | Show hook installation status per tool |
| `fleet run` | — | Start an interactive session with a model profile |
| `fleet model add [tool]` | — | Add a new model profile (`claude`, `codex`, or interactive) |
| `fleet model list` | `model ls` | List all saved model profiles |
| `fleet model edit` | — | Interactively edit an existing model profile |
| `fleet model delete` | `model rm` | Interactively delete a model profile |
| `fleet up` | — | Launch all (or `--only`) instances as background processes |
| `fleet down` | `stop` | Stop all running background instances |
| `fleet restart` | — | Stop then start all (or `--only`) instances |
| `fleet ls` | `list` | List currently running background instances with PID and model |
| `fleet status` | — | Show detailed configuration for all instances |
| `fleet notify` | — | Configure desktop notifications (`--on`, `--off`, `--sound`, `--no-sound`) |
| `fleet init` | — | Create `fleet.config.json` from template in the current directory |

### Global Options

| Flag | Description |
|------|-------------|
| `--config <path>` | Use a specific config file instead of auto-searching |
| `--only <names>` | Target only specific named instances (comma-separated, for `up`/`restart`) |
| `--model <name>` | Specify model profile (for `run` command) |
| `--cwd <path>` | Set working directory (for `run` command) |
| `--proxy [url]` | Enable HTTP proxy; uses profile's saved proxy URL if url omitted (for `run` command) |
| `--tools <names>` | Comma-separated tool names to target (for `hooks install`) |

## Configuration

### Config file search order

1. `fleet.config.local.json` in the current directory (gitignored, for local secrets)
2. `fleet.config.json` in the current directory
3. `~/.config/claude-code-fleet/config.json` (global fallback)

### Instance options

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique instance name |
| `tool` | No | Tool type: `claude` (default) or `codex` |
| `apiKey` | Yes | API key (Anthropic for Claude, OpenAI for Codex) |
| `model` | No | Model ID (e.g., `claude-opus-4-6`, `gpt-5.4`) |
| `apiBaseUrl` | No | Custom API endpoint |
| `cwd` | No | Working directory for the instance (created if missing) |
| `env` | No | Additional environment variables as key-value pairs |
| `args` | No | Extra CLI arguments passed to the tool binary |
| `proxy` | No | HTTP proxy URL (sets `HTTP_PROXY` and `HTTPS_PROXY`) |

### Example Config

```json
{
  "instances": [
    {
      "name": "opus-worker",
      "tool": "claude",
      "apiKey": "sk-ant-api03-xxxxx",
      "model": "claude-opus-4-6",
      "apiBaseUrl": "https://api.anthropic.com",
      "cwd": "./workspace/opus"
    },
    {
      "name": "sonnet-worker",
      "tool": "claude",
      "apiKey": "sk-ant-api03-yyyyy",
      "model": "claude-sonnet-4-6",
      "cwd": "./workspace/sonnet"
    },
    {
      "name": "codex-worker",
      "tool": "codex",
      "apiKey": "sk-openai-zzzzz",
      "model": "gpt-5.4",
      "cwd": "./workspace/codex"
    },
    {
      "name": "custom-endpoint",
      "apiKey": "your-key",
      "model": "claude-sonnet-4-6",
      "apiBaseUrl": "https://your-proxy.example.com/v1",
      "proxy": "http://127.0.0.1:7890",
      "env": { "CUSTOM_HEADER": "value" },
      "args": ["--verbose"],
      "cwd": "./workspace/custom"
    }
  ]
}
```

## Observer Dashboard

### How It Works

1. Copies `hook-client.js` and adapter modules to `~/.config/claude-code-fleet/hooks/`
2. Auto-detects installed tools and injects hooks into each tool's config (`~/.claude/settings.json` for Claude, `~/.codex/hooks.json` for Codex)
3. Starts a Unix socket server at `~/.config/claude-code-fleet/fleet.sock`
4. When any tool process fires a hook, the client sends a normalized JSON event to the socket
5. Master tracks each session by `session_id`, recording model info, tool usage, and AI messages
6. TUI re-renders in real-time with 100ms debounce
7. Persists session metadata to disk — survives master restarts
8. Automatically removes workers whose process has died (30 min) or been inactive (3+ hours)

### Hook Events

| Event | Claude Code | Codex CLI | What It Captures |
|-------|:-----------:|:---------:|-----------------|
| `SessionStart` | ✓ | ✓ | Model name, tool type, process PID/PPID, terminal program |
| `PostToolUse` | ✓ | ✓ | Tool name and input (Edit/Write/Read show filename, Bash shows command, Grep shows pattern) |
| `Stop` | ✓ | ✓ | Last assistant message (truncated to 500 chars), marks worker as idle |
| `Notification` | ✓ | — | Starts a new turn with the notification message as summary |

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
3. Checks for the required tool CLI (`claude` and/or `codex`) per instance
4. Spawns each instance as a detached background process with the configured model and environment
5. Tracks PIDs in a state file for lifecycle management
6. Automatically cleans up stale entries on every operation

### Hooks

Hooks are installed into each tool's config file and are persistent — they survive master restarts. When the master is not running, hook-client exits silently in < 1ms (tool processes are unaffected).

```bash
fleet hooks install                # Auto-detect tools, install for all
fleet hooks install --tools codex  # Install for Codex only
fleet hooks status                 # Check installation per tool
fleet hooks remove                 # Clean uninstall for all tools
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

## Desktop Notifications

Receive system notifications when Claude Code finishes a task or sends a notification. Works independently — no need for the master/observer to be running.

### How It Works

1. `notifier.js` is copied alongside `hook-client.js` during `fleet hooks install`
2. When a `Stop` event fires, a desktop notification is sent with the project name as subtitle and the last AI message as body
3. When a `Notification` event fires, the notification message is forwarded to the desktop
4. macOS uses native `osascript display notification`, Linux uses `notify-send`, Windows uses PowerShell toast

### Configuration

Stored in `~/.config/claude-code-fleet/notify.json`:

```json
{
  "enabled": true,
  "sound": true,
  "events": {
    "stop": true,
    "notification": true
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `true` | Master toggle for all notifications |
| `sound` | `true` | Play system notification sound |
| `events.stop` | `true` | Notify when Claude Code finishes a response |
| `events.notification` | `true` | Notify when Claude sends a notification event |

### CLI

```bash
fleet notify              # Show current notification config
fleet notify --on         # Enable notifications
fleet notify --off        # Disable notifications
fleet notify --sound      # Enable notification sound
fleet notify --no-sound   # Disable notification sound
```

## Data & State

All state is stored under `~/.config/claude-code-fleet/`:

| Path | Purpose |
|------|---------|
| `models.json` | Saved model profiles |
| `fleet-state.json` | Background instance PIDs (Fleet mode) |
| `fleet.sock` | Unix domain socket (transient, Observer mode) |
| `hooks/hook-client.js` | Hook script for tool events |
| `hooks/adapters/` | Tool adapter modules (Claude, Codex) used by hook-client |
| `hooks/notifier.js` | Desktop notification module (loaded by hook-client) |
| `notify.json` | Desktop notification preferences |
| `sessions/<id>.json` | Per-session metadata for Observer recovery |

## License

MIT
