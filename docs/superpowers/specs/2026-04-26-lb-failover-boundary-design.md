# Load Balancer Failover Boundary Design

## Summary

Refine `src/lb.js` so failover is driven by explicit failure classification instead of `exitCode !== 0`. Add a small failover policy surface (`off | safe-only | always`), default to `safe-only`, and move tool-specific error classification into adapters.

## Problem

The current load balancer treats every non-zero exit as a signal to try the next model:

```js
if (code === 0) return;
console.log(`failed (exit ${code}), trying next...`);
```

That collapses several distinct failure classes into one path:

1. **Per-model infrastructure failures** — a single API key, endpoint, or route is unhealthy.
2. **Global infrastructure failures** — the network, account, or environment is broadly unavailable.
3. **Terminal task failures** — the request is invalid, the CLI rejects the invocation, or the task itself cannot succeed.

Because `lb` cannot currently distinguish them, it often performs wasteful failover on failures that are not recoverable by switching models.

## Goals

- Let users explicitly disable failover.
- Restrict automatic failover to failures that are explicitly classified as safe to retry on another model.
- Keep `src/lb.js` focused on pool selection and execution orchestration, not tool-specific stderr parsing.
- Improve observability so users can tell why each attempt did or did not fail over.

## Non-Goals

- Solving upper-layer task-quality retries or prompt validation.
- Adding health checks, weighted routing, or observer-driven routing.
- Guaranteeing perfect classification for every tool from day one.

## Design Overview

The new design introduces three concepts:

1. **Failover policy** — controls whether failover is disabled, conservative, or legacy-compatible.
2. **Execution result classification** — every attempt is classified as `success`, `failover-safe`, or `terminal`.
3. **Adapter-owned error interpretation** — each tool adapter may optionally classify failures it can recognize reliably.

`src/lb.js` remains the coordinator:

- choose the next model via round-robin
- run one attempt
- collect process outcome
- apply policy + classification
- either stop or move to the next model

## Failover Policy

Support three policy values:

| Policy | Meaning |
|------|---------|
| `off` | Never fail over. Run at most one model attempt. |
| `safe-only` | Fail over only when the result is explicitly classified as recoverable. Default. |
| `always` | Legacy-compatible mode. Any non-success **execution result** may fail over, except explicit user interruption. |

### CLI surface

Recommended CLI shape:

```bash
fleet lb <pool> [--failover <mode> | --no-failover] -- <args>
```

`--no-failover` is a convenience alias for `--failover off`.

### CLI parsing and validation

Because `parseArgs()` stops option parsing at `--`, the failover flags must appear **before** the passthrough boundary:

```bash
fleet lb my-pool --failover safe-only -- -p "hello"
fleet lb my-pool --no-failover -- -p "hello"
```

Validation rules:

- accepted values for `--failover` are exactly `off`, `safe-only`, and `always`
- invalid values are a CLI usage error and should exit before spawning anything
- `--no-failover` and `--failover <mode>` are mutually exclusive unless `<mode>` is `off`
- if neither flag is provided, default to `safe-only`
- passthrough args after `--` are never inspected by `lb`

## Failure Classification Model

Each attempt produces a normalized process result:

```js
{
  spawnError,     // Error | null
  exitCode,       // number | null
  signal,         // string | null
  timedOut,       // boolean
  timeoutPhase,   // 'startup' | null
  stderrSnippet,  // string
}
```

### Result collection boundary

`runWithFailover()` should delegate raw process capture to a small helper such as:

```js
collectProcessResult(child, options)
```

Responsibilities:

- capture `exitCode`, `signal`, timeout metadata, and `stderrSnippet`
- know nothing about pool policy or adapter classification
- return the normalized result shape consumed by the classifier

### `stderrSnippet` contract

`stderrSnippet` exists only to support adapter classification and logging. It should be defined narrowly:

- capture stderr in parallel with normal stdio behavior, keeping terminal output unchanged for the user
- store only the last **4096 bytes**, with a fixed ring-buffer-style truncation policy
- treat it as best-effort diagnostic context, not a full transcript
- on `spawnError`, `stderrSnippet` is an empty string because the child process never started
- on startup timeout, `stderrSnippet` contains whatever was captured before termination, if anything
- truncate by bytes, not lines, so tests can assert deterministic limits

The adapter interface must not depend on full stderr fidelity.

That result is classified into one of three categories:

| Classification | Meaning | `lb` action |
|---------------|---------|-------------|
| `success` | Attempt completed successfully | Persist `lastIndex`, return success |
| `failover-safe` | Switching models may reasonably help | Record attempt, try next model if policy allows |
| `terminal` | Switching models is unlikely to help | Stop immediately and return failure |

### Classification precedence

1. `exitCode === 0` and `signal === null` and `spawnError === null` and `timedOut === false` → `success`
2. explicit startup timeout controlled by `lb` → `failover-safe`
3. child exit by `SIGINT` or `SIGTERM`, when `timedOut !== true` → `terminal`
4. spawn/setup errors (`ENOENT`, invalid `cwd`, permission errors, unknown adapter) → setup error, throw immediately
5. adapter classification, if provided
6. otherwise default to `terminal`

This default is intentionally conservative: if the system cannot confidently say failover is useful, it should not guess.

### Classifier boundary

The precedence logic should live in its own pure helper:

```js
classifyAttempt(result, adapterClassification)
```

Input:

- `result`: normalized process result from `collectProcessResult()`
- `adapterClassification`: optional adapter return `{ kind, reason }`

Output:

```js
{
  kind: 'success' | 'failover-safe' | 'terminal',
  reason: string
}
```

Responsibilities:

- apply the precedence rules in one place
- keep `runWithFailover()` focused on orchestration
- keep adapter logic limited to tool-specific interpretation, not policy ordering

### Startup timeout boundary

Only a timeout introduced by `lb` to detect failure-to-start counts as recoverable. This timeout is intentionally narrow: it covers the period before the child is considered successfully started.

For this design, the **startup phase ends at the earliest of**:

1. the child exits
2. the child emits any stdout or stderr data
3. the fixed startup timer expires

Startup timeout behavior:

- if the timer expires **before** any child output and while the child is still alive, `lb` terminates the child and records `timedOut: true`, `timeoutPhase: 'startup'`
- that result is classified as `failover-safe`
- if output arrives before the timer expires, the startup timer is cleared and the process is considered started

Startup timeout defaults:

- use a fixed default of **3000ms**
- do not make it user-configurable in this iteration
- terminate with `SIGTERM`, then escalate to `SIGKILL` after a fixed **500ms** grace period only if the child does not exit

Any later timeout is **not** a startup timeout.

This design does **not** treat long-running task execution timeouts as recoverable failover events. If a future task timeout is added, it belongs to a separate layer and must not reuse this classification automatically.

## Adapter Extension

Extend the adapter base contract with an optional method:

```js
class ToolAdapter {
  classifyFailure(_result) {
    return { kind: 'terminal', reason: 'unclassified' };
  }
}
```

Where the returned shape is:

```js
{
  kind: 'failover-safe' | 'terminal',
  reason: string
}
```

### Adapter rules

- Adapters should only classify failures they can recognize with high confidence.
- Tool-specific stderr matching belongs in adapters, not in `src/lb.js`.
- If a tool cannot classify a failure reliably, it must return `terminal`.

### Suggested recoverable reason enum

To keep logs and tests stable, `failover-safe` should be limited to a small set of reason codes:

- `startup_timeout`
- `rate_limited`
- `upstream_unreachable`
- `auth_temporarily_unusable`
- `startup_transient_error`

Anything else should remain `terminal` unless a strong case emerges from real usage.

### Terminal reason enum

To avoid open-ended adapter output, terminal results should also use a constrained vocabulary where possible:

- `unclassified`
- `invalid_request`
- `invalid_cli_usage`
- `user_interrupted`
- `task_failed`
- `auth_permanently_unusable`

Adapters may map tool-specific messages into these reasons, but should not invent arbitrary new reason strings in the first version.

## `runWithFailover()` Execution Flow

1. Load models and pools.
2. Resolve the target pool.
3. Select the next candidate with `pickNext()`.
4. Resolve hard prerequisites for the attempt:
   - model exists in `models`
   - adapter exists for `entry.tool`
   - adapter binary is available if that is validated at execution time
   If any prerequisite fails, throw a setup error immediately.
5. Spawn the tool and collect the normalized process result.
6. Classify the result using the precedence rules above.
7. Apply the policy in this order:
   - `success` → persist `lastIndex`, return success result
   - child exit by `SIGINT` or `SIGTERM` → stop immediately and return failure result
   - policy `off` → stop after the first attempt, regardless of non-success kind
   - policy `always` → on any non-success execution result except explicit user interruption, record attempt and continue if candidates remain
   - policy `safe-only` + `failover-safe` → record attempt, continue
   - policy `safe-only` + `terminal` → stop immediately and return failure result
8. If all pool members are exhausted under recoverable failure conditions, return an aggregated error/result.

### Candidate selection boundary

The current `pickNext(pool, models)` helper is no longer enough because execution now needs awareness of already-attempted indices within one invocation. The selector API should be:

```js
pickNext(pool, models, attemptedIndices)
```

Required behavior:

- round-robin still starts from `state.lastIndex + 1`
- candidates already attempted in the current invocation are skipped
- if no candidates remain, the helper reports exhaustion explicitly

This keeps selection as a standalone unit instead of burying iteration rules inside `runWithFailover()`.

## State Semantics

`state.lastIndex` should be persisted **only on success**.

Rationale:

- a failed attempt did not successfully serve the request
- persisting failed indices blurs the meaning of round-robin state
- success-only persistence gives the clearest mental model: the pointer marks the last successful route

In-memory tracking of attempted indices is still needed within a single invocation to avoid retry loops.

## Result Shape and Observability

`runWithFailover()` should return a richer outcome rather than only resolving `undefined` on success or throwing on every failure. The recommended contract is:

- **config/setup errors** still throw: missing pool, empty pool, unreadable config, invalid CLI policy
- **execution outcomes** return a structured result object, whether success or failure

Recommended result shape:

```js
{
  status: 'success' | 'failure',
  poolName,
  selectedModel,          // successful model or null
  finalKind,              // 'success' | 'terminal' | 'policy_stopped' | 'exhausted'
  finalReason,            // reason code for final outcome
  attempts: [
    {
      modelName,
      exitCode,
      signal,
      kind,
      reason
    }
  ]
}
```

Semantics:

- `finalKind: 'success'` means one attempt succeeded
- `finalKind: 'terminal'` means execution stopped on a non-recoverable failure
- `finalKind: 'policy_stopped'` means policy `off` stopped execution after the first failed attempt
- `finalKind: 'exhausted'` means all attempts that policy allowed were consumed by recoverable failures
- `finalReason` must be one of exactly:
  - `success`
  - `user_interrupted`
  - `terminal_failure`
  - `policy_off`
  - `recoverable_exhausted`

This removes the ambiguity noted in the review: exhaustion is a distinct top-level outcome, not a reuse of a single-attempt classification.

### CLI exit mapping

`cmdLbRun()` should translate structured execution results into process exits as follows:

- `finalKind: 'success'` → exit 0
- `finalKind: 'terminal'` with `finalReason: 'user_interrupted'` → exit 130
- `finalKind: 'terminal'` for all other reasons → exit 1 after printing the final attempt and summary
- `finalKind: 'policy_stopped'` → exit 1 after printing the single-attempt summary
- `finalKind: 'exhausted'` → exit 1 after printing the recoverable-attempt summary

Thrown config/setup errors remain fatal usage/runtime errors and also exit 1.

### Setup error vs execution failure

These conditions are **setup/runtime errors** and should throw instead of becoming classified attempt results:

- target pool does not exist
- pool has no models
- model named by the pool cannot be resolved
- adapter for the model tool cannot be resolved
- binary is missing
- configured `cwd` does not exist or cannot be entered

These conditions abort the **entire run immediately** rather than skipping the bad entry. They happen before a meaningful model attempt and should not trigger failover inside a single-tool pool.

Even if the CLI initially uses only part of this structure, it gives a stable basis for:

- clearer terminal logs
- future observer/TUI integration
- better tests

### Logging

Per-attempt logs should show both the model and the decision:

```text
[lb:pool] try 1/3 claude:alpha
[lb:pool] alpha -> failover-safe (reason=rate_limited)
[lb:pool] trying next model...
```

```text
[lb:pool] try 1/3 claude:alpha
[lb:pool] alpha -> terminal (exit_code=1, reason=invalid_request)
[lb:pool] stop failover: terminal failure
```

When exhaustion happens, the summary should show each attempt and its classification rather than only printing `All models failed`.

## Backward Compatibility

The existing behavior can be preserved temporarily via `--failover always`.

Recommended migration path:

1. introduce the new policy surface
2. set default to `safe-only`
3. document `always` as a compatibility mode, not the preferred mode
4. reevaluate later whether `always` should remain public

## Testing Plan

At minimum, add or update tests for:

- transient startup error classified as `startup_transient_error` triggers failover
- binary missing / invalid cwd / missing adapter throws setup error and does not fail over
- unclassified non-zero exit does not fail over under `safe-only`
- adapter-classified recoverable error does fail over under `safe-only`
- `--no-failover` / `off` runs only one attempt
- `always` preserves legacy multi-attempt behavior
- user interrupt stops immediately and never fails over
- `lastIndex` is persisted only on success
- exhaustion summary contains model-by-model classification data

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Adapter classification is too broad | terminal task failures may still churn across the pool | keep recoverable reasons narrowly scoped |
| Adapter classification is too narrow | recoverable failures may stop early | start conservative and expand from real failure samples |
| Result shape changes ripple upward | callers may assume `undefined` success | stage the change carefully or preserve a compatibility wrapper |
| Timeout semantics are unclear | task runtime timeout may be mistaken for startup failure | only classify `lb`-owned startup timeout as recoverable |

## Recommendation

Adopt the conservative design:

- default failover policy: `safe-only`
- explicit opt-out: `off`
- explicit compatibility mode: `always`
- tool-aware failure classification lives in adapters
- unknown failures are terminal by default

This directly addresses both key concerns:

1. users gain a first-class way to disable retry/failover
2. `lb` stops pretending every failure is recoverable and only switches when it has an explicit reason to do so
