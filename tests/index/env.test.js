import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mod = await import('../../src/index.js');
const { cmdModelEnvList, cmdModelEnvSet, cmdModelEnvUnset } = mod;

describe('fleet model env CLI', () => {
  let logSpy, errSpy, exitSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit:${code}`); });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('list prints "no env vars" for profile without env', () => {
    cmdModelEnvList({ name: 'a' });
    const out = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(out).toMatch(/No env vars configured/);
  });

  it('list prints each key=value for profile with env', () => {
    cmdModelEnvList({ name: 'a', env: { FOO: '1', BAR: '2' } });
    const out = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(out).toMatch(/FOO/);
    expect(out).toMatch(/BAR/);
    expect(out).toMatch(/1/);
    expect(out).toMatch(/2/);
  });

  it('set rejects empty key', () => {
    const data = { models: [{ name: 'a' }] };
    expect(() => cmdModelEnvSet(data, data.models[0], '', '1')).toThrow(/exit:1/);
    expect(errSpy).toHaveBeenCalled();
  });

  it('set rejects lowercase key', () => {
    const data = { models: [{ name: 'a' }] };
    expect(() => cmdModelEnvSet(data, data.models[0], 'foo', '1')).toThrow(/exit:1/);
  });

  it('set rejects empty value', () => {
    const data = { models: [{ name: 'a' }] };
    expect(() => cmdModelEnvSet(data, data.models[0], 'FOO', '')).toThrow(/exit:1/);
  });

  it('unset rejects missing key', () => {
    const data = { models: [{ name: 'a' }] };
    expect(() => cmdModelEnvUnset(data, data.models[0], '')).toThrow(/exit:1/);
  });

  it('unset warns when key absent but does not exit', () => {
    const data = { models: [{ name: 'a', env: { X: '1' } }] };
    cmdModelEnvUnset(data, data.models[0], 'Y');
    const out = errSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(out).toMatch(/was not set/);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
