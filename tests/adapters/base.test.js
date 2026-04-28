import { describe, it, expect } from 'vitest';

const { ToolAdapter } = await import('../../src/adapters/base.js');

describe('ToolAdapter base class', () => {
  let adapter;

  it('cannot be used directly — abstract getters throw', () => {
    adapter = new ToolAdapter();
    expect(() => adapter.name).toThrow('ToolAdapter.name must be implemented');
    expect(() => adapter.displayName).toThrow('ToolAdapter.displayName must be implemented');
    expect(() => adapter.binary).toThrow('ToolAdapter.binary must be implemented');
    expect(() => adapter.hookEvents).toThrow('ToolAdapter.hookEvents must be implemented');
  });

  it('abstract methods throw', () => {
    adapter = new ToolAdapter();
    expect(() => adapter.buildArgs({})).toThrow('ToolAdapter.buildArgs must be implemented');
    expect(() => adapter.buildEnv({}, {})).toThrow('ToolAdapter.buildEnv must be implemented');
    expect(() => adapter.installHooks('/path')).toThrow('ToolAdapter.installHooks must be implemented');
    expect(() => adapter.removeHooks()).toThrow('ToolAdapter.removeHooks must be implemented');
    expect(() => adapter.normalizePayload({})).toThrow('ToolAdapter.normalizePayload must be implemented');
  });

  it('summarizeToolUse defaults to returning toolName', () => {
    adapter = new ToolAdapter();
    expect(adapter.summarizeToolUse('MyTool', { foo: 'bar' })).toBe('MyTool');
    expect(adapter.summarizeToolUse('Read', {})).toBe('Read');
  });

  it('classifyFailure defaults to terminal/unclassified', () => {
    adapter = new ToolAdapter();
    expect(adapter.classifyFailure({ stderrSnippet: '' })).toEqual({
      kind: 'terminal',
      reason: 'unclassified',
    });
  });
});

class StubAdapter extends ToolAdapter {
  get name() { return 'stub'; }
  get displayName() { return 'Stub'; }
  get binary() { return 'stub'; }
  get hookEvents() { return []; }
  buildArgs() { return []; }
  buildEnv(entry, baseEnv) { return this.applyUserEnv(entry, { ...baseEnv }); }
  installHooks() {}
  removeHooks() {}
  normalizePayload(x) { return x; }
}

describe('ToolAdapter defaults', () => {
  it('commonEnvVars returns empty array by default', () => {
    expect(new StubAdapter().commonEnvVars).toEqual([]);
  });

  it('applyUserEnv merges entry.env into target env', () => {
    const a = new StubAdapter();
    const out = a.buildEnv({ env: { FOO: '1', BAR: 'hi' } }, { PATH: '/bin' });
    expect(out).toEqual({ PATH: '/bin', FOO: '1', BAR: 'hi' });
  });

  it('applyUserEnv is a no-op when entry.env is absent', () => {
    const a = new StubAdapter();
    const out = a.buildEnv({}, { PATH: '/bin' });
    expect(out).toEqual({ PATH: '/bin' });
  });

  it('applyUserEnv overrides baseEnv values', () => {
    const a = new StubAdapter();
    const out = a.buildEnv({ env: { PATH: '/override' } }, { PATH: '/bin' });
    expect(out.PATH).toBe('/override');
  });
});
