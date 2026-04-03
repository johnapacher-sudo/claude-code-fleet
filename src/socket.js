#!/usr/bin/env node

const net = require('net');
const fs = require('fs');
const path = require('path');

const DEFAULT_SOCK_PATH = path.join(
  process.env.HOME || '~', '.config', 'claude-code-fleet', 'fleet.sock'
);

class SocketServer {
  constructor(sockPath = DEFAULT_SOCK_PATH, handler) {
    this.sockPath = sockPath;
    this.handler = handler; // async (message) => response
    this.server = null;
  }

  start() {
    // Clean up stale socket
    if (fs.existsSync(this.sockPath)) {
      fs.unlinkSync(this.sockPath);
    }
    const dir = path.dirname(this.sockPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.server = net.createServer((conn) => {
      let buffer = '';
      conn.on('data', (chunk) => {
        buffer += chunk.toString();
        // Messages are newline-delimited JSON
        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.trim()) {
            try {
              const msg = JSON.parse(line);
              Promise.resolve(this.handler(msg)).then((resp) => {
                conn.write(JSON.stringify(resp) + '\n');
              }).catch(() => {
                conn.write(JSON.stringify({ ok: true }) + '\n');
              });
            } catch { /* ignore malformed */ }
          }
        }
      });
    });

    this.server.listen(this.sockPath);
  }

  stop() {
    if (this.server) {
      this.server.close();
      try { fs.unlinkSync(this.sockPath); } catch { /* already gone */ }
    }
  }
}

function sendToSocket(sockPath, message, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(sockPath, () => {
      sock.write(JSON.stringify(message) + '\n');
    });
    let buffer = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) { settled = true; sock.destroy(); reject(new Error('timeout')); }
    }, timeoutMs);

    sock.on('data', (chunk) => {
      buffer += chunk.toString();
      const idx = buffer.indexOf('\n');
      if (idx !== -1) {
        const line = buffer.slice(0, idx);
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          sock.destroy();
          try { resolve(JSON.parse(line)); }
          catch { resolve({ ok: true }); }
        }
      }
    });

    sock.on('error', (err) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(err); }
    });
  });
}

module.exports = { SocketServer, sendToSocket, DEFAULT_SOCK_PATH };
