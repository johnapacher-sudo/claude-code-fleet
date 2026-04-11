import { describe, it, expect } from 'vitest';
const { WorkerRunner, SYSTEM_PROMPT, wrapWorkerPrompt } = await import('../src/worker-runner.js');

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

describe('wrapWorkerPrompt', () => {
  it('wraps user prompt in XML tags with task metadata', async () => {
    const mod = await import('../src/worker-runner.js');
    const task = { id: 'task-abc123', prompt: 'Fix the login bug' };
    const result = mod.wrapWorkerPrompt(task);

    expect(result).toContain('<worker-context>');
    expect(result).toContain('execution: autonomous background task');
    expect(result).toContain('task-id: task-abc123');
    expect(result).toContain('timeout: 3 hours');
    expect(result).toContain('</worker-context>');
    expect(result).toContain('<user-prompt>');
    expect(result).toContain('Fix the login bug');
    expect(result).toContain('</user-prompt>');
  });

  it('preserves user prompt verbatim including special characters', async () => {
    const mod = await import('../src/worker-runner.js');
    const task = { id: 'task-x', prompt: 'Use <div> & "quotes" and\nnewlines' };
    const result = mod.wrapWorkerPrompt(task);

    expect(result).toContain('Use <div> & "quotes" and\nnewlines');
  });

  it('places user-prompt after worker-context with blank line separator', async () => {
    const mod = await import('../src/worker-runner.js');
    const task = { id: 'task-y', prompt: 'hello' };
    const result = mod.wrapWorkerPrompt(task);

    const ctxEnd = result.indexOf('</worker-context>');
    const promptStart = result.indexOf('<user-prompt>');
    expect(promptStart).toBeGreaterThan(ctxEnd);
    // Blank line between sections
    expect(result.slice(ctxEnd + '</worker-context>'.length, promptStart)).toContain('\n\n');
  });
});

describe('autonomous mode integration', () => {
  it('wrapWorkerPrompt and SYSTEM_PROMPT together form the complete prompt', () => {
    const task = { id: 'task-integ', prompt: 'do work', cwd: process.cwd() };
    const wrapped = wrapWorkerPrompt(task);

    expect(wrapped).toContain('task-id: task-integ');
    expect(wrapped).toContain('do work');
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(100);
    expect(SYSTEM_PROMPT).toContain('autonomous');
  });
});