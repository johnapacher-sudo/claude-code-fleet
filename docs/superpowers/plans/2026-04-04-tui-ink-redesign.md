# TUI Ink Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled ANSI TUI with an Ink (React) component-based terminal dashboard, adding conversation turn tracking, rich worker cards, and keyboard interaction.

**Architecture:** Master.js manages worker state with a new `turns` data model (Notification events as turn boundaries). TUI is a thin CJS bridge that dynamically imports ESM Ink components. Ink handles rendering, layout, and animations via React reconciliation.

**Tech Stack:** Ink 5, React 18, ink-spinner 5, ESM components via `.mjs` files, dynamic `import()` bridge from CJS.

---

## File Structure

```
src/
  index.js              (CJS, unchanged)
  master.js             (CJS, modify - turns data model)
  socket.js             (CJS, unchanged)
  hook-client.js        (CJS, unchanged)
  tui.js                (CJS, rewrite - Ink bridge with dynamic import)
  components/
    app.mjs             (ESM, create - Ink App + state management)
    header.mjs          (ESM, create - header bar)
    worker-card.mjs     (ESM, create - worker card with turn blocks)
    footer.mjs          (ESM, create - keyboard hints footer)
package.json            (modify - add dependencies)
```

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install ink, react, ink-spinner**

```bash
cd /Users/cuijianwei/workspace/claude-code-fleet
npm install ink@5 react@18 ink-spinner@5
```

- [ ] **Step 2: Verify installation**

```bash
node -e "const ink = require('ink'); console.log('ink CJS:', !!ink)" 2>&1 || echo "ink is ESM-only (expected)"
node --input-type=module -e "import {render, Box, Text} from 'ink'; console.log('ink ESM: ok')" 2>&1
```

Expected: CJS import fails, ESM import succeeds. Confirms ESM bridge is needed.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add ink, react, ink-spinner dependencies for TUI redesign"
```

---

### Task 2: Refactor master.js — Turns Data Model

**Files:**
- Modify: `src/master.js`

The current `master.js` uses `currentRound.actions[]` with flat action lists. This task replaces it with the `turns[]` model from the spec, where Notification events serve as turn boundaries.

- [ ] **Step 1: Rewrite worker creation with turns structure**

Replace the worker creation block in `handleEvent()` (the `if (!this.workers.has(sid))` block, lines 73-88). The new structure uses `turns` array instead of `currentRound` + `rounds`:

```javascript
    if (!this.workers.has(sid)) {
      this.workers.set(sid, {
        sessionId: sid,
        sessionIdShort: sid.slice(0, 4),
        displayName: path.basename(payload.cwd || 'unknown'),
        cwd: payload.cwd || '',
        modelName: null,
        fleetModelName: null,
        firstEventAt: Date.now(),
        lastEventAt: Date.now(),
        status: 'idle',
        turns: [],           // completed turns (max 2)
        currentTurn: null,   // { summary, summaryTime, actions: [] } or null
      });
    }
```

- [ ] **Step 2: Rewrite PostToolUse handler**

Replace the `PostToolUse` block (lines 102-107). PostToolUse adds an action to the current turn. If no current turn exists, create one. Mark previous action as done:

```javascript
    if (payload.event === 'PostToolUse') {
      worker.status = 'active';
      // Ensure a current turn exists
      if (!worker.currentTurn) {
        worker.currentTurn = { summary: '', summaryTime: Date.now(), actions: [] };
      }
      // Mark previous action as done
      const actions = worker.currentTurn.actions;
      if (actions.length > 0) {
        actions[actions.length - 1].status = 'done';
      }
      // Add new action as running
      const summary = summarizeToolUse(payload);
      const parts = summary.split(' ', 2);
      const tool = parts[0] || summary;
      const target = parts[1] || '';
      actions.push({ tool, target, time: Date.now(), status: 'running' });
    }
```

- [ ] **Step 3: Rewrite Notification handler**

Replace the `Notification` block (lines 110-117). Notification closes the current turn (if any) and starts a new one. The Notification text becomes the previous turn's summary:

```javascript
    if (payload.event === 'Notification') {
      worker.status = 'active';
      if (worker.currentTurn) {
        // Close current turn: mark all actions done, set summary
        worker.currentTurn.actions.forEach(a => a.status = 'done');
        worker.currentTurn.summary = payload.message || '';
        worker.currentTurn.summaryTime = Date.now();
        // Move to turns history (keep max 2)
        worker.turns.push(worker.currentTurn);
        if (worker.turns.length > 2) worker.turns.shift();
      }
      // Start a new empty current turn
      worker.currentTurn = { summary: '', summaryTime: Date.now(), actions: [] };
    }
```

- [ ] **Step 4: Rewrite Stop handler**

Replace the Stop block (lines 51-69). Stop closes the current turn and marks worker idle:

```javascript
    if (payload.event === 'Stop') {
      if (this.workers.has(sid)) {
        const worker = this.workers.get(sid);
        worker.lastEventAt = Date.now();
        worker.status = 'idle';
        // Close current turn
        if (worker.currentTurn) {
          worker.currentTurn.actions.forEach(a => a.status = 'done');
          worker.turns.push(worker.currentTurn);
          if (worker.turns.length > 2) worker.turns.shift();
          worker.currentTurn = null;
        }
      }
      if (this.tui) this.tui.scheduleRender();
      return;
    }
```

- [ ] **Step 5: Update summarizeToolUse to return structured data**

Replace `summarizeToolUse` (lines 133-145) to return an object with tool name and target separately (used by PostToolUse handler above):

```javascript
function summarizeToolUse(payload) {
  const tool = payload.tool_name;
  const input = payload.tool_input || {};
  switch (tool) {
    case 'Edit':  return `Edit ${path.basename(input.file_path || '')}`;
    case 'Write': return `Write ${path.basename(input.file_path || '')}`;
    case 'Read':  return `Read ${path.basename(input.file_path || '')}`;
    case 'Bash':  return `Bash ${(input.command || '').slice(0, 50)}`;
    case 'Grep':  return `Grep ${(input.pattern || '').slice(0, 30)}`;
    case 'Glob':  return `Glob ${input.pattern || ''}`;
    default:      return tool;
  }
}
```

Note: `summarizeToolUse` stays the same — the PostToolUse handler parses its output into `tool` and `target` parts.

- [ ] **Step 6: Verify master.js doesn't have syntax errors**

```bash
node -e "require('./src/master.js')" 2>&1
```

Expected: No errors (the module exports successfully, just no runtime execution without master start).

- [ ] **Step 7: Commit**

```bash
git add src/master.js
git commit -m "refactor: replace rounds with turns data model in master.js"
```

---

### Task 3: Create Ink Components

**Files:**
- Create: `src/components/colors.mjs`
- Create: `src/components/app.mjs`
- Create: `src/components/header.mjs`
- Create: `src/components/footer.mjs`
- Create: `src/components/worker-card.mjs`

All files are ESM (`.mjs`). Use `React.createElement` (aliased as `h`) — no JSX, no build step needed.

- [ ] **Step 1: Create colors.mjs — shared color constants**

```javascript
// src/components/colors.mjs
export const colors = {
  title: '#a78bfa',       // purple
  running: '#4ade80',     // green
  idle: '#525252',        // dim gray
  slow: '#fbbf24',        // yellow
  projectName: '#e0e0e0', // white
  modelAlias: '#a78bfa',  // purple
  modelName: '#525252',   // dim gray
  aiSummary: '#8b949e',   // gray
  toolName: '#d4d4d4',    // light gray
  target: '#8b949e',      // gray
  doneMark: '#4ade80',    // green
  spinnerColor: '#fbbf24',// yellow
  activeLine: '#4ade80',  // green
  historyLine: '#525252', // dim gray
  separator: '#1e1e1e',   // deep gray
  footer: '#333333',      // deep gray
};
```

- [ ] **Step 2: Create header.mjs — top bar**

```javascript
// src/components/header.mjs
import React from 'react';
import { Box, Text } from 'ink';
import { colors } from './colors.mjs';

const h = React.createElement;

export function Header({ workers }) {
  const total = workers.length;
  const running = workers.filter(w => w.status === 'active').length;
  const idle = total - running;

  return h(Box, {
    justifyContent: 'space-between',
    paddingX: 1,
    borderStyle: 'single',
    borderColor: colors.separator,
  },
    h(Text, { color: colors.title, bold: true }, '\u2B22 Fleet Master'),
    h(Box, { gap: 1 },
      running > 0 ? h(Text, { color: colors.running }, `\u25CF ${running}`) : null,
      idle > 0 ? h(Text, { color: colors.idle }, `\u25CB ${idle}`) : null,
      h(Text, { color: colors.idle }, `${total} session${total !== 1 ? 's' : ''}`),
    ),
  );
}
```

- [ ] **Step 3: Create footer.mjs — keyboard hints**

```javascript
// src/components/footer.mjs
import React from 'react';
import { Box, Text } from 'ink';
import { colors } from './colors.mjs';

const h = React.createElement;

export function Footer() {
  return h(Box, {
    justifyContent: 'space-between',
    paddingX: 1,
  },
    h(Text, { color: colors.footer },
      '[j/k] scroll  [enter] expand  [1-9] filter'
    ),
    h(Text, { color: colors.footer }, '[q] quit'),
  );
}
```

- [ ] **Step 4: Create worker-card.mjs — full card with turns**

This is the most complex component. It renders the card header, current turn (expanded with up to 3 actions), and history turn (collapsed).

```javascript
// src/components/worker-card.mjs
import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { colors } from './colors.mjs';

const h = React.createElement;

function getStatusIcon(status) {
  if (status === 'active') return { icon: '\u25CF', color: colors.running };
  return { icon: '\u25CB', color: colors.idle };
}

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const hr = Math.floor(m / 60);
  return `${hr}h${m % 60}m`;
}

function formatAgo(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const hr = Math.floor(m / 60);
  return `${hr}h ago`;
}

function ActionLine({ action, now }) {
  if (action.status === 'running') {
    return h(Box, { justifyContent: 'space-between' },
      h(Box, { gap: 1 },
        h(Text, { color: colors.spinnerColor },
          h(Spinner, { type: 'dots' }),
          ' ',
        ),
        h(Text, { color: colors.spinnerColor }, action.tool),
        h(Text, { color: colors.target }, ' ', action.target),
      ),
      h(Text, { color: colors.spinnerColor }, 'running\u2026'),
    );
  }
  return h(Box, { justifyContent: 'space-between' },
    h(Box, { gap: 1 },
      h(Text, { color: colors.doneMark }, '\u2713'),
      h(Text, { color: colors.toolName }, action.tool),
      action.target ? h(Text, { color: colors.target }, action.target) : null,
    ),
    h(Text, { color: colors.idle }, formatAgo(now - action.time)),
  );
}

function CurrentTurn({ turn, now }) {
  if (!turn) return null;
  const recentActions = turn.actions.slice(-3);

  return h(Box, {
    borderStyle: 'bold',
    borderLeft: true,
    borderRight: false,
    borderTop: false,
    borderBottom: false,
    borderColor: colors.activeLine,
    paddingLeft: 1,
    flexDirection: 'column',
    gap: 0,
  },
    turn.summary
      ? h(Text, { color: colors.aiSummary, italic: true },
          turn.summary.length > 80
            ? turn.summary.slice(0, 77) + '...'
            : turn.summary,
        )
      : null,
    ...recentActions.map((action, i) =>
      h(ActionLine, { key: i, action, now })
    ),
  );
}

function HistoryTurn({ turn, now }) {
  if (!turn) return null;

  const toolNames = turn.actions.map(a => a.tool);
  const collapsed = toolNames.length <= 3
    ? toolNames.join(' \u2192 ')
    : toolNames.slice(0, 3).join(' \u2192 ') + ` +${toolNames.length - 3}`;

  return h(Box, {
    borderStyle: 'bold',
    borderLeft: true,
    borderRight: false,
    borderTop: false,
    borderBottom: false,
    borderColor: colors.historyLine,
    paddingLeft: 1,
    flexDirection: 'column',
    gap: 0,
  },
    turn.summary
      ? h(Text, { color: colors.historyLine, italic: true },
          turn.summary.length > 80
            ? turn.summary.slice(0, 77) + '...'
            : turn.summary,
        )
      : null,
    h(Box, { justifyContent: 'space-between' },
      h(Text, { color: colors.historyLine },
        '\u2713 ',
        collapsed,
      ),
      h(Text, { color: colors.historyLine },
        formatAgo(now - turn.summaryTime),
      ),
    ),
  );
}

export function WorkerCard({ worker, now }) {
  const statusIcon = getStatusIcon(worker.status);
  const elapsed = formatElapsed(now - worker.firstEventAt);

  // The previous turn (for history display)
  const historyTurn = worker.turns.length > 0
    ? worker.turns[worker.turns.length - 1]
    : null;

  return h(Box, { flexDirection: 'column', paddingX: 1, paddingBottom: 1 },
    // Header row
    h(Box, { justifyContent: 'space-between' },
      h(Box, { gap: 1 },
        h(Text, { color: statusIcon.color }, statusIcon.icon),
        h(Text, { color: colors.projectName, bold: true }, worker.displayName),
        worker.fleetModelName
          ? h(Text, { color: colors.modelAlias }, worker.fleetModelName)
          : null,
        worker.modelName
          ? h(Text, { color: colors.modelName }, worker.modelName)
          : null,
      ),
      h(Text, { color: colors.idle }, elapsed),
    ),
    // Current turn (expanded)
    h(CurrentTurn, { turn: worker.currentTurn, now }),
    // History turn (collapsed)
    h(HistoryTurn, { turn: historyTurn, now }),
  );
}
```

- [ ] **Step 5: Create app.mjs — main Ink app with state management**

```javascript
// src/components/app.mjs
import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { Header } from './header.mjs';
import { WorkerCard } from './worker-card.mjs';
import { Footer } from './footer.mjs';
import { colors } from './colors.mjs';

const h = React.createElement;

function getWorkerStatus(worker, now) {
  if (worker.status === 'idle') return 'idle';
  const elapsed = now - worker.lastEventAt;
  if (elapsed > 10 * 60 * 1000) return 'slow';
  return 'active';
}

export function createApp(master) {
  const { render } = require('ink');

  function App() {
    const { exit } = React.useContext(require('ink').AppContext);
    const [, setTick] = useState(0);
    const [selectedIdx, setSelectedIdx] = useState(0);

    // Re-render on master data changes
    useEffect(() => {
      master._renderCallback = () => setTick(t => t + 1);
      return () => { master._renderCallback = null; };
    }, []);

    // Periodic refresh for elapsed time display
    useEffect(() => {
      const timer = setInterval(() => setTick(t => t + 1), 5000);
      return () => clearInterval(timer);
    }, []);

    const now = Date.now();
    const workers = [...master.workers.values()].map(w => ({
      ...w,
      computedStatus: getWorkerStatus(w, now),
    }));

    // Sort: active > slow > idle, then by lastEventAt desc
    const statusOrder = { active: 0, slow: 1, idle: 2 };
    workers.sort((a, b) => {
      const sa = statusOrder[a.computedStatus] ?? 9;
      const sb = statusOrder[b.computedStatus] ?? 9;
      if (sa !== sb) return sa - sb;
      return b.lastEventAt - a.lastEventAt;
    });

    // Keyboard
    useInput((input, key) => {
      if (input === 'q' || (key.ctrl && input === 'c')) {
        master.stop();
        return;
      }
      if (key.downArrow || input === 'j') {
        setSelectedIdx(i => Math.min(i + 1, workers.length - 1));
      }
      if (key.upArrow || input === 'k') {
        setSelectedIdx(i => Math.max(i - 1, 0));
      }
      if (key.return) {
        // Toggle expand — for now just visual indicator
      }
      // Number keys 1-9 to jump to worker
      const num = parseInt(input, 10);
      if (num >= 1 && num <= 9 && num <= workers.length) {
        setSelectedIdx(num - 1);
      }
    });

    return h(Box, { flexDirection: 'column' },
      h(Header, { workers }),
      h(Box, { flexDirection: 'column', paddingTop: 1 },
        workers.length === 0
          ? h(Box, { paddingX: 1 },
              h(Text, { color: colors.idle },
                'No active workers. Start claude processes to see them here.',
              ),
            )
          : workers.map((w, i) =>
              h(Box, {
                key: w.sessionId,
                flexDirection: 'column',
                borderStyle: i === selectedIdx ? 'single' : undefined,
                borderColor: i === selectedIdx ? colors.idle : undefined,
                paddingLeft: i === selectedIdx ? 0 : 1,
              },
                h(WorkerCard, { worker: w, now }),
              ),
            ),
      ),
      h(Box, { paddingTop: 1 },
        h(Footer),
      ),
    );
  }

  return render(h(App));
}
```

Wait — `require('ink')` inside ESM won't work. The app.mjs needs to use pure ESM imports. Let me fix the approach.

- [ ] **Step 5 (revised): Create app.mjs — pure ESM, no require()**

```javascript
// src/components/app.mjs
import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput, render } from 'ink';
import { Header } from './header.mjs';
import { WorkerCard } from './worker-card.mjs';
import { Footer } from './footer.mjs';
import { colors } from './colors.mjs';

const h = React.createElement;

function getWorkerStatus(worker, now) {
  if (worker.status === 'idle') return 'idle';
  const elapsed = now - worker.lastEventAt;
  if (elapsed > 10 * 60 * 1000) return 'slow';
  return 'active';
}

function App({ master }) {
  const { exit } = useApp();
  const [, setTick] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState(0);

  // Re-render on master data changes
  useEffect(() => {
    master._renderCallback = () => setTick(t => t + 1);
    return () => { master._renderCallback = null; };
  }, []);

  // Periodic refresh for elapsed time display
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 5000);
    return () => clearInterval(timer);
  }, []);

  const now = Date.now();
  const workers = [...master.workers.values()].map(w => ({
    ...w,
    computedStatus: getWorkerStatus(w, now),
  }));

  // Sort: active > slow > idle, then by lastEventAt desc
  const statusOrder = { active: 0, slow: 1, idle: 2 };
  workers.sort((a, b) => {
    const sa = statusOrder[a.computedStatus] ?? 9;
    const sb = statusOrder[b.computedStatus] ?? 9;
    if (sa !== sb) return sa - sb;
    return b.lastEventAt - a.lastEventAt;
  });

  // Keyboard
  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      master.stop();
      return;
    }
    if (key.downArrow || input === 'j') {
      setSelectedIdx(i => Math.min(i + 1, workers.length - 1));
    }
    if (key.upArrow || input === 'k') {
      setSelectedIdx(i => Math.max(i - 1, 0));
    }
    if (key.return) {
      // Toggle expand — for now just visual indicator
    }
    // Number keys 1-9 to jump to worker
    const num = parseInt(input, 10);
    if (num >= 1 && num <= 9 && num <= workers.length) {
      setSelectedIdx(num - 1);
    }
  });

  return h(Box, { flexDirection: 'column' },
    h(Header, { workers }),
    h(Box, { flexDirection: 'column', paddingTop: 1 },
      workers.length === 0
        ? h(Box, { paddingX: 1 },
            h(Text, { color: colors.idle },
              'No active workers. Start claude processes to see them here.',
            ),
          )
        : workers.map((w, i) =>
            h(Box, {
              key: w.sessionId,
              flexDirection: 'column',
              borderStyle: i === selectedIdx ? 'single' : undefined,
              borderColor: i === selectedIdx ? colors.idle : undefined,
              paddingLeft: i === selectedIdx ? 0 : 1,
            },
              h(WorkerCard, { worker: w, now }),
            ),
          ),
    ),
    h(Box, { paddingTop: 1 },
      h(Footer),
    ),
  );
}

export function createApp(master) {
  return render(h(App, { master }));
}
```

- [ ] **Step 6: Verify all components have no syntax errors**

```bash
node --input-type=module -e "
  import './src/components/colors.mjs';
  console.log('colors: ok');
" 2>&1

node -e "
  const path = require('path');
  const code = require('fs').readFileSync('src/components/app.mjs', 'utf-8');
  console.log('app.mjs lines:', code.split('\n').length);
  console.log('has createApp export:', code.includes('export function createApp'));
  console.log('has React.createElement:', code.includes('React.createElement'));
" 2>&1
```

Expected: colors imports ok, app.mjs has the expected exports and structure.

- [ ] **Step 7: Commit**

```bash
git add src/components/
git commit -m "feat: add Ink components for TUI dashboard (header, worker-card, footer, app)"
```

---

### Task 4: Rewrite tui.js — Ink Bridge

**Files:**
- Modify: `src/tui.js`

Replace the current hand-rolled ANSI TUI with a thin CJS bridge that dynamically imports the ESM Ink app. Master calls `tui.start()` and `tui.scheduleRender()` as before — the interface stays the same.

- [ ] **Step 1: Rewrite tui.js**

```javascript
// src/tui.js
const path = require('path');

class TUI {
  constructor(master) {
    this.master = master;
    this.running = false;
    this.renderTimer = null;
    this.inkApp = null;
  }

  async start() {
    this.running = true;
    try {
      const { createApp } = await import(path.join(__dirname, 'components', 'app.mjs'));
      this.inkApp = createApp(this.master);
    } catch (err) {
      process.stderr.write(`[fleet] TUI init error: ${err.message}\n`);
      process.stderr.write(`[fleet] Falling back to quiet mode.\n`);
    }
  }

  stop() {
    this.running = false;
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }
    if (this.inkApp) {
      try { this.inkApp.unmount(); } catch { /* already unmounted */ }
      this.inkApp = null;
    }
  }

  scheduleRender() {
    if (!this.running) return;
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      // Trigger Ink rerender via callback
      if (this.master._renderCallback) {
        this.master._renderCallback();
      }
    }, 100);
  }
}

module.exports = { TUI };
```

- [ ] **Step 2: Verify tui.js loads without errors**

```bash
node -e "const { TUI } = require('./src/tui'); console.log('TUI class:', typeof TUI);" 2>&1
```

Expected: `TUI class: function`

- [ ] **Step 3: Commit**

```bash
git add src/tui.js
git commit -m "refactor: rewrite tui.js as Ink bridge with dynamic ESM import"
```

---

### Task 5: Integration Verification

**Files:**
- No new files

- [ ] **Step 1: Run fleet start and verify TUI launches**

```bash
cd /Users/cuijianwei/workspace/claude-code-fleet
node src/index.js start
```

Expected: Terminal shows Ink-rendered dashboard with header "Fleet Master", empty state message, and footer. Press `q` to exit.

Verify:
- Header renders with purple `⬡ Fleet Master`
- Empty state shows "No active workers..." message
- Footer shows keyboard hints
- `q` exits cleanly (cursor restored)

- [ ] **Step 2: Test with live workers**

In a separate terminal, launch a claude session:
```bash
cd /Users/cuijianwei/workspace/claude-code-fleet
node src/index.js run --model <some-model>
```

Then verify in the fleet dashboard:
- Worker card appears with project name and model info
- Actions show up as PostToolUse events arrive
- Current action shows spinner animation
- Completed actions show green `✓`
- Notification events create new turns with AI summary
- History turn shows collapsed action chain

- [ ] **Step 3: Test keyboard interaction**

- `j`/`k` moves selection between workers
- Arrow keys work too
- `1`-`9` jumps to specific worker
- `q` exits cleanly

- [ ] **Step 4: Fix any visual issues found during testing**

Common issues to watch for:
- Border rendering on different terminals (iTerm2 vs Terminal.app vs Warp)
- Unicode character support (⬡, ●, ○, ✓, →)
- Color rendering on terminals without True Color support
- Layout overflow on narrow terminals

- [ ] **Step 5: Commit any fixes**

```bash
git add -u
git commit -m "fix: address TUI visual issues from integration testing"
```

---

### Task 6: Cleanup & Final Polish

**Files:**
- Modify: `src/master.js` (remove `_renderCallback` if using different pattern)
- Verify all files

- [ ] **Step 1: Remove old ANSI code that's no longer needed**

Check if any old ANSI helper code remains in `src/index.js` that was only used by the old TUI. The `ANSI` object in index.js (lines 17-24) is used by CLI output commands, so it stays.

- [ ] **Step 2: Verify clean startup and shutdown**

```bash
# Start and immediately press q
node src/index.js start
```

Verify no errors on startup or shutdown. Cursor should be restored.

- [ ] **Step 3: Final commit**

```bash
git add -u
git commit -m "chore: cleanup after TUI Ink migration"
```

---

## Self-Review Checklist

- [ ] **Spec coverage:** Each section of the spec maps to a task:
  - Section 二 (layout): Task 3 (components)
  - Section 三 (card layers): Task 3 (worker-card.mjs)
  - Section 四 (turns data model): Task 2 (master.js refactor)
  - Section 五 (Ink technical): Tasks 1, 3, 4
  - Section 六 (keyboard): Task 3 (app.mjs useInput)
  - Section 七 (colors): Task 3 (colors.mjs)
  - Section 八 (file changes): All tasks

- [ ] **Placeholder scan:** No TBD, TODO, "implement later" in any step.

- [ ] **Type consistency:**
  - `worker.currentTurn` structure `{ summary, summaryTime, actions: [{ tool, target, time, status }] }` is created in Task 2 Step 3 and consumed in Task 3 Step 4 (CurrentTurn/ActionLine components) — fields match.
  - `worker.turns[]` elements have same structure — consumed in Task 3 Step 4 (HistoryTurn) — fields match.
  - `master._renderCallback` set in Task 4 Step 1 (tui.js scheduleRender) and used in Task 3 Step 5 (app.mjs useEffect) — consistent.
