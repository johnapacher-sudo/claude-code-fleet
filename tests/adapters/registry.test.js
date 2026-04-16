import { describe, it, expect, beforeEach } from 'vitest';

const registry = await import('../../src/adapters/registry.js');

class FakeAdapter {
  constructor(name, isInstalledVal = true) {
    this._name = name;
    this._isInstalled = isInstalledVal;
  }
  get name() { return this._name; }
  isInstalled() { return this._isInstalled; }
}

describe('Adapter registry', () => {
  beforeEach(() => {
    registry.reset();
  });

  it('register and get', () => {
    const a = new FakeAdapter('test-tool');
    registry.register(a);
    expect(registry.get('test-tool')).toBe(a);
  });

  it('get returns undefined for unknown', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('all returns all registered adapters', () => {
    const a1 = new FakeAdapter('tool-a');
    const a2 = new FakeAdapter('tool-b');
    registry.register(a1);
    registry.register(a2);
    expect(registry.all()).toHaveLength(2);
    expect(registry.all()).toContain(a1);
    expect(registry.all()).toContain(a2);
  });

  it('installed filters to adapters where isInstalled() is true', () => {
    registry.register(new FakeAdapter('installed-tool', true));
    registry.register(new FakeAdapter('missing-tool', false));
    const result = registry.installed();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('installed-tool');
  });

  it('detect returns payload._tool or defaults to claude', () => {
    expect(registry.detect({})).toBe('claude');
    expect(registry.detect({ _tool: 'codex' })).toBe('codex');
    expect(registry.detect({ _tool: 'claude' })).toBe('claude');
  });

  it('reset clears all adapters', () => {
    registry.register(new FakeAdapter('a'));
    registry.register(new FakeAdapter('b'));
    expect(registry.all()).toHaveLength(2);
    registry.reset();
    expect(registry.all()).toHaveLength(0);
  });
});
