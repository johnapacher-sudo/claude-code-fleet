#!/usr/bin/env node

const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

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

    // Persist session metadata to file (for Master recovery on restart)
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

  // Stop: update session file status to stopped (don't delete — let master clean up)
  if (input.hook_event_name === 'Stop') {
    try {
      const sessionFile = path.join(SESSIONS_DIR, `${input.session_id}.json`);
      if (fs.existsSync(sessionFile)) {
        const data = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
        data.stoppedAt = Date.now();
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

  const client = net.connect(SOCK_PATH, () => {
    client.write(JSON.stringify(payload) + '\n');
    client.end();
  });

  // Master not running → connect fails → silent exit
  client.on('error', () => process.exit(0));

  // Timeout protection
  setTimeout(() => process.exit(0), 1000);
}

main();
