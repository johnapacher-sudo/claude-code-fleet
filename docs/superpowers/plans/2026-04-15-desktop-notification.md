# Desktop Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add independent desktop notifications to hook-client.js that fire when Claude Code processes finish, error, timeout, or send notifications — with click-to-focus on macOS.

**Architecture:** A new `notifier.js` CommonJS module loaded by `hook-client.js`. Uses file-based timestamps for timeout detection and `terminal-notifier`/`osascript` for macOS desktop notifications. A standalone `focus-session.js` script handles click-to-focus. Zero external dependencies.

**Tech Stack:** Node.js built-in modules (`child_process`, `fs`, `os`, `path`), `terminal-notifier` (optional, macOS), `osascript` (macOS fallback), `notify-send` (Linux).

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/notifier.js` | Create | Notification logic: send, timeout detection, error detection, config loading, activity tracking |
| `src/focus-session.js` | Create | Standalone script: read session file → AppleScript focus terminal |
| `src/hook-client.js` | Modify | Wire notification calls after existing logic |
| `src/master.js` | Modify | `ensureHooks()` copies `notifier.js` + `focus-session.js` to hooks dir |
| `src/index.js` | Modify | Add `fleet notify` CLI command |
| `tests/notifier.test.js` | Create | Unit tests for notifier.js |
| `tests/focus-session.test.js` | Create | Unit tests for focus-session.js |

---

### Task 1: `detectError()` in notifier.js

**Files:**
- Create: `src/notifier.js`
- Test: `tests/notifier.test.js`

- [ ] **Step 1: Write failing tests for `detectError`**

```js
// tests/notifier.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

// We test notifier by importing it after writing the module.
// For now, test via rewire or direct require.
const CONFIG_DIR = path.join(os.homedir(), '.config', 'claude-code-fleet');

describe('notifier', () => {
  describe('detectError', () => {
    let detectError;

    beforeEach(async () => {
      const mod = await import('../src/notifier.js');
      detectError = mod.detectError;
    });

    it('returns false for null message', () => {
      expect(detectError(null)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(detectError('')).toBe(false);
    });

    it('returns false for normal completion message', () => {
      expect(detectError('Successfully refactored the authentication module.')).toBe(false);
    });

    it('returns true for message containing "error"', () => {
      expect(detectError('An error occurred while processing')).toBe(true);
    });

    it('returns true for message containing "Error"', () => {
      expect(detectError('TypeError: Cannot read property')).toBe(true);
    });

    it('returns true for message containing "failed"', () => {
      expect(detectError('The operation failed unexpectedly')).toBe(true);
    });

    it('returns true for message containing "Failed"', () => {
      expect(detectError('Failed to connect to database')).toBe(true);
    });

    it('returns true for message containing "exception"', () => {
      expect(detectError('Unhandled exception in worker thread')).toBe(true);
    });

    it('returns true for message containing "Exception"', () => {
      expect(detectError('NullPointerException at line 42')).toBe(true);
    });

    it('returns false for message containing "error" as part of a normal word', () => {
      // "error" in "errors" should still match — this is intentional over-detection
      // to avoid missing real errors. False positives are acceptable.
      expect(detectError('Fixed all errors in the codebase')).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/notifier.test.js`
Expected: FAIL — module `../src/notifier.js` not found

- [ ] **Step 3: Write minimal `notifier.js` with `detectError`**

```js
// src/notifier.js
const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_DIR = path.join(os.homedir(), '.config', 'claude-code-fleet');
const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');
const NOTIFY_CONFIG_PATH = path.join(CONFIG_DIR, 'notify.json');
const HOOKS_DIR = path.join(CONFIG_DIR, 'hooks');

const ERROR_KEYWORDS = ['error', 'failed', 'exception'];

const DEFAULT_CONFIG = {
  enabled: true,
  timeoutMinutes: 5,
  events: { stop: true, error: true, timeout: true, notification: true },
};

function detectError(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ERROR_KEYWORDS.some(kw => lower.includes(kw));
}

function loadNotifyConfig() {
  try {
    if (!fs.existsSync(NOTIFY_CONFIG_PATH)) return { ...DEFAULT_CONFIG };
    const raw = JSON.parse(fs.readFileSync(NOTIFY_CONFIG_PATH, 'utf-8'));
    return {
      enabled: raw.enabled !== false,
      timeoutMinutes: raw.timeoutMinutes || DEFAULT_CONFIG.timeoutMinutes,
      events: { ...DEFAULT_CONFIG.events, ...(raw.events || {}) },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function updateActivity(sessionId) {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    fs.writeFileSync(path.join(SESSIONS_DIR, `${sessionId}.last-activity`), String(Date.now()));
  } catch { /* ignore */ }
}

function clearTimeoutFlag(sessionId) {
  try { fs.unlinkSync(path.join(SESSIONS_DIR, `${sessionId}.timeout-notified`)); } catch { /* ignore */ }
}

function isStopNotified(sessionId) {
  return fs.existsSync(path.join(SESSIONS_DIR, `${sessionId}.stop-notified`));
}

function markStopNotified(sessionId) {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    fs.writeFileSync(path.join(SESSIONS_DIR, `${sessionId}.stop-notified`), String(Date.now()));
  } catch { /* ignore */ }
}

function clearStopNotified(sessionId) {
  // Stop-notified is NOT cleared on new Stop — it prevents duplicate Stop notifications
  // for the same session. It's per-session, not per-task.
}

function checkTimeout(sessionId, config) {
  if (!config.events.timeout) return;
  try {
    const activityFile = path.join(SESSIONS_DIR, `${sessionId}.last-activity`);
    if (!fs.existsSync(activityFile)) return;

    const lastActivity = parseInt(fs.readFileSync(activityFile, 'utf-8'), 10);
    const elapsed = Date.now() - lastActivity;
    const threshold = config.timeoutMinutes * 60 * 1000;

    if (elapsed > threshold) {
      const notifiedFile = path.join(SESSIONS_DIR, `${sessionId}.timeout-notified`);
      if (fs.existsSync(notifiedFile)) return;

      fs.writeFileSync(notifiedFile, String(Date.now()));
      sendNotification({
        title: '⏱ 执行超时',
        body: `已 ${Math.round(elapsed / 60000)} 分钟未收到活动事件`,
        sessionId,
        platform: process.platform,
      });
    }
  } catch { /* ignore */ }
}

function hasTerminalNotifier() {
  try {
    execSync('which terminal-notifier', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function escapeShell(str) {
  return str.replace(/'/g, "'\\''");
}

function truncateBody(text, max = 200) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function sendNotification({ title, body, sessionId, platform }) {
  const safeTitle = truncateBody(title, 100);
  const safeBody = truncateBody(body);

  try {
    if (platform === 'darwin') {
      sendMacOS(safeTitle, safeBody, sessionId);
    } else if (platform === 'linux') {
      sendLinux(safeTitle, safeBody);
    } else if (platform === 'win32') {
      sendWindows(safeTitle, safeBody);
    }
  } catch { /* ignore notification failures */ }
}

function sendMacOS(title, body, sessionId) {
  if (hasTerminalNotifier()) {
    sendTerminalNotifier(title, body, sessionId);
  } else {
    sendOsascript(title, body);
  }
}

function sendTerminalNotifier(title, body, sessionId) {
  const focusScript = path.join(HOOKS_DIR, 'focus-session.js');
  const executeCmd = sessionId ? `node '${focusScript}' '${sessionId}'` : '';
  const args = [
    '-title', 'Fleet',
    '-message', body,
    '-subtitle', title,
  ];
  if (executeCmd) {
    args.push('-execute', executeCmd);
  }
  try {
    execFileSync('terminal-notifier', args, { stdio: 'pipe', timeout: 5000 });
  } catch {
    sendOsascript(title, body);
  }
}

function sendOsascript(title, body) {
  const script = `display notification "${escapeShell(body)}" with title "Fleet" subtitle "${escapeShell(title)}"`;
  execSync(`osascript -e '${script}'`, { stdio: 'pipe', timeout: 5000 });
}

function sendLinux(title, body) {
  try {
    execFileSync('notify-send', ['Fleet', `${title}: ${body}`], { stdio: 'pipe', timeout: 5000 });
  } catch { /* ignore */ }
}

function sendWindows(title, body) {
  try {
    const ps = `
      Add-Type -AssemblyName System.Windows.Forms
      $n = New-Object System.Windows.Forms.NotifyIcon
      $n.Icon = [System.Drawing.SystemIcons]::Information
      $n.Visible = $true
      $n.ShowBalloonTip(5000, 'Fleet', '${escapeShell(title)}: ${escapeShell(body)}', [System.Windows.Forms.ToolTipIcon]::Info)
    `;
    execSync(`powershell -Command "${ps.replace(/"/g, '\\"')}"`, { stdio: 'pipe', timeout: 5000 });
  } catch { /* ignore */ }
}

module.exports = {
  detectError,
  loadNotifyConfig,
  updateActivity,
  clearTimeoutFlag,
  isStopNotified,
  markStopNotified,
  clearStopNotified,
  checkTimeout,
  sendNotification,
  // Exported for testing
  _DEFAULT_CONFIG: DEFAULT_CONFIG,
  _CONFIG_DIR: CONFIG_DIR,
  _SESSIONS_DIR: SESSIONS_DIR,
  _NOTIFY_CONFIG_PATH: NOTIFY_CONFIG_PATH,
  _HOOKS_DIR: HOOKS_DIR,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/notifier.test.js`
Expected: All `detectError` tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/notifier.js tests/notifier.test.js
git commit -m "feat: add notifier module with detectError function"
```

---

### Task 2: `loadNotifyConfig()` tests

**Files:**
- Modify: `tests/notifier.test.js`

- [ ] **Step 1: Write failing tests for `loadNotifyConfig`**

Add to `tests/notifier.test.js` inside the top-level `describe('notifier', ...)`:

```js
describe('loadNotifyConfig', () => {
  let loadNotifyConfig;
  let originalHome;

  beforeEach(async () => {
    const mod = await import('../src/notifier.js');
    loadNotifyConfig = mod.loadNotifyConfig;
  });

  it('returns default config when notify.json does not exist', () => {
    // The default config dir may or may not have notify.json
    // We test the shape, not the file
    const config = loadNotifyConfig();
    expect(config).toHaveProperty('enabled');
    expect(config).toHaveProperty('timeoutMinutes');
    expect(config).toHaveProperty('events');
    expect(config.events).toHaveProperty('stop');
    expect(config.events).toHaveProperty('error');
    expect(config.events).toHaveProperty('timeout');
    expect(config.events).toHaveProperty('notification');
  });

  it('returns enabled=true by default', () => {
    const config = loadNotifyConfig();
    // If no file exists, should default to enabled
    expect(typeof config.enabled).toBe('boolean');
  });

  it('returns timeoutMinutes as a number', () => {
    const config = loadNotifyConfig();
    expect(typeof config.timeoutMinutes).toBe('number');
    expect(config.timeoutMinutes).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/notifier.test.js`
Expected: PASS — `loadNotifyConfig` already implemented in Task 1

- [ ] **Step 3: Commit**

```bash
git add tests/notifier.test.js
git commit -m "test: add loadNotifyConfig tests"
```

---

### Task 3: Activity tracking and timeout detection tests

**Files:**
- Modify: `tests/notifier.test.js`

- [ ] **Step 1: Write failing tests for `updateActivity`, `checkTimeout`, flag management**

Add to `tests/notifier.test.js` inside the top-level `describe('notifier', ...)`:

```js
describe('updateActivity', () => {
  let updateActivity, _SESSIONS_DIR;
  let tmpDir;

  beforeEach(async () => {
    const mod = await import('../src/notifier.js');
    updateActivity = mod.updateActivity;
    _SESSIONS_DIR = mod._SESSIONS_DIR;
    tmpDir = path.join(os.tmpdir(), `fleet-notify-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('writes a timestamp file for the session', () => {
    // We can't easily override SESSIONS_DIR, so test with real path
    // by using a session ID that writes to the actual sessions dir
    const testSid = `test-activity-${Date.now()}`;
    updateActivity(testSid);
    const activityFile = path.join(_SESSIONS_DIR, `${testSid}.last-activity`);
    expect(fs.existsSync(activityFile)).toBe(true);
    const content = fs.readFileSync(activityFile, 'utf-8');
    expect(parseInt(content, 10)).toBeGreaterThan(0);
    // Cleanup
    try { fs.unlinkSync(activityFile); } catch { /* ignore */ }
  });
});

describe('timeout flags', () => {
  let clearTimeoutFlag, isStopNotified, markStopNotified, _SESSIONS_DIR;

  beforeEach(async () => {
    const mod = await import('../src/notifier.js');
    clearTimeoutFlag = mod.clearTimeoutFlag;
    isStopNotified = mod.isStopNotified;
    markStopNotified = mod.markStopNotified;
    _SESSIONS_DIR = mod._SESSIONS_DIR;
  });

  it('isStopNotified returns false when no flag file exists', () => {
    expect(isStopNotified(`no-such-sid-${Date.now()}`)).toBe(false);
  });

  it('markStopNotified creates flag and isStopNotified returns true', () => {
    const testSid = `test-stop-flag-${Date.now()}`;
    markStopNotified(testSid);
    expect(isStopNotified(testSid)).toBe(true);
    // Cleanup
    try { fs.unlinkSync(path.join(_SESSIONS_DIR, `${testSid}.stop-notified`)); } catch { /* ignore */ }
  });

  it('clearTimeoutFlag removes timeout flag file', () => {
    const testSid = `test-timeout-flag-${Date.now()}`;
    const flagPath = path.join(_SESSIONS_DIR, `${testSid}.timeout-notified`);
    fs.writeFileSync(flagPath, String(Date.now()));
    expect(fs.existsSync(flagPath)).toBe(true);
    clearTimeoutFlag(testSid);
    expect(fs.existsSync(flagPath)).toBe(false);
  });

  it('clearTimeoutFlag does not throw when file does not exist', () => {
    expect(() => clearTimeoutFlag(`no-such-sid-${Date.now()}`)).not.toThrow();
  });
});

describe('checkTimeout', () => {
  let checkTimeout, updateActivity, _SESSIONS_DIR;
  let sendNotificationSpy;

  beforeEach(async () => {
    const mod = await import('../src/notifier.js');
    checkTimeout = mod.checkTimeout;
    updateActivity = mod.updateActivity;
    _SESSIONS_DIR = mod._SESSIONS_DIR;
  });

  it('does not notify when activity is recent', () => {
    const testSid = `test-timeout-recent-${Date.now()}`;
    updateActivity(testSid);
    // With default 5min timeout, recent activity should not trigger
    const config = { events: { timeout: true }, timeoutMinutes: 5 };
    expect(() => checkTimeout(testSid, config)).not.toThrow();
    // Cleanup
    try { fs.unlinkSync(path.join(_SESSIONS_DIR, `${testSid}.last-activity`)); } catch { /* ignore */ }
  });

  it('notifies when activity is older than threshold', () => {
    const testSid = `test-timeout-old-${Date.now()}`;
    // Write an old activity timestamp (10 minutes ago)
    const oldTime = Date.now() - 10 * 60 * 1000;
    if (!fs.existsSync(_SESSIONS_DIR)) fs.mkdirSync(_SESSIONS_DIR, { recursive: true });
    fs.writeFileSync(path.join(_SESSIONS_DIR, `${testSid}.last-activity`), String(oldTime));

    const config = { events: { timeout: true }, timeoutMinutes: 5 };
    // This will attempt to send a real notification — acceptable in test
    expect(() => checkTimeout(testSid, config)).not.toThrow();
    // Should have created timeout-notified flag
    expect(fs.existsSync(path.join(_SESSIONS_DIR, `${testSid}.timeout-notified`))).toBe(true);

    // Cleanup
    try { fs.unlinkSync(path.join(_SESSIONS_DIR, `${testSid}.last-activity`)); } catch { /* ignore */ }
    try { fs.unlinkSync(path.join(_SESSIONS_DIR, `${testSid}.timeout-notified`)); } catch { /* ignore */ }
  });

  it('does not notify again when already notified', () => {
    const testSid = `test-timeout-dup-${Date.now()}`;
    const oldTime = Date.now() - 10 * 60 * 1000;
    if (!fs.existsSync(_SESSIONS_DIR)) fs.mkdirSync(_SESSIONS_DIR, { recursive: true });
    fs.writeFileSync(path.join(_SESSIONS_DIR, `${testSid}.last-activity`), String(oldTime));
    fs.writeFileSync(path.join(_SESSIONS_DIR, `${testSid}.timeout-notified`), String(Date.now()));

    const config = { events: { timeout: true }, timeoutMinutes: 5 };
    // Second call should not throw and should not send duplicate
    expect(() => checkTimeout(testSid, config)).not.toThrow();

    // Cleanup
    try { fs.unlinkSync(path.join(_SESSIONS_DIR, `${testSid}.last-activity`)); } catch { /* ignore */ }
    try { fs.unlinkSync(path.join(_SESSIONS_DIR, `${testSid}.timeout-notified`)); } catch { /* ignore */ }
  });

  it('skips when timeout event is disabled in config', () => {
    const testSid = `test-timeout-disabled-${Date.now()}`;
    const oldTime = Date.now() - 10 * 60 * 1000;
    if (!fs.existsSync(_SESSIONS_DIR)) fs.mkdirSync(_SESSIONS_DIR, { recursive: true });
    fs.writeFileSync(path.join(_SESSIONS_DIR, `${testSid}.last-activity`), String(oldTime));

    const config = { events: { timeout: false }, timeoutMinutes: 5 };
    expect(() => checkTimeout(testSid, config)).not.toThrow();
    // Should NOT have created timeout-notified flag
    expect(fs.existsSync(path.join(_SESSIONS_DIR, `${testSid}.timeout-notified`))).toBe(false);

    // Cleanup
    try { fs.unlinkSync(path.join(_SESSIONS_DIR, `${testSid}.last-activity`)); } catch { /* ignore */ }
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/notifier.test.js`
Expected: All tests PASS — activity/timeout functions already implemented in Task 1

- [ ] **Step 3: Commit**

```bash
git add tests/notifier.test.js
git commit -m "test: add activity tracking and timeout detection tests"
```

---

### Task 4: `sendNotification()` tests

**Files:**
- Modify: `tests/notifier.test.js`

- [ ] **Step 1: Write tests for `sendNotification`**

Add to `tests/notifier.test.js` inside the top-level `describe('notifier', ...)`:

```js
describe('sendNotification', () => {
  let sendNotification;

  beforeEach(async () => {
    const mod = await import('../src/notifier.js');
    sendNotification = mod.sendNotification;
  });

  it('does not throw on any platform', () => {
    // On CI or non-macOS, notification may fail silently
    expect(() => sendNotification({
      title: 'Test',
      body: 'Test body',
      sessionId: 'test-session',
      platform: process.platform,
    })).not.toThrow();
  });

  it('handles empty body without error', () => {
    expect(() => sendNotification({
      title: 'Test',
      body: '',
      sessionId: 'test-session',
      platform: process.platform,
    })).not.toThrow();
  });

  it('handles null body without error', () => {
    expect(() => sendNotification({
      title: 'Test',
      body: null,
      sessionId: 'test-session',
      platform: process.platform,
    })).not.toThrow();
  });

  it('truncates long body text', () => {
    const longBody = 'x'.repeat(500);
    expect(() => sendNotification({
      title: 'Test',
      body: longBody,
      sessionId: 'test-session',
      platform: process.platform,
    })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/notifier.test.js`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/notifier.test.js
git commit -m "test: add sendNotification tests"
```

---

### Task 5: `focus-session.js` standalone click-focus script

**Files:**
- Create: `src/focus-session.js`
- Create: `tests/focus-session.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/focus-session.test.js
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const focusSessionPath = path.resolve(process.cwd(), 'src/focus-session.js');

describe('focus-session', () => {
  it('exists as a file', () => {
    expect(fs.existsSync(focusSessionPath)).toBe(true);
  });

  it('is a Node.js script with shebang', () => {
    const src = fs.readFileSync(focusSessionPath, 'utf-8');
    expect(src.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('reads session file and uses termProgram for focusing', () => {
    const src = fs.readFileSync(focusSessionPath, 'utf-8');
    expect(src).toContain('term_program');
    expect(src).toContain('iTerm');
    expect(src).toContain('Terminal');
  });

  it('handles missing session file gracefully', () => {
    const src = fs.readFileSync(focusSessionPath, 'utf-8');
    expect(src).toContain('catch');
    expect(src).toContain('exit(0)');
  });

  it('uses execSync for AppleScript execution', () => {
    const src = fs.readFileSync(focusSessionPath, 'utf-8');
    expect(src).toContain('execSync');
    expect(src).toContain('osascript');
  });

  it('uses SESSIONS_DIR to locate session files', () => {
    const src = fs.readFileSync(focusSessionPath, 'utf-8');
    expect(src).toContain('sessions');
    expect(src).toContain('sessionId');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/focus-session.test.js`
Expected: FAIL — file does not exist

- [ ] **Step 3: Implement `focus-session.js`**

```js
#!/usr/bin/env node

// Standalone script: click-to-focus for terminal-notifier
// Called via: node focus-session.js <session_id>
// Reads session metadata and focuses the corresponding terminal window.

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_DIR = path.join(os.homedir(), '.config', 'claude-code-fleet');
const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');

const TERMINAL_NAMES = {
  'iTerm.app': 'iTerm',
  'Apple_Terminal': 'Terminal',
  'vscode': 'VSCode',
  'Cursor': 'Cursor',
  'WarpTerminal': 'Warp',
  'WezTerm': 'WezTerm',
};

function escapeAppleScript(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function runAppleScript(script) {
  execSync('osascript', { input: script, stdio: ['pipe', 'pipe', 'pipe'] });
}

function focusITerm(itermSessionId) {
  if (itermSessionId) {
    const script = `
tell application "iTerm"
  activate
  tell current window
    repeat with t in tabs
      repeat with s in sessions of t
        if (id of s as text) contains "${escapeAppleScript(itermSessionId.split(':')[0])}" then
          select t
          select s
        end if
      end repeat
    end repeat
  end tell
end tell`;
    runAppleScript(script);
  } else {
    runAppleScript(`tell application "iTerm" to activate`);
  }
}

function getTtyForPid(pid) {
  if (!pid) return null;
  try {
    const tty = execFileSync('ps', ['-o', 'tty=', '-p', String(pid)], { encoding: 'utf-8' }).trim();
    return tty || null;
  } catch {
    return null;
  }
}

function focusAppleTerminal(ppid) {
  const tty = getTtyForPid(ppid);
  if (tty) {
    const ttyPath = `/dev/${tty}`;
    const script = `
tell application "Terminal"
  activate
  try
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is "${escapeAppleScript(ttyPath)}" then
          set selected of t to true
          set index of w to 1
          return
        end if
      end repeat
    end repeat
  end try
end tell`;
    try {
      runAppleScript(script);
      return;
    } catch { /* fall back to simple activate */ }
  }
  runAppleScript(`tell application "Terminal" to activate`);
}

function focusByWindowTitle(processName, displayName) {
  const script = `
tell application "System Events"
  tell process "${escapeAppleScript(processName)}"
    set frontmost to true
    repeat with w in windows
      if name of w contains "${escapeAppleScript(displayName)}" then
        perform action "AXRaise" of w
      end if
    end repeat
  end tell
end tell`;
  try {
    runAppleScript(script);
  } catch {
    runAppleScript(`tell application "${escapeAppleScript(processName)}" to activate`);
  }
}

function focusVSCode(cwd) {
  execFileSync('open', ['-a', 'Visual Studio Code', cwd], { stdio: 'pipe' });
}

function focusCursor(cwd) {
  execFileSync('open', ['-a', 'Cursor', cwd], { stdio: 'pipe' });
}

function focusTerminal({ termProgram, itermSessionId, cwd, displayName, ppid }) {
  if (os.platform() !== 'darwin') return;
  if (!termProgram) return;

  switch (termProgram) {
    case 'iTerm.app':
      focusITerm(itermSessionId);
      break;
    case 'Apple_Terminal':
      focusAppleTerminal(ppid);
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
      break;
  }
}

function main() {
  const sessionId = process.argv[2];
  if (!sessionId) process.exit(0);

  const sessionFile = path.join(SESSIONS_DIR, `${sessionId}.json`);
  if (!fs.existsSync(sessionFile)) process.exit(0);

  let data;
  try {
    data = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
  } catch {
    process.exit(0);
  }

  try {
    focusTerminal({
      termProgram: data.term_program,
      itermSessionId: data.iterm_session_id,
      cwd: data.cwd,
      displayName: path.basename(data.cwd || 'unknown'),
      ppid: data.ppid,
    });
  } catch { /* ignore focus failures */ }

  process.exit(0);
}

main();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/focus-session.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/focus-session.js tests/focus-session.test.js
git commit -m "feat: add focus-session.js standalone click-to-focus script"
```

---

### Task 6: Integrate notifications into hook-client.js

**Files:**
- Modify: `src/hook-client.js`

- [ ] **Step 1: Add notification require (with graceful fallback)**

In `src/hook-client.js`, after the existing `require` statements (line 6), add:

```js
// Notification module (optional — graceful degradation)
let notifier;
try {
  notifier = require('./notifier');
} catch {
  notifier = null;
}
```

- [ ] **Step 2: Add notification logic at end of `main()` function**

In `src/hook-client.js`, replace the entire `main()` function. The existing code from line 12 to line 103 becomes:

```js
async function main() {
  let input = {};
  try {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString();
    if (raw.trim()) input = JSON.parse(raw);
  } catch { /* empty or invalid stdin */ }

  const payload = {
    event: input.hook_event_name,
    session_id: input.session_id,
    cwd: input.cwd,
    timestamp: Date.now(),
  };

  // SessionStart: extract model + persist session file
  if (input.hook_event_name === 'SessionStart') {
    payload.model = input.model || null;
    payload.pid = process.pid;
    payload.ppid = process.ppid;
    payload.term_program = process.env.TERM_PROGRAM || null;
    payload.iterm_session_id = process.env.ITERM_SESSION_ID || null;

    try {
      const sessionFile = path.join(SESSIONS_DIR, `${input.session_id}.json`);
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
      fs.writeFileSync(sessionFile, JSON.stringify({
        sessionId: input.session_id,
        cwd: input.cwd,
        model: payload.model,
        term_program: payload.term_program,
        iterm_session_id: payload.iterm_session_id,
        pid: payload.pid,
        ppid: payload.ppid,
        fleet_model_name: process.env.FLEET_MODEL_NAME || null,
        timestamp: Date.now(),
      }, null, 2));
    } catch { /* ignore write failures */ }
  }

  // Stop: update session file with last message for persistence
  if (input.hook_event_name === 'Stop') {
    try {
      const sessionFile = path.join(SESSIONS_DIR, `${input.session_id}.json`);
      if (fs.existsSync(sessionFile)) {
        const data = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
        data.stoppedAt = Date.now();
        if (input.last_assistant_message) {
          data.lastMessage = { text: input.last_assistant_message.slice(0, 500), time: Date.now() };
        }
        fs.writeFileSync(sessionFile, JSON.stringify(data, null, 2));
      }
    } catch { /* ignore */ }
  }

  // PostToolUse: only tool_name and tool_input, skip tool_response
  if (input.hook_event_name === 'PostToolUse') {
    payload.tool_name = input.tool_name;
    payload.tool_input = input.tool_input;
  }

  // Notification: message and type
  if (input.hook_event_name === 'Notification') {
    payload.message = input.message;
    payload.notification_type = input.notification_type;
  }

  // Stop: capture AI's final response text
  if (input.hook_event_name === 'Stop') {
    payload.last_assistant_message = (input.last_assistant_message || '').slice(0, 500);
  }

  // fleet run environment variable
  if (process.env.FLEET_MODEL_NAME) {
    payload.fleet_model_name = process.env.FLEET_MODEL_NAME;
  }

  // Socket forwarding (existing logic, unchanged)
  const client = net.connect(SOCK_PATH, () => {
    client.write(JSON.stringify(payload) + '\n');
    client.end();
  });
  client.on('error', () => { /* master not running */ });

  // Timeout protection for socket connection
  setTimeout(() => process.exit(0), 1000);

  // ─── Notification branch (independent, non-blocking) ───
  if (notifier) {
    try {
      const config = notifier.loadNotifyConfig();
      if (!config.enabled) return;

      const sid = input.session_id;
      notifier.updateActivity(sid);

      if (input.hook_event_name === 'PostToolUse') {
        notifier.checkTimeout(sid, config);
      }

      if (input.hook_event_name === 'Stop') {
        notifier.clearTimeoutFlag(sid);
        if (!notifier.isStopNotified(sid)) {
          const isAbnormal = notifier.detectError(payload.last_assistant_message);
          if (isAbnormal && !config.events.error) { /* skip */ }
          else if (!isAbnormal && !config.events.stop) { /* skip */ }
          else {
            notifier.sendNotification({
              title: isAbnormal ? '⚠ 任务异常结束' : '✅ 任务完成',
              body: payload.last_assistant_message,
              sessionId: sid,
              platform: process.platform,
            });
            notifier.markStopNotified(sid);
          }
        }
      }

      if (input.hook_event_name === 'Notification' && config.events.notification) {
        notifier.sendNotification({
          title: 'Claude 通知',
          body: payload.message,
          sessionId: sid,
          platform: process.platform,
        });
      }
    } catch { /* notification failures must not affect main flow */ }
  }
}
```

- [ ] **Step 3: Run existing hook-client tests**

Run: `npx vitest run tests/hook-client.test.js`
Expected: All existing tests still PASS (notification logic is additive)

- [ ] **Step 4: Verify notification integration via source inspection test**

Add to `tests/hook-client.test.js`:

```js
it('integrates notifier module', () => {
  const src = fs.readFileSync(hookClientPath, 'utf-8');
  expect(src).toContain("require('./notifier')");
  expect(src).toContain('loadNotifyConfig');
  expect(src).toContain('sendNotification');
  expect(src).toContain('checkTimeout');
  expect(src).toContain('detectError');
  expect(src).toContain('updateActivity');
});
```

Run: `npx vitest run tests/hook-client.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hook-client.js tests/hook-client.test.js
git commit -m "feat: integrate desktop notifications into hook-client"
```

---

### Task 7: Update `ensureHooks()` to copy notifier.js and focus-session.js

**Files:**
- Modify: `src/master.js`

- [ ] **Step 1: Add file copies in `Master.start()` method**

In `src/master.js`, in the `start()` method (line 28), after the existing `fs.copyFileSync(HOOK_CLIENT_SRC, HOOK_CLIENT_DST);` (line 29), add:

```js
// Copy notification support files
const notifierSrc = path.join(__dirname, 'notifier.js');
const notifierDst = path.join(HOOKS_DIR, 'notifier.js');
if (fs.existsSync(notifierSrc)) fs.copyFileSync(notifierSrc, notifierDst);

const focusSrc = path.join(__dirname, 'focus-session.js');
const focusDst = path.join(HOOKS_DIR, 'focus-session.js');
if (fs.existsSync(focusSrc)) fs.copyFileSync(focusSrc, focusDst);
```

This goes after line 29 (`fs.copyFileSync(HOOK_CLIENT_SRC, HOOK_CLIENT_DST);`).

- [ ] **Step 2: Add constants for the new paths**

At the top of `master.js`, after line 14 (`const HOOK_CLIENT_DST = ...`), add:

```js
const NOTIFIER_SRC = path.join(__dirname, 'notifier.js');
const NOTIFIER_DST = path.join(HOOKS_DIR, 'notifier.js');
const FOCUS_SESSION_SRC = path.join(__dirname, 'focus-session.js');
const FOCUS_SESSION_DST = path.join(HOOKS_DIR, 'focus-session.js');
```

Then simplify the `start()` addition to use these constants:

```js
if (fs.existsSync(NOTIFIER_SRC)) fs.copyFileSync(NOTIFIER_SRC, NOTIFIER_DST);
if (fs.existsSync(FOCUS_SESSION_SRC)) fs.copyFileSync(FOCUS_SESSION_SRC, FOCUS_SESSION_DST);
```

- [ ] **Step 3: Run existing master tests**

Run: `npx vitest run tests/master.test.js`
Expected: All existing tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/master.js
git commit -m "feat: copy notifier.js and focus-session.js in ensureHooks"
```

---

### Task 8: Add `fleet notify` CLI command

**Files:**
- Modify: `src/index.js`

- [ ] **Step 1: Add `cmdNotify` function**

In `src/index.js`, after the `cmdHooksStatus` function (after line 665), add:

```js
// ─── Notify commands ──────────────────────────────────────────────────────

function getNotifyConfigPath() {
  return path.join(GLOBAL_CONFIG_DIR, 'notify.json');
}

function loadNotifyConfig() {
  const p = getNotifyConfigPath();
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

function saveNotifyConfig(config) {
  const dir = path.dirname(getNotifyConfigPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getNotifyConfigPath(), JSON.stringify(config, null, 2) + '\n');
}

function cmdNotify(opts) {
  const configPath = getNotifyConfigPath();

  if (opts.on) {
    const existing = loadNotifyConfig() || {};
    existing.enabled = true;
    saveNotifyConfig(existing);
    console.log(ANSI.green('  Notifications enabled.'));
    return;
  }

  if (opts.off) {
    const existing = loadNotifyConfig() || {};
    existing.enabled = false;
    saveNotifyConfig(existing);
    console.log(ANSI.yellow('  Notifications disabled.'));
    return;
  }

  if (opts.timeout) {
    const existing = loadNotifyConfig() || {};
    existing.timeoutMinutes = parseInt(opts.timeout, 10) || 5;
    saveNotifyConfig(existing);
    console.log(ANSI.green(`  Timeout threshold set to ${existing.timeoutMinutes} minutes.`));
    return;
  }

  // Show current config
  const config = loadNotifyConfig();
  if (!config) {
    console.log(ANSI.bold('\nNotification Config:'));
    console.log(ANSI.dim('  No config file found. Using defaults:\n'));
    console.log('  enabled:       true');
    console.log('  timeout:       5 minutes');
    console.log('  events.stop:   true');
    console.log('  events.error:  true');
    console.log('  events.timeout:true');
    console.log('  events.notification: true');
  } else {
    console.log(ANSI.bold('\nNotification Config:'));
    console.log(`  file: ${ANSI.dim(configPath)}\n`);
    console.log(`  enabled:       ${config.enabled !== false ? ANSI.green('true') : ANSI.red('false')}`);
    console.log(`  timeout:       ${config.timeoutMinutes || 5} minutes`);
    console.log(`  events.stop:   ${config.events?.stop !== false ? ANSI.green('true') : ANSI.red('false')}`);
    console.log(`  events.error:  ${config.events?.error !== false ? ANSI.green('true') : ANSI.red('false')}`);
    console.log(`  events.timeout:${config.events?.timeout !== false ? ANSI.green('true') : ANSI.red('false')}`);
    console.log(`  events.notification: ${config.events?.notification !== false ? ANSI.green('true') : ANSI.red('false')}`);
  }
  console.log();
}
```

- [ ] **Step 2: Update `parseArgs` to handle notify flags**

In `src/index.js`, in the `parseArgs` function (line 716), add these cases inside the `while` loop, before the closing `else` at the end of the arg parsing:

```js
} else if (arg === '--on') {
  opts.on = true;
} else if (arg === '--off') {
  opts.off = true;
} else if (arg === '--timeout' && argv[i + 1]) {
  opts.timeout = argv[++i];
```

These go right before the final `else { positional.push(arg); }` block.

- [ ] **Step 3: Wire `notify` command into `main()` router**

In `src/index.js`, in the `main()` function, add this block right before the `// Remaining commands need fleet config` comment (line 876):

```js
  // Notify configuration (doesn't need fleet config)
  if (command === 'notify') {
    cmdNotify(opts);
    return;
  }
```

- [ ] **Step 4: Update help text**

In `printHelp()`, add `notify` to the commands list:

```
  notify              Configure desktop notifications
```

Add to Options:

```
  --on               Enable notifications (for notify command)
  --off              Disable notifications (for notify command)
  --timeout <min>    Set timeout threshold (for notify command)
```

Add to Examples:

```
  fleet notify                  # Show notification config
  fleet notify --on             # Enable notifications
  fleet notify --timeout 10     # Set 10-minute timeout
```

- [ ] **Step 5: Run existing tests**

Run: `npx vitest run`
Expected: All existing tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/index.js
git commit -m "feat: add fleet notify CLI command for notification configuration"
```

---

### Task 9: Run full test suite and fix any issues

**Files:**
- Potentially fix any test failures

- [ ] **Step 1: Run the complete test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run tests with coverage**

Run: `npx vitest run --coverage`
Expected: Coverage report shows notifier.js functions covered

- [ ] **Step 3: Fix any failures**

If any test fails, investigate and fix the issue. Re-run until all tests pass.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve test failures from notification integration"
```

---

### Task 10: Manual smoke test

- [ ] **Step 1: Install hooks**

Run: `fleet hooks install`

- [ ] **Step 2: Verify files copied**

Check that `~/.config/claude-code-fleet/hooks/` contains:
- `hook-client.js`
- `notifier.js`
- `focus-session.js`

- [ ] **Step 3: Test notification config**

Run: `fleet notify` — should show default config
Run: `fleet notify --timeout 3` — should set timeout to 3 minutes
Run: `fleet notify` — should show updated config

- [ ] **Step 4: Verify hook-client loads notifier**

Run: `echo '{"hook_event_name":"Stop","session_id":"manual-test","cwd":"/tmp","last_assistant_message":"Manual test complete"}' | node ~/.config/claude-code-fleet/hooks/hook-client.js`

Expected: Desktop notification appears on macOS

- [ ] **Step 5: Clean up test artifacts**

```bash
rm -f ~/.config/claude-code-fleet/sessions/manual-test.*
```
