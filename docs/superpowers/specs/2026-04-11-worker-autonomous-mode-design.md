# Worker Autonomous Execution Mode Design

**Goal:** Enable worker-launched claude processes to execute tasks autonomously without human interaction, producing complete results with structured output.

**Architecture:** Three-layer defense — system prompt (behavioral guidance), prompt wrapping (task-level context), and tool blocking (hard constraint). All changes concentrated in `worker-runner.js`.

**Scope:** Always-on for all worker tasks. No configuration toggle.

---

## Problem

Worker daemon launches `claude -p` subprocesses to execute background tasks. Current issues:

1. **Interactive skills block execution.** Skills like `superpowers:brainstorming` are designed as multi-turn dialogues (8-20+ rounds). In `claude -p` mode, claude outputs a question and exits — user gets a question, not a result.

2. **No execution context.** Claude receives only the bare prompt. It doesn't know it's running as a background worker, has no task metadata, no timeout awareness.

3. **Inconsistent output.** Without guidance, output ranges from terse summaries to unfocused rambling. No standard format for task results.

4. **No error handling strategy.** When tasks fail mid-execution, claude has no guidance on whether to retry, search for solutions, or give up.

5. **Code changes uncommitted.** Coding tasks modify project files but don't commit, leaving uncommitted changes in the working tree.

## Skill Interaction Analysis

| Skill | Interactive? | User Input Waits | Risk Level |
|-------|-------------|------------------|------------|
| brainstorming | Yes (dialogue) | 8-20+ | **High** — deadlocks at first question |
| writing-plans | Minimal | 1 (final choice) | Low — deliverable already saved |
| subagent-driven-development | No | 0 normal | None |
| systematic-debugging | No | 0 normal | None |
| test-driven-development | No | 0 normal | None |
| using-superpowers | No | 0 | None |
| writing-skills | No | 0 | None |

Key finding: Skills use natural-language dialogue for interaction, not `AskUserQuestion` tool calls. The blocking happens because claude produces a question as output and exits, not because it hangs.

## Design: Three-Layer Defense

### Layer 1: System Prompt (`--append-system-prompt`)

**Positioning:** Primary behavioral guidance. General rules for all worker tasks.

**Content:**

```
You are a background autonomous worker. No human will read your output until the task completes.

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
   - Unresolved problems or assumptions made
```

**What each rule covers:**

| Rule | User Requirement |
|------|-----------------|
| 1. No questions | No interaction, autonomous execution |
| 2. Skip skill interaction | Skills still load but skip Q&A |
| 3. Resolve errors independently | Autonomous error handling |
| 4. Auto-commit changes | Coding tasks commit to git |
| 5. Structured output | Markdown summary format |

**Limitation:** Soft guidance. Model may not fully comply when skill instructions conflict with system instructions. Layer 3 provides hard enforcement.

### Layer 2: Prompt Wrapping

**Positioning:** Task-level context injection. Higher attention weight than system prompt.

**Format:**

```xml
<worker-context>
execution: autonomous background task
task-id: {task.id}
timeout: 3 hours
</worker-context>

<user-prompt>
{user's original prompt, verbatim}
</user-prompt>
```

**What this provides:**

- `execution: autonomous` — reinforces the execution mode at prompt level
- `task-id` — claude can reference in commit messages or output
- `timeout` — claude knows the time budget, can pace itself
- `<user-prompt>` — preserves original prompt without modification

**Division of labor with Layer 1:**

- Layer 1 (system prompt) = "who you are, how to behave" (general rules)
- Layer 2 (prompt wrapping) = "what this task is, what constraints apply" (task-specific)

**Example — user submits prompt "为 auth.js 添加 JWT token 刷新逻辑":**

```xml
<worker-context>
execution: autonomous background task
task-id: task-20260411-a3f8k2
timeout: 3 hours
</worker-context>

<user-prompt>
为 auth.js 添加 JWT token 刷新逻辑
</user-prompt>
```

### Layer 3: Hard Constraint (`--disallowedTools`)

**Positioning:** Safety net. Even if Layers 1-2 are ignored, tool calls are physically blocked.

**Blocked tool:**

```
AskUserQuestion
```

**Why only this one:**

- `AskUserQuestion` is the only built-in tool that waits for user input
- `Skill`, `Agent`, `Read`, `Edit`, `Bash`, `Grep`, `Glob` are all non-interactive — blocking them would cripple claude's capabilities
- `EnterPlanMode` auto-skips in `-p` mode

**Error chain when triggered:**

```
claude attempts: AskUserQuestion("Which approach?")
  → claude CLI returns: tool not allowed error
  → claude sees the error
  → combines with Layer 1 rules 1-2, understands why it's blocked
  → makes autonomous choice, continues execution
```

### Combined Effect

**Scenario 1: Design task (triggers brainstorming skill)**

Prompt: "Design a new authentication system"

| Without protection | With protection |
|---|---|
| Loads skill → outputs first clarifying question → exits | Loads skill → understands framework → skips Q&A → makes reasonable assumptions → outputs complete design document |
| **Result: 1 question** | **Result: complete design** |

Quality is slightly lower than interactive (no user feedback refinement), but output is complete and usable.

**Scenario 2: TDD development task**

Prompt: "Implement user login with full tests"

| Without protection | With protection |
|---|---|
| Normal TDD cycle | Same — TDD is naturally non-interactive |
| **Result: code + tests** | **Result: code + tests + git commit** |

Autonomous skills are unaffected. Layer 4 (auto-commit) adds value.

**Scenario 3: Model ignores system instructions (edge case)**

| Layer 1 | Layer 2 | Layer 3 |
|---|---|---|
| System prompt says don't ask | Prompt context says autonomous | `--disallowedTools` blocks tool |
| Model might ignore | Supplemental reinforcement | **Tool call physically fails** |
| | | Model receives error → forced to adapt |

Even if Layer 1 fails, Layer 3 guarantees no interaction blocking.

## Implementation

### File Changes

| File | Change |
|------|--------|
| `src/worker-runner.js` | Add `SYSTEM_PROMPT` constant, add `wrapWorkerPrompt(task)` function, modify `run()` args construction |

No other files need changes.

### Code Structure

```javascript
// Module-level constant
const SYSTEM_PROMPT = `You are a background autonomous worker...`;

// Prompt wrapping function
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

### Args Construction in `run()`

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

### Testing

- Unit test for `wrapWorkerPrompt()` — verifies XML structure and metadata injection
- Unit test for `SYSTEM_PROMPT` — verifies it contains key behavioral rules
- Existing mock runner tests unaffected (mock returns pre-built result objects)
- Integration test: verify claude args contain `--disallowedTools`, `--append-system-prompt`, and wrapped prompt

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auto-commit code changes | Yes | Unattended tasks need changes preserved |
| Output format | Structured Markdown | Readable in report viewer |
| Error handling | Autonomous resolution | Worker has 3 hours, should try to solve |
| Task scope | No restriction | Trust claude's judgment |
| Configuration toggle | Always-on | Simplicity, predictability |
| Timeout | Fixed 3 hours (global) | Adequate for most tasks |
