#!/usr/bin/env node

const { sendToSocket } = require('./socket');

const workerName = process.env.FLEET_WORKER_NAME;
const sockPath = process.env.FLEET_SOCK_PATH;
const eventName = process.argv[2]; // PostToolUse | Stop | Notification

if (!workerName || !sockPath || !eventName) {
  // Missing config, fail open
  process.exit(0);
}

async function main() {
  // Read hook input from stdin (JSON from Claude Code)
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  let hookData = {};
  try {
    hookData = JSON.parse(Buffer.concat(chunks).toString());
  } catch { /* empty stdin is fine */ }

  const message = {
    event: eventName,
    worker: workerName,
    ...hookData,
  };

  try {
    const response = await sendToSocket(sockPath, message, 25000);
    if (eventName === 'Stop' && response && response.action === 'continue') {
      // Tell Claude Code to keep going with next task
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: response.reason,
      }));
    }
    process.exit(0);
  } catch {
    // Socket failure — fail open, don't break Claude
    process.exit(0);
  }
}

main();
