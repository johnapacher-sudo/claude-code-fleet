import { render } from 'ink-testing-library';
import React from 'react';
import { describe, it, expect } from 'vitest';
import { Header } from '../../src/components/header.mjs';

const h = React.createElement;

describe('Header', () => {
  it('renders Fleet title and sort mode', () => {
    const { lastFrame } = render(h(Header, { workers: [], sortMode: 'time' }));
    expect(lastFrame()).toContain('Fleet');
    expect(lastFrame()).toContain('sort:time');
  });

  it('renders processing/idle/offline counts with icons', () => {
    const workers = [
      { computedStatus: 'processing' },
      { computedStatus: 'processing' },
      { computedStatus: 'idle' },
      { computedStatus: 'offline' },
    ];
    const { lastFrame } = render(h(Header, { workers, sortMode: 'name' }));
    const out = lastFrame();
    expect(out).toContain('\u25CF 2');  // processing ●
    expect(out).toContain('\u25CB 1');  // idle ○
    expect(out).toContain('\u2717 1');  // offline ✗
  });

  it('renders total count', () => {
    const workers = [{ computedStatus: 'idle' }, { computedStatus: 'idle' }];
    const { lastFrame } = render(h(Header, { workers, sortMode: 'time' }));
    expect(lastFrame()).toContain('2 total');
  });
});
