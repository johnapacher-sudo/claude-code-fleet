import { render } from 'ink-testing-library';
import React from 'react';
import { describe, it, expect } from 'vitest';
import { Footer } from '../../src/components/footer.mjs';

const h = React.createElement;

describe('Footer', () => {
  it('renders key hints and version', () => {
    const { lastFrame } = render(h(Footer));
    const out = lastFrame();
    expect(out).toContain('j/k scroll');
    expect(out).toContain('Fleet v0.1.0');
  });

  it('shows position/total when provided; omits when not', () => {
    const { lastFrame } = render(h(Footer, { position: 2, total: 5 }));
    expect(lastFrame()).toContain('[3/5]');
    // Without props — no bracket
    const { lastFrame: frame2 } = render(h(Footer));
    expect(frame2()).not.toContain('[/');
  });
});
