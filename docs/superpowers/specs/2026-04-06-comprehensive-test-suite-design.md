# Comprehensive Test Suite Design

## Overview

Add a complete test suite covering all modules of Claude Code Fleet using Vitest. The project currently has zero tests. The goal is to achieve thorough coverage of all pure functions, class methods, CLI commands, and React/Ink UI components.

## Decisions

- **Framework**: Vitest — ESM-native, fast, works well with .mjs components
- **Mocking**: Heavy mocking — mock fs, child_process, net, and claude CLI. Tests run fast without real system dependencies.
- **UI testing**: Use ink-testing-library for React/Ink component rendering tests
- **Structure**: One test file per source module, mirroring the project layout

## Test Structure

```
tests/
├── setup.js                    # Vitest setup, global mocks
├── index.test.js               # CLI, commands, state, config
├── master.test.js              # Master class, event handling, hooks
├── socket.test.js              # SocketServer
├── hook-client.test.js         # Hook payload construction, session persistence
├── tui.test.js                 # TUI class
└── components/
    ├── colors.test.mjs         # Color constants
    ├── header.test.mjs         # Header rendering
    ├── footer.test.mjs         # Footer rendering
    ├── worker-card.test.mjs    # WorkerCard, helpers
    ├── selector.test.mjs       # Selector, ConfirmDialog, InputForm
    ├── terminal-focus.test.mjs # focusTerminal, TERMINAL_NAMES
    └── app.test.mjs            # App component, getWorkerStatus
```

## Dependencies to Install

```
vitest
ink-testing-library
@vitest/coverage-v8
```

## Detailed Test Cases

### 1. `tests/index.test.js` (~40 tests)

**Pure functions:**
- `stripAnsi` — removes ANSI escape codes from strings
- `truncStr` — truncates strings with ellipsis at max length; handles null, undefined, short strings
- `modelMeta` — formats API key (truncated) and endpoint display string
- `modelWarning` — detects missing Name, API Key, Model ID; returns undefined when all present
- `modelItem` — builds display item with label, detail, meta, warning, value

**Config & validation:**
- `validateConfig` — rejects non-array instances, empty instances, missing name, missing apiKey, duplicate names
- `findConfigFile` — CLI path takes priority; searches local then global paths; exits on not-found CLI path
- `loadConfig` — loads and returns valid config; exits on invalid JSON; exits on validation errors
- `configSearchPaths` — returns 3 paths in correct order

**State management:**
- `loadState` — returns `{ instances: {} }` for missing file; parses valid JSON; returns empty on corrupt file
- `saveState` — creates directory if needed; writes JSON with trailing newline
- `isProcessAlive` — returns true for current process PID; returns false for PID 99999999
- `cleanupState` — removes dead PIDs from state; keeps alive PIDs; saves only when changed

**Commands:**
- `filterInstances` — returns all when no filter; filters by name; warns on unknown names; exits on no match
- `cmdModelList` — displays model profiles; handles empty list with message
- `cmdInit` — creates config file from example; rejects if file exists
- `cmdHooksStatus` — displays hook status for all 4 events; handles missing/corrupt settings
- `cmdLs` — lists running instances; handles empty state
- `cmdStatus` — shows instance config details
- `cmdDown` — stops running instances; handles already-exited processes
- `cmdHooksInstall` — calls ensureHooks and prints success
- `cmdHooksRemove` — calls removeHooks and prints success

**CLI routing:**
- `parseArgs` — parses command, subcommand, `--config`, `--only`, `--model`, `--cwd`, `--help`
- `main` — routes `init`, `model add/list/edit/delete`, `run`, `start`, `hooks install/remove/status`, `up`, `down`, `restart`, `ls`, `status`; shows help for unknown commands

### 2. `tests/master.test.js` (~30 tests)

**Event handling:**
- `handleEvent('SessionStart')` — creates worker entry with session metadata, sets model/term/pid
- `handleEvent('PostToolUse')` — sets status active, creates currentTurn if needed, adds action, updates lastActions (max 3)
- `handleEvent('Notification')` — closes current turn (marks actions done, sets summary), starts new empty turn
- `handleEvent('Stop')` — sets status idle, sets awaitsInput true, closes current turn with summary, persists lastMessage
- `handleEvent` — ignores events without session_id
- Full lifecycle — SessionStart → PostToolUse → PostToolUse → Notification → PostToolUse → Stop

**Cleanup:**
- `cleanupExpired` — marks dead processes offline; removes workers dead for 30+ minutes; removes workers inactive for 3+ hours; keeps active workers

**Persistence:**
- `loadPersistedSessions` — loads from session files; skips dead processes (deletes file); handles stale currentTurn (moves to history); skips duplicate session IDs; handles corrupted files
- `persistSession` — atomic write (tmp + rename); merges with existing file data; persists turns, currentTurn, lastActions, lastMessage, lastEventAt, awaitsInput
- `deleteSessionFile` — removes session file silently

**Helper functions:**
- `summarizeToolUse` — Edit returns filename; Write returns filename; Read returns filename; Bash returns truncated command; Grep returns pattern; Glob returns pattern; unknown tool returns tool name
- `isProcessAlive` — returns false for null PID; uses process.kill signal 0

**Hook management:**
- `ensureHooks` — adds fleet hooks for all 4 events to empty settings; idempotent (no duplicates); preserves existing non-fleet hooks; creates settings file if missing
- `removeHooks` — removes fleet hooks; preserves non-fleet hooks; cleans up empty hook arrays; handles missing settings file

### 3. `tests/socket.test.js` (~8 tests)

- `start` — cleans up stale socket file; creates parent directory; listens on socket path
- `stop` — closes server; removes socket file
- Data handling — buffers incoming data; splits on newlines; parses each line as JSON; calls handler with parsed payload
- Error handling — ignores malformed JSON lines; ignores empty lines
- Multiple connections — handles concurrent connections correctly

### 4. `tests/hook-client.test.js` (~10 tests)

**Payload construction:**
- SessionStart — includes event, session_id, cwd, timestamp, model, pid, ppid, term_program, iterm_session_id
- PostToolUse — includes tool_name and tool_input
- Notification — includes message and notification_type
- Stop — includes last_assistant_message truncated to 500 chars

**Session persistence:**
- SessionStart creates session file with sessionId, cwd, model, term_program, iterm_session_id, pid, ppid, fleet_model_name, timestamp
- Stop updates session file with stoppedAt and lastMessage
- Stop reads existing session file before updating

**Environment:**
- `FLEET_MODEL_NAME` env var included in payload when set

**Socket communication:**
- Connects to Unix socket and sends JSON + newline
- Silent exit on connection failure
- Timeout protection (exits after 1 second)

### 5. `tests/tui.test.js` (~5 tests)

- `start` — sets running=true; dynamically imports createApp; calls createApp with master; handles import error gracefully
- `stop` — sets running=false; clears render timer; unmounts ink app
- `scheduleRender` — debounces renders at 100ms; calls master._renderCallback; ignores when not running; ignores when timer already pending

### 6. `tests/components/worker-card.test.mjs` (~12 tests)

**Helper functions:**
- `getProcessingColor(ms)` — returns colors.running when < 3min; returns colors.slow when 3-10min; returns colors.alert when >= 10min
- `getStatusIcon(status)` — processing returns filled circle; offline returns cross; idle returns hollow circle
- `formatElapsed(ms)` — formats seconds (< 60); minutes (< 3600); hours+minutes
- `formatAgo(ms)` — formats "Xs ago", "Xm ago", "Xh ago"

**Components:**
- `WorkerCard` — renders project name, model name, status icon; shows processing timer when active; shows last message; shows current turn with colored border; shows last actions when idle
- `ActionLine` — renders checkmark, tool name, target, time ago
- `CurrentTurn` — renders summary (truncated to 80 chars); renders recent actions (max 3); returns null for empty turn
- `HistoryTurn` — collapses tool names (>3 shows "+N"); renders summary and time ago
- `LastActions` — renders action list; returns null for empty array

### 7. `tests/components/selector.test.mjs` (~10 tests)

- `Selector` — renders title and items; highlights selected item with accent color; j/k navigates; enter selects; q/ctrl+c cancels; shows warning for active item
- `ConfirmDialog` — renders title and item; y/enter confirms; n/esc/q cancels; shows danger accent when dangerMode
- `InputForm` — renders fields with labels; up/down/tab navigates fields; typing appends to current field; backspace deletes last char; enter submits when all required fields filled; shows errors for empty required fields; auto-jumps to first empty required field; esc/ctrl+c cancels
- `renderSelector` / `renderConfirm` / `renderInput` — return promises; resolve with value on confirm; resolve with null/false on cancel

### 8. `tests/components/terminal-focus.test.mjs` (~6 tests)

- `TERMINAL_NAMES` — maps iTerm.app, Apple_Terminal, vscode, Cursor, WarpTerminal, WezTerm
- `focusTerminal` — dispatches to focusITerm for iTerm.app; dispatches to focusAppleTerminal for Apple_Terminal; dispatches to focusVSCode for vscode; returns `{ ok: false, reason: 'unsupported' }` on non-darwin; returns `{ ok: false, reason: 'unknown' }` for missing termProgram
- `escapeAppleScript` — escapes backslashes and double quotes
- Permission detection — returns `{ ok: false, reason: 'permission' }` for -1743 error; returns `{ ok: false, reason: 'permission' }` for "not allowed" error

### 9. `tests/components/app.test.mjs` (~8 tests)

- `getWorkerStatus(worker)` — returns 'offline' for offline status; returns 'offline' when ppid is dead; returns 'processing' when not awaitsInput; returns 'idle' when awaitsInput
- Sorting — processing workers before idle before offline; within same status, sorts by time or name based on sortMode
- Keyboard — j/k moves selection; tab toggles sort mode; space toggles expanded; q/ctrl+c calls master.stop(); enter calls focusTerminal; 1-9 quick selects
- Selection clamping — clamps selectedIdx when workers.length decreases

### 10. `tests/components/header.test.mjs` (~3 tests)

- Renders "Fleet" title and sort mode label
- Renders processing/idle/offline counts with correct icons
- Renders "X total" count

### 11. `tests/components/footer.test.mjs` (~2 tests)

- Renders key hints and version label
- Shows position/total when provided; omits when not

### 12. `tests/components/colors.test.mjs` (~1 test)

- Exports all 16 color constants with correct hex values

## Total: ~135 tests

## Implementation Notes

- All test files use CommonJS (`require`) for .js source files and ESM (`import`) for .mjs component files
- `vi.mock()` used to mock `fs`, `child_process`, `net`, `os` as needed per test file
- `vi.spyOn()` used for `process.exit`, `console.log`, `console.error` to prevent test output pollution
- For hook-client.js tests, mock `process.stdin` with async iterator yielding JSON input
- For component tests, use ink-testing-library's `render` and inspect output via `lastFrame()`
- Global setup file stubs `process.stdout.rows` and `process.stdout.columns` for consistent terminal size
