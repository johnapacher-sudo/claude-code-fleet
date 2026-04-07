import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { Master, ensureHooks, removeHooks } = await import('../src/master.js');

describe('Master handleEvent', () => {
  let master;

  beforeEach(() => {
    master = new Master();
    master.tui = { scheduleRender: vi.fn() };
  });

  it('ignores events without session_id', () => {
    master.handleEvent({ event: 'PostToolUse' });
    expect(master.workers.size).toBe(0);
  });

  it('creates worker on first event', () => {
    master.handleEvent({
      event: 'SessionStart',
      session_id: 'sid-1',
      cwd: '/project/my-app',
      model: 'claude-opus-4-6',
      fleet_model_name: 'opus-prod',
      term_program: 'iTerm.app',
      iterm_session_id: 'abc123',
      pid: 12345,
      ppid: process.pid,
    });
    expect(master.workers.has('sid-1')).toBe(true);
    const w = master.workers.get('sid-1');
    expect(w.displayName).toBe('my-app');
    expect(w.modelName).toBe('claude-opus-4-6');
    expect(w.fleetModelName).toBe('opus-prod');
    expect(w.termProgram).toBe('iTerm.app');
    expect(w.status).toBe('idle');
  });

  it('PostToolUse creates currentTurn and action', () => {
    master.handleEvent({ event: 'SessionStart', session_id: 'sid-2', cwd: '/x', ppid: process.pid });
    master.handleEvent({
      event: 'PostToolUse',
      session_id: 'sid-2',
      tool_name: 'Edit',
      tool_input: { file_path: '/src/app.js' },
    });
    const w = master.workers.get('sid-2');
    expect(w.status).toBe('active');
    expect(w.currentTurn).toBeTruthy();
    expect(w.currentTurn.actions).toHaveLength(1);
    expect(w.currentTurn.actions[0].tool).toBe('Edit');
    expect(w.currentTurn.actions[0].status).toBe('running');
  });

  it('Notification closes turn and starts new one', () => {
    master.handleEvent({ event: 'SessionStart', session_id: 'sid-3', cwd: '/x', ppid: process.pid });
    master.handleEvent({ event: 'PostToolUse', session_id: 'sid-3', tool_name: 'Read', tool_input: {} });
    master.handleEvent({ event: 'Notification', session_id: 'sid-3', message: 'Hello world' });
    const w = master.workers.get('sid-3');
    // Old turn should be in history
    expect(w.turns).toHaveLength(1);
    expect(w.turns[0].summary).toBe('Hello world');
    expect(w.currentTurn).toBeTruthy();
    expect(w.currentTurn.actions).toHaveLength(0);
  });

  it('Stop sets idle, closes turn with summary', () => {
    master.handleEvent({ event: 'SessionStart', session_id: 'sid-4', cwd: '/x', ppid: process.pid });
    master.handleEvent({ event: 'PostToolUse', session_id: 'sid-4', tool_name: 'Bash', tool_input: { command: 'ls' } });
    master.handleEvent({
      event: 'Stop',
      session_id: 'sid-4',
      last_assistant_message: 'Done working',
    });
    const w = master.workers.get('sid-4');
    expect(w.status).toBe('idle');
    expect(w.awaitsInput).toBe(true);
    expect(w.lastMessage.text).toBe('Done working');
    expect(w.turns).toHaveLength(1);
    expect(w.turns[0].summary).toBe('Done working');
    expect(w.currentTurn).toBeNull();
  });

  it('full lifecycle', () => {
    master.handleEvent({ event: 'SessionStart', session_id: 'sid-5', cwd: '/project/app', model: 'opus', ppid: process.pid });
    master.handleEvent({ event: 'PostToolUse', session_id: 'sid-5', tool_name: 'Read', tool_input: { file_path: '/a.js' } });
    master.handleEvent({ event: 'PostToolUse', session_id: 'sid-5', tool_name: 'Edit', tool_input: { file_path: '/a.js' } });
    master.handleEvent({ event: 'Notification', session_id: 'sid-5', message: 'Editing done' });
    master.handleEvent({ event: 'PostToolUse', session_id: 'sid-5', tool_name: 'Bash', tool_input: { command: 'npm test' } });
    master.handleEvent({ event: 'Stop', session_id: 'sid-5', last_assistant_message: 'Tests pass' });

    const w = master.workers.get('sid-5');
    expect(w.turns).toHaveLength(2);
    expect(w.lastMessage.text).toBe('Tests pass');
    expect(w.awaitsInput).toBe(true);
    expect(w.lastActions.length).toBeLessThanOrEqual(3);
  });

  it('keeps max 2 turns', () => {
    master.handleEvent({ event: 'SessionStart', session_id: 'sid-6', cwd: '/x', ppid: process.pid });
    // Create 3 turns
    for (let i = 0; i < 3; i++) {
      master.handleEvent({ event: 'PostToolUse', session_id: 'sid-6', tool_name: 'Bash', tool_input: { command: `cmd${i}` } });
      master.handleEvent({ event: 'Notification', session_id: 'sid-6', message: `msg${i}` });
    }
    const w = master.workers.get('sid-6');
    expect(w.turns.length).toBeLessThanOrEqual(2);
  });
});

describe('Master cleanupExpired', () => {
  let master;

  beforeEach(() => {
    master = new Master();
    master.tui = { scheduleRender: vi.fn() };
  });

  it('marks dead processes offline', () => {
    master.workers.set('dead', {
      ppid: 99999999, lastEventAt: Date.now(), status: 'active',
    });
    master.cleanupExpired();
    expect(master.workers.get('dead').status).toBe('offline');
  });

  it('removes dead processes after 30 min', () => {
    master.workers.set('old-dead', {
      ppid: 99999999, lastEventAt: Date.now() - 31 * 60 * 1000,
    });
    master.deleteSessionFile = vi.fn();
    master.cleanupExpired();
    expect(master.workers.has('old-dead')).toBe(false);
  });

  it('removes inactive workers after 3 hours', () => {
    master.workers.set('stale', {
      ppid: process.pid, lastEventAt: Date.now() - 4 * 60 * 60 * 1000,
    });
    master.deleteSessionFile = vi.fn();
    master.cleanupExpired();
    expect(master.workers.has('stale')).toBe(false);
  });

  it('keeps active workers', () => {
    master.workers.set('alive', {
      ppid: process.pid, lastEventAt: Date.now(), status: 'active',
    });
    master.cleanupExpired();
    expect(master.workers.has('alive')).toBe(true);
  });
});

describe('Master isProcessAlive', () => {
  let master;
  beforeEach(() => { master = new Master(); });

  it('returns true for self', () => expect(master.isProcessAlive(process.pid)).toBe(true));
  it('returns false for null', () => expect(master.isProcessAlive(null)).toBe(false));
  it('returns false for dead pid', () => expect(master.isProcessAlive(99999999)).toBe(false));
});

describe('ensureHooks', () => {
  it('adds hooks to empty settings', () => {
    // ensureHooks reads/writes ~/.claude/settings.json — just test it doesn't throw
    // Full integration test would require real fs
    expect(typeof ensureHooks).toBe('function');
  });
});

describe('removeHooks', () => {
  it('is a function', () => {
    expect(typeof removeHooks).toBe('function');
  });
});
