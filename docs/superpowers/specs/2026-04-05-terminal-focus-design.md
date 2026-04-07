# Terminal Focus Feature Design

**Date**: 2026-04-05
**Status**: Draft

## Summary

Add terminal window focusing to the observer TUI. When a user selects a worker card and presses Enter, the terminal window running that Claude Code process is brought to the foreground. Uses macOS-native AppleScript and environment variable detection to identify and activate the correct terminal application and window.

## Background

The observer TUI (`fleet start`) displays all active Claude Code worker processes. Currently, users must manually search across terminal windows/tabs to find which terminal is running a specific worker. This feature automates that workflow.

## Architecture

### Data Flow

```
hook-client.js                        Master (master.js)
┌────────────────┐   Unix Socket   ┌─────────────────────┐
│ SessionStart:  │ ─────────────►  │ Store in worker:     │
│ TERM_PROGRAM   │                 │   termProgram        │
│ ITERM_SESSION  │                 │   itermSessionId     │
│ pid / ppid     │                 │   pid / ppid         │
└────────────────┘                 └─────────────────────┘
                                           │
                                           ▼
                                    TUI (app.mjs)
                                    ┌─────────────────┐
                                    │ Enter keypress   │
                                    │ → read worker    │
                                    │   terminal meta  │
                                    │ → call focus fn  │
                                    └─────────────────┘
                                           │
                                           ▼
                                    terminal-focus.mjs
                                    ┌────────────────────┐
                                    │ iTerm2 → session   │
                                    │ Terminal → window   │
                                    │ VSCode → project    │
                                    │ Cursor → project    │
                                    └────────────────────┘
```

## Detailed Design

### 1. hook-client.js: Terminal Metadata Collection

Collect terminal metadata only on `SessionStart` events. Add four fields to the payload:

```javascript
// In SessionStart handler
payload.pid = process.pid;
payload.ppid = process.ppid;
payload.term_program = process.env.TERM_PROGRAM || null;
payload.iterm_session_id = process.env.ITERM_SESSION_ID || null;
```

| Field | Source | Example | Purpose |
|-------|--------|---------|---------|
| `pid` | `process.pid` | `84231` | Hook process PID (debugging) |
| `ppid` | `process.ppid` | `84200` | Parent PID (Claude Code node process) |
| `term_program` | `TERM_PROGRAM` env | `"iTerm.app"`, `"vscode"`, `"Cursor"` | Identify terminal app |
| `iterm_session_id` | `ITERM_SESSION_ID` env | `"w0t0p0:ABCD-1234"` | iTerm2 tab+pane targeting |

**Why SessionStart only**: A Claude Code session runs in a single terminal for its entire lifetime. The terminal environment does not change between events.

### 2. master.js: Worker State Extension

Add four fields to the worker state object created on first event:

```javascript
{
  // ... existing fields ...
  termProgram: null,        // "iTerm.app" | "vscode" | "Cursor" | "Apple_Terminal" | ...
  itermSessionId: null,     // iTerm2-specific session ID
  pid: null,                // hook-client PID
  ppid: null,               // Claude Code node process PID
}
```

These fields are populated when processing `SessionStart` events. Non-SessionStart events ignore these fields entirely.

### 3. New Module: `src/components/terminal-focus.mjs`

A standalone ESM module with a single exported function:

```javascript
export function focusTerminal({ termProgram, itermSessionId, cwd, displayName })
// Returns: { ok: true } | { ok: false, reason: string }
```

**Per-terminal strategy:**

| termProgram | Strategy | Precision |
|---|---|---|
| `iTerm.app` | AppleScript: select session by `ITERM_SESSION_ID`, then activate tab+pane | Exact pane |
| `Apple_Terminal` | AppleScript: activate app, then `AXRaise` window matching `displayName` | Window |
| `vscode` | Shell: `code -r <cwd>` to focus project window | Project window |
| `Cursor` | Shell: `cursor -r <cwd>` to focus project window | Project window |
| `WarpTerminal` | AppleScript: activate + `AXRaise` window matching `displayName` | Window |
| `WezTerm` | AppleScript: activate + `AXRaise` window matching `displayName` | Window |
| `null` / unknown | Return `{ ok: false, reason: 'unknown' }` | — |

**Implementation detail for iTerm2** (the most precise case):

```applescript
tell application "iTerm"
  activate
  tell current window
    repeat with t in tabs
      repeat with s in sessions of t
        if id of s contains "<ITERM_SESSION_ID fragment>" then
          select t
          select s
        end if
      end repeat
    end repeat
  end tell
end tell
```

**Implementation for window-title matching** (Terminal.app, Warp, WezTerm):

```applescript
tell application "System Events"
  tell process "<Terminal App>"
    set frontmost to true
    repeat with w in windows
      if name of w contains "<displayName>" then
        perform action "AXRaise" of w
      end if
    end repeat
  end tell
end tell
```

**Error handling**: All AppleScript/shell execution wrapped in try-catch. Failures return `{ ok: false, reason }` — never throw or crash.

### 4. TUI Interaction Changes

#### Key Bindings

| Key | Current | New |
|-----|---------|-----|
| `Enter` | Expand/collapse worker | **Focus terminal window** |
| `Space` | — | **Expand/collapse worker details** |
| `j/k`, arrows | Scroll selection | Unchanged |
| `1-9` | Jump to worker | Unchanged |
| `q`, Ctrl+C | Quit | Unchanged |
| `Tab` | Toggle sort | Unchanged |

#### Footer Update

```
Current: [j/k] scroll  [enter] expand  [1-9] filter
New:     [j/k] scroll  [space] expand  [enter] focus  [1-9] jump
```

#### Worker Card: Terminal Label

When `termProgram` is not null, show a dim terminal identifier tag on the card header row:

```
● my-project  opus-prod  iTerm   12m
```

The terminal name is derived from `termProgram`:
- `"iTerm.app"` → `"iTerm"`
- `"Apple_Terminal"` → `"Terminal"`
- `"vscode"` → `"VSCode"`
- `"Cursor"` → `"Cursor"`
- `"WarpTerminal"` → `"Warp"`
- `"WezTerm"` → `"WezTerm"`

When `termProgram` is null (old hook-client without metadata), no tag is shown.

#### Focus Feedback

After pressing Enter, a status line appears at the bottom of the TUI for 2 seconds:

- `✓ Focused iTerm → my-project` (success)
- `✗ Focus failed` (AppleScript/shell execution error)
- `⚠ No terminal info for this worker` (worker has no terminal metadata)

Implemented via a `focusStatus` state in `app.mjs` with a 2-second auto-clear timer.

## Files Changed

| File | Change |
|------|--------|
| `src/hook-client.js` | Add 4 metadata fields to SessionStart payload |
| `src/master.js` | Store terminal metadata in worker state on SessionStart |
| `src/components/terminal-focus.mjs` | **New file**: focus logic per terminal type |
| `src/components/app.mjs` | Remap Enter→focus, Space→expand; add focus status display; add terminal label |
| `src/components/worker-card.mjs` | Show terminal name tag on header row |
| `src/components/footer.mjs` | Update key hints |

## Platform Scope

macOS only. The `terminal-focus.mjs` module uses:
- AppleScript via `osascript` CLI
- `code`/`cursor` CLI commands for VSCode-family editors

On non-macOS platforms, `focusTerminal()` returns `{ ok: false, reason: 'unsupported' }`.

## Edge Cases

- **Worker from before feature deployment**: Old hook-client won't send terminal metadata. Worker shows no terminal tag, Enter shows "No terminal info" message.
- **Multiple windows with same project name**: `AXRaise` activates the first matching window. This is acceptable — same project name means either same window or user can distinguish.
- **iTerm2 session ID format**: `ITERM_SESSION_ID` format is `w<window>t<tab>p<pane>:<UUID>`. AppleScript matching uses substring containment, not exact match.
- **Terminal app not running**: If the terminal was closed, AppleScript will fail silently → "Focus failed" message.
- **VSCode/Cursor remote windows**: `code -r` works with local windows only. Remote SSH windows cannot be targeted.
