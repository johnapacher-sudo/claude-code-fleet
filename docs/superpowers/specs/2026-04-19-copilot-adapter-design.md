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
| `SessionStart` | `sessionStart` | `sessionStart` / `SessionStart` |
| `PostToolUse` | `postToolUse` | `postToolUse` / `PostToolUse` |
| `Stop` | `agentStop` | `agentStop` / `AgentStop` |

Copilot supports two payload formats: camelCase and VS Code compatible (PascalCase). Fleet normalizes both in `normalizePayload()`.

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
  COPILOT_MODEL: entry.model,  // if model specified in profile
}
```

### Authentication
Copilot uses GitHub OAuth — no API key injection needed. `cmdModelAdd()` skips the apiKey prompt for `copilot` tool type.

## Hook Installation

**Target**: Global `~/.copilot/config.json` → `hooks` field.

### installHooks(hookClientPath)
1. Read `~/.copilot/config.json` (create empty object if missing)
2. For each mapped event, inject a hook entry:
   ```json
   {
     "hooks": {
       "sessionStart": [{
         "command": "node \"/path/to/hook-client.js\" --tool copilot --event SessionStart",
         "type": "command"
       }],
       "postToolUse": [{
         "command": "node \"/path/to/hook-client.js\" --tool copilot --event PostToolUse",
         "type": "command"
       }],
       "agentStop": [{
         "command": "node \"/path/to/hook-client.js\" --tool copilot --event Stop",
         "type": "command"
       }]
     }
   }
   ```
3. Atomic write via tmp file + rename (consistent with claude.js pattern)

### removeHooks()
1. Read `~/.copilot/config.json`
2. Remove hook entries where command contains `--tool copilot`
3. If hooks object is empty, delete the hooks field entirely
4. Atomic write updated config

## normalizePayload(rawInput)

Handles both camelCase and VS Code compatible payload formats:

```js
normalizePayload(rawInput) {
  const data = JSON.parse(rawInput);
  return {
    event: this._mapEvent(data.type),
    toolName: data.toolName || data.tool_name,
    input: data.input || data.tool_input || {},
    output: data.output || data.tool_output || '',
    sessionId: data.session_id || data.sessionId,
    timestamp: data.timestamp || Date.now(),
  };
}
```

Event mapping covers both formats:
- `sessionStart` / `SessionStart` → `SessionStart`
- `postToolUse` / `PostToolUse` → `PostToolUse`
- `agentStop` / `AgentStop` → `Stop`

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
| `src/master.js` | Add `'copilot.js'` to `ADAPTER_FILES` array |
| `src/components/worker-card.mjs` | Add `copilot: 'blue'` to `TOOL_COLORS` |
| `src/index.js` | `cmdModelAdd()` skip apiKey prompt for `copilot` tool |

### Unchanged Files
| File | Reason |
|------|--------|
| `src/hook-client.js` | Already loads adapters dynamically via `--tool` arg |
| `src/adapters/base.js` | Base class contract unchanged |
| `src/adapters/registry.js` | Registry API unchanged |
| `src/adapters/claude.js` | No changes to existing adapters |
| `src/adapters/codex.js` | No changes to existing adapters |

## Out of Scope
- Per-repo hook installation (`.github/hooks/*.json`) — can be added later
- `preToolUse` event interception — Fleet doesn't intercept tool calls
- `notification` / `errorOccurred` / `permissionRequest` events — not needed for Observer Mode
- Generic hook framework abstraction — YAGNI with only 3 adapters
