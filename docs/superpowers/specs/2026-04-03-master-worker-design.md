# Master-Worker Architecture Design

> Date: 2026-04-03
> Status: Approved
> Scope: Add master process with TUI, task queue, and bidirectional communication to claude-code-fleet

## Overview

Add a master daemon process (`fleetd`) that manages multiple Claude Code worker instances. Workers run autonomously and report progress via Claude Code hooks. The master displays real-time status in a terminal TUI and supports dynamic task assignment.

Key interaction model: **fully autonomous with exception reporting**. Workers execute tasks from a queue without human intervention. Only errors or decisions requiring human input bubble up to the master TUI.

## Architecture

```
fleet start   →  Master (fleetd)
                  ├── TUI Panel (ANSI escape, zero deps)
                  ├── Unix Socket Server (~/.config/claude-code-fleet/fleet.sock)
                  ├── Task Queue Manager (per worker)
                  └── Worker Manager
                        ├── fork() Worker 1
                        │     └── spawn claude -p "task" --dangerously-skip-permissions
                        ├── fork() Worker 2
                        │     └── spawn claude -p "task" --dangerously-skip-permissions
                        └── ...
```

## Components

### 1. Master Process (`src/master.js`)

Single Node.js process running:

- **Unix Socket Server**: listens on `~/.config/claude-code-fleet/fleet.sock`, handles connections from hook-client.js instances
- **Task Queue Manager**: tracks per-worker task queues, handles dequeue and dynamic append
- **Worker Manager**: spawns worker processes via `fork()`, monitors health, handles restart
- **State Persistence**: writes worker status to `fleet-state.json` for crash recovery

### 2. Worker Wrapper (`src/worker.js`)

Node.js process forked from master:

- Receives config and initial task via IPC (`process.on('message')`)
- Spawns `claude` with `-p <task>` + `--dangerously-skip-permissions`
- Captures claude stdout/stderr and forwards to master for TUI display
- Reports claude process exit to master
- Master injects `.claude/settings.local.json` into worker's cwd before spawning

### 3. Hook Communication Bridge (`src/hook-client.js`)

Shared script at `~/.config/claude-code-fleet/hooks/hook-client.js`:

- Invoked by Claude Code hooks (PostToolUse, Stop, Notification)
- Reads JSON from stdin (Claude Code provides event context)
- Sends event to master via Unix socket
- Waits for master response, writes to stdout for Claude Code to consume
- Worker identity via env vars: `FLEET_WORKER_NAME`, `FLEET_SOCK_PATH`

### 4. TUI Panel (`src/tui.js`)

Terminal UI rendered with ANSI escape codes, zero dependencies:

- **Status panel**: worker name, status (RUNNING/IDLE/ERROR), task progress, current task, elapsed time
- **Log panel**: real-time scrolling events from all workers, color-coded by type
- **Input panel**: send tasks to selected worker, reply to notifications
- **Key bindings**: up/down select worker, Enter send, a add task, f filter logs, q quit

### 5. Unix Socket Layer (`src/socket.js`)

Bidirectional JSON-over-Unix-socket protocol:

- Master listens, hook-client.js connects per event
- Request/response model: hook-client sends event, master responds synchronously
- Response determines hook behavior (continue, stop, inject instruction)

## Hook Protocol

### Settings Injection

Master generates `.claude/settings.local.json` in each worker's cwd:

```json
{
  "hooks": {
    "PostToolUse": [{
      "hooks": [{
        "type": "command",
        "command": "FLEET_WORKER_NAME=<name> FLEET_SOCK_PATH=<path> node ~/.config/claude-code-fleet/hooks/hook-client.js PostToolUse",
        "timeout": 5
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "FLEET_WORKER_NAME=<name> FLEET_SOCK_PATH=<path> node ~/.config/claude-code-fleet/hooks/hook-client.js Stop",
        "timeout": 30
      }]
    }],
    "Notification": [{
      "hooks": [{
        "type": "command",
        "command": "FLEET_WORKER_NAME=<name> FLEET_SOCK_PATH=<path> node ~/.config/claude-code-fleet/hooks/hook-client.js Notification",
        "timeout": 5
      }]
    }]
  }
}
```

### Message Formats

**PostToolUse** (Worker → Master):

```json
{ "event": "PostToolUse", "worker": "opus-worker", "tool_name": "Edit", "tool_input": { "file_path": "...", "old_string": "...", "new_string": "..." }, "tool_response": "..." }
```

Master response: `{ "ok": true }`

**Notification** (Worker → Master):

```json
{ "event": "Notification", "worker": "opus-worker", "message": "API rate limit", "notification_type": "permission_prompt" }
```

Master response: `{ "ok": true }`

**Stop** (Worker → Master):

```json
{ "event": "Stop", "worker": "opus-worker", "last_assistant_message": "...", "session_id": "abc-123" }
```

Master response — continue with next task:

```json
{ "action": "continue", "reason": "Implement error handling for the API layer" }
```

Master response — no more tasks:

```json
{ "action": "stop" }
```

### Stop Hook Response Behavior

When hook-client.js receives `action: "continue"` from master:

```json
{ "decision": "block", "reason": "Implement error handling for the API layer" }
```

Claude Code receives this as a new instruction and continues working in the same session.

When hook-client.js receives `action: "stop"` from master: exit with code 0, Claude Code stops normally.

## Task Queue

### Configuration

Tasks defined per-instance in `fleet.config.json`:

```json
{
  "instances": [
    {
      "name": "opus-worker",
      "apiKey": "sk-ant-xxx",
      "model": "claude-opus-4-6",
      "cwd": "./workspace/opus",
      "tasks": [
        "Analyze project architecture",
        "Refactor src/core.js into modules",
        "Write unit tests for core modules"
      ]
    }
  ]
}
```

`tasks` is optional. If omitted, worker starts IDLE and waits for master to assign tasks.

### Queue State Machine

```
PENDING → RUNNING → CHECKING → RUNNING (next task) or IDLE
                                     ↑                |
                                     └── master push ─┘
```

States per worker:

| State | Description |
|-------|-------------|
| PENDING | Queued, not yet started |
| RUNNING | Executing a task via claude |
| CHECKING | Stop hook fired, querying master for next task |
| IDLE | No tasks remaining, waiting for master |
| ERROR | Claude process exited abnormally |

### Master-side Data Structure

```js
{
  workerName: {
    status: 'running' | 'idle' | 'error',
    currentTask: 'Refactor src/core.js',
    taskIndex: 2,
    totalTasks: 5,
    pendingTasks: ['Write unit tests'],
    completedTasks: ['Analyze architecture', 'Refactor modules'],
    sessionId: 'abc-123',
    lastActivity: Date.now(),
    pid: 12345
  }
}
```

### Dynamic Task Append

Tasks can be added at runtime via:
- TUI input: select worker, type new task
- CLI command: `fleet task add <worker> "task description"`

New tasks are appended to `pendingTasks`. The next Stop hook call will pick them up.

## TUI Layout

```
┌─ Claude Code Fleet ────────────────────────────────────── HH:MM:SS ─┐
│                                                                      │
│  ● opus-worker    RUNNING   2/5  Refactoring core.js     00:03:12   │
│  ● sonnet-worker  RUNNING   1/3  Implementing API         00:01:45   │
│  ○ haiku-worker   IDLE      3/3  (no pending tasks)       00:08:22   │
│  ! custom-worker  ERROR     0/2  API rate limit            00:00:03   │
│                                                                      │
├─ Worker Logs ────────────────────────────────────────────────────────┤
│ [opus] PostToolUse: Edit src/core.js (line 45-78)                   │
│ [opus] PostToolUse: Bash "npm test"                                  │
│ [sonnet] Notification: Need database config confirmation             │
│ [haiku] Stop: All tasks completed, now idle                          │
│ [custom] Error: API rate limit exceeded                              │
├─ Input ──────────────────────────────────────────────────────────────┤
│ > _                                                                  │
│                                                                      │
│ Keys: ↑↓ select | Enter send | a add task | f filter | q quit       │
└──────────────────────────────────────────────────────────────────────┘
```

### Key Bindings

| Key | Action |
|-----|--------|
| Up/Down | Switch selected worker |
| Enter | Send input text to selected worker |
| `a` | Add task to selected worker's queue |
| `f` | Filter logs to selected worker |
| `q` | Quit master TUI (workers continue running) |

## Worker Lifecycle

### Startup Sequence

1. Master reads `fleet.config.json`
2. For each instance:
   a. Ensure `cwd` directory exists
   b. Write `cwd/.claude/settings.local.json` (hook injection)
   c. Copy `hook-client.js` to `~/.config/claude-code-fleet/hooks/`
   d. `fork(worker.js)` with instance config via IPC
3. Worker spawns `claude -p "<first task>" --dangerously-skip-permissions --model <model>`
4. Worker captures claude stdout/stderr, forwards to master

### Error Handling

| Scenario | Handling |
|----------|----------|
| Claude process crashes | Worker notifies master, TUI shows `! ERROR`, user can retry or skip from TUI |
| Master crashes | Workers and Claude continue; hooks silently fail open (timeout → Claude continues) |
| Hook timeout | Claude Code enforces timeout from settings; on timeout Claude proceeds normally |
| No tasks available | Stop hook returns exit 0, Claude stops, worker enters IDLE |
| Socket connection failure | hook-client.js catches error, exits with code 0 (non-blocking), Claude proceeds |

### Master Recovery

On startup, master checks `fleet-state.json` for running worker PIDs. If found and alive, reconnects to existing workers instead of respawning. TUI restores state from the persisted data.

## Command Changes

### New Commands

| Command | Description |
|---------|-------------|
| `fleet start` | Start master daemon with all workers |
| `fleet attach` | Connect TUI to a running master |
| `fleet task add <worker> <task>` | Append task to a worker's queue |

### Preserved Commands (Backward Compatible)

| Command | Behavior |
|---------|----------|
| `fleet up` | Start workers without master (existing behavior) |
| `fleet down` | Stop background workers (existing behavior) |
| `fleet ls` | List running instances (existing behavior) |
| `fleet run` | Single interactive session (existing behavior) |
| `fleet model *` | Model profile management (existing behavior) |

## File Structure

### Source Files

```
src/
  index.js              # Entry point + command routing (existing)
  master.js             # Master: TUI + Socket Server + Task Manager
  worker.js             # Worker wrapper: manages claude subprocess
  hook-client.js        # Hook bridge: claude → Unix socket → master
  tui.js                # TUI rendering with ANSI escapes
  socket.js             # Unix Socket Server/Client
```

### Runtime Files

```
~/.config/claude-code-fleet/
  fleet.sock              # Unix socket (exists while master runs)
  fleet-state.json        # Worker PID + state persistence (existing)
  models.json             # Model profiles (existing)
  hooks/
    hook-client.js        # Shared hook communication script
```

### Config Changes

`fleet.config.example.json` adds optional `tasks` field per instance.

## Constraints

- Zero external dependencies (Node.js built-in modules only)
- Node.js >= 18 required
- Claude Code CLI must be installed globally
- Unix socket requires a Unix-like OS (macOS, Linux)
- No Windows support for master mode (Unix socket limitation; basic fleet mode still works)
