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

# Create your config
cp fleet.config.example.json fleet.config.json
# Edit fleet.config.json with your API keys and model preferences

# Launch the fleet
npm run fleet -- up

# Attach to the tmux session
npm run fleet -- attach
# or directly:
tmux attach -t claude-fleet
```

## Configuration

Copy `fleet.config.example.json` to `fleet.config.json` and customize:

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
    }
  ],
  "tmux": {
    "sessionName": "claude-fleet",
    "layout": "tiled"
  }
}
```

### Instance Options

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Instance name (used as tmux window name) |
| `apiKey` | Yes | Anthropic API key (`ANTHROPIC_API_KEY`) |
| `model` | No | Model to use (e.g., `claude-opus-4-6`, `claude-sonnet-4-6`) |
| `apiBaseUrl` | No | Custom API endpoint (`ANTHROPIC_BASE_URL`) |
| `cwd` | No | Working directory for the instance |

### Tmux Options

| Field | Default | Description |
|-------|---------|-------------|
| `sessionName` | `claude-fleet` | tmux session name |
| `layout` | `tiled` | tmux layout (`tiled`, `even-horizontal`, `even-vertical`, `main-horizontal`) |

## Commands

```bash
fleet up        # Start all instances (default command)
fleet down      # Stop the fleet
fleet ls        # List running instances
fleet attach    # Attach to the tmux session
```

## How It Works

1. Reads `fleet.config.json` for instance definitions
2. Creates a tmux session with one window per instance
3. Each window launches `claude` with the configured model and API key
4. All instances run in parallel within the tmux session

## Tmux Quick Reference

```bash
# Attach to fleet
tmux attach -t claude-fleet

# Switch between instances (inside tmux)
Ctrl+b n    # Next window
Ctrl+b p    # Previous window
Ctrl+b 0-9  # Jump to window by number

# Detach (fleet keeps running)
Ctrl+b d
```

## License

MIT
