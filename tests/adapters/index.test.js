import { describe, it, expect, beforeEach } from 'vitest';

describe('Adapter index wiring', () => {
  let registry;

  beforeEach(async () => {
    // Fresh import each time — registry is a singleton so we reset between tests
    const registryMod = await import('../../src/adapters/registry.js');
    registryMod.reset();
    // Re-require the index module to trigger registration
    // We need to bust the require cache to re-register
    const indexPath = require.resolve('../../src/adapters/index.js');
    delete require.cache[indexPath];
    delete require.cache[require.resolve('../../src/adapters/registry.js')];
    const indexMod = require('../../src/adapters/index.js');
    registry = indexMod.registry;
  });

  it('registers both claude and codex adapters', () => {
    expect(registry.all()).toHaveLength(2);
  });

  it('claude adapter is accessible by name', () => {
    const claude = registry.get('claude');
    expect(claude).toBeDefined();
    expect(claude.name).toBe('claude');
    expect(claude.displayName).toBe('Claude Code');
  });

  it('codex adapter is accessible by name', () => {
    const codex = registry.get('codex');
    expect(codex).toBeDefined();
    expect(codex.name).toBe('codex');
    expect(codex.displayName).toBe('Codex CLI');
  });
});
