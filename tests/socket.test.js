import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SocketServer } from '../src/socket.js';
import net from 'net';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Helper: wait for condition with timeout
function waitFor(fn, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      try {
        if (fn()) return resolve();
      } catch {}
      if (Date.now() - start > timeout) {
        return reject(new Error('waitFor timeout'));
      }
      setTimeout(check, 20);
    };
    check();
  });
}

describe('SocketServer', () => {
  const sockDir = path.join(os.tmpdir(), `fleet-sock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const sockPath = path.join(sockDir, 'test.sock');
  let handler;
  let server;

  beforeEach(() => {
    handler = vi.fn();
    server = new SocketServer(sockPath, handler);
    // Ensure clean state
    try { fs.mkdirSync(sockDir, { recursive: true }); } catch {}
    try { fs.unlinkSync(sockPath); } catch {}
  });

  afterEach(() => {
    try { server.stop(); } catch {}
    try { fs.rmSync(sockDir, { recursive: true }); } catch {}
  });

  describe('start()', () => {
    it('creates parent directory and listens', () => {
      // Remove dir to test creation
      try { fs.rmSync(sockDir, { recursive: true }); } catch {}
      server.start();
      expect(fs.existsSync(sockDir)).toBe(true);
      // Socket file should exist after listen (async)
      return waitFor(() => fs.existsSync(sockPath), 1000);
    });

    it('cleans up stale socket file', () => {
      // Create a stale socket file
      fs.writeFileSync(sockPath, 'stale');
      expect(fs.existsSync(sockPath)).toBe(true);
      server.start();
      return waitFor(() => {
        // The stale file should be replaced by a real socket
        const stat = fs.statSync(sockPath);
        return !stat.isFile(); // socket is not a regular file
      }, 1000);
    });
  });

  describe('stop()', () => {
    it('closes server and removes socket file', async () => {
      server.start();
      await waitFor(() => fs.existsSync(sockPath), 1000);
      server.stop();
      // Give a tick for unlink
      await new Promise(r => setTimeout(r, 50));
      expect(fs.existsSync(sockPath)).toBe(false);
    });
  });

  describe('data handling', () => {
    it('buffers data, splits on newlines, parses JSON, calls handler', async () => {
      server.start();
      await waitFor(() => fs.existsSync(sockPath), 1000);

      const client = net.connect(sockPath);
      const payload = JSON.stringify({ type: 'test', value: 42 });
      client.write(payload + '\n');

      await waitFor(() => handler.mock.calls.length > 0, 500);
      expect(handler).toHaveBeenCalledWith({ type: 'test', value: 42 });
      client.destroy();
    });

    it('ignores malformed JSON', async () => {
      server.start();
      await waitFor(() => fs.existsSync(sockPath), 1000);

      const client = net.connect(sockPath);
      client.write('{bad json}\n');
      client.write(JSON.stringify({ valid: true }) + '\n');

      await waitFor(() => handler.mock.calls.length > 0, 500);
      // Should only have been called with the valid payload
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ valid: true });
      client.destroy();
    });

    it('skips empty lines', async () => {
      server.start();
      await waitFor(() => fs.existsSync(sockPath), 1000);

      const client = net.connect(sockPath);
      client.write('\n\n' + JSON.stringify({ data: 1 }) + '\n\n');

      await waitFor(() => handler.mock.calls.length > 0, 500);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ data: 1 });
      client.destroy();
    });

    it('handles multiple payloads on one connection', async () => {
      server.start();
      await waitFor(() => fs.existsSync(sockPath), 1000);

      const client = net.connect(sockPath);
      client.write(JSON.stringify({ a: 1 }) + '\n' + JSON.stringify({ b: 2 }) + '\n');

      await waitFor(() => handler.mock.calls.length >= 2, 500);
      expect(handler).toHaveBeenCalledWith({ a: 1 });
      expect(handler).toHaveBeenCalledWith({ b: 2 });
      client.destroy();
    });
  });

  describe('multiple connections', () => {
    it('handles multiple clients simultaneously', async () => {
      server.start();
      await waitFor(() => fs.existsSync(sockPath), 1000);

      const client1 = net.connect(sockPath);
      const client2 = net.connect(sockPath);

      client1.write(JSON.stringify({ from: 'c1' }) + '\n');
      client2.write(JSON.stringify({ from: 'c2' }) + '\n');

      await waitFor(() => handler.mock.calls.length >= 2, 500);
      expect(handler).toHaveBeenCalledWith({ from: 'c1' });
      expect(handler).toHaveBeenCalledWith({ from: 'c2' });

      client1.destroy();
      client2.destroy();
    });
  });
});
