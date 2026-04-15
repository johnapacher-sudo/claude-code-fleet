#!/usr/bin/env node
const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_DIR = path.join(os.homedir(), '.config', 'claude-code-fleet');
const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');

const TERMINAL_NAMES = {
  'iTerm.app': 'iTerm', 'Apple_Terminal': 'Terminal',
  'vscode': 'VSCode', 'Cursor': 'Cursor',
  'WarpTerminal': 'Warp', 'WezTerm': 'WezTerm',
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
  } catch { return null; }
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
    try { runAppleScript(script); return; } catch { /* fallback */ }
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
  try { runAppleScript(script); }
  catch { runAppleScript(`tell application "${escapeAppleScript(processName)}" to activate`); }
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
    case 'iTerm.app': focusITerm(itermSessionId); break;
    case 'Apple_Terminal': focusAppleTerminal(ppid); break;
    case 'vscode': focusVSCode(cwd); break;
    case 'Cursor': focusCursor(cwd); break;
    case 'WarpTerminal': focusByWindowTitle('Warp', displayName); break;
    case 'WezTerm': focusByWindowTitle('WezTerm', displayName); break;
  }
}

function main() {
  const sessionId = process.argv[2];
  if (!sessionId) process.exit(0);
  const sessionFile = path.join(SESSIONS_DIR, `${sessionId}.json`);
  if (!fs.existsSync(sessionFile)) process.exit(0);
  let data;
  try { data = JSON.parse(fs.readFileSync(sessionFile, 'utf-8')); }
  catch { process.exit(0); }
  try {
    focusTerminal({
      termProgram: data.term_program,
      itermSessionId: data.iterm_session_id,
      cwd: data.cwd,
      displayName: path.basename(data.cwd || 'unknown'),
      ppid: data.ppid,
    });
  } catch { /* ignore */ }
  process.exit(0);
}

main();
