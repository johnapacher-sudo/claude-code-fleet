import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const focusSessionPath = path.resolve(process.cwd(), 'src/focus-session.js');

describe('focus-session', () => {
  it('exists as a file', () => {
    expect(fs.existsSync(focusSessionPath)).toBe(true);
  });

  it('is a Node.js script with shebang', () => {
    const src = fs.readFileSync(focusSessionPath, 'utf-8');
    expect(src.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('reads session file and uses termProgram for focusing', () => {
    const src = fs.readFileSync(focusSessionPath, 'utf-8');
    expect(src).toContain('term_program');
    expect(src).toContain('iTerm');
    expect(src).toContain('Terminal');
  });

  it('handles missing session file gracefully', () => {
    const src = fs.readFileSync(focusSessionPath, 'utf-8');
    expect(src).toContain('catch');
    expect(src).toContain('exit(0)');
  });

  it('uses execSync for AppleScript execution', () => {
    const src = fs.readFileSync(focusSessionPath, 'utf-8');
    expect(src).toContain('execSync');
    expect(src).toContain('osascript');
  });

  it('uses SESSIONS_DIR to locate session files', () => {
    const src = fs.readFileSync(focusSessionPath, 'utf-8');
    expect(src).toContain('sessions');
    expect(src).toContain('sessionId');
  });
});
