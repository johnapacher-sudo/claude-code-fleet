'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

// --- Constants ---

const CONFIG_DIR = path.join(os.homedir(), '.config', 'claude-code-fleet');
const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');
const NOTIFY_CONFIG_PATH = path.join(CONFIG_DIR, 'notify.json');

const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  sound: true,
  events: Object.freeze({
    stop: true,
    notification: true,
  }),
});

// --- Config loading ---

/**
 * Read notify.json from disk, falling back to DEFAULT_CONFIG on any failure.
 *
 * @returns {object} Merged configuration
 */
function loadNotifyConfig() {
  try {
    if (!fs.existsSync(NOTIFY_CONFIG_PATH)) {
      return { ...DEFAULT_CONFIG, events: { ...DEFAULT_CONFIG.events } };
    }
    const raw = fs.readFileSync(NOTIFY_CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      events: {
        ...DEFAULT_CONFIG.events,
        ...(parsed.events || {}),
      },
    };
  } catch {
    return { ...DEFAULT_CONFIG, events: { ...DEFAULT_CONFIG.events } };
  }
}

// --- Activity tracking ---

// (removed — timeout detection requires a long-running process)

// --- Helpers ---

/**
 * Escape a string for safe inclusion in a single-quoted shell argument.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeShell(str) {
  return String(str)
    .replace(/'/g, "'\\''");
}

/**
 * Truncate a body string to a maximum length, appending an ellipsis if needed.
 *
 * @param {string} body
 * @param {number} [maxLength=200]
 * @returns {string}
 */
function truncateBody(body, maxLength = 200) {
  if (!body || body.length <= maxLength) {
    return body || '';
  }
  return body.slice(0, maxLength - 1) + '\u2026';
}

// --- Platform-specific notification senders ---

/**
 * Send a macOS notification via osascript.
 *
 * @param {string} title
 * @param {string} body
 * @param {string} sessionId
 */
function sendMacOS(title, body, cwd, sessionId, sound) {
  try {
    const safeBody = truncateBody(body);
    const safeTitle = truncateBody(title, 60);
    const project = cwd ? path.basename(cwd) : '';
    const escapedBody = safeBody.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const escapedTitle = safeTitle.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const escapedProject = project.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const subtitlePart = escapedProject ? ` subtitle "${escapedProject}"` : '';
    const soundPart = sound !== false ? ' sound name "default"' : '';
    const script = `display notification "${escapedBody}" with title "${escapedTitle}"${subtitlePart}${soundPart}`;
    execSync(`osascript -e '${escapeShell(script)}'`, { stdio: 'pipe', timeout: 5000 });
  } catch { /* silently ignore notification failures */ }
}

/**
 * Send a Linux notification via notify-send.
 *
 * @param {string} title
 * @param {string} body
 */
function sendLinux(title, body) {
  try {
    const safeBody = truncateBody(body);
    const safeTitle = truncateBody(title, 60);
    execSync(`notify-send '${escapeShell(safeTitle)}' '${escapeShell(safeBody)}'`, {
      stdio: 'pipe',
      timeout: 5000,
    });
  } catch { /* silently ignore notification failures */ }
}

/**
 * Send a Windows notification via PowerShell toast.
 *
 * @param {string} title
 * @param {string} body
 */
function sendWindows(title, body) {
  try {
    const safeBody = truncateBody(body);
    const safeTitle = truncateBody(title, 60);
    const ps = `
      [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
      [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null
      $template = @"
      <toast>
        <visual>
          <binding template="ToastText02">
            <text id="1">${safeTitle.replace(/"/g, '&quot;').replace(/</g, '&lt;')}</text>
            <text id="2">${safeBody.replace(/"/g, '&quot;').replace(/</g, '&lt;')}</text>
          </binding>
        </visual>
      </toast>
"@
      $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
      $xml.LoadXml($template)
      $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
      [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Fleet").Show($toast)
    `.trim();
    execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, {
      stdio: 'pipe',
      timeout: 5000,
    });
  } catch { /* silently ignore notification failures */ }
}

// --- Unified notification sender ---

/**
 * Send a desktop notification using the platform-appropriate method.
 *
 * @param {object} params
 * @param {string} params.title
 * @param {string} params.body
 * @param {string} params.sessionId
 * @param {string} [params.platform] - Override platform detection (for testing)
 */
function sendNotification({ title, body, cwd, sessionId, platform, sound }) {
  const p = platform || process.platform;
  switch (p) {
    case 'darwin':
      sendMacOS(title, body, cwd, sessionId, sound);
      break;
    case 'linux':
      sendLinux(title, body);
      break;
    case 'win32':
      sendWindows(title, body);
      break;
    default:
      break;
  }
}

// --- Exports ---

module.exports = {
  loadNotifyConfig,
  sendNotification,

  // Expose internals for testing
  _DEFAULT_CONFIG: DEFAULT_CONFIG,
  _CONFIG_DIR: CONFIG_DIR,
  _SESSIONS_DIR: SESSIONS_DIR,
  _NOTIFY_CONFIG_PATH: NOTIFY_CONFIG_PATH,
};
