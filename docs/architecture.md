# Architecture

## Runtime Contexts

The project has three independent runtime contexts that share source code but never run in the same process:

### CLI Context (`src/index.js`)

- **Lifecycle:** Process starts, handles one command, exits.
- **Responsibilities:** Argument parsing, model profile CRUD, spawning tool processes (`fleet run`), hook management (`fleet hooks install/remove/status`), notification config (`fleet notify`).
- **Key flow:** `parseArgs()` → command router → `cmdRun()`/`cmdModelAdd()`/etc. For `fleet run`, loads profile → `adapter.buildArgs()` + `adapter.buildEnv()` → `spawn(adapter.binary, args, { stdio: 'inherit' })`.

### Observer Context (`src/master.js` + `src/socket.js` + `src/tui.js`)

- **Lifecycle:** Long-lived daemon started by `fleet start`. Runs until SIGINT/SIGTERM.
- **Responsibilities:** Accept hook events via Unix socket, track per-session worker state, render TUI dashboard, persist sessions to disk, clean up expired workers.
- **Startup sequence:**
  1. `ensureHooks()` — copies hook-client.js + notifier.js + adapter modules to `~/.config/claude-code-fleet/hooks/`, then calls `adapter.installHooks()` for each installed tool.
  2. `loadPersistedSessions()` — reads session JSON files, verifies processes are alive, rebuilds workers Map.
  3. Creates TUI (async Ink init).
  4. Creates SocketServer on `fleet.sock`.
  5. Starts 5-minute cleanup interval.

### Hook Context (`src/hook-client.js`)

- **Lifecycle:** One-shot process spawned by each AI tool on every hook event. Reads stdin, processes, exits in ~1 second.
- **Responsibilities:** Read raw JSON from stdin, normalize via adapter, persist session file (SessionStart/Stop), forward to Unix socket, send desktop notification (Stop/Notification).
- **Key property:** Must be lightweight. No imports from master/socket/tui. Only loads the specific adapter module it needs.

## Module Dependencies

```
index.js ──→ adapters/index.js (registry)
         ──→ master.js (for fleet start, hooks install/remove)

master.js ──→ socket.js (SocketServer)
          ──→ tui.js (TUI)
          ──→ adapters/index.js (registry, for summarizeToolUse)

tui.js ──→ components/app.mjs (dynamic import)

hook-client.js ──→ adapters/<name>.js (loadAdapter)
               ──→ notifier.js (optional)

app.mjs ──→ header.mjs, worker-card.mjs, footer.mjs, colors.mjs, terminal-focus.mjs

index.js ──→ components/selector.mjs (for model add/edit/delete interactive UI)
```

## Hook Event Data Flow

1. AI tool process fires a hook event (e.g., Claude Code calls a PostToolUse hook).
2. Tool spawns `node hook-client.js --tool claude`, passing raw JSON via stdin.
3. `hook-client.js` loads the `ClaudeAdapter`, calls `normalizePayload(rawInput)`.
4. The adapter maps tool-specific fields to a canonical payload (see `docs/protocol.md`).
5. `hook-client.js` adds `_tool` and `fleet_model_name` fields.
6. For SessionStart: persists `~/.config/claude-code-fleet/sessions/<session_id>.json`.
7. Opens Unix socket connection to `fleet.sock`, writes `JSON.stringify(payload) + '\n'`.
8. `SocketServer` receives the line, parses JSON, calls `Master.handleEvent(payload)`.
9. Master updates the worker state Map based on event type.
10. Master calls `tui.scheduleRender()` (100ms debounce).
11. TUI triggers `master._renderCallback()` → React `setTick(t + 1)` → Ink re-render.
12. For Stop/Notification events: `hook-client.js` also sends desktop notifications via `notifier.js`.

## Worker State Machine

Workers are tracked in `Master.workers` as a `Map<sessionId, WorkerState>`.

```
[New session] ──→ active (PostToolUse) ──→ thinking (actions done, <90s)
                  │                            │
                  │                            ├──→ active (new PostToolUse)
                  │                            └──→ idle (Stop event)
                  │
                  └──→ idle (Stop event) ──→ active (new PostToolUse)

Any state ──→ offline (parent process dead)
offline ──→ [deleted after 30 minutes or 3 hours inactive]
```

States:
- **active:** Worker has a running action in `currentTurn.actions`.
- **thinking:** All actions in `currentTurn` are done, but last action was <90 seconds ago (AI is between tool calls).
- **idle:** `Stop` event received or `awaitsInput` is true. AI finished a response.
- **offline:** Parent process (`ppid`) is dead. Deleted after 30 minutes.

Workers are sorted: active → thinking → idle → offline, then by last event time or name (toggle with Tab).

## Session Persistence

- On `SessionStart`: hook-client writes `sessions/<session_id>.json` with metadata (session ID, cwd, model, tool, terminal info, PID, PPID).
- On `Stop`: hook-client updates session file with `stoppedAt` and `lastMessage`.
- On Observer startup: `Master.loadPersistedSessions()` reads all session files, verifies PPIDs are alive, rebuilds the workers Map. Dead sessions are cleaned up.
- This allows workers to survive master restarts — the hook-client always persists to disk independently.
