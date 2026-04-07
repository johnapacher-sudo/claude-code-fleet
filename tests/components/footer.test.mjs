import { render } from 'ink-testing-library';
import React from 'react';
import { describe, it, expect } from 'vitest';
import { Footer } from '../../src/components/footer.mjs';

const h = React.createElement;

describe('Footer', () => {
  it('renders key hints', () => {
    const { lastFrame } = render(h(Footer));
    const out = lastFrame();
    expect(out).toContain('j/k');
    expect(out).toContain('scroll');
    expect(out).toContain('quit');
  });

  it('does not render position/total by default', () => {
    const { lastFrame } = render(h(Footer));
    expect(lastFrame()).not.toContain('[/');
  });
});
