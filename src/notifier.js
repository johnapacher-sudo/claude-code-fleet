'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

// --- Constants ---

const CONFIG_DIR = path.join(os.homedir(), '.config', 'claude-code-fleet');
const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');
const NOTIFY_CONFIG_PATH = path.join(CONFIG_DIR, 'notify.json');

const ERROR_KEYWORDS = ['error', 'failed', 'exception'];

const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  timeoutMinutes: 5,
  events: Object.freeze({
    stop: true,
    error: true,
    timeout: true,
    notification: true,
  }),
});

// --- Error detection ---

/**
 * Detect whether a message contains error-related keywords.
 * Returns false for null/empty/falsy messages.
 *
 * @param {string|null|undefined} message
 * @returns {boolean}
 */
function detectError(message) {
  if (!message || typeof message !== 'string') {
    return false;
  }
  const lower = message.toLowerCase();
  return ERROR_KEYWORDS.some((keyword) => lower.includes(keyword));
}

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

/**
 * Write (or overwrite) the activity timestamp file for a session.
 *
 * @param {string} sessionId
 */
function updateActivity(sessionId) {
  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    const filePath = path.join(SESSIONS_DIR, `${sessionId}.last-activity`);
    fs.writeFileSync(filePath, String(Date.now()));
  } catch { /* ignore write failures */ }
}

/**
 * Remove the timeout-notified flag file so a new timeout can fire later.
 *
 * @param {string} sessionId
 */
function clearTimeoutFlag(sessionId) {
  try {
    const flagPath = path.join(SESSIONS_DIR, `${sessionId}.timeout-notified`);
    if (fs.existsSync(flagPath)) {
      fs.unlinkSync(flagPath);
    }
  } catch { /* ignore */ }
}

// --- Stop-notification flags (per-session, cleared when session restarts) ---

/**
 * Check whether a stop notification has already been sent for this session.
 *
 * @param {string} sessionId
 * @returns {boolean}
 */
function isStopNotified(sessionId) {
  try {
    const flagPath = path.join(SESSIONS_DIR, `${sessionId}.stop-notified`);
    return fs.existsSync(flagPath);
  } catch {
    return false;
  }
}

/**
 * Mark that a stop notification was sent for this session.
 *
 * @param {string} sessionId
 */
function markStopNotified(sessionId) {
  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    const flagPath = path.join(SESSIONS_DIR, `${sessionId}.stop-notified`);
    fs.writeFileSync(flagPath, String(Date.now()));
  } catch { /* ignore */ }
}

/**
 * Clear the stop-notified flag for a session.
 * Currently a no-op because the flag is per-session and ephemeral,
 * but provided for API completeness.
 *
 * @param {string} sessionId
 */
function clearStopNotified(_sessionId) {
  // Intentionally a no-op: per-session flags are not reused across sessions.
}

// --- Timeout check ---

/**
 * Check whether a session has exceeded its timeout threshold.
 * If so, send a notification (unless one was already sent).
 *
 * @param {string} sessionId
 * @param {object} config - The merged notification config
 * @returns {boolean} true if a timeout notification was fired
 */
function checkTimeout(sessionId, config) {
  try {
    const flagPath = path.join(SESSIONS_DIR, `${sessionId}.timeout-notified`);
    if (fs.existsSync(flagPath)) {
      return false;
    }

    const activityPath = path.join(SESSIONS_DIR, `${sessionId}.last-activity`);
    if (!fs.existsSync(activityPath)) {
      return false;
    }

    const lastActivity = parseInt(fs.readFileSync(activityPath, 'utf-8'), 10);
    const elapsed = Date.now() - lastActivity;
    const threshold = (config.timeoutMinutes || DEFAULT_CONFIG.timeoutMinutes) * 60 * 1000;

    if (elapsed >= threshold) {
      fs.writeFileSync(flagPath, String(Date.now()));
      sendNotification({
        title: 'Fleet',
        body: `Session ${sessionId.slice(0, 8)} has been inactive for ${Math.round(elapsed / 60000)}m`,
        sessionId,
        platform: process.platform,
      });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

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
function sendMacOS(title, body, cwd, sessionId) {
  try {
    const safeBody = truncateBody(body);
    const safeTitle = truncateBody(title, 60);
    const project = cwd ? path.basename(cwd) : '';
    const escapedBody = safeBody.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const escapedTitle = safeTitle.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const escapedProject = project.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const subtitlePart = escapedProject ? ` subtitle "${escapedProject}"` : '';
    const script = `display notification "${escapedBody}" with title "${escapedTitle}"${subtitlePart}`;
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
function sendNotification({ title, body, cwd, sessionId, platform }) {
  const p = platform || process.platform;
  switch (p) {
    case 'darwin':
      sendMacOS(title, body, cwd, sessionId);
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
  detectError,
  loadNotifyConfig,
  updateActivity,
  clearTimeoutFlag,
  isStopNotified,
  markStopNotified,
  clearStopNotified,
  checkTimeout,
  sendNotification,

  // Expose internals for testing
  _DEFAULT_CONFIG: DEFAULT_CONFIG,
  _CONFIG_DIR: CONFIG_DIR,
  _SESSIONS_DIR: SESSIONS_DIR,
  _NOTIFY_CONFIG_PATH: NOTIFY_CONFIG_PATH,
};
