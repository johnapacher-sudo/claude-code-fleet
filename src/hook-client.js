#!/usr/bin/env node

const net = require('net');
const os = require('os');
const path = require('path');

const SOCK_PATH = path.join(os.homedir(), '.config', 'claude-code-fleet', 'fleet.sock');

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

  // SessionStart: extract model
  if (input.hook_event_name === 'SessionStart') {
    payload.model = input.model || null;
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
