#!/usr/bin/env node

const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Notification module (optional — graceful degradation)
let notifier;
try {
  notifier = require('./notifier');
} catch {
  notifier = null;
}

const CONFIG_DIR = path.join(os.homedir(), '.config', 'claude-code-fleet');
const SOCK_PATH = path.join(CONFIG_DIR, 'fleet.sock');
const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');

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

  // PostToolUse: only tool_name and tool_input
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

  // Socket forwarding (existing logic)
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

main();
