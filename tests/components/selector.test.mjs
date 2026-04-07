import { describe, it, expect } from 'vitest';

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
