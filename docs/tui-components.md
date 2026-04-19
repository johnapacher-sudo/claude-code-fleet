# TUI Components

## Component Tree

```
App ({ master })
├── Header ({ workers })
├── Box (worker list container)
│   ├── WorkerCard ({ worker, now, isExpanded })  × N
│   └── Text (separator)                          × N-1
├── Box (focus status feedback, conditional)
└── Footer ()
```

All components use ESM (`.mjs`) and React.createElement (no JSX). Rendering via Ink v5.

## State Management

State lives entirely in `App` via React hooks. No external state store.

```javascript
// Master → React connection
const [, setTick] = useState(0);
master._renderCallback = () => setTick(t => t + 1);

// UI state
const [selectedIdx, setSelectedIdx] = useState(0);
const [sortMode, setSortMode] = useState('time');
const [expanded, setExpanded] = useState(new Set());
const [focusStatus, setFocusStatus] = useState(null);
```

Worker data comes from `master.workers` (a Map). App reads it on every render, computes derived status via `getWorkerStatus()`.

## Worker Status Derivation

`getWorkerStatus(worker, now)` computes display status from worker state:

1. If `worker.status === 'offline'` → **offline**
2. If `ppid` is dead → **offline**
3. If `currentTurn.actions` has any `status === 'running'` → **active**
4. If `awaitsInput === true` → **idle** (Stop event was received)
5. If `currentTurn.actions` all done AND last action <90 seconds ago → **thinking**
6. Default → **idle**

Sort order: active (0) → thinking (1) → idle (2) → offline (3), then by last event time or name.

## Keyboard Handling

Handled in `App` via Ink's `useInput()`:

| Input | Action |
|-------|--------|
| `j` / ↓ | Move selection down |
| `k` / ↑ | Move selection up |
| `1`-`9` | Jump to worker by position |
| Space | Toggle expanded detail view for selected worker |
| Enter | Focus the terminal window of selected worker |
| Tab | Toggle sort mode (time ↔ name) |
| `q` / Ctrl+C | Quit (calls `master.stop()`) |

## WorkerCard Component

Receives `{ worker, now, isExpanded }` props. Renders:

- **Status icon:** Green dot (active), yellow spinner (thinking), gray dot (idle), red X (offline)
- **Tool tag:** `[Claude]` purple, `[Codex]` green, `[Copilot]` blue
- **Project name:** Basename of `worker.cwd`
- **Model name:** From `fleetModelName` or `modelName`
- **Terminal:** `termProgram` (e.g., iTerm.app)
- **Elapsed time:** Since `firstEventAt`
- **Last message:** Truncated AI summary
- **Current turn:** Active actions with spinner, if any
- **History turns:** Collapsed tool chain (max 2 past turns), shown when expanded
- **Last 3 actions:** Flat list of recent tool uses

## Interactive UI Components (selector.mjs)

Used by CLI commands (not the dashboard). Three exported functions:

- **`renderSelector({ title, items, dangerMode })`** — Arrow-key list picker. Returns selected `value` or `null` on cancel.
- **`renderConfirm({ title, items, dangerMode })`** — Yes/No dialog. Returns `true`/`false`.
- **`renderInput({ title, fields, requiredFields })`** — Multi-field form with cursor navigation, inline editing, required field validation. Returns field map or `null` on cancel.

These use Ink's `useInput` for key handling and manage their own focus/navigation state.

## Terminal Focus

`terminal-focus.mjs` exports `focusTerminal({ termProgram, itermSessionId, cwd, displayName, ppid })`.

macOS only. Returns `{ ok, reason, name }`.

| Terminal | Method |
|----------|--------|
| iTerm2 | AppleScript to select session by ID |
| Terminal.app | Find TTY by PID, select matching tab via AppleScript |
| VSCode | `open -a "Visual Studio Code" <cwd>` |
| Cursor | `open -a "Cursor" <cwd>` |
| Warp | AppleScript to raise window |
| WezTerm | AppleScript to raise window |

## Color System

`colors.mjs` exports 17 named hex colors:

| Color Name | Hex | Usage |
|-----------|-----|-------|
| `title` | `#a78bfa` | Dashboard title, model names |
| `running` | `#4ade80` | Active items, done marks |
| `idle` | `#525252` | Idle workers, secondary info |
| `slow` | `#fbbf24` | Thinking state, warnings, spinner |
| `projectName` | `#e0e0e0` | Project names |
| `modelAlias` | `#a78bfa` | Model alias names |
| `modelName` | `#525252` | Secondary model info |
| `aiSummary` | `#8b949e` | AI message text |
| `toolName` | `#d4d4d4` | Tool names in action list |
| `target` | `#8b949e` | Tool targets in action list |
| `doneMark` | `#4ade80` | Checkmarks for completed actions |
| `spinnerColor` | `#fbbf24` | Spinner animation |
| `activeLine` | `#4ade80` | Active action line indicators |
| `historyLine` | `#525252` | History turn lines |
| `separator` | `#1e1e1e` | Separator between worker cards |
| `footer` | `#333333` | Footer text |
