# Claude Code Fleet

Run multiple Claude Code instances with different API keys, models, and endpoints in parallel — managed through tmux.

## Why

When you need to:

- Run multiple Claude Code workers simultaneously (e.g., Opus for architecture, Sonnet for implementation, Haiku for quick tasks)
- Use different API keys to distribute rate limits
- Route requests through different endpoints or proxies
- Manage it all from one terminal

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`npm install -g @anthropic-ai/claude-code`)
- [tmux](https://github.com/tmux/tmux)

## Quick Start

```bash
# Clone the repo
git clone https://github.com/<your-username>/claude-code-fleet.git
cd claude-code-fleet

# Initialize config (creates fleet.config.json from template)
node src/index.js init

# Edit with your API keys and model preferences
# Or manually: cp fleet.config.example.json fleet.config.json

# Launch the fleet
node src/index.js up

# Attach to the tmux session
node src/index.js attach
```

## Commands

```
fleet up                          Start all instances
fleet up --only opus,sonnet       Start only named instances
fleet up --config ~/my-fleet.json Use specific config file
fleet down                        Stop the fleet
fleet restart                     Restart the fleet
fleet restart --only sonnet       Restart specific instances
fleet ls                          List running instances
fleet status                      Show detailed instance configs
fleet attach                      Attach to the tmux session
fleet init                        Create fleet.config.json from template
```

## Configuration

### Config file search order

1. `fleet.config.local.json` (gitignored, for local overrides)
2. `fleet.config.json`
3. `~/.config/claude-code-fleet/config.json`

### Instance options

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Instance name (used as tmux window name) |
| `apiKey` | Yes | Anthropic API key (`ANTHROPIC_API_KEY`) |
| `model` | No | Model to use (e.g., `claude-opus-4-6`, `claude-sonnet-4-6`) |
| `apiBaseUrl` | No | Custom API endpoint (`ANTHROPIC_BASE_URL`) |
| `cwd` | No | Working directory for the instance |
| `env` | No | Additional environment variables as key-value pairs |
| `args` | No | Extra CLI arguments passed to `claude` |

### Example

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
  ],
  "tmux": {
    "sessionName": "claude-fleet",
    "layout": "tiled"
  }
}
```

### Tmux options

| Field | Default | Description |
|-------|---------|-------------|
| `sessionName` | `claude-fleet` | tmux session name |
| `layout` | `tiled` | tmux layout (`tiled`, `even-horizontal`, `even-vertical`, `main-horizontal`) |

## How It Works

1. Reads config file for instance definitions
2. Validates configuration (required fields, duplicate names)
3. Checks for `tmux` and `claude` CLI dependencies
4. Creates a tmux session with one window per instance
5. Each window launches `claude` with the configured model and environment
6. All instances run in parallel within the tmux session

## Tmux Quick Reference

```bash
tmux attach -t claude-fleet   # Attach to fleet

# Inside tmux:
Ctrl+b n    # Next window
Ctrl+b p    # Previous window
Ctrl+b 0-9  # Jump to window by number
Ctrl+b d    # Detach (fleet keeps running)
```

## License

MIT
