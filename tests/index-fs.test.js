// Integration-style tests for index.js fs-using functions
// Uses real tmp directories instead of mocks
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmpBase = path.join(os.tmpdir(), 'fleet-test-' + process.pid);

beforeEach(() => { fs.mkdirSync(tmpBase, { recursive: true }); });
afterEach(() => { try { fs.rmSync(tmpBase, { recursive: true }); } catch {} });

// Re-import index.js functions for each test context
const { parseArgs } = await import('../src/index.js');

// ─── Runtime import smoke check ─────────────────────────────────────────────

describe('CLI parsing with real runtime import', () => {
  it('defaults to run command', () => {
    expect(parseArgs([]).command).toBe('run');
  });
});
