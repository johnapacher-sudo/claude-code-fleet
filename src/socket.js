#!/usr/bin/env node

const net = require('net');
const fs = require('fs');
const path = require('path');

class SocketServer {
  constructor(sockPath, handler) {
    this.sockPath = sockPath;
    this.handler = handler; // (payload) => void
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
        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.trim()) {
            try {
              const payload = JSON.parse(line);
              this.handler(payload);
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

module.exports = { SocketServer };
