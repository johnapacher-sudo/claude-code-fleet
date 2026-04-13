import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Pure function tests (no mocking needed) ────────────────────────────────

// Import the module — functions that use fs will be tested via a separate CJS approach
const mod = await import('../src/index.js');
const {
  stripAnsi, truncStr, modelMeta, modelWarning, modelItem,
  ANSI, CONFIG_FILENAME, GLOBAL_CONFIG_DIR, STATE_FILE,
  configSearchPaths, validateConfig, isProcessAlive, getModelsPath, parseArgs,
  normalizeProxyUrl, resolveProxy, applyProxy,
} = mod;

describe('stripAnsi', () => {
  it('removes ANSI codes', () => expect(stripAnsi('hi \x1b[31mworld\x1b[0m')).toBe('hi world'));
  it('leaves plain text', () => expect(stripAnsi('plain')).toBe('plain'));
  it('handles empty string', () => expect(stripAnsi('')).toBe(''));
  it('handles multiple codes', () => expect(stripAnsi('\x1b[1m\x1b[32mok\x1b[0m')).toBe('ok'));
});

describe('truncStr', () => {
  it('truncates long strings', () => expect(truncStr('a'.repeat(100), 10)).toBe('a'.repeat(10) + '...'));
  it('returns null', () => expect(truncStr(null, 10)).toBeNull());
  it('returns undefined', () => expect(truncStr(undefined, 10)).toBeUndefined());
  it('keeps short strings', () => expect(truncStr('short', 10)).toBe('short'));
  it('keeps exact-length', () => expect(truncStr('12345', 5)).toBe('12345'));
});

describe('modelMeta', () => {
  it('shows truncated key + endpoint', () => {
    const r = modelMeta({ apiKey: 'sk-ant-verylongkey12345', apiBaseUrl: 'https://api.anthropic.com/v1' });
    expect(r).toContain('key:');
    expect(r).toContain('endpoint:');
  });
  it('shows not set for missing key', () => expect(modelMeta({ apiBaseUrl: 'x' })).toContain('not set'));
  it('shows default for missing url', () => expect(modelMeta({ apiKey: 's' })).toContain('default'));
  it('includes proxy when set', () => {
    const r = modelMeta({ apiKey: 'sk', proxy: 'http://127.0.0.1:7890' });
    expect(r).toContain('proxy:');
    expect(r).toContain('127.0.0.1:7890');
  });
  it('omits proxy when not set', () => {
    const r = modelMeta({ apiKey: 'sk' });
    expect(r).not.toContain('proxy:');
  });
});

describe('modelWarning', () => {
  it('undefined for complete', () => expect(modelWarning({ name: 'a', apiKey: 'b', model: 'c' })).toBeUndefined());
  it('all missing', () => expect(modelWarning({})).toBe('incomplete: missing Name, API Key, Model ID'));
  it('name missing', () => expect(modelWarning({ apiKey: 'x', model: 'y' })).toBe('incomplete: missing Name'));
  it('apiKey missing', () => expect(modelWarning({ name: 'x', model: 'y' })).toBe('incomplete: missing API Key'));
  it('model missing', () => expect(modelWarning({ name: 'x', apiKey: 'y' })).toBe('incomplete: missing Model ID'));
  it('two missing', () => expect(modelWarning({ name: 'x' })).toBe('incomplete: missing API Key, Model ID'));
});

describe('modelItem', () => {
  it('has all keys', () => {
    const item = modelItem({ name: 'opus', model: 'c4', apiKey: 'sk', apiBaseUrl: 'https://a.com' });
    for (const k of ['display', 'label', 'detail', 'meta', 'warning', 'value']) expect(item).toHaveProperty(k);
  });
  it('unnamed for no name', () => expect(modelItem({ model: 'm' }).label).toBe('(unnamed)'));
  it('default for no model', () => expect(modelItem({ name: 't' }).detail).toBe('default'));
  it('value is name', () => expect(modelItem({ name: 'x', model: 'm' }).value).toBe('x'));
});

describe('Constants', () => {
  it('CONFIG_FILENAME', () => expect(CONFIG_FILENAME).toBe('fleet.config.json'));
  it('GLOBAL_CONFIG_DIR', () => expect(GLOBAL_CONFIG_DIR).toContain('.config/claude-code-fleet'));
  it('STATE_FILE', () => expect(STATE_FILE).toContain('fleet-state.json'));
});

describe('ANSI', () => {
  it('bold', () => expect(ANSI.bold('x')).toBe('\x1b[1mx\x1b[0m'));
  it('green', () => expect(ANSI.green('x')).toBe('\x1b[32mx\x1b[0m'));
  it('red', () => expect(ANSI.red('x')).toBe('\x1b[31mx\x1b[0m'));
});

describe('validateConfig', () => {
  it('rejects non-array', () => {
    const e = validateConfig({ instances: 'x' });
    expect(e).toHaveLength(1);
    expect(e[0]).toContain('must be a non-empty array');
  });
  it('rejects empty', () => expect(validateConfig({ instances: [] })[0]).toContain('must be a non-empty array'));
  it('rejects no name', () => expect(validateConfig({ instances: [{ apiKey: 'k' }] }).some(e => e.includes('"name" is required'))).toBe(true));
  it('rejects no apiKey', () => expect(validateConfig({ instances: [{ name: 'a' }] }).some(e => e.includes('"apiKey" is required'))).toBe(true));
  it('rejects dup names', () => expect(validateConfig({ instances: [{ name: 'd', apiKey: 'k1' }, { name: 'd', apiKey: 'k2' }] }).some(e => e.includes('duplicate'))).toBe(true));
  it('accepts valid', () => expect(validateConfig({ instances: [{ name: 'w1', apiKey: 'k' }] })).toEqual([]));
});

describe('configSearchPaths', () => {
  it('returns 3 paths', () => expect(configSearchPaths()).toHaveLength(3));
});

describe('isProcessAlive', () => {
  it('alive for self', () => expect(isProcessAlive(process.pid)).toBe(true));
  it('dead for fake pid', () => expect(isProcessAlive(99999999)).toBe(false));
});

describe('getModelsPath', () => {
  it('contains models.json', () => expect(getModelsPath()).toContain('models.json'));
});

describe('parseArgs', () => {
  it('init', () => { const r = parseArgs(['init']); expect(r.command).toBe('init'); expect(r.subcommand).toBeUndefined(); });
  it('model add', () => expect(parseArgs(['model', 'add']).subcommand).toBe('add'));
  it('--config', () => expect(parseArgs(['--config', 'x.json']).opts.config).toBe('x.json'));
  it('--only array', () => expect(parseArgs(['--only', 'a,b']).opts.only).toEqual(['a', 'b']));
  it('--help', () => expect(parseArgs(['--help']).opts.help).toBe(true));
  it('-h', () => expect(parseArgs(['-h']).opts.help).toBe(true));
  it('default run', () => expect(parseArgs([]).command).toBe('run'));
  it('--model', () => expect(parseArgs(['--model', 'o']).opts.model).toBe('o'));
  it('--cwd', () => expect(parseArgs(['--cwd', '/t']).opts.cwd).toBe('/t'));
  it('extra args', () => expect(parseArgs(['a', 'b', 'c']).args).toEqual(['c']));
  it('--proxy with url argument', () => expect(parseArgs(['--proxy', 'http://127.0.0.1:7890']).opts.proxy).toBe('http://127.0.0.1:7890'));
  it('--proxy= with inline value', () => expect(parseArgs(['--proxy=http://localhost:8080']).opts.proxy).toBe('http://localhost:8080'));
  it('--proxy without value sets true', () => expect(parseArgs(['--proxy']).opts.proxy).toBe(true));
  it('--proxy before another flag sets true', () => {
    const r = parseArgs(['--proxy', '--model', 'o']);
    expect(r.opts.proxy).toBe(true);
    expect(r.opts.model).toBe('o');
  });
  it('--proxy combined with other opts', () => {
    const r = parseArgs(['run', '--model', 'opus', '--proxy', 'socks5://1.2.3.4:1080', '--cwd', '/tmp']);
    expect(r.command).toBe('run');
    expect(r.opts.model).toBe('opus');
    expect(r.opts.proxy).toBe('socks5://1.2.3.4:1080');
    expect(r.opts.cwd).toBe('/tmp');
  });
});

describe('filterInstances', () => {
  const inst = [{ name: 'w1', apiKey: 'k1' }, { name: 'w2', apiKey: 'k2' }, { name: 'w3', apiKey: 'k3' }];

  it('returns all when no filter', () => {
    expect(mod.filterInstances(inst, null)).toEqual(inst);
    expect(mod.filterInstances(inst, [])).toEqual(inst);
  });
  it('filters by name', () => {
    const r = mod.filterInstances(inst, ['w1']);
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('w1');
  });
  it('warns on unknown', () => {
    const s = vi.spyOn(console, 'error').mockImplementation(() => {});
    mod.filterInstances(inst, ['w1', 'ghost']);
    expect(s).toHaveBeenCalledWith(expect.stringContaining('unknown instances'));
    s.mockRestore();
  });
  it('exits on no match', () => {
    const s = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const e = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => mod.filterInstances(inst, ['nope'])).toThrow('exit');
    s.mockRestore(); e.mockRestore();
  });
});

describe('cmdStatus', () => {
  it('shows details', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    mod.cmdStatus({ instances: [{ name: 'w1', apiKey: 'k', model: 'opus' }] });
    const out = log.mock.calls.flat().join(' ');
    expect(out).toContain('w1');
    expect(out).toContain('opus');
    log.mockRestore();
  });
  it('shows proxy when configured', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    mod.cmdStatus({ instances: [{ name: 'w1', apiKey: 'k', model: 'opus', proxy: 'http://127.0.0.1:7890' }] });
    const out = log.mock.calls.flat().join(' ');
    expect(out).toContain('proxy:');
    expect(out).toContain('http://127.0.0.1:7890');
    log.mockRestore();
  });
  it('omits proxy line when not configured', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    mod.cmdStatus({ instances: [{ name: 'w1', apiKey: 'k', model: 'opus' }] });
    const out = log.mock.calls.flat().join(' ');
    expect(out).not.toContain('proxy:');
    log.mockRestore();
  });
});

// ─── Proxy function tests ────────────────────────────────────────────────────

describe('normalizeProxyUrl', () => {
  it('adds http:// when no protocol', () => {
    expect(normalizeProxyUrl('127.0.0.1:7890')).toBe('http://127.0.0.1:7890');
  });
  it('adds http:// for host:port without scheme', () => {
    expect(normalizeProxyUrl('proxy.corp.com:3128')).toBe('http://proxy.corp.com:3128');
  });
  it('preserves existing http://', () => {
    expect(normalizeProxyUrl('http://127.0.0.1:7890')).toBe('http://127.0.0.1:7890');
  });
  it('preserves existing https://', () => {
    expect(normalizeProxyUrl('https://proxy.secure.com:443')).toBe('https://proxy.secure.com:443');
  });
  it('is case-insensitive for protocol', () => {
    expect(normalizeProxyUrl('HTTP://localhost:8080')).toBe('HTTP://localhost:8080');
    expect(normalizeProxyUrl('HTTPS://localhost:8080')).toBe('HTTPS://localhost:8080');
  });
  it('returns falsy values as-is', () => {
    expect(normalizeProxyUrl(null)).toBeNull();
    expect(normalizeProxyUrl(undefined)).toBeUndefined();
    expect(normalizeProxyUrl('')).toBe('');
  });
});

describe('resolveProxy', () => {
  it('returns null when cliProxy is falsy', () => {
    expect(resolveProxy(null, 'http://x')).toBeNull();
    expect(resolveProxy(undefined, 'http://x')).toBeNull();
    expect(resolveProxy(false, 'http://x')).toBeNull();
  });
  it('returns normalized url when cliProxy is a string', () => {
    expect(resolveProxy('127.0.0.1:7890', null)).toBe('http://127.0.0.1:7890');
    expect(resolveProxy('http://localhost:8080', null)).toBe('http://localhost:8080');
  });
  it('uses profileProxy when cliProxy is true', () => {
    expect(resolveProxy(true, 'http://127.0.0.1:7890')).toBe('http://127.0.0.1:7890');
  });
  it('normalizes profileProxy when cliProxy is true', () => {
    expect(resolveProxy(true, '10.0.0.1:3128')).toBe('http://10.0.0.1:3128');
  });
  it('returns null when cliProxy is true but no profileProxy', () => {
    expect(resolveProxy(true, null)).toBeNull();
    expect(resolveProxy(true, undefined)).toBeNull();
    expect(resolveProxy(true, '')).toBeNull();
  });
  it('cli string overrides profileProxy', () => {
    expect(resolveProxy('http://cli-proxy:1234', 'http://profile-proxy:5678')).toBe('http://cli-proxy:1234');
  });
});

describe('applyProxy', () => {
  it('sets HTTP_PROXY and HTTPS_PROXY', () => {
    const env = {};
    applyProxy(env, 'http://127.0.0.1:7890');
    expect(env.HTTP_PROXY).toBe('http://127.0.0.1:7890');
    expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:7890');
  });
  it('does not modify env when proxyUrl is falsy', () => {
    const env = { EXISTING: 'value' };
    applyProxy(env, null);
    expect(env).toEqual({ EXISTING: 'value' });
    applyProxy(env, undefined);
    expect(env).toEqual({ EXISTING: 'value' });
    applyProxy(env, '');
    expect(env).toEqual({ EXISTING: 'value' });
  });
  it('overwrites existing proxy vars', () => {
    const env = { HTTP_PROXY: 'old', HTTPS_PROXY: 'old' };
    applyProxy(env, 'http://new:8080');
    expect(env.HTTP_PROXY).toBe('http://new:8080');
    expect(env.HTTPS_PROXY).toBe('http://new:8080');
  });
});
