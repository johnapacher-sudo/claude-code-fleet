# GitHub Copilot CLI — Model Profile Guide

Guide for adding and managing GitHub Copilot CLI model profiles in Claude Code Fleet.

## Adding a Copilot Profile

```bash
fleet model add copilot
```

This opens an interactive form with the following fields:

| Field | Required | Placeholder | Description |
|-------|----------|-------------|-------------|
| **Name** | Yes | `e.g. copilot-prod` | Profile name for `fleet run` selection |
| **Model ID** | Yes | `e.g. gpt-4.1` | Model passed via `COPILOT_MODEL` env var |
| **API Key** | No | `GitHub PAT (copilot_requests), press Enter to skip` | GitHub PAT; skip to use OAuth |
| **API Base URL** | No | `not required (uses GitHub models)` | Not applicable for Copilot |
| **Proxy URL** | No | `http://127.0.0.1:7890 (optional)` | HTTP proxy if needed |

## Authentication

Copilot CLI supports two authentication paths:

### Option 1: OAuth (default)

If you've already run `copilot login`, your credentials are stored in the system keychain. Leave the API Key field empty — Copilot will use the stored OAuth token automatically.

```bash
# Login first (one-time)
copilot login

# Then add a profile without API key
fleet model add copilot
# → Press Enter on "API Key" to skip
```

### Option 2: GitHub PAT (for multi-account)

Use a Fine-grained Personal Access Token with the **"Copilot Requests"** permission. This enables:

- **Multi-account support** — different profiles with different GitHub tokens can run simultaneously
- **CI/CD usage** — token-based auth without interactive login

Steps:
1. Go to GitHub Settings → Developer settings → Fine-grained tokens
2. Create a new token with **"Copilot Requests"** permission (under "Account permissions")
3. Paste the token as the API Key in the profile form

```bash
fleet model add copilot
# Name: copilot-account-1
# Model ID: gpt-4.1
# API Key: github_pat_xxxxxxxxxxxx
# API Base URL: (skip)
```

## Environment Variables

When you run `fleet run --model <name>` with a Copilot profile, the following environment variables are set:

| Variable | Source | Behavior |
|----------|--------|----------|
| `COPILOT_MODEL` | `model` field | Always set if Model ID is provided |
| `COPILOT_GITHUB_TOKEN` | `apiKey` field | Only set if API Key is provided; highest-precedence auth |
| `FLEET_MODEL_NAME` | `name` field | Internal tracking by Fleet |
| `HTTP_PROXY` / `HTTPS_PROXY` | `proxy` field | Set if proxy URL is provided |

## Multi-Account Example

Run two Copilot workers with different GitHub accounts:

```bash
# Profile for personal account
fleet model add copilot
# Name: copilot-personal
# Model ID: gpt-4.1
# API Key: github_pat_personal_xxx

# Profile for work account
fleet model add copilot
# Name: copilot-work
# Model ID: gpt-4.1
# API Key: github_pat_work_xxx

# Run both simultaneously
fleet run --model copilot-personal &
fleet run --model copilot-work &
```

## Available Models

Copilot CLI provides access to models hosted by GitHub. Common model IDs include:

- `gpt-4.1` — GPT-4.1
- `gpt-4o` — GPT-4o
- `o3` — o3
- `o4-mini` — o4-mini
- `claude-sonnet-4-20250514` — Claude Sonnet 4 (via GitHub Models)
- `gemini-2.5-pro` — Gemini 2.5 Pro (via GitHub Models)

> Model availability depends on your GitHub Copilot subscription and organization settings.

## Editing a Profile

```bash
fleet model edit
```

Select the Copilot profile to edit. The form will show the same fields with current values. The same validation rules apply — only Name and Model ID are required.

## Hook Events

Copilot CLI emits the following hook events, captured by Fleet's observer:

| Copilot Event | Fleet Event | Description |
|---------------|-------------|-------------|
| `sessionStart` | `SessionStart` | Session begins, captures model and process info |
| `postToolUse` | `PostToolUse` | After a tool call (Edit, Write, Bash, etc.) |
| `sessionEnd` | `Stop` | Session ends with `reason`: `complete`, `error`, `abort`, `timeout`, `user_exit` |

Hooks are installed per-repo into `<repo>/.github/hooks/fleet.json`. Copilot CLI does not support global hooks. To manage:

```bash
# In the target repository directory:
fleet hooks install --tools copilot  # Install Copilot hooks in current directory
fleet hooks status                   # Check status (checks current directory for Copilot)
fleet hooks remove                   # Remove hooks from current directory

# Or simply use fleet run — hooks are installed automatically
fleet run --model my-copilot-profile
```
