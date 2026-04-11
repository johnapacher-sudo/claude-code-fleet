import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { WorkerQueueCard } from '../../src/components/worker-queue-card.mjs';

const h = React.createElement;

function makeTask(overrides = {}) {
  return {
    id: 'task-1',
    title: 'Fix auth bug',
    status: 'pending',
    modelProfile: null,
    startedAt: null,
    queuePosition: null,
    queueTotal: null,
    prompt: null,
    result: null,
    ...overrides,
  };
}

describe('WorkerQueueCard', () => {
  const now = Date.now();

  it('renders pending task with title and model', () => {
    const task = makeTask({ status: 'pending', modelProfile: 'opus-prod' });
    const { lastFrame } = render(h(WorkerQueueCard, { task, now }));
    const output = lastFrame();
    expect(output).toContain('Fix auth bug');
    expect(output).toContain('opus-prod');
  });

  it('renders running task (shows something for running state)', () => {
    const task = makeTask({
      status: 'running',
      startedAt: new Date(now - 30000).toISOString(),
    });
    const { lastFrame } = render(h(WorkerQueueCard, { task, now }));
    const output = lastFrame();
    // Running tasks show elapsed time
    expect(output).toContain('30s');
  });

  it('shows queue position [N/M]', () => {
    const task = makeTask({ queuePosition: 2, queueTotal: 5 });
    const { lastFrame } = render(h(WorkerQueueCard, { task, now }));
    expect(lastFrame()).toContain('[2/5]');
  });

  it('shows expanded prompt when isExpanded=true', () => {
    const task = makeTask({ prompt: 'Please fix the authentication bug in login.js' });
    const { lastFrame } = render(h(WorkerQueueCard, { task, now, isExpanded: true }));
    expect(lastFrame()).toContain('Please fix the authentication bug in login.js');
  });

  it('does not show prompt when isExpanded=false', () => {
    const task = makeTask({ prompt: 'Please fix the authentication bug in login.js' });
    const { lastFrame } = render(h(WorkerQueueCard, { task, now, isExpanded: false }));
    expect(lastFrame()).not.toContain('Please fix the authentication bug in login.js');
  });

  it("shows 'default' when modelProfile is null", () => {
    const task = makeTask({ modelProfile: null });
    const { lastFrame } = render(h(WorkerQueueCard, { task, now }));
    expect(lastFrame()).toContain('default');
  });

  it('shows completed status icon', () => {
    const task = makeTask({ status: 'completed' });
    const { lastFrame } = render(h(WorkerQueueCard, { task, now }));
    expect(lastFrame()).toContain('\u2713'); // ✓
  });

  it('shows failed status icon', () => {
    const task = makeTask({ status: 'failed' });
    const { lastFrame } = render(h(WorkerQueueCard, { task, now }));
    expect(lastFrame()).toContain('\u2717'); // ✗
  });

  it('shows expanded result when isExpanded=true', () => {
    const task = makeTask({ result: { claudeResult: 'The bug was fixed successfully' } });
    const { lastFrame } = render(h(WorkerQueueCard, { task, now, isExpanded: true }));
    expect(lastFrame()).toContain('The bug was fixed successfully');
  });

  it('truncates long prompt at 200 chars', () => {
    const longPrompt = 'a'.repeat(250);
    const task = makeTask({ prompt: longPrompt });
    const { lastFrame } = render(h(WorkerQueueCard, { task, now, isExpanded: true }));
    const output = lastFrame();
    expect(output).toContain('...');
    // Should contain the first ~197 chars but not the full 250
    expect(output).not.toContain('a'.repeat(250));
  });

  it('truncates long result at 150 chars', () => {
    const longResult = 'b'.repeat(200);
    const task = makeTask({ result: { claudeResult: longResult } });
    const { lastFrame } = render(h(WorkerQueueCard, { task, now, isExpanded: true }));
    const output = lastFrame();
    expect(output).toContain('...');
  });

  it('formats elapsed time correctly for minutes', () => {
    const task = makeTask({
      status: 'running',
      startedAt: new Date(now - 150000).toISOString(), // 2m30s
    });
    const { lastFrame } = render(h(WorkerQueueCard, { task, now }));
    expect(lastFrame()).toContain('2m');
  });

  it('omits queue position when null', () => {
    const task = makeTask({ queuePosition: null, queueTotal: null });
    const { lastFrame } = render(h(WorkerQueueCard, { task, now }));
    expect(lastFrame()).not.toContain('[');
  });
});
