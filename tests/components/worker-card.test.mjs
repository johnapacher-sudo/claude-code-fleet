import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { WorkerCard } from '../../src/components/worker-card.mjs';
import { colors } from '../../src/components/colors.mjs';

const h = React.createElement;

function makeWorker(overrides = {}) {
  return {
    sessionId: 'sid-test',
    sessionIdShort: 'sid-',
    displayName: 'my-project',
    cwd: '/project/my-project',
    modelName: null,
    fleetModelName: null,
    firstEventAt: Date.now() - 30000,
    lastEventAt: Date.now(),
    status: 'idle',
    awaitsInput: false,
    turns: [],
    currentTurn: null,
    lastActions: [],
    lastMessage: null,
    termProgram: null,
    itermSessionId: null,
    pid: null,
    ppid: null,
    computedStatus: 'idle',
    ...overrides,
  };
}

describe('WorkerCard', () => {
  const now = Date.now();

  it('renders project name', () => {
    const w = makeWorker();
    const { lastFrame } = render(h(WorkerCard, { worker: w, now }));
    expect(lastFrame()).toContain('my-project');
  });

  it('renders idle status with circle', () => {
    const w = makeWorker({ computedStatus: 'idle' });
    const { lastFrame } = render(h(WorkerCard, { worker: w, now }));
    expect(lastFrame()).toContain('\u25CB'); // ○
  });

  it('renders active status with filled circle', () => {
    const w = makeWorker({ computedStatus: 'active' });
    const { lastFrame } = render(h(WorkerCard, { worker: w, now }));
    expect(lastFrame()).toContain('\u25CF'); // ●
  });

  it('renders offline status with x', () => {
    const w = makeWorker({ computedStatus: 'offline' });
    const { lastFrame } = render(h(WorkerCard, { worker: w, now }));
    expect(lastFrame()).toContain('\u2717'); // ✗
  });

  it('renders fleet model name when present', () => {
    const w = makeWorker({ fleetModelName: 'opus-prod' });
    const { lastFrame } = render(h(WorkerCard, { worker: w, now }));
    expect(lastFrame()).toContain('opus-prod');
  });

  it('renders model name when present', () => {
    const w = makeWorker({ modelName: 'claude-opus-4-6' });
    const { lastFrame } = render(h(WorkerCard, { worker: w, now }));
    expect(lastFrame()).toContain('claude-opus-4-6');
  });

  it('renders last message', () => {
    const w = makeWorker({ lastMessage: { text: 'Hello from Claude', time: now } });
    const { lastFrame } = render(h(WorkerCard, { worker: w, now }));
    expect(lastFrame()).toContain('Hello from Claude');
  });

  it('truncates long last message', () => {
    const longMsg = 'a'.repeat(150);
    const w = makeWorker({ lastMessage: { text: longMsg, time: now } });
    const { lastFrame } = render(h(WorkerCard, { worker: w, now }));
    expect(lastFrame()).toContain('...');
  });

  it('renders current turn actions', () => {
    const w = makeWorker({
      computedStatus: 'active',
      currentTurn: {
        summary: '',
        summaryTime: now,
        actions: [
          { tool: 'Edit', target: 'app.js', time: now, status: 'running' },
        ],
      },
    });
    const { lastFrame } = render(h(WorkerCard, { worker: w, now }));
    expect(lastFrame()).toContain('Edit');
    expect(lastFrame()).toContain('app.js');
  });

  it('renders history turns collapsed', () => {
    const w = makeWorker({
      turns: [{
        summary: 'Did some work',
        summaryTime: now - 60000,
        actions: [
          { tool: 'Read', target: 'file.js', time: now - 61000, status: 'done' },
        ],
      }],
    });
    const { lastFrame } = render(h(WorkerCard, { worker: w, now, isExpanded: false }));
    expect(lastFrame()).toContain('Did some work');
  });

  it('renders elapsed time', () => {
    const w = makeWorker({ firstEventAt: now - 90000 }); // 90 seconds ago
    const { lastFrame } = render(h(WorkerCard, { worker: w, now }));
    expect(lastFrame()).toContain('1m');
  });

  it('renders terminal name', () => {
    const w = makeWorker({ termProgram: 'iTerm.app' });
    const { lastFrame } = render(h(WorkerCard, { worker: w, now }));
    expect(lastFrame()).toContain('iTerm');
  });
});
