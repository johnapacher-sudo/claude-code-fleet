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
});
