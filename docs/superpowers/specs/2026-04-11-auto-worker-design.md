# Auto Worker Background Task System — Design Spec

## Overview

Extend claude-code-fleet with an auto-worker background task execution system, inspired by the standalone `claude-auto-worker` project. The system adds a task queue and scheduler that automatically executes Claude Code tasks in the background, integrated into fleet's existing TUI dashboard and model profile system.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Command system | Independent `fleet worker` subcommands | Clean separation from observer mode, no impact on existing features |
| Concurrency model | Configurable (default 1, supports N) | Flexibility for different workloads |
| Storage location | `~/.config/claude-code-fleet/` | Unified with existing fleet config |
| Queue/Archive split | Active queue for pending+running, daily archive for completed | Keeps active queue small and fast |
| Model config | Reuse existing model profiles | No duplicate config, consistent UX |
| Execution model | Fresh `claude -p` subprocess per task | Full isolation, no context pollution |
| TUI integration | Event bridge to existing Master/dashboard | Minimal changes to existing components |
| Architecture | Independent module + event bridge (Option A) | Minimal invasion, self-contained worker module |

## CLI Interface

```
fleet worker start [--concurrency <n>] [--poll-interval <s>] [--timeout <s>]
fleet worker stop
fleet worker add <prompt> [--title <t>] [--cwd <dir>] [--priority <n>] [--model <profile-name>]
fleet worker list [--status <pending|running>]
fleet worker import <file.json>
fleet worker report [YYYY-MM-DD]
fleet worker show <task-id>
```

### `fleet worker start`
- Starts WorkerManager daemon in the background
- Writes PID to `~/.config/claude-code-fleet/worker.pid`
- Recovers any `running` tasks from previous ungraceful shutdown (resets to `pending`)
- Auto-starts TUI dashboard if not already running, injects worker status
- Flags:
  - `--concurrency <n>`: number of parallel worker slots (default: 1)
  - `--poll-interval <s>`: seconds between scheduler ticks (default: 5)
  - `--timeout <s>`: max seconds per task before SIGKILL (default: 600)

### `fleet worker stop`
- Sends SIGTERM to WorkerManager daemon via PID file
- Graceful shutdown: waits for all in-flight tasks to complete
- Removes PID file on exit

### `fleet worker add <prompt>`
- Adds a task to the active queue
- Auto-generates title from first 60 chars of prompt if `--title` not provided
- Validates `--model` against existing model profiles (rejects if profile not found)
- Flags:
  - `--title <t>`: human-readable task title
  - `--cwd <dir>`: working directory for task execution (default: `process.cwd()`)
  - `--priority <n>`: lower number = higher priority (default: 5)
  - `--model <profile-name>`: model profile to use for execution (default: null = use default claude config)

### `fleet worker list`
- Displays all tasks in the active queue (pending + running)
- `--status <status>`: filter by status (only `pending` or `running`; completed/failed tasks are in archives, use `fleet worker report`)
- Output format: table with ID, title, status, priority, model, timestamps

### `fleet worker import <file.json>`
- Batch import tasks from a JSON file
- File format: array of task input objects
```json
[
  { "prompt": "...", "title": "...", "cwd": "...", "priority": 3, "model": "opus-prod" },
  { "prompt": "...", "title": "...", "cwd": "...", "priority": 5 }
]
```
- Validates all entries before importing
- Reports errors for entries with invalid model profiles, imports valid ones
- If no entries are valid, exits with error

### `fleet worker report [YYYY-MM-DD]`
- Shows completed/failed tasks for a given date (default: today)
- Displays: task title, status, duration, cost, result summary
- Shows aggregate summary: total tasks, completed, failed, total duration, total cost

### `fleet worker show <task-id>`
- Shows full details of a single task including complete output
- Searches both active queue and archive files
- Displays: all task metadata, full claudeResult output, cost, duration

## Data Model

### Storage Paths

```
~/.config/claude-code-fleet/
    ├── worker-queue.json          # Active queue (pending + running only)
    ├── worker.pid                 # WorkerManager process PID
    ├── worker-archive/            # Completed task archives
    │   ├── 2026-04-10.json
    │   ├── 2026-04-11.json
    │   └── ...
    ├── models.json                # Existing model profiles (reused, unchanged)
    ├── fleet.sock                 # Existing socket
    ├── sessions/                  # Existing observer sessions
    └── hooks/                     # Existing hooks
```

### Task Interface

```typescript
interface Task {
  id: string;                    // "task-{Date.now()}"
  title: string;                 // Human-readable title
  prompt: string;                // Full prompt text sent to Claude
  cwd: string;                   // Working directory for execution
  priority: number;              // Lower = higher priority (default: 5)
  modelProfile: string | null;   // Model profile name, null = default config
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: string;             // ISO timestamp
  startedAt?: string;            // ISO timestamp, set when status → running
  completedAt?: string;          // ISO timestamp, set when status → completed/failed
  workerId?: number;             // Worker slot index, set when running
  result?: TaskResult;           // Set after execution completes
}

interface TaskResult {
  exitCode: number;              // Process exit code (-1 for timeout)
  stdout: string;                // Raw stdout from claude -p
  stderr: string;                // Raw stderr
  durationMs: number;            // Execution duration
  isClaudeError: boolean;        // Parsed from claude JSON output
  claudeResult: string | null;   // Parsed response text from claude output
  totalCostUsd: number | null;   // Parsed cost from claude output
}
```

### Active Queue File (`worker-queue.json`)

```json
{
  "tasks": [
    {
      "id": "task-1712812345678",
      "title": "Fix login bug",
      "prompt": "Check src/auth.js...",
      "cwd": "/path/to/project",
      "priority": 3,
      "modelProfile": "opus-prod",
      "status": "pending",
      "createdAt": "2026-04-11T10:00:00.000Z"
    }
  ]
}
```

Only `pending` and `running` tasks exist in this file. Completed/failed tasks are archived immediately.

### Archive File (`worker-archive/YYYY-MM-DD.json`)

```json
{
  "date": "2026-04-11",
  "tasks": [
    {
      "id": "task-1712812000000",
      "title": "Fix login bug",
      "prompt": "...",
      "cwd": "/path/to/project",
      "priority": 3,
      "modelProfile": "opus-prod",
      "status": "completed",
      "createdAt": "2026-04-11T09:50:00.000Z",
      "startedAt": "2026-04-11T09:51:00.000Z",
      "completedAt": "2026-04-11T09:55:00.000Z",
      "result": {
        "exitCode": 0,
        "stdout": "...",
        "claudeResult": "Successfully fixed...",
        "totalCostUsd": 0.124,
        "durationMs": 240000
      }
    }
  ],
  "summary": {
    "total": 5,
    "completed": 4,
    "failed": 1,
    "totalDurationMs": 1200000,
    "totalCostUsd": 0.620
  }
}
```

Summary is recalculated on each archive write.

## Core Modules

### New Files

```
src/
    ├── worker-manager.js       # Worker lifecycle orchestration
    ├── worker-task-store.js    # Active queue + archive storage
    └── worker-runner.js        # claude -p subprocess executor
```

### Modified Files

```
src/
    ├── index.js                # Add worker subcommand routing
    └── master.js               # Receive WorkerManager events, inject into TUI
```

### `worker-task-store.js` — WorkerTaskStore

Responsibility: CRUD operations on active queue and archive files.

**Methods:**
- `constructor(baseDir)` — accepts `~/.config/claude-code-fleet/`, ensures `worker-archive/` dir exists
- `addTask(input)` — generates ID, sets status to "pending", writes to `worker-queue.json`
- `getNextPending()` — returns highest-priority (lowest number) pending task
- `updateTask(id, updates)` — partial merge update on task fields
- `archiveTask(task)` — removes from `worker-queue.json`, appends to `worker-archive/YYYY-MM-DD.json`, recalculates summary
- `getActiveTasks()` — returns all tasks from active queue
- `getByStatus(status)` — filters active tasks by status
- `getById(id)` — searches active queue
- `getArchive(date)` — reads archive for specific date, returns null if not found
- `getArchivedTask(id)` — searches all archive files for a task by ID (for `fleet worker show`)

**Corruption recovery:** If `worker-queue.json` is malformed, reset to `{ tasks: [] }` and log error.

### `worker-runner.js` — WorkerRunner

Responsibility: Execute a single task via `claude -p` subprocess.

**Methods:**
- `run(task, modelConfig)` — spawns `claude -p "<prompt>" --output-format json` with task's cwd
- Returns `Promise<TaskResult>`

**Execution details:**
- Spawns `child_process.spawn('claude', ['-p', prompt, '--output-format', 'json'], { cwd })`
- If `modelConfig` is provided, passes `--model` and sets `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` env vars
- Captures stdout/stderr incrementally
- Parses JSON output to extract `is_error`, `result`, `total_cost_usd`
- Timeout: configurable (default 600s). On timeout, sends SIGKILL, returns exitCode -1
- Stdout truncation: if output exceeds 1MB, truncate with marker

### `worker-manager.js` — WorkerManager

Responsibility: Orchestrate worker lifecycle, manage concurrent execution, bridge to TUI.

**Methods:**
- `start(options)` — starts the scheduler loop with given concurrency/pollInterval/timeout
- `stop()` — graceful shutdown, waits for in-flight tasks
- `tick()` — get next pending task, find idle slot, assign and execute
- `onTaskEvent(callback)` — register event callback for TUI bridge

**WorkerPool:**
- Maintains N slots: `Array<{ idle: true } | { idle: false, taskId, childProcess }>`
- `findIdleSlot()` returns index of first idle slot, or -1
- `assign(slot, task)` marks slot busy, calls `workerRunner.run()`, handles completion

**Event callbacks (for TUI bridge):**
- `taskStarted(task)` — when a task begins execution
- `taskCompleted(task, result)` — when a task succeeds
- `taskFailed(task, result)` — when a task fails

**Scheduler loop:**
- Writes PID file on start
- Runs first tick immediately
- `setInterval(tick, pollInterval * 1000)` for repeated ticks
- Tick logic: find idle slot + next pending task → execute; if no slot or no task → no-op
- On `stop()`: clear interval, poll for all slots to become idle, remove PID file

### Modifications to `index.js`

Add `worker` subcommand handling in `parseArgs()`:

```
fleet worker <subcommand> [args...]
```

New command functions:
- `cmdWorkerStart(args)` — instantiate WorkerManager + Master, start daemon
- `cmdWorkerStop(args)` — read PID, send SIGTERM
- `cmdWorkerAdd(args)` — parse prompt and flags, call WorkerTaskStore.addTask()
- `cmdWorkerList(args)` — read and display active tasks
- `cmdWorkerImport(args)` — read JSON file, validate, batch add
- `cmdWorkerReport(args)` — read archive for date, display report
- `cmdWorkerShow(args)` — find task by ID across active + archive, display details

### Modifications to `master.js`

Add optional WorkerManager integration:

- New `workerManager` property (set only when `fleet worker start` is used)
- `handleWorkerEvent(type, data)` — receives events from WorkerManager, creates/updates virtual worker entries in `workers` Map
- Virtual worker entries have `type: 'auto'` to distinguish from observer workers
- Existing event handling and cleanup logic unchanged

## TUI Integration

### Display Layout

Observer workers and auto-worker tasks are displayed as separate groups in the dashboard:

```
── Observer Workers ──
🟢 auth-service  opus-4-6  iTerm2    2m ago
   └ Editing src/auth.js

── Auto Worker Queue (3 pending, 1 running) ──
🔄 [1/4] Fix login bug       opus-prod   30s
   └ Running...
⏳ [2] Refactor API layer     sonnet-4-6
⏳ [3] Add unit tests         opus-prod
⏳ [4] Update README          default
```

### New Component: `worker-queue-card.mjs`

Renders a single auto-worker task card:
- Queue position and total count: `[1/4]`
- Status icon: ⏳ pending, 🔄 running, ✅ completed, ❌ failed
- Task title, model profile name, elapsed time (if running)
- Expandable: `space` shows full prompt and partial output

### Worker Status in Master's workers Map

Auto-worker tasks are represented as virtual workers:

```javascript
{
  type: 'auto',
  id: task.id,
  session_id: 'auto-' + task.id,
  project: path.basename(task.cwd),
  model: task.modelProfile || 'default',
  status: 'running' | 'pending',
  currentTurn: { actions: [...] },
  startedAt: task.startedAt,
  title: task.title,
  queuePosition: n,
  queueTotal: m
}
```

### Keyboard Interaction

Existing keybindings extend naturally:
- `j/k` — scroll through both observer workers and auto-worker tasks
- `space` — expand auto-worker task to show prompt and execution output
- `q` — quit (stops WorkerManager gracefully)

## Task Lifecycle

```
addTask() ──→ worker-queue.json [pending]
                    │
              scheduler tick()
                    │
         getNextPending() + findIdleSlot()
                    │
              worker-queue.json [running]
                    │
         WorkerRunner.run() → claude -p
                    │
         ┌─────────┴──────────┐
     exitCode=0           exitCode≠0 or timeout
         │                     │
    [completed]            [failed]
         │                     │
         └─────────┬───────────┘
                   │
            archiveTask()
                   │
     worker-queue.json (removed)
     worker-archive/YYYY-MM-DD.json (appended)
```

## Error Handling

| Scenario | Strategy |
|----------|----------|
| Claude subprocess timeout | SIGKILL, mark `failed`, `exitCode: -1` |
| Claude returns error | Parse `is_error` from JSON output, mark `failed` |
| Queue JSON corruption | Reset to empty, log error |
| Archive file corruption | Skip file, return null for that date |
| Model profile not found | Reject at `addTask()` time with clear error message |
| Worker stop with in-flight tasks | Wait for completion, then exit |
| WorkerManager crash | On next `start`, reset all `running` tasks to `pending` |

## Startup Recovery

When `fleet worker start` runs:

1. Read `worker-queue.json`
2. If any tasks have `status: 'running'`, reset them all to `pending`
   - These are leftovers from an ungraceful shutdown
   - They retain their original priority, so they'll be picked up first
3. Start scheduler loop normally

## Test Strategy

Test the three new modules independently:

- **worker-task-store.test.js**: CRUD operations, priority ordering, archive write/read, corruption recovery, batch import
- **worker-runner.test.js**: successful execution, timeout handling, error output parsing, model config injection
- **worker-manager.test.js**: tick logic, concurrency guard, graceful stop, startup recovery, event callbacks
- **CLI integration**: worker subcommand parsing, flags, error messages
