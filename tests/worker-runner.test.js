import { describe, it, expect } from 'vitest';
const { WorkerRunner, SYSTEM_PROMPT } = await import('../src/worker-runner.js');

describe('WorkerRunner', () => {
  it('runs a task and returns result', async () => {
    const runner = new WorkerRunner({ timeout: 30 });
    const task = { id: 'test-1', prompt: 'echo hello', cwd: process.cwd() };
    const result = await runner.run(task, null);
    expect(result).toHaveProperty('exitCode');
    expect(result).toHaveProperty('stdout');
    expect(result).toHaveProperty('stderr');
    expect(result).toHaveProperty('durationMs');
    expect(result).toHaveProperty('isClaudeError');
    expect(result).toHaveProperty('claudeResult');
    expect(result).toHaveProperty('totalCostUsd');
    expect(typeof result.durationMs).toBe('number');
  }, 60000);

  it('returns proper shape on failure', async () => {
    const runner = new WorkerRunner({ timeout: 30 });
    const task = { id: 'test-2', prompt: 'test', cwd: '/nonexistent/path' };
    const result = await runner.run(task, null);
    expect(result).toHaveProperty('exitCode');
    expect(result).toHaveProperty('stdout');
    expect(result).toHaveProperty('stderr');
    expect(result).toHaveProperty('durationMs');
    expect(result).toHaveProperty('isClaudeError');
  }, 60000);

  it('times out long-running tasks', async () => {
    const runner = new WorkerRunner({ timeout: 0.001 }); // 1ms = instant timeout
    const task = { id: 'test-3', prompt: 'write a long essay', cwd: process.cwd() };
    const result = await runner.run(task, null);
    expect(result.exitCode).toBe(-1);
  }, 30000);

  it('passes model config as env vars', async () => {
    const runner = new WorkerRunner({ timeout: 30 });
    const task = { id: 'test-4', prompt: 'echo test', cwd: process.cwd() };
    const modelConfig = { model: 'test-model', apiKey: 'test-key', apiBaseUrl: 'https://test.example.com' };
    const result = await runner.run(task, modelConfig);
    expect(result).toHaveProperty('exitCode');
  }, 60000);
});

describe('SYSTEM_PROMPT', () => {
  it('contains all required behavioral rules', () => {
    expect(SYSTEM_PROMPT).toContain('autonomous worker');
    expect(SYSTEM_PROMPT).toContain('NEVER ask questions');
    expect(SYSTEM_PROMPT).toContain('skip the interactive parts');
    expect(SYSTEM_PROMPT).toContain('attempt to resolve them independently');
    expect(SYSTEM_PROMPT).toContain('commit each logical change');
    expect(SYSTEM_PROMPT).toContain('## Summary');
    expect(SYSTEM_PROMPT).toContain('## Changes');
    expect(SYSTEM_PROMPT).toContain('## Result');
    expect(SYSTEM_PROMPT).toContain('## Issues');
  });
});
