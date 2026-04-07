# Terminal Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Enter-to-focus-terminal functionality to the observer TUI, allowing users to jump to the terminal window running a selected Claude Code worker.

**Architecture:** hook-client collects terminal metadata (`TERM_PROGRAM`, `ITERM_SESSION_ID`) on SessionStart and sends it to Master via the existing Unix socket. Master stores it in worker state. A new `terminal-focus.mjs` module handles per-terminal AppleScript/shell commands. TUI remaps Enter to focus and Space to expand.

**Tech Stack:** Node.js (CJS + ESM), AppleScript via `osascript`, Ink/React for TUI

**Spec:** `docs/superpowers/specs/2026-04-05-terminal-focus-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/hook-client.js` | Modify | Collect terminal env vars on SessionStart |
| `src/master.js` | Modify | Store terminal metadata in worker state |
| `src/components/terminal-focus.mjs` | Create | Execute focus commands per terminal type |
| `src/components/worker-card.mjs` | Modify | Display terminal name tag |
| `src/components/app.mjs` | Modify | Remap keys, integrate focus, show feedback |
| `src/components/footer.mjs` | Modify | Update key hint text |

---

### Task 1: Add terminal metadata to hook-client.js

**Files:**
- Modify: `src/hook-client.js:27-29`

- [ ] **Step 1: Add terminal metadata fields to SessionStart payload**

In `src/hook-client.js`, after line 29 (`payload.model = input.model || null;`), add four fields:

```javascript
  // SessionStart: extract model
  if (input.hook_event_name === 'SessionStart') {
    payload.model = input.model || null;
    payload.pid = process.pid;
    payload.ppid = process.ppid;
    payload.term_program = process.env.TERM_PROGRAM || null;
    payload.iterm_session_id = process.env.ITERM_SESSION_ID || null;
  }
```

- [ ] **Step 2: Verify no syntax errors**

Run: `node -c src/hook-client.js`
Expected: No output (no syntax errors)

- [ ] **Step 3: Commit**

```bash
git add src/hook-client.js
git commit -m "feat(hook): collect terminal metadata on SessionStart"
```

---

### Task 2: Store terminal metadata in master.js worker state

**Files:**
- Modify: `src/master.js:69-83` (worker creation)
- Modify: `src/master.js:88-94` (SessionStart handler)

- [ ] **Step 1: Add terminal fields to worker state initialization**

In `src/master.js`, in the worker creation block (around line 70), add four new fields after `currentTurn`:

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
        turns: [],
        currentTurn: null,
        termProgram: null,
        itermSessionId: null,
        pid: null,
        ppid: null,
      });
    }
```

- [ ] **Step 2: Populate fields from SessionStart event**

In the SessionStart handler block (around line 89), add after the `fleetModelName` assignment:

```javascript
    if (payload.event === 'SessionStart') {
      worker.modelName = payload.model || null;
      if (payload.fleet_model_name) {
        worker.fleetModelName = payload.fleet_model_name;
      }
      if (payload.term_program) {
        worker.termProgram = payload.term_program;
      }
      if (payload.iterm_session_id) {
        worker.itermSessionId = payload.iterm_session_id;
      }
      if (payload.pid) {
        worker.pid = payload.pid;
      }
      if (payload.ppid) {
        worker.ppid = payload.ppid;
      }
    }
```

- [ ] **Step 3: Verify no syntax errors**

Run: `node -c src/master.js`
Expected: No output (no syntax errors)

- [ ] **Step 4: Commit**

```bash
git add src/master.js
git commit -m "feat(master): store terminal metadata in worker state"
```

---

### Task 3: Create terminal-focus.mjs module

**Files:**
- Create: `src/components/terminal-focus.mjs`

- [ ] **Step 1: Create the terminal focus module**

Create `src/components/terminal-focus.mjs` with the full implementation:

```javascript
import { execSync } from 'child_process';
import os from 'os';

export const TERMINAL_NAMES = {
  'iTerm.app': 'iTerm',
  'Apple_Terminal': 'Terminal',
  'vscode': 'VSCode',
  'Cursor': 'Cursor',
  'WarpTerminal': 'Warp',
  'WezTerm': 'WezTerm',
};

function runAppleScript(script) {
  execSync('osascript', { input: script, stdio: ['pipe', 'pipe', 'pipe'] });
}

function focusITerm(itermSessionId, displayName) {
  if (itermSessionId) {
    const script = `
tell application "iTerm"
  activate
  tell current window
    repeat with t in tabs
      repeat with s in sessions of t
        if (id of s as text) contains "${itermSessionId.split(':')[0]}" then
          select t
          select s
        end if
      end repeat
    end repeat
  end tell
end tell`;
    runAppleScript(script);
  } else {
    const script = `
tell application "iTerm"
  activate
end tell`;
    runAppleScript(script);
  }
}

function focusByWindowTitle(processName, displayName) {
  const script = `
tell application "System Events"
  tell process "${processName}"
    set frontmost to true
    repeat with w in windows
      if name of w contains "${displayName}" then
        perform action "AXRaise" of w
      end if
    end repeat
  end tell
end tell`;
  runAppleScript(script);
}

function focusVSCode(cwd) {
  execSync(`open -a "Visual Studio Code" "${cwd}"`, { stdio: 'pipe' });
}

function focusCursor(cwd) {
  execSync(`open -a "Cursor" "${cwd}"`, { stdio: 'pipe' });
}

export function focusTerminal({ termProgram, itermSessionId, cwd, displayName }) {
  if (os.platform() !== 'darwin') {
    return { ok: false, reason: 'unsupported' };
  }

  if (!termProgram) {
    return { ok: false, reason: 'unknown' };
  }

  const name = TERMINAL_NAMES[termProgram] || termProgram;

  try {
    switch (termProgram) {
      case 'iTerm.app':
        focusITerm(itermSessionId, displayName);
        break;
      case 'Apple_Terminal':
        focusByWindowTitle('Terminal', displayName);
        break;
      case 'vscode':
        focusVSCode(cwd);
        break;
      case 'Cursor':
        focusCursor(cwd);
        break;
      case 'WarpTerminal':
        focusByWindowTitle('Warp', displayName);
        break;
      case 'WezTerm':
        focusByWindowTitle('WezTerm', displayName);
        break;
      default:
        return { ok: false, reason: 'unknown' };
    }
    return { ok: true, name };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
```

- [ ] **Step 2: Verify module loads without errors**

Run: `node -e "import('./src/components/terminal-focus.mjs').then(m => console.log(Object.keys(m)))"`
Expected: `[ 'TERMINAL_NAMES', 'focusTerminal' ]`

- [ ] **Step 3: Commit**

```bash
git add src/components/terminal-focus.mjs
git commit -m "feat(tui): add terminal focus module with AppleScript strategies"
```

---

### Task 4: Add terminal label to worker-card.mjs

**Files:**
- Modify: `src/components/worker-card.mjs:1-6` (import)
- Modify: `src/components/worker-card.mjs:139-151` (header row)

- [ ] **Step 1: Add import and terminal name display**

In `src/components/worker-card.mjs`, add the import at the top:

```javascript
import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { colors } from './colors.mjs';
import { TERMINAL_NAMES } from './terminal-focus.mjs';
```

In the `WorkerCard` function, in the header row (the first `h(Box, { justifyContent: 'space-between' }, ...)` block), add the terminal tag between the model name and elapsed time. Replace the existing header row with:

```javascript
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
        worker.termProgram
          ? h(Text, { color: colors.idle }, TERMINAL_NAMES[worker.termProgram] || worker.termProgram)
          : null,
      ),
      h(Text, { color: colors.idle }, elapsed),
    ),
```

- [ ] **Step 2: Verify no syntax errors**

Run: `node -c src/components/worker-card.mjs`
Note: `node -c` only checks CJS. For ESM, verify by loading:
Run: `node -e "import('./src/components/worker-card.mjs').then(() => console.log('ok'))"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add src/components/worker-card.mjs
git commit -m "feat(tui): show terminal name tag on worker cards"
```

---

### Task 5: Remap keys and integrate focus in app.mjs

**Files:**
- Modify: `src/components/app.mjs:1-6` (imports)
- Modify: `src/components/app.mjs:17-89` (App component)

- [ ] **Step 1: Add import for focusTerminal**

Add `focusTerminal` to the imports at the top of `src/components/app.mjs`:

```javascript
import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useApp, useInput, render } from 'ink';
import { Header } from './header.mjs';
import { WorkerCard } from './worker-card.mjs';
import { Footer } from './footer.mjs';
import { colors } from './colors.mjs';
import { focusTerminal, TERMINAL_NAMES } from './terminal-focus.mjs';
```

- [ ] **Step 2: Add focusStatus state and clear timer ref**

In the `App` function, add after the existing state declarations (after `const [expanded, setExpanded] = useState(new Set());`):

```javascript
  const [focusStatus, setFocusStatus] = useState(null);
  const focusTimerRef = useRef(null);
```

- [ ] **Step 3: Remap Enter to focus and Space to expand**

Replace the entire `useInput` block (lines 59-89) with:

```javascript
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
    if (key.tab) {
      setSortMode(m => m === 'time' ? 'name' : 'time');
    }
    // Space: expand/collapse worker details
    if (input === ' ') {
      if (workers.length === 0) return;
      const sid = workers[selectedIdx]?.sessionId;
      if (!sid) return;
      setExpanded(prev => {
        const next = new Set(prev);
        if (next.has(sid)) next.delete(sid);
        else next.add(sid);
        return next;
      });
    }
    // Enter: focus terminal window
    if (key.return) {
      if (workers.length === 0) return;
      const worker = workers[selectedIdx];
      if (!worker) return;

      if (!worker.termProgram) {
        setFocusStatus({ ok: false, reason: 'unknown', name: null });
      } else {
        const result = focusTerminal({
          termProgram: worker.termProgram,
          itermSessionId: worker.itermSessionId,
          cwd: worker.cwd,
          displayName: worker.displayName,
        });
        setFocusStatus(result);
      }

      // Auto-clear after 2 seconds
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
      focusTimerRef.current = setTimeout(() => setFocusStatus(null), 2000);
    }
    // Number keys 1-9 to jump to worker
    const num = parseInt(input, 10);
    if (num >= 1 && num <= 9 && num <= workers.length) {
      setSelectedIdx(num - 1);
    }
  });
```

- [ ] **Step 4: Add focus status display in the render output**

Add a focus status line between the worker list and the footer. In the `return` block, insert before `h(Box, { paddingTop: 1 }, h(Footer))`:

```javascript
    // Focus status feedback
    focusStatus
      ? h(Box, { paddingX: 1 },
          focusStatus.ok
            ? h(Text, { color: colors.running },
                `\u2713 Focused ${focusStatus.name} \u2192 ${workers[selectedIdx]?.displayName || ''}`)
            : focusStatus.reason === 'unknown'
              ? h(Text, { color: colors.slow },
                  '\u26A0 No terminal info for this worker')
              : h(Text, { color: colors.modelAlias },
                  '\u2717 Focus failed'),
        )
      : null,
```

The full return block should now be:

```javascript
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
            h(Box, { key: w.sessionId, flexDirection: 'column' },
              h(Box, {
                flexDirection: 'column',
                borderStyle: i === selectedIdx ? 'single' : undefined,
                borderColor: i === selectedIdx ? colors.idle : undefined,
                paddingLeft: i === selectedIdx ? 0 : 1,
              },
                h(WorkerCard, { worker: w, now, isExpanded: expanded.has(w.sessionId) }),
              ),
              i < workers.length - 1
                ? h(Text, { color: colors.separator }, '\u2500'.repeat(50))
                : null,
            ),
          ),
    ),
    // Focus status feedback
    focusStatus
      ? h(Box, { paddingX: 1 },
          focusStatus.ok
            ? h(Text, { color: colors.running },
                `\u2713 Focused ${focusStatus.name} \u2192 ${workers[selectedIdx]?.displayName || ''}`)
            : focusStatus.reason === 'unknown'
              ? h(Text, { color: colors.slow },
                  '\u26A0 No terminal info for this worker')
              : h(Text, { color: colors.modelAlias },
                  '\u2717 Focus failed'),
        )
      : null,
    h(Box, { paddingTop: 1 },
      h(Footer),
    ),
  );
```

- [ ] **Step 5: Verify the module loads**

Run: `node -e "import('./src/components/app.mjs').then(() => console.log('ok'))"`
Expected: `ok`

- [ ] **Step 6: Commit**

```bash
git add src/components/app.mjs
git commit -m "feat(tui): remap Enter to focus terminal, Space to expand"
```

---

### Task 6: Update footer key hints

**Files:**
- Modify: `src/components/footer.mjs:12-14`

- [ ] **Step 1: Update footer text**

Replace the footer content in `src/components/footer.mjs`:

```javascript
export function Footer() {
  return h(Box, {
    justifyContent: 'space-between',
    paddingX: 1,
  },
    h(Text, { color: colors.footer },
      '[j/k] scroll  [space] expand  [enter] focus  [1-9] jump'
    ),
    h(Text, { color: colors.footer }, '[q] quit'),
  );
}
```

- [ ] **Step 2: Verify module loads**

Run: `node -e "import('./src/components/footer.mjs').then(() => console.log('ok'))"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add src/components/footer.mjs
git commit -m "feat(tui): update footer hints for focus key mapping"
```

---

### Task 7: End-to-end verification

- [ ] **Step 1: Run the TUI and verify it starts without errors**

Run: `node src/index.js start`
Expected: TUI renders with the updated footer showing `[j/k] scroll  [space] expand  [enter] focus  [1-9] jump`

- [ ] **Step 2: Start a Claude Code session in another terminal to generate a worker**

In a separate terminal:
```bash
claude
```

Wait for the worker to appear in the TUI. Verify:
- Worker card shows terminal name tag (e.g., "iTerm" or "Terminal")
- `j`/`k` moves selection
- `space` expands/collapses worker details
- `1-9` jumps to worker

- [ ] **Step 3: Test Enter focus**

With a worker selected, press Enter. Verify:
- iTerm: the tab/pane running that Claude Code process comes to the foreground
- Terminal.app: the Terminal window comes to the foreground
- VSCode/Cursor: the project window comes to the foreground
- Bottom of TUI shows a status line: `✓ Focused <terminal> → <project>`
- Status line disappears after 2 seconds

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address terminal focus integration issues"
```
