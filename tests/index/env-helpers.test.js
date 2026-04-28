import { describe, it, expect } from 'vitest';
const mod = await import('../../src/index.js');
const { validateEnvKey, applyEnvSet, applyEnvUnset } = mod;

describe('validateEnvKey', () => {
  it('rejects empty key', () => expect(validateEnvKey('', [])).toMatch(/required/i));
  it('rejects lowercase', () => expect(validateEnvKey('foo', [])).toMatch(/UPPER_SNAKE_CASE/));
  it('rejects leading digit', () => expect(validateEnvKey('1FOO', [])).toMatch(/UPPER_SNAKE_CASE/));
  it('rejects dashes', () => expect(validateEnvKey('FOO-BAR', [])).toMatch(/UPPER_SNAKE_CASE/));
  it('accepts FOO', () => expect(validateEnvKey('FOO', [])).toBeNull());
  it('accepts FOO_BAR_1', () => expect(validateEnvKey('FOO_BAR_1', [])).toBeNull());
  it('accepts _FOO', () => expect(validateEnvKey('_FOO', [])).toBeNull());
  it('rejects duplicate', () => expect(validateEnvKey('FOO', ['FOO'])).toMatch(/already set/));
});

describe('applyEnvSet', () => {
  it('adds first key immutably', () => {
    const entry = { name: 'x' };
    const out = applyEnvSet(entry, 'FOO', '1');
    expect(out).not.toBe(entry);
    expect(out.env).toEqual({ FOO: '1' });
    expect(entry.env).toBeUndefined();
  });

  it('preserves existing keys and overrides same key', () => {
    const entry = { name: 'x', env: { A: '1', B: '2' } };
    const out = applyEnvSet(entry, 'B', 'new');
    expect(out.env).toEqual({ A: '1', B: 'new' });
    expect(entry.env).toEqual({ A: '1', B: '2' });
  });
});

describe('applyEnvUnset', () => {
  it('removes key without mutating original', () => {
    const entry = { name: 'x', env: { A: '1', B: '2' } };
    const out = applyEnvUnset(entry, 'A');
    expect(out.env).toEqual({ B: '2' });
    expect(entry.env).toEqual({ A: '1', B: '2' });
  });

  it('is a no-op when key absent', () => {
    const entry = { name: 'x', env: { A: '1' } };
    const out = applyEnvUnset(entry, 'Z');
    expect(out.env).toEqual({ A: '1' });
  });

  it('handles entry without env', () => {
    const entry = { name: 'x' };
    const out = applyEnvUnset(entry, 'Z');
    expect(out.env).toEqual({});
  });
});
