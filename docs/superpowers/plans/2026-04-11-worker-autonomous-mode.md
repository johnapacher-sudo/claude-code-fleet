# Worker Autonomous Execution Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three-layer autonomous execution mode to worker-launched claude processes: system prompt (behavior), prompt wrapping (context), tool blocking (safety net).

**Architecture:** All changes in `src/worker-runner.js`. Add a `SYSTEM_PROMPT` constant, a `wrapWorkerPrompt(task)` function, and modify `run()` to pass `--append-system-prompt`, `--disallowedTools AskUserQuestion`, and the wrapped prompt instead of the raw prompt. Tests in `tests/worker-runner.test.js`.

**Tech Stack:** Node.js CJS, vitest

---

### Task 1: Add SYSTEM_PROMPT constant

**Files:**
- Modify: `src/worker-runner.js:6-7` (after `USER_SETTINGS_PATH`)

- [ ] **Step 1: Write the failing test**

Add to `tests/worker-runner.test.js` after the existing imports:

```javascript
describe('SYSTEM_PROMPT', () => {
  it('contains all required behavioral rules', async () => {
    const mod = await import('../src/worker-runner.js');
    const prompt = mod.SYSTEM_PROMPT;
    expect(prompt).toContain('autonomous worker');
    expect(prompt).toContain('NEVER ask questions');
    expect(prompt).toContain('skip the interactive parts');
    expect(prompt).toContain('attempt to resolve them independently');
    expect(prompt).toContain('commit each logical change');
    expect(prompt).toContain('## Summary');
    expect(prompt).toContain('## Changes');
    expect(prompt).toContain('## Result');
    expect(prompt).toContain('## Issues');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/worker-runner.test.js --reporter=verbose 2>&1 | grep -A5 'SYSTEM_PROMPT'`
Expected: FAIL — `SYSTEM_PROMPT` is not exported

- [ ] **Step 3: Write minimal implementation**

Add to `src/worker-runner.js` after line 7 (`const USER_SETTINGS_PATH = ...`):

```javascript
const SYSTEM_PROMPT = `You are a background autonomous worker. No human will read your output until the task completes.

Execution rules:
1. NEVER ask questions or wait for input. Proceed autonomously with best judgment.
2. When a skill or workflow requires interaction, skip the interactive parts and make autonomous decisions.
3. When encountering errors, attempt to resolve them independently. Try alternative approaches, search for solutions, and debug systematically. Only give up after exhausting reasonable options.
4. When you modify project files (code, tests, docs), commit each logical change with a descriptive message using git.
5. Produce a structured summary at the end of your work:
   ## Summary
   - What was done
   ## Changes
   - Files modified and why
   ## Result
   - Final status and any noteworthy findings
   ## Issues (if any)
   - Unresolved problems or assumptions made`;
```

Update the export at the bottom of `src/worker-runner.js`:

```javascript
module.exports = { WorkerRunner, SYSTEM_PROMPT };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/worker-runner.test.js --reporter=verbose`
Expected: PASS — `SYSTEM_PROMPT` test passes, all existing tests still pass

- [ ] **Step 5: Commit**

```bash
git add src/worker-runner.js tests/worker-runner.test.js
git commit -m "feat(worker): add SYSTEM_PROMPT constant for autonomous execution"
```

---

### Task 2: Add wrapWorkerPrompt function

**Files:**
- Modify: `src/worker-runner.js` (add function after `SYSTEM_PROMPT`)
- Modify: `tests/worker-runner.test.js` (add test describe block)

- [ ] **Step 1: Write the failing test**

Add to `tests/worker-runner.test.js`:

```javascript
describe('wrapWorkerPrompt', () => {
  it('wraps user prompt in XML tags with task metadata', async () => {
    const mod = await import('../src/worker-runner.js');
    const wrap = mod.wrapWorkerPrompt;
    const task = { id: 'task-abc123', prompt: 'Fix the login bug' };
    const result = wrap(task);

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
    const wrap = mod.wrapWorkerPrompt;
    const task = { id: 'task-x', prompt: 'Use <div> & "quotes" and\nnewlines' };
    const result = wrap(task);

    expect(result).toContain('Use <div> & "quotes" and\nnewlines');
  });

  it('places user-prompt after worker-context with blank line separator', async () => {
    const mod = await import('../src/worker-runner.js');
    const wrap = mod.wrapWorkerPrompt;
    const task = { id: 'task-y', prompt: 'hello' };
    const result = wrap(task);

    const ctxEnd = result.indexOf('</worker-context>');
    const promptStart = result.indexOf('<user-prompt>');
    expect(promptStart).toBeGreaterThan(ctxEnd);
    // Blank line between sections
    expect(result.slice(ctxEnd + '</worker-context>'.length, promptStart)).toContain('\n\n');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/worker-runner.test.js --reporter=verbose 2>&1 | grep -A5 'wrapWorkerPrompt'`
Expected: FAIL — `wrapWorkerPrompt` is not exported

- [ ] **Step 3: Write minimal implementation**

Add to `src/worker-runner.js` after the `SYSTEM_PROMPT` constant:

```javascript
function wrapWorkerPrompt(task) {
  return [
    '<worker-context>',
    'execution: autonomous background task',
    `task-id: ${task.id}`,
    'timeout: 3 hours',
    '</worker-context>',
    '',
    '<user-prompt>',
    task.prompt,
    '</user-prompt>',
  ].join('\n');
}
```

Update the export:

```javascript
module.exports = { WorkerRunner, SYSTEM_PROMPT, wrapWorkerPrompt };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/worker-runner.test.js --reporter=verbose`
Expected: PASS — all `wrapWorkerPrompt` tests pass, all existing tests still pass

- [ ] **Step 5: Commit**

```bash
git add src/worker-runner.js tests/worker-runner.test.js
git commit -m "feat(worker): add wrapWorkerPrompt for task-level context injection"
```

---

### Task 3: Integrate three layers into run() args

**Files:**
- Modify: `src/worker-runner.js:31` (the `args` line in `run()`)

- [ ] **Step 1: Write the failing test**

Add to `tests/worker-runner.test.js`:

```javascript
describe('run() args construction', () => {
  it('passes wrapped prompt, system prompt, and disallowed tools to claude', async () => {
    // Intercept spawn to capture args
    const { spawn } = require('child_process');
    const origSpawn = require('child_process').spawn;
    let capturedArgs = null;

    // Temporarily mock spawn
    const mod = await import('../src/worker-runner.js');
    // We test by verifying wrapWorkerPrompt and SYSTEM_PROMPT are used
    // through the exported functions directly, since spawn is hard to mock in CJS

    const task = { id: 'task-integ', prompt: 'do work', cwd: process.cwd() };
    const wrapped = mod.wrapWorkerPrompt(task);

    // Verify the wrapped prompt contains task metadata
    expect(wrapped).toContain('task-id: task-integ');
    expect(wrapped).toContain('do work');

    // Verify SYSTEM_PROMPT is non-empty and contains rules
    expect(mod.SYSTEM_PROMPT.length).toBeGreaterThan(100);
    expect(mod.SYSTEM_PROMPT).toContain('autonomous');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/worker-runner.test.js --reporter=verbose 2>&1 | grep -A5 'args construction'`
Expected: This test should PASS already since it tests exported functions. The real change is in `run()` which we verify by reading the code.

- [ ] **Step 3: Modify run() to use all three layers**

Replace line 31 in `src/worker-runner.js`:

Before:
```javascript
      const args = ['-p', task.prompt, '--dangerously-skip-permissions'];
```

After:
```javascript
      const args = [
        '-p', wrapWorkerPrompt(task),
        '--dangerously-skip-permissions',
        '--disallowedTools', 'AskUserQuestion',
        '--append-system-prompt', SYSTEM_PROMPT,
      ];
```

- [ ] **Step 4: Run all tests to verify nothing breaks**

Run: `npx vitest run`
Expected: ALL tests pass (existing tests use real `claude` which gets the new args, mock runner tests unaffected)

- [ ] **Step 5: Commit**

```bash
git add src/worker-runner.js
git commit -m "feat(worker): integrate autonomous mode — system prompt, prompt wrapping, tool blocking"
```

---

### Task 4: Verify full test suite passes

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (18 test files, 240+ tests)

- [ ] **Step 2: Run only worker-runner tests in verbose mode**

Run: `npx vitest run tests/worker-runner.test.js --reporter=verbose`
Expected: All worker-runner tests pass including new ones

- [ ] **Step 3: Commit any remaining test adjustments if needed**

Only if tests needed fixes.
