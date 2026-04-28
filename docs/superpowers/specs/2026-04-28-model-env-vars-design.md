# Model Profile Env Vars — Design

**Date:** 2026-04-28
**Status:** Draft (awaiting review)

## Problem

Model profiles currently expose a fixed set of top-level fields (`name`, `tool`, `model`, `apiKey`, `apiBaseUrl`, `proxy`). Some tool-specific knobs — e.g. `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (Claude Code defaults to 200k context, but DeepSeek-V4-Pro supports 1M) — live only as environment variables for the underlying CLI. Adding one dedicated field per such knob does not scale:

- Each new knob requires a schema change, a form-field change, and help-text changes.
- The edit form grows unbounded and gets visually cluttered.
- Different adapters need different knobs; a flat schema cannot express that cleanly.

## Goals

- Let users attach arbitrary environment variables to a single model profile.
- Keep the terminal UX discoverable for common knobs (per-adapter preset list) and flexible for uncommon ones (custom KEY/VALUE).
- Avoid new UI primitives; reuse existing `selector.mjs` (Selector / ConfirmDialog / InputForm).
- Keep the default adapter interface backward-compatible: adapters that do not opt in keep working.

## Non-Goals

- Batch `$EDITOR`-based dotenv editing.
- Value validation (numeric range, enum membership) beyond key-name syntax.
- `.env` file import/export.
- Global env vars applied to every profile (would introduce a precedence hierarchy we do not need today).
- Secret masking for env values (the user opted for plaintext display to stay consistent with current `apiKey` handling only being truncated, not masked).

## Data Model

`~/.config/claude-code-fleet/models.json` — each model entry gains one optional field:

```json
{
  "name": "ds-v4-pro",
  "tool": "claude",
  "model": "deepseek-v4-pro",
  "apiKey": "sk-...",
  "apiBaseUrl": "https://api.deepseek.com",
  "env": {
    "CLAUDE_CODE_MAX_CONTEXT_TOKENS": "1000000"
  }
}
```

- `env` is `Record<string, string>`; omitted/empty map behaves identically to no field.
- Values are always strings; callers are responsible for stringifying numbers.
- Keys must match `^[A-Z_][A-Z0-9_]*$`.
- Existing profiles without `env` keep working unchanged (read as `{}`).

### Conflict rule

When an env key coincides with a knob already expressed by a top-level field (e.g. `ANTHROPIC_BASE_URL` vs. `apiBaseUrl`), **the `env` map wins**. Rationale: explicit user input should override defaults. Implementation: top-level fields are written first into the adapter's env construction, then `entry.env` is merged on top.

## Adapter Integration

### Base class change

`src/adapters/base.js` gains two defaults:

```js
applyUserEnv(entry, env) {
  if (entry.env) Object.assign(env, entry.env);
  return env;
}

get commonEnvVars() {
  return [];
}
```

`commonEnvVars` returns `[{ key, hint }]` describing the preset list shown in the Add flow.

### Per-adapter wiring

- **codex / copilot** — call `this.applyUserEnv(entry, env)` at the end of `buildEnv()`. Env goes straight into the child process environment.
- **claude** — special because Claude Code env vars are passed via `--settings '{"env":{...}}'` in `buildArgs()`, not through the process env. Fix:
  - In `buildArgs()`, merge `entry.env` into `settingsEnv` **after** the existing top-level merges, so env-map values override.
  - Also call `applyUserEnv` in `buildEnv()` for completeness (belt-and-suspenders; any env var Claude reads from the real process env still works).

### Preset examples (initial)

- **claude**: `CLAUDE_CODE_MAX_CONTEXT_TOKENS` ("Context token limit, default 200000"), `ANTHROPIC_LOG` ("debug | info | warn").
- **codex / copilot**: start with `[]`; add presets when real requests arrive.

## CLI Surface

Commands are grouped under `fleet model env`, parallel to existing `fleet model add/edit/delete/list`:

| Command | Behavior |
|---|---|
| `fleet model env <name>` | Interactive env management (defaults to list view). |
| `fleet model env <name> list` | Non-interactive print; for scripts. |
| `fleet model env <name> set <KEY> <VALUE>` | Non-interactive set; writes immediately. |
| `fleet model env <name> unset <KEY>` | Non-interactive delete; writes immediately. |

Unknown model name → stderr + exit 1, prints available models (same style as `cmdRun`).

## Terminal UX (Interactive)

All screens reuse `selector.mjs`. Selector gains two optional props — `onAdd` / `onDelete` — bound to `a` / `d` keys. Absent props mean the keys are inert, preserving backward compatibility. Help-line text adapts to which handlers are present.

### 1. Env vars list (Selector, extended)

```
⬢ Env vars for "ds-v4-pro"  (claude · deepseek-v4-pro)
↑↓ navigate · enter edit · a add · d delete · q back

│ ❯ CLAUDE_CODE_MAX_CONTEXT_TOKENS
│     1000000
│
│   ANTHROPIC_LOG
│     debug
```

Empty state:

```
⬢ Env vars for "ds-v4-pro"  (claude · deepseek-v4-pro)
a add · q back

│   (no env vars configured)
│   Press 'a' to add one.
```

### 2. Add — preset or custom (Selector)

```
⬢ Add env var to "ds-v4-pro"
↑↓ navigate · enter select · q cancel

│ ❯ CLAUDE_CODE_MAX_CONTEXT_TOKENS
│     Context token limit, default 200000
│
│   ANTHROPIC_LOG
│     debug | info | warn
│
│   + Custom...
│     Enter any KEY manually
```

Keys already present in `entry.env` are filtered out of the preset list. `+ Custom...` is always shown.

### 3a. Preset chosen → InputForm with a single Value field

```
⬢ Set CLAUDE_CODE_MAX_CONTEXT_TOKENS
  Value: ▎
         (Context token limit, default 200000)
```

Submit → return to list; entry is saved immediately.

### 3b. Custom chosen → InputForm with Key + Value

```
⬢ Add custom env var to "ds-v4-pro"
  Key:   ▎
         (e.g. DISABLE_TELEMETRY)
  Value:
```

Key validation (UPPER_SNAKE_CASE, non-empty, not already present) runs synchronously after submit; on failure re-open `renderInput` with an error placeholder. This avoids extending InputForm's validation API.

### 4. Edit value (InputForm)

Enter on a list row opens an InputForm with the key fixed in the title and only `Value` editable. Renaming a key is intentionally unsupported (remove + add instead) to keep the mental model simple.

### 5. Delete (ConfirmDialog, dangerMode)

```
⚠ Delete env var "CLAUDE_CODE_MAX_CONTEXT_TOKENS"?

│ CLAUDE_CODE_MAX_CONTEXT_TOKENS
│   1000000

y/enter confirm · n/esc cancel
```

### 6. Exit

`q` / Esc from the list returns to the shell. Summary line printed only if something was changed during the session: `Env vars for "<name>" updated (<n> set).` No summary when unchanged.

### Persistence semantics

Every add/edit/delete writes `models.json` immediately. Matches current `cmdModelEdit` behavior, avoids "unsaved changes" state, and survives crashes.

## Implementation Plan

Reference-only — will be refined by writing-plans.

### File-by-file changes

| File | Change | Est. lines |
|---|---|---|
| `src/components/selector.mjs` | Selector: `onAdd` / `onDelete` props, `a` / `d` keybindings, dynamic help text. | +20 |
| `src/adapters/base.js` | Default `applyUserEnv()` and `get commonEnvVars()`. | +8 |
| `src/adapters/claude.js` | Merge `entry.env` into `settingsEnv` in `buildArgs()`; call `applyUserEnv` in `buildEnv()`; implement `commonEnvVars`. | +15 |
| `src/adapters/codex.js` | Call `applyUserEnv` in `buildEnv()`; implement `commonEnvVars` (initially empty). | +5 |
| `src/adapters/copilot.js` | Same as codex. | +5 |
| `src/index.js` | `cmdModelEnv` router + sub-handlers; `parseArgs` recognizes `model env`; help text. | +120 |
| `tests/adapters/claude.test.js` | `entry.env` merge and top-level override tests. | +15 |
| `tests/adapters/codex.test.js`, `copilot.test.js` | Symmetrical `buildEnv` tests. | +15 |
| `tests/index/env.test.js` | `set` / `unset` / `list` / missing-model / invalid-key tests. | +60 |

Total: ~260 lines added.

### Function decomposition in `src/index.js`

```
cmdModelEnv(name, sub, rest)
  ├─ resolveModel(name)
  ├─ cmdModelEnvList(entry)
  ├─ cmdModelEnvSet(entry, k, v)
  ├─ cmdModelEnvUnset(entry, k)
  └─ cmdModelEnvInteractive(entry)
        ├─ renderEnvList(entry)
        ├─ renderEnvAdd(entry)
        └─ renderEnvEdit(entry, key)
```

Each ≤ 40 lines. Mirrors the `selectLoop` / `editLoop` style of the existing `cmdModelEdit`.

### Immutability

All updates use spread patterns per project coding style:

```js
const updated = { ...entry, env: { ...(entry.env || {}), [key]: value } };
const { [key]: _removed, ...rest } = entry.env || {};
const deleted = { ...entry, env: rest };
data = { ...data, models: data.models.map(m => m.name === entry.name ? updated : m) };
```

## Error Handling

| Scenario | Behavior |
|---|---|
| `fleet model env <missing>` | stderr + exit 1, prints available models. |
| `fleet model env <name> set` missing args | stderr + exit 1, prints usage line. |
| Invalid key syntax | Interactive: re-open form with error placeholder. Non-interactive: stderr + exit 1. |
| Duplicate key in custom add | Re-open form with error placeholder. |
| Corrupted `models.json` | Falls through `loadModels()`'s existing degrade path (`{ models: [] }`). |
| Ctrl+C in any screen | Existing Selector / InputForm cancel paths return null → print `Cancelled.` and exit. |

## Testing Strategy

Vitest, colocated under `tests/` mirroring `src/`:

- **Adapter unit tests** — `entry.env` merge into `buildArgs`/`buildEnv`; conflict-rule coverage (env overrides top-level).
- **CLI command tests** — `set`, `unset`, `list` in non-interactive mode; missing-model and invalid-key error paths; backward compat on profiles without `env`.
- **No E2E on interactive Ink screens** — consistent with current coverage of `cmdModelEdit`. Interactive handlers stay thin and delegate to the same helpers that unit tests cover.

Target: ≥ 80% line coverage on the new code (matches project standard).

## Backward Compatibility

- Profiles without `env` load and run unchanged.
- Existing `fleet model add` / `edit` forms do not gain env-related fields (deliberate — we want the dedicated command instead).
- No migration required.

## Docs

- `README.md` — append one row to the command table.
- `CLAUDE.md` — update the `models.json` snippet to show optional `env`.
- No new standalone docs.
