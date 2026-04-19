# claude-code-fleet

Multi-tool AI coding process orchestrator. Run multiple Claude Code, GitHub Copilot CLI, and Codex CLI instances with different API keys, models, and endpoints in parallel. Real-time TUI observer dashboard. Extensible adapter architecture.

## Architecture

Three independent runtime contexts, one shared codebase:

1. **CLI** (`src/index.js`) — Short-lived command handler. Routes `fleet <command>` to model management, hook management, notification config, or spawns a tool process via `fleet run`.
2. **Observer** (`src/master.js` + `src/socket.js` + `src/tui.js`) — Long-lived daemon. Unix socket server receives normalized hook events, tracks worker state, renders TUI dashboard.
3. **Hook** (`src/hook-client.js`) — Ephemeral one-shot process. Runs inside each AI tool process via native hooks. Reads stdin JSON, normalizes via adapter, forwards over Unix socket, sends desktop notifications.

The **adapter pattern** (`src/adapters/`) is used in all three contexts: CLI uses `buildArgs()`/`buildEnv()` to spawn tools; Observer uses `summarizeToolUse()` for display; Hook uses `normalizePayload()` to canonicalize events.

## Source Map

| File | Responsibility |
|------|---------------|
| `src/index.js` | CLI entry point, argument parser, all command implementations |
| `src/master.js` | Observer core: worker state tracking, event handling, session persistence |
| `src/socket.js` | Unix domain socket server (newline-delimited JSON protocol) |
| `src/tui.js` | Bridges Master to Ink/React rendering (100ms debounced) |
| `src/hook-client.js` | Hook script running inside tool processes (stdin → normalize → socket → notify) |
| `src/notifier.js` | Desktop notification sender (macOS/Linux/Windows) |
| `src/adapters/base.js` | `ToolAdapter` abstract class — defines required interface |
| `src/adapters/claude.js` | Claude Code adapter |
| `src/adapters/codex.js` | Codex CLI adapter |
| `src/adapters/copilot.js` | GitHub Copilot CLI adapter |
| `src/adapters/registry.js` | `Map<name, adapter>` with `register`, `get`, `all`, `installed`, `detect` |
| `src/adapters/index.js` | Auto-registers all adapters into the registry at load time |
| `src/components/app.mjs` | Root Ink/React component, keyboard handling, worker list rendering |
| `src/components/worker-card.mjs` | Per-worker card: status icon, tool tag, project, model, actions |
| `src/components/header.mjs` | Dashboard header with worker counts |
| `src/components/footer.mjs` | Keyboard shortcut hints |
| `src/components/selector.mjs` | Reusable interactive UI: selector, confirm dialog, input form |
| `src/components/terminal-focus.mjs` | macOS terminal window focus via AppleScript |
| `src/components/colors.mjs` | Shared color palette (17 named hex colors) |

## Key Data Flow

```
AI Tool → fires hook → hook-client.js (stdin JSON)
  → adapter.normalizePayload() → canonical event
  → net.connect(fleet.sock) → SocketServer
  → Master.handleEvent() → update worker state
  → TUI.scheduleRender() (100ms debounce)
  → React setTick() → Ink re-render
```

## Adapter Pattern

`ToolAdapter` (base.js) requires:

- **Getters:** `name`, `displayName`, `binary`, `hookEvents`
- **Methods:** `buildArgs(entry)`, `buildEnv(entry, baseEnv)`, `installHooks(hookClientPath)`, `removeHooks()`, `normalizePayload(rawInput)`
- **Optional:** `summarizeToolUse(toolName, toolInput)` — default returns raw tool name
- **Concrete:** `isInstalled()` — runs `which <binary>`
- **Optional:** `isHookInstalled()` — checks tool config for fleet hooks

New adapters are registered in `src/adapters/index.js` and auto-loaded by the hook client via `require('./adapters/<name>')`.

Hook config locations:
- Claude: `~/.claude/settings.json`
- Codex: `~/.codex/hooks.json` + `~/.codex/config.toml`
- Copilot: `~/.copilot/config.json`

## Configuration & State

All state stored under `~/.config/claude-code-fleet/`:

```
models.json        — [{ name, tool, model, apiKey, apiBaseUrl, proxy }]
fleet.sock         — Unix domain socket (transient, Observer mode)
hooks/             — Deployed hook-client.js, notifier.js, adapters/
notify.json        — { enabled, sound, events: { stop, notification } }
sessions/<id>.json — Per-session metadata for Observer recovery
```

## Coding Conventions

- **src/ files:** CommonJS (`require`/`module.exports`)
- **src/components/ files:** ESM (`.mjs`, `import`/`export`)
- **Tests:** Vitest (`vitest run`), colocated in `tests/` mirroring `src/` structure
- **React:** Ink v5, `React.createElement` (aliased as `h`), no JSX
- **Dependencies:** `ink`, `ink-spinner`, `react` (runtime); `vitest`, `rewire` (dev)
- **Node:** >= 18.0.0

## Common Tasks

- **Add a new adapter** → See `docs/adapter-guide.md`
- **Modify the TUI** → Edit files in `src/components/`. App state lives in `app.mjs` via React hooks. Master data accessed through the `master` prop.
- **Add a new hook event** → Add event name to adapter's `hookEvents` getter, update `normalizePayload()`, update `Master.handleEvent()`, update TUI display if needed.
- **Change the socket protocol** → See `docs/protocol.md` for the newline-delimited JSON spec.
- **Change CLI commands** → Edit `src/index.js` (both `parseArgs()` and `main()` router).
