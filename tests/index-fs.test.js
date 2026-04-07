// Integration-style tests for index.js fs-using functions
// Uses real tmp directories instead of mocks
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmpBase = path.join(os.tmpdir(), 'fleet-test-' + process.pid);

beforeEach(() => { fs.mkdirSync(tmpBase, { recursive: true }); });
afterEach(() => { try { fs.rmSync(tmpBase, { recursive: true }); } catch {} });

// Re-import index.js functions for each test context
const { stripAnsi, validateConfig, configSearchPaths, parseArgs, isProcessAlive,
        filterInstances, getModelsPath, loadState, saveState, cleanupState,
        loadConfig, findConfigFile, loadModels, saveModels,
        cmdModelList, cmdInit, cmdHooksStatus, cmdLs, cmdDown,
        cmdHooksInstall, cmdHooksRemove, cmdStatus, main } = await import('../src/index.js');

// ─── State management (uses real tmp) ───────────────────────────────────────

describe('State with real tmp', () => {
  it('isProcessAlive works', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(99999999)).toBe(false);
  });
});
