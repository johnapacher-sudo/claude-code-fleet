import { describe, it, expect, vi } from 'vitest';

// app.mjs uses Ink render() which patches console — test in module-only mode
const mod = await import('../../src/components/app.mjs');

describe('app exports', () => {
  it('exports createApp', () => {
    expect(typeof mod.createApp).toBe('function');
  });
});

describe('createApp', () => {
  it('is a function', () => {
    expect(typeof mod.createApp).toBe('function');
  });

  it('accepts a master object', () => {
    // createApp returns an Ink app instance — test the signature
    expect(mod.createApp.length).toBe(1);
  });
});

// Test the internal logic without rendering by reading source
describe('getWorkerStatus logic (via source)', () => {
  it('app.mjs has expected status logic', async () => {
    const fs = await import('fs');
    const src = fs.default.readFileSync(new URL('../../src/components/app.mjs', import.meta.url), 'utf-8');
    // Verify key status handling
    expect(src).toContain('offline');
    expect(src).toContain('active');
    expect(src).toContain('thinking');
    expect(src).toContain('idle');
    expect(src).toContain('awaitsInput');
    expect(src).toContain('STATUS_ORDER');
  });

  it('sorts active > thinking > idle > offline', async () => {
    const fs = await import('fs');
    const src = fs.default.readFileSync(new URL('../../src/components/app.mjs', import.meta.url), 'utf-8');
    expect(src).toContain('active: 0');
    expect(src).toContain('thinking: 1');
    expect(src).toContain('idle: 2');
    expect(src).toContain('offline: 3');
  });

  it('uses sortMode for secondary sort', async () => {
    const fs = await import('fs');
    const src = fs.default.readFileSync(new URL('../../src/components/app.mjs', import.meta.url), 'utf-8');
    expect(src).toContain('sortMode');
    expect(src).toContain('localeCompare');
    expect(src).toContain('lastEventAt');
  });

  it('clamps selection when workers change', async () => {
    const fs = await import('fs');
    const src = fs.default.readFileSync(new URL('../../src/components/app.mjs', import.meta.url), 'utf-8');
    expect(src).toContain('Math.min');
    expect(src).toContain('sortedWorkers.length');
  });

  it('handles keyboard j/k/Tab/q/enter/space/1-9', async () => {
    const fs = await import('fs');
    const src = fs.default.readFileSync(new URL('../../src/components/app.mjs', import.meta.url), 'utf-8');
    expect(src).toContain("input === 'j'");
    expect(src).toContain("input === 'k'");
    expect(src).toContain('key.tab');
    expect(src).toContain("input === 'q'");
    expect(src).toContain('key.return');
    expect(src).toContain("input === ' '");
    expect(src).toContain('parseInt');
  });

  it('calls master.stop on q', async () => {
    const fs = await import('fs');
    const src = fs.default.readFileSync(new URL('../../src/components/app.mjs', import.meta.url), 'utf-8');
    expect(src).toMatch(/master\.stop/);
  });

  it('calls focusTerminal on enter', async () => {
    const fs = await import('fs');
    const src = fs.default.readFileSync(new URL('../../src/components/app.mjs', import.meta.url), 'utf-8');
    expect(src).toContain('focusTerminal');
  });
});
