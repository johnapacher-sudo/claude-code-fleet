import { render } from 'ink-testing-library';
import React from 'react';
import { describe, it, expect } from 'vitest';
import { Header } from '../../src/components/header.mjs';

const h = React.createElement;

describe('Header', () => {
  it('renders Fleet Master title', () => {
    const { lastFrame } = render(h(Header, { workers: [] }));
    expect(lastFrame()).toContain('Fleet Master');
  });

  it('renders active/idle counts with icons', () => {
    const workers = [
      { computedStatus: 'active' },
      { computedStatus: 'active' },
      { computedStatus: 'idle' },
    ];
    const { lastFrame } = render(h(Header, { workers }));
    const out = lastFrame();
    expect(out).toContain('\u25CF 2');  // active ●
    expect(out).toContain('\u25CB 1');  // idle ○
  });

  it('renders total session count', () => {
    const workers = [{ computedStatus: 'idle' }, { computedStatus: 'idle' }];
    const { lastFrame } = render(h(Header, { workers }));
    expect(lastFrame()).toContain('2 sessions');
  });
});
