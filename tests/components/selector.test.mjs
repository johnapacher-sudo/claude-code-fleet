import { describe, it, expect } from 'vitest';
import { render as inkRender } from 'ink-testing-library';
import React from 'react';
import { Selector, renderSelector } from '../../src/components/selector.mjs';

// These functions use Ink's render() internally, which doesn't work in test env.
// We verify they exist and have the right signatures.
// Full integration testing would need a terminal emulator.

const mod = await import('../../src/components/selector.mjs');

describe('selector exports', () => {
  it('exports renderSelector', () => expect(typeof mod.renderSelector).toBe('function'));
  it('exports renderConfirm', () => expect(typeof mod.renderConfirm).toBe('function'));
  it('exports renderInput', () => expect(typeof mod.renderInput).toBe('function'));
});

describe('renderSelector signature', () => {
  it('accepts { title, items, dangerMode }', () => {
    // Verify it's a single-argument function
    expect(mod.renderSelector.length).toBe(1);
  });
});

describe('renderConfirm signature', () => {
  it('accepts { title, items, dangerMode }', () => {
    expect(mod.renderConfirm.length).toBe(1);
  });
});

describe('renderInput signature', () => {
  it('accepts { title, fields, requiredFields }', () => {
    expect(mod.renderInput.length).toBe(1);
  });
});

describe('Selector help line', () => {
  it('shows a/d hints when handlers provided', () => {
    const { lastFrame } = inkRender(
      React.createElement(Selector, {
        title: 'T',
        items: [{ label: 'x', value: 'x' }],
        onSelect: () => {}, onCancel: () => {},
        onAdd: () => {}, onDelete: () => {},
      })
    );
    expect(lastFrame()).toMatch(/a add/);
    expect(lastFrame()).toMatch(/d delete/);
  });

  it('omits a/d hints when handlers absent', () => {
    const { lastFrame } = inkRender(
      React.createElement(Selector, {
        title: 'T',
        items: [{ label: 'x', value: 'x' }],
        onSelect: () => {}, onCancel: () => {},
      })
    );
    expect(lastFrame()).not.toMatch(/a add/);
    expect(lastFrame()).not.toMatch(/d delete/);
  });
});

describe('renderSelector export contract', () => {
  it('is a function that accepts options', () => {
    expect(typeof renderSelector).toBe('function');
    expect(renderSelector.length).toBeGreaterThanOrEqual(1);
  });
});
