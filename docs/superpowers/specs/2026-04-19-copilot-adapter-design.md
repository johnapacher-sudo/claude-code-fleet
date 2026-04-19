# GitHub Copilot CLI Adapter Design

**Date**: 2026-04-19
**Status**: Approved
**Scope**: Observer Mode + Model Profile Mode (full integration)

## Overview

Add support for GitHub Copilot CLI (`@github/copilot`) to claude-code-fleet as a third tool adapter, following the existing adapter + registry pattern. Copilot CLI is GitHub's official code agent CLI, similar to Claude Code, installed via `npm install -g @github/copilot`.

## Approach

Minimal adapter approach — only add `src/adapters/copilot.js` and make minimal registration/infrastructure changes. Follow existing patterns exactly.

## Adapter Properties

| Property | Value |
|----------|-------|
| `name` | `'copilot'` |
| `displayName` | `'GitHub Copilot'` |
| `binary` | `'copilot'` |
| `hookEvents` | `['SessionStart', 'PostToolUse', 'Stop']` |

## Hook Event Mapping

| Fleet Internal | Copilot Config Key | Copilot Payload Type |
|----------------|-------------------|---------------------|
| `SessionStart` | `sessionStart` | `sessionStart` |
| `PostToolUse` | `postToolUse` | `postToolUse` |
| `Stop` | `sessionEnd` | `sessionEnd` |

Copilot uses camelCase event names in config and payloads. The `sessionEnd` event fires when a session stops, with a `reason` field (`complete`, `error`, `abort`, `timeout`, `user_exit`).

## buildArgs / buildEnv

### buildArgs(entry)
```
['--allow-all']
```
No `--model` CLI flag exists for Copilot. Model selection is handled via environment variable.

### buildEnv(entry, baseEnv)
```js
{
  ...baseEnv,
  COPILOT_MODEL: entry.model,           // if model specified in profile
  COPILOT_GITHUB_TOKEN: entry.apiKey,   // if GitHub PAT provided (optional)
}
```

### Authentication
Copilot CLI supports two authentication paths:

| Mode | apiKey in profile | What happens |
|------|------------------|--------------|
| **GitHub PAT** | Fine-grained PAT with "Copilot Requests" permission | `buildEnv()` injects `COPILOT_GITHUB_TOKEN` |
| **Already logged in** | Empty | Uses keychain OAuth from `copilot login` |

The `apiKey` field in the model profile maps to `COPILOT_GITHUB_TOKEN` — the highest-precedence auth method for Copilot CLI. This enables multi-account support: different profiles with different GitHub tokens can run simultaneously.

`cmdModelAdd()` makes apiKey optional for copilot (user may already be logged in via OAuth). The placeholder text guides users to create a Fine-grained PAT with "Copilot Requests" permission.

## Hook Installation

**Target**: Per-repo `<repo>/.github/hooks/fleet.json` — Copilot CLI loads hooks from `.github/hooks/*.json` in the working directory. There is no global hooks support (see [github/copilot-cli#1067](https://github.com/github/copilot-cli/issues/1067)).

### installHooks(hookClientPath, cwd)
1. Create `<cwd>/.github/hooks/` directory if missing
2. Write `<cwd>/.github/hooks/fleet.json`:
   ```json
   {
     "version": 1,
     "hooks": {
       "sessionStart": [{
         "type": "command",
         "bash": "node \"/path/to/hook-client.js\" --tool copilot"
       }],
       "postToolUse": [{
         "type": "command",
         "bash": "node \"/path/to/hook-client.js\" --tool copilot"
       }],
       "sessionEnd": [{
         "type": "command",
         "bash": "node \"/path/to/hook-client.js\" --tool copilot"
       }]
     }
   }
   ```
   Hook entry format: `{ type: "command", bash: "<command>" }`. Events must be nested under a `"hooks"` key. Top-level `"version": 1` is required by Copilot CLI.
3. Atomic write via tmp file + rename

### removeHooks(cwd)
1. Read `<cwd>/.github/hooks/fleet.json`
2. Verify it contains fleet hooks (bash field includes `claude-code-fleet`)
3. Delete the file if it's fleet-managed

### Hook installation timing
- **`fleet run`**: Installs hooks in `workDir` before spawning Copilot process
- **`fleet hooks install --tools copilot`**: Installs hooks in `process.cwd()` (user must run in target repo)
- **`fleet start`** (observer): Skips Copilot hook installation — no CWD context. Users must install per-repo or use `fleet run`.

### isHookInstalled(cwd)
Check if `<cwd>/.github/hooks/fleet.json` exists and contains fleet hooks for all three events.

## normalizePayload(rawInput)

Handles Copilot CLI payload format:

```js
normalizePayload(rawInput) {
  // Event mapping: sessionStart → SessionStart, sessionEnd → Stop
  const toolName = rawInput.toolName;                          // Copilot uses camelCase
  const toolInput = JSON.parse(rawInput.toolArgs);             // toolArgs is JSON string
  const toolOutput = rawInput.toolResult?.textResultForLlm;    // structured result
  const reason = rawInput.reason;                              // sessionEnd reason
  return {
    event,
    session_id: rawInput.sessionId,
    cwd: rawInput.cwd,
    timestamp: rawInput.timestamp || Date.now(),
    tool_name: toolName,
    tool_input: toolInput,
    tool_output: toolOutput,
    message: reason,
    ...
  };
}
```

Key differences from Claude/Codex payloads:
- `toolArgs` is a JSON string (not an object) — must parse
- `toolResult` is structured with `resultType` and `textResultForLlm` fields
- `sessionEnd` has `reason` field: `complete`, `error`, `abort`, `timeout`, `user_exit`
- `sessionId` (camelCase) — Copilot uses camelCase consistently

## summarizeToolUse(toolName, toolInput)

Provides human-readable summaries for Observer Mode UI. Copilot uses a tool set similar to Claude (Read, Edit, Write, Bash, Grep, Glob, etc.). Summary logic follows the same pattern as ClaudeAdapter.

## File Changes Summary

### New Files
| File | Description |
|------|-------------|
| `src/adapters/copilot.js` | CopilotAdapter class — full implementation |

### Modified Files
| File | Change |
|------|--------|
| `src/adapters/index.js` | Register `CopilotAdapter` at module load |
| `src/master.js` | Add `'copilot.js'` to `ADAPTER_FILES` array; skip Copilot in `ensureHooks()` and `removeHooks()` (per-repo only) |
| `src/index.js` | `cmdModelAdd()` / `cmdModelEdit()` — copilot-specific required fields; `cmdRun()` — install per-repo hooks before spawning; `cmdHooksInstall/Status/Remove` — CWD-aware for Copilot |
| `src/components/worker-card.mjs` | Add `copilot: 'blue'` to `TOOL_COLORS` |

### Unchanged Files
| File | Reason |
|------|--------|
| `src/hook-client.js` | Already loads adapters dynamically via `--tool` arg |
| `src/adapters/base.js` | Base class contract unchanged |
| `src/adapters/registry.js` | Registry API unchanged |
| `src/adapters/claude.js` | No changes to existing adapters |
| `src/adapters/codex.js` | No changes to existing adapters |

## Out of Scope
- Global hook installation (`~/.copilot/config.json`) — Copilot CLI does not support global hooks
- `preToolUse` event interception — Fleet doesn't intercept tool calls
- `notification` / `errorOccurred` / `permissionRequest` events — not needed for Observer Mode
- Generic hook framework abstraction — YAGNI with only 3 adapters
