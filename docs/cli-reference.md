# CLI Reference

Binary: `fleet` (entry: `src/index.js`)

## Commands

### `fleet start`

Start an interactive AI tool session with a model profile. Alias for `fleet run`.

```bash
fleet start                      # Interactive model picker
fleet start --model opus-prod    # Use specific profile
fleet start --cwd /path/to/project
```

### `fleet run` (default)

Start an interactive AI tool session with a model profile.

```bash
fleet run                        # Interactive model picker
fleet run --model opus-prod      # Use specific profile
fleet run --model opus-prod --proxy              # Use profile's saved proxy
fleet run --model opus-prod --proxy http://1.2.3.4:7890  # Explicit proxy
fleet run --cwd /path/to/project # Set working directory
```

Spawns the tool process with `stdio: 'inherit'` so user interacts directly.

### `fleet observer`

Start the observer dashboard (TUI). Long-running process.

Auto-detects installed tools, deploys hooks, starts Unix socket server, renders real-time dashboard.

### `fleet model add [tool]`

Add a new model profile. Optional tool argument (`claude`, `codex`, `copilot`). If omitted, shows interactive tool picker.

```bash
fleet model add           # Interactive: pick tool, then fill form
fleet model add claude    # Skip tool picker, go straight to form
fleet model add copilot   # Copilot form (API key optional)
```

Interactive form fields: Name, Model ID, API Key, API Base URL, Proxy URL. Copilot profiles only require Name and Model ID.

### `fleet model list` / `fleet model ls`

Print all saved model profiles with key/endpoint/proxy details.

### `fleet model edit`

Interactive edit loop: selector → form → confirm. Can edit any field of an existing profile. Supports renaming.

### `fleet model delete` / `fleet model rm`

Interactive: selector → confirm (danger mode, red styling). Permanently removes the profile.

### `fleet hooks install [--tools <names>]`

Deploy fleet hooks for all detected tools, or specific tools.

```bash
fleet hooks install                 # All detected tools
fleet hooks install --tools codex   # Codex only
fleet hooks install --tools copilot # Copilot only
fleet hooks install --tools claude,codex  # Multiple
```

Copies hook-client.js, notifier.js, and adapter modules to `~/.config/claude-code-fleet/hooks/`, then writes hook config into each tool's settings file. **Note:** For Copilot, hooks are installed per-repo into `<cwd>/.github/hooks/fleet.json` — run this command in the target repository directory, or use `fleet run` which installs hooks automatically.

### `fleet hooks remove`

Remove fleet hooks from all tool config files (Claude, Codex). For Copilot, removes `<cwd>/.github/hooks/fleet.json` from the current directory only. Does not delete the deployed files in `~/.config/claude-code-fleet/hooks/`.

### `fleet hooks status`

Show per-tool hook installation status:
- Whether CLI is installed (`which <binary>`)
- Whether hooks are registered in tool config
- List of configured event types per tool

### `fleet notify`

Manage desktop notification preferences.

```bash
fleet notify              # Show current config
fleet notify --on         # Enable notifications
fleet notify --off        # Disable notifications
fleet notify --sound      # Enable notification sound
fleet notify --no-sound   # Disable notification sound
```

Config stored at `~/.config/claude-code-fleet/notify.json`.

## Global Options

| Flag | Description |
|------|-------------|
| `--model <name>` | Model profile name (for `run`/`start`) |
| `--cwd <path>` | Working directory (for `run`/`start`) |
| `--proxy [url]` | Enable HTTP proxy (for `run`/`start`). Uses profile's saved proxy if url omitted |
| `--tools <names>` | Comma-separated tool names (for `hooks install`) |
| `-v`, `--version` | Show version |
| `-h`, `--help` | Show help |

## Model Profile System

Profiles stored at `~/.config/claude-code-fleet/models.json`.

Each profile:
- `name` — Unique identifier (required)
- `tool` — Adapter name: `claude`, `codex`, or `copilot` (required, auto-migrated to `claude'` if missing)
- `model` — Model ID string (e.g., `claude-opus-4-6`, `gpt-4.1`)
- `apiKey` — Tool-specific API key (optional for Copilot)
- `apiBaseUrl` — Custom API endpoint (optional)
- `proxy` — HTTP proxy URL (optional, applied when `--proxy` flag is used)

## Interactive UI Components

All interactive prompts use Ink (React for the terminal):

- **Selector:** Arrow keys or `j`/`k` to navigate, Enter to confirm, `q`/Ctrl+C to abort. Supports danger mode (red accent for destructive actions).
- **Confirm:** `y`/Enter to confirm, `n`/`q`/Escape to cancel.
- **Input Form:** Up/Down/Tab to navigate fields, inline text editing with backspace/delete, required field validation with error highlighting.
