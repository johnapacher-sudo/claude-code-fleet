# Claude Code Fleet

<!-- README-I18N:START -->

**English** | [汉语](./README.zh.md)

<!-- README-I18N:END -->

Run multiple AI coding tool instances with different API keys, models, and endpoints in parallel — from one terminal, zero dependencies. Supports **Claude Code**, **GitHub Copilot CLI**, and **Codex CLI**, with an extensible adapter architecture for future tools.

## Key Features

- **Multi-Tool Support** — Manage Claude Code, GitHub Copilot CLI, and Codex CLI from a single interface via an Adapter pattern; easy to extend for other tools
- **Observer Dashboard** — Real-time TUI that auto-discovers all AI coding tool processes and shows their status, actions, and AI messages
- **Terminal Focus** — Jump to any worker's terminal window/tab with one keypress (iTerm, Terminal.app, VSCode, Cursor, Warp, WezTerm)
- **Session Persistence** — Workers survive master restarts; session state is persisted to disk and auto-resumed
- **Model Profiles** — Named profiles for quick interactive sessions with different models, API keys, and proxy settings
- **HTTP Proxy** — Per-profile or per-run proxy support; auto-sets `HTTP_PROXY` and `HTTPS_PROXY` environment variables
- **Interactive UI** — Arrow-key selectors, confirmation dialogs, and multi-field input forms, all in the terminal
- **Desktop Notifications** — System notifications when a tool finishes a task or sends a notification, with configurable sound

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`npm install -g @anthropic-ai/claude-code`) and/or [GitHub Copilot CLI](https://docs.github.com/en/copilot) (`npm install -g @github/copilot`) and/or [Codex CLI](https://developers.openai.com/codex/) (`npm install -g @openai/codex`)

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
fleet model add copilot  # Add a GitHub Copilot CLI profile
fleet model add codex    # Add a Codex CLI profile

# Run a single instance (interactive picker)
fleet run

# Run with proxy enabled
fleet run --proxy
fleet run --proxy http://127.0.0.1:7890
fleet run --proxy=http://127.0.0.1:7890

# Pass extra arguments to the underlying tool
fleet run --model opus-prod -- -p "analyze this codebase"
fleet run --model opus-prod -- --full-auto

# Load balancer
fleet lb add                       # Create a pool interactively
fleet lb list                      # List all pools
fleet lb my-pool -- -p "hello"     # Distribute instruction across pool

# Start the observer dashboard
fleet observer

# Configure desktop notifications
fleet notify --on
fleet notify --no-sound
```

## Two Modes

### Observer Mode (Dashboard)

Start a real-time terminal dashboard that observes all active AI coding tool processes.

- `fleet observer` launches the observer TUI
- Automatically discovers all Claude Code and Codex CLI processes via async hooks
- Shows session ID, model name, tool type, working directory, tool usage, and AI messages per worker
- Workers appear when they start and are cleaned up when they stop (3+ hours inactive) or their process dies (30 minutes)
- Session state is persisted to disk — workers survive master restarts
- No config file required — just run `fleet observer` and launch Claude Code or Codex processes

### Model Profile Mode

Manage named model profiles and launch single interactive AI coding sessions.

- Profiles are stored globally at `~/.config/claude-code-fleet/models.json`
- Each profile stores: name, tool type, model ID, API key, API base URL, and optional proxy URL
- `fleet run` (or just `fleet` with no command) launches a foreground interactive session with `stdio` inherited
- If no `--model` flag is given, an interactive arrow-key menu appears
- Use `--proxy` to enable proxy via CLI, or rely on the profile's saved proxy URL

## Commands

| Command | Aliases | Description |
|---------|---------|-------------|
| `fleet start` | — | Start an interactive session with a model profile (alias for `run`) |
| `fleet observer` | — | Start observer dashboard (TUI) |
| `fleet hooks install` | — | Install fleet hooks for all detected tools |
| `fleet hooks remove` | — | Remove fleet hooks from all tools |
| `fleet hooks status` | — | Show hook installation status per tool |
| `fleet run` | — | Start an interactive session with a model profile |
| `fleet model add [tool]` | — | Add a new model profile (`claude`, `copilot`, `codex`, or interactive) |
| `fleet model list` | `model ls` | List all saved model profiles |
| `fleet model edit` | — | Interactively edit an existing model profile |
| `fleet model delete` | `model rm` | Interactively delete a model profile |
| `fleet notify` | — | Configure desktop notifications (`--on`, `--off`, `--sound`, `--no-sound`) |
| `fleet lb add` | — | Create a load balancer pool |
| `fleet lb list` | — | List all pools |
| `fleet lb delete` | — | Delete a pool (interactive) |
| `fleet lb <pool> [--failover <mode> \| --no-failover] [--max-retry <n>] -- <args>` | — | Run via pool with round-robin and classified failover |

## Load Balancer

Distribute instructions across a pool of model profiles using round-robin. `fleet lb` defaults to `safe-only` failover and `--max-retry 1`: it only switches models when the failure is explicitly classified as recoverable, and it will make at most one extra model switch unless you raise the retry budget.

### Constraints

- All models in a pool **must use the same tool** (e.g., all `claude`, or all `codex`). Mixed tool pools are rejected at creation.
- Each model profile's proxy settings are inherited automatically — no need for extra flags.

### How It Works

1. `fleet lb <pool> [--failover <mode> | --no-failover] [--max-retry <n>] -- <args>` reads the pool from `models.json`
2. Picks the next model via round-robin: `(lastIndex + 1) % pool.models.length`
3. Builds the spawn command via the adapter (`buildArgs` + `buildEnv`, including proxy)
4. Executes the tool process, waits for exit
5. On success: persists the last successful model index back to `models.json`
6. Under `safe-only`, only explicitly recoverable failures fail over to the next model
7. Use `--no-failover` (same as `--failover off`) to disable retries, `--failover always` to keep the legacy aggressive behavior, and `--max-retry <n>` to cap extra failover attempts
8. Startup timeout defaults to 10 seconds before the first stdout/stderr output
9. Failed attempts do not advance the persisted round-robin pointer
10. Exhausted or terminal failures are reported with a summary and exit code 1

The `lastIndex` is stored in the pool's `state` field in `models.json`, and it records the last **successful** route rather than the last attempted route.

### Data Model

Pools are stored alongside model profiles in `models.json`:

```json
{
  "models": [ ... ],
  "pools": [
    {
      "name": "my-pool",
      "models": ["GLM-wjs", "ADA-公司", "KIMI-部门"],
      "strategy": "round-robin",
      "state": { "lastIndex": -1 }
    }
  ]
}
```

### Global Options

| Flag | Description |
|------|-------------|
| `--model <name>` | Specify model profile (for `run` command) |
| `--cwd <path>` | Set working directory (for `run` command) |
| `--proxy [url]` | Enable HTTP proxy; uses profile's saved proxy URL if url omitted (for `run` command) |
| `--tools <names>` | Comma-separated tool names to target (for `hooks install`) |
| `--` | Pass all subsequent arguments to the underlying tool (for `run` command) |

## Observer Dashboard

### How It Works

1. Copies `hook-client.js` and adapter modules to `~/.config/claude-code-fleet/hooks/`
2. Auto-detects installed tools and injects hooks into each tool's config (`~/.claude/settings.json` for Claude, `~/.copilot/config.json` for Copilot, `~/.codex/hooks.json` for Codex)
3. Starts a Unix socket server at `~/.config/claude-code-fleet/fleet.sock`
4. When any tool process fires a hook, the client sends a normalized JSON event to the socket
5. Master tracks each session by `session_id`, recording model info, tool usage, and AI messages
6. TUI re-renders in real-time with 100ms debounce
7. Persists session metadata to disk — survives master restarts
8. Automatically removes workers whose process has died (30 min) or been inactive (3+ hours)

### Hook Events

| Event | Claude Code | Copilot CLI | Codex CLI | What It Captures |
|-------|:-----------:|:-----------:|:---------:|-----------------|
| `SessionStart` | ✓ | ✓ | ✓ | Model name, tool type, process PID/PPID, terminal program |
| `PostToolUse` | ✓ | ✓ | ✓ | Tool name and input (Edit/Write/Read show filename, Bash shows command, Grep shows pattern) |
| `Stop` | ✓ | ✓ | ✓ | Last assistant message (truncated to 500 chars), marks worker as idle |
| `Notification` | ✓ | — | — | Starts a new turn with the notification message as summary |

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

### Hooks

Hooks are installed into each tool's config file and are persistent — they survive master restarts. When the master is not running, hook-client exits silently in < 1ms (tool processes are unaffected).

```bash
fleet hooks install                # Auto-detect tools, install for all
fleet hooks install --tools codex  # Install for Codex only
fleet hooks install --tools copilot # Install for Copilot only
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
| `fleet.sock` | Unix domain socket (transient, Observer mode) |
| `hooks/hook-client.js` | Hook script for tool events |
| `hooks/adapters/` | Tool adapter modules (Claude, Copilot, Codex) used by hook-client |
| `hooks/notifier.js` | Desktop notification module (loaded by hook-client) |
| `notify.json` | Desktop notification preferences |
| `sessions/<id>.json` | Per-session metadata for Observer recovery |

## GitHub Copilot CLI — Model Profiles

Adding a Copilot model profile works the same as other tools (`fleet model add copilot`), with a few differences:

### Authentication

Copilot CLI supports two auth paths:

| Mode | `apiKey` in profile | What happens |
|------|---------------------|--------------|
| **GitHub PAT** | Fine-grained PAT with "Copilot Requests" permission | `buildEnv()` injects `COPILOT_GITHUB_TOKEN` |
| **Already logged in** | Empty (press Enter to skip) | Uses keychain OAuth from `copilot login` |

The `apiKey` field is **optional** for Copilot profiles — if you've already run `copilot login`, you can skip it. If provided, it's passed as `COPILOT_GITHUB_TOKEN` (highest-precedence auth), enabling multi-account support with different GitHub tokens per profile.

### Required Fields

Only **Name** and **Model ID** are required for Copilot profiles. API Key and API Base URL are optional — Copilot uses GitHub's model endpoint by default.

### Environment Variables

| Variable | Source | Description |
|----------|--------|-------------|
| `COPILOT_MODEL` | `model` field | Model ID (e.g. `gpt-4.1`, `gpt-4o`) |
| `COPILOT_GITHUB_TOKEN` | `apiKey` field | GitHub PAT (optional — uses OAuth if omitted) |

> **Tip**: To use different GitHub accounts simultaneously, create separate profiles with different PATs.

## License

MIT
