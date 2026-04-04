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
