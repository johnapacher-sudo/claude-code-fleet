import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { WorkerDaemonBar } from '../../src/components/worker-daemon-bar.mjs';

const h = React.createElement;

describe('WorkerDaemonBar', () => {
  const baseState = { running: false, pid: null, paused: false, concurrency: 1 };
  const queueStats = { pending: 2, running: 1 };

  it('shows stopped state with start hint', () => {
    const { lastFrame } = render(h(WorkerDaemonBar, {
      daemonState: baseState,
      inputMode: false,
      inputValue: '',
      queueStats,
    }));
    const output = lastFrame();
    expect(output).toContain('stopped');
    expect(output).toContain('[d] start');
    expect(output).toContain('[a] add');
  });

  it('shows running state with pid and controls', () => {
    const { lastFrame } = render(h(WorkerDaemonBar, {
      daemonState: { running: true, pid: 12345, paused: false, concurrency: 3 },
      inputMode: false,
      inputValue: '',
      queueStats,
    }));
    const output = lastFrame();
    // Text may wrap in narrow terminals, so check for key fragments
    expect(output).toContain('Worker');
    expect(output).toContain('12345');
    expect(output).toContain('concurrency');
    expect(output).toContain('3');
    expect(output).toContain('pending');
    expect(output).toContain('active');
    expect(output).toContain('stop');
    expect(output).toContain('pause');
  });

  it('shows paused state with resume hint', () => {
    const { lastFrame } = render(h(WorkerDaemonBar, {
      daemonState: { running: true, pid: 12345, paused: true, concurrency: 2 },
      inputMode: false,
      inputValue: '',
      queueStats,
    }));
    const output = lastFrame();
    expect(output).toContain('Worker');
    expect(output).toContain('resume');
    expect(output).toContain('stop');
  });

  it('shows input mode with cursor and cancel hint', () => {
    const { lastFrame } = render(h(WorkerDaemonBar, {
      daemonState: baseState,
      inputMode: true,
      inputValue: 'fix the bug',
      queueStats,
    }));
    const output = lastFrame();
    expect(output).toContain('Add task');
    expect(output).toContain('fix the bug');
    expect(output).toContain('[Enter] submit');
    expect(output).toContain('[Esc] cancel');
  });

  it('shows empty input value with cursor', () => {
    const { lastFrame } = render(h(WorkerDaemonBar, {
      daemonState: baseState,
      inputMode: true,
      inputValue: '',
      queueStats,
    }));
    const output = lastFrame();
    expect(output).toContain('Add task');
    expect(output).toContain('[Enter] submit');
  });
});
