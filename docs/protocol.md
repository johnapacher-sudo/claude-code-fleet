# Protocol & Interface Specification

## Hook Event Types

| Event | Fired When | Claude | Codex | Copilot |
|-------|-----------|:------:|:-----:|:-------:|
| `SessionStart` | Tool process starts a new session | Yes | Yes | Yes |
| `PostToolUse` | Tool completes a tool call (Edit, Bash, Read, etc.) | Yes | Yes | Yes |
| `Stop` | Tool finishes a response and awaits user input | Yes | Yes | Yes |
| `Notification` | Tool sends a notification | Yes | No | No |

## Canonical Payload Format

All adapters must normalize tool-specific input into this format:

```javascript
{
  event: 'SessionStart' | 'PostToolUse' | 'Stop' | 'Notification',
  session_id: string | null,
  cwd: string | null,
  timestamp: number,           // Unix ms
  model: string | null,
  pid: number,                 // hook-client process PID
  ppid: number,                // hook-client parent PID
  term_program: string | null, // e.g. 'iTerm.app'
  iterm_session_id: string | null,
  tool_name: string | null,          // PostToolUse only
  tool_input: object | string | null, // PostToolUse only
  last_assistant_message: string | null, // Stop only, max 500 chars
  message: string | null,             // Notification only
  notification_type: string | null,   // Notification only (Claude)
}
```

After normalization, `hook-client.js` injects:
```javascript
{
  _tool: string,         // Adapter name (e.g. 'claude')
  tool: string,          // Same as _tool
  fleet_model_name: string | undefined, // From FLEET_MODEL_NAME env var
}
```

## Tool-Specific Input Formats

### Claude Code Input

Claude Code passes hook input via stdin as JSON with PascalCase fields:

```json
{
  "hook_event_name": "PostToolUse",
  "session_id": "abc-123",
  "cwd": "/path/to/project",
  "model": "claude-opus-4-6",
  "tool_name": "Edit",
  "tool_input": { "file_path": "/path/to/file.js", "old_string": "...", "new_string": "..." },
  "last_assistant_message": "I've updated the file...",
  "message": "...",
  "notification_type": "..."
}
```

### Codex CLI Input

Same format as Claude Code (PascalCase field names). No `notification_type` field.

### Copilot CLI Input

Copilot uses camelCase field names and different structure:

```json
{
  "type": "postToolUse",
  "sessionId": "abc-123",
  "cwd": "/path/to/project",
  "model": "gpt-4.1",
  "toolName": "Edit",
  "toolArgs": "{\"file_path\":\"...\"}",
  "toolResult": { "textResultForLlm": "..." },
  "reason": "task completed"
}
```

Copilot event mapping: `sessionEnd` → `Stop`, `sessionStart` → `SessionStart`, `postToolUse` → `PostToolUse`.

## Unix Socket Protocol

Transport: Unix domain socket at `~/.config/claude-code-fleet/fleet.sock`.

Protocol: **Newline-delimited JSON**. Each message is a single JSON object on one line, terminated by `\n`.

### Client (hook-client.js) behavior:

1. `net.connect(sockPath)`
2. On connect: write `JSON.stringify(payload) + '\n'`
3. Call `client.end()`
4. `process.exit(0)` after 1-second timeout (ensures socket write completes)

### Server (SocketServer) behavior:

1. `net.createServer()` listening on socket path
2. Accumulate data in buffer
3. Split on `\n` boundaries
4. Parse each line as JSON
5. Call `handler(payload)` for each parsed object
6. Silently ignore malformed JSON lines

## Hook Config File Formats

### Claude Code (`~/.claude/settings.json`)

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node /path/to/hook-client.js --tool claude" }] }
    ],
    "PostToolUse": [],
    "Stop": [],
    "Notification": []
  }
}
```

Fleet identifies its hooks by checking if `command` contains `'claude-code-fleet'`. Uses atomic write (tmp + rename).

### Codex CLI (`~/.codex/hooks.json`)

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node /path/to/hook-client.js --tool codex" }] }
    ],
    "PostToolUse": [],
    "Stop": []
  }
}
```

Also requires `codex_hooks = true` in `~/.codex/config.toml` under `[features]`.

### Copilot CLI (`<repo>/.github/hooks/fleet.json`)

Copilot CLI loads hooks from `.github/hooks/*.json` in the repository working directory. There is no global hooks support. Fleet writes a single `fleet.json` file per repo:

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      { "type": "command", "bash": "node /path/to/hook-client.js --tool copilot" }
    ],
    "postToolUse": [
      { "type": "command", "bash": "node /path/to/hook-client.js --tool copilot" }
    ],
    "sessionEnd": [
      { "type": "command", "bash": "node /path/to/hook-client.js --tool copilot" }
    ]
  }
}
```

Note: `"version": 1` is required. Events must be nested under a `"hooks"` key. Copilot uses camelCase event keys and `{ type: 'command', bash: ... }` format. Hooks are installed automatically by `fleet run` or manually via `fleet hooks install --tools copilot` in the target repo directory.

## Model Profile Schema

Stored at `~/.config/claude-code-fleet/models.json`:

```json
{
  "models": [
    {
      "name": "opus-prod",
      "tool": "claude",
      "model": "claude-opus-4-6",
      "apiKey": "sk-ant-...",
      "apiBaseUrl": "https://api.anthropic.com",
      "proxy": "http://127.0.0.1:7890"
    }
  ]
}
```

All fields except `name` are optional. The `tool` field is auto-migrated to `'claude'` if missing.

## Notification Config Schema

Stored at `~/.config/claude-code-fleet/notify.json`:

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

Defaults: all `true`. Missing fields fall back to defaults.

## Session File Schema

Stored at `~/.config/claude-code-fleet/sessions/<session_id>.json`:

```json
{
  "sessionId": "abc-123",
  "cwd": "/path/to/project",
  "model": "claude-opus-4-6",
  "tool": "claude",
  "term_program": "iTerm.app",
  "iterm_session_id": "...",
  "pid": 12345,
  "ppid": 12340,
  "fleet_model_name": "opus-prod",
  "timestamp": 1713523200000,
  "stoppedAt": 1713523800000,
  "lastMessage": { "text": "...", "time": 1713523800000 }
}
```

`stoppedAt` and `lastMessage` are added by the Stop event handler.
