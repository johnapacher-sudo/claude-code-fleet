import { execSync, execFileSync } from 'child_process';
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

function escapeAppleScript(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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
  // Strategy: find the tty device of the Claude Code process via its pid,
  // then tell Terminal.app to select the tab that owns that tty.
  const tty = getTtyForPid(ppid);
  if (tty) {
    const ttyPath = `/dev/${tty}`;
    const script = `
tell application "Terminal"
  activate
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is "${escapeAppleScript(ttyPath)}" then
        set selected of t to true
        set index of w to 1
        return
      end if
    end repeat
  end repeat
end tell`;
    runAppleScript(script);
    return;
  }
  // Fallback: just activate Terminal (best effort — won't select specific tab)
  runAppleScript(`tell application "Terminal" to activate`);
}

function focusByWindowTitle(processName, displayName) {
  // Try AXRaise for precise window targeting (requires Accessibility permission)
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
    return;
  } catch {
    // AXRaise may fail without Accessibility permission — fallback to simple activate
  }
  runAppleScript(`tell application "${escapeAppleScript(processName)}" to activate`);
}

function focusVSCode(cwd) {
  execFileSync('open', ['-a', 'Visual Studio Code', cwd], { stdio: 'pipe' });
}

function focusCursor(cwd) {
  execFileSync('open', ['-a', 'Cursor', cwd], { stdio: 'pipe' });
}

export function focusTerminal({ termProgram, itermSessionId, cwd, displayName, ppid }) {
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
        return { ok: false, reason: 'unknown' };
    }
    return { ok: true, name };
  } catch (err) {
    // Only detect actual macOS Automation permission denial
    // -1743: errAEEventNotPermitted (user denied AppleEvent permission)
    // "not allowed" from osascript when automation is blocked
    const msg = err.message || '';
    if (msg.includes('-1743') || msg.includes('not allowed')) {
      return { ok: false, reason: 'permission' };
    }
    return { ok: false, reason: 'failed', detail: msg.slice(0, 120) };
  }
}
