#!/usr/bin/env node

const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

let notifier;
try {
  notifier = require('./notifier');
} catch {
  notifier = null;
}

const CONFIG_DIR = path.join(os.homedir(), '.config', 'claude-code-fleet');
const SOCK_PATH = path.join(CONFIG_DIR, 'fleet.sock');
const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');

function parseToolArg() {
  const idx = process.argv.indexOf('--tool');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return 'claude';
}

function loadAdapter(toolName) {
  try {
    const mod = require(`./adapters/${toolName}`);
    const className = Object.keys(mod).find(k => k.endsWith('Adapter'));
    if (className) return new mod[className]();
  } catch { /* fallback */ }
  return null;
}

async function main() {
  const toolName = parseToolArg();
  const adapter = loadAdapter(toolName);

  let input = {};
  try {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString();
    if (raw.trim()) input = JSON.parse(raw);
  } catch { /* empty or invalid stdin */ }

  let payload;
  if (adapter) {
    payload = adapter.normalizePayload(input);
  } else {
    payload = {
      event: input.hook_event_name,
      session_id: input.session_id,
      cwd: input.cwd,
      timestamp: Date.now(),
    };

    if (input.hook_event_name === 'SessionStart') {
      payload.model = input.model || null;
      payload.pid = process.pid;
      payload.ppid = process.ppid;
      payload.term_program = process.env.TERM_PROGRAM || null;
      payload.iterm_session_id = process.env.ITERM_SESSION_ID || null;
    }

    if (input.hook_event_name === 'PostToolUse') {
      payload.tool_name = input.tool_name;
      payload.tool_input = input.tool_input;
    }

    if (input.hook_event_name === 'Notification') {
      payload.message = input.message;
      payload.notification_type = input.notification_type;
    }

    if (input.hook_event_name === 'Stop') {
      payload.last_assistant_message = (input.last_assistant_message || '').slice(0, 500);
    }
  }

  payload._tool = toolName;
  payload.tool = toolName;

  if (process.env.FLEET_MODEL_NAME) {
    payload.fleet_model_name = process.env.FLEET_MODEL_NAME;
  }

  // SessionStart: persist session file
  if (input.hook_event_name === 'SessionStart') {
    try {
      const sessionFile = path.join(SESSIONS_DIR, `${input.session_id}.json`);
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
      fs.writeFileSync(sessionFile, JSON.stringify({
        sessionId: input.session_id,
        cwd: input.cwd,
        model: payload.model,
        tool: toolName,
        term_program: payload.term_program,
        iterm_session_id: payload.iterm_session_id,
        pid: payload.pid,
        ppid: payload.ppid,
        fleet_model_name: process.env.FLEET_MODEL_NAME || null,
        timestamp: Date.now(),
      }, null, 2));
    } catch { /* ignore write failures */ }
  }

  // Stop: update session file with last message
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

  // Socket forwarding
  const client = net.connect(SOCK_PATH, () => {
    client.write(JSON.stringify(payload) + '\n');
    client.end();
  });
  client.on('error', () => { /* master not running */ });

  setTimeout(() => process.exit(0), 1000);

  // Notification branch
  if (notifier) {
    try {
      const config = notifier.loadNotifyConfig();
      if (!config.enabled) return;

      const sid = input.session_id;
      const sound = config.sound;
      const displayName = adapter ? adapter.displayName : 'Claude Code';

      if (input.hook_event_name === 'Stop') {
        if (config.events.stop) {
          notifier.sendNotification({
            title: displayName,
            body: payload.last_assistant_message,
            cwd: payload.cwd,
            sessionId: sid,
            platform: process.platform,
            sound,
          });
        }
      }

      if (input.hook_event_name === 'Notification' && config.events.notification) {
        notifier.sendNotification({
          title: `${displayName} 通知`,
          body: payload.message,
          cwd: payload.cwd,
          sessionId: sid,
          platform: process.platform,
          sound,
        });
      }
    } catch { /* notification failures must not affect main flow */ }
  }
}

main();
