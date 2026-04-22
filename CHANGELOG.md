# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-04-22

### Added

- **Load Balancer** — `fleet lb` command for distributing instructions across a pool of model profiles
- Round-robin selection strategy with automatic failover on failure
- `fleet lb add` — interactive pool creation
- `fleet lb list` — show pools with members and last-used model
- `fleet lb delete` — interactive pool deletion
- `fleet lb <pool> -- <args>` — execute instruction via pool with round-robin and failover

## [1.3.2] - 2026-04-22

### Added

- `--` passthrough separator in `fleet run` — forward extra arguments directly to the underlying tool (e.g. `fleet run --model opus-prod -- -p "hello"`)

## [1.3.1] - 2026-04-20

### Changed

- `fleet start` now launches a tool session (alias for `fleet run`)
- Observer dashboard moved to `fleet observer` command (original `start` behavior)
- Updated help text, CLI reference, and README docs for new command layout

## [1.3.0] - 2026-04-19

### Added

- **GitHub Copilot CLI Adapter** — Full adapter support for `copilot` as a third tool alongside Claude Code and Codex CLI
- CopilotAdapter: identity, `buildArgs`, `buildEnv` with model profile mapping and tests
- CopilotAdapter: hook operations (`installHooks`, `removeHooks`, `isHookInstalled`) writing `~/.copilot/config.json`
- CopilotAdapter: `normalizePayload` and `summarizeToolUse` for event canonicalization
- Copilot tool color (GitHub blue) in TUI worker cards
- CopilotAdapter registered in adapter index and included in master hook deployment
- CLI support for `copilot` model profiles — help text and profile creation
- Auto-migrate existing model profiles to include `tool` field

### Fixed

- Use normalized payload fields in hook-client for cross-tool compatibility
- Show tool tag for all profiles including Claude

## [1.2.0] - 2026-04-16

### Added

- **Multi-Tool Support** — Adapter pattern for Claude Code + Codex CLI; extensible for future tools
- Adapter layer: `ToolAdapter` base class, `ClaudeAdapter`, `CodexAdapter`, adapter registry
- `fleet model add [claude|codex]` — tool-aware model profile creation with tool-specific placeholders
- `fleet hooks install --tools <names>` — selective hook installation per tool
- `fleet hooks status` — per-tool hook installation status display
- Codex CLI hooks: writes `~/.codex/hooks.json` and enables `codex_hooks` feature flag in `config.toml`
- TUI worker cards show `[Codex]` label with color coding for non-Claude tools
- Input form cursor navigation (←/→, Ctrl+A/E) with visible cursor position indicator

### Changed

- `fleet run` selection list shows tool type tags (`[Claude]`, `[Codex]`)
- `fleet hooks install/remove` now operates on all detected tools instead of Claude only
- Hook payloads include `_tool` field for tool identification
- Session files include `tool` field for persistence across restarts
- Notification titles use `adapter.displayName` instead of hardcoded "Claude Code"
- `checkDeps()` replaced by `checkToolDeps(toolName)` — only checks the required tool binary

### Fixed

- Input form paste only showing last character (React stale closure in `useInput`)
- Backspace not working in Cursor terminal (`key.delete` / `key.backspace` mapping)
- Backspace leaving ghost content (stale cursor position from separate state objects)
- Codex `apiBaseUrl` now passed via `-c openai_base_url=...` flag instead of env var

### Removed

- **Fleet Mode** — Background multi-instance management (`fleet up/down/restart/ls/status/init`)
- Fleet state tracking (`loadState`, `saveState`, `cleanupState`, `fleet-state.json`)
- Config file search/validation (`configSearchPaths`, `loadConfig`, `validateConfig`)
- `fleet.config.example.json`

## [1.1.2] - 2026-04-15

### Added

- Desktop notification system with `fleet notify` CLI command
- Notifier module with cross-platform support (macOS, Linux, Windows)
- Configurable notification sound (`--sound` / `--no-sound`)
- `--version` / `-v` flag to display package version
- Show project directory and message summary in notifications

### Changed

- Simplified notification architecture — removed terminal-notifier dependency and click-to-focus logic

### Fixed

- File copying moved into `ensureHooks` for `fleet hooks install`
- Activity file naming correction

## [1.1.1] - 2026-04-13

### Added

- HTTP proxy support for model profiles and fleet instances
- Per-profile or per-run proxy with `--proxy [url]` flag
- Auto-sets `HTTP_PROXY` and `HTTPS_PROXY` environment variables

## [1.1.0] - 2026-04-07

### Added

- Observer Mode — Real-time TUI dashboard that auto-discovers Claude Code processes
- Terminal Focus — Jump to any worker's terminal window/tab (iTerm, Terminal.app, VSCode, Cursor, Warp, WezTerm)
- Session Persistence — Workers survive master restarts with disk-persisted state
- Thinking status indicator with spinner (activity within last 90 seconds)
- Last 3 actions display on worker card when idle
- Ink-based TUI components (header, worker-card, footer, selector, confirm, input form)
- Ink card-style selector replacing ANSI selector
- Terminal metadata collection on SessionStart (terminal program, iTerm session ID)
- AppleScript-based terminal focus strategies per terminal emulator

### Changed

- Architecture rewritten from master-worker to pure observer model
- Socket simplified to receive-only for observer mode
- Hook-client rewritten as async fire-and-forget observer
- TUI rewritten with Ink (React for terminal) and debounced rendering
- Data model changed from rounds to turns

### Fixed

- Correct Claude Code hooks format (matcher + hooks array)
- Null guards and error handling to prevent master crashes
- Worker online status indicator logic
- macOS permission denial detection with actionable error messages
- Terminal.app TTY device matching for tab focus
- Render race condition on TUI startup

## [1.0.1] - 2026-04-03

### Added

- Default `fleet` command runs Claude Code instead of showing help

## [1.0.0] - 2026-04-03

### Added

- Initial release
- PID-based process management for multiple Claude Code instances
- Model profiles with named configurations (API key, model ID, endpoint)
- Fleet config file for defining multiple instances
- `fleet up/down/restart/ls/status` lifecycle management
- Interactive CLI with arrow-key selector
- Auto-publish to npm via GitHub Actions

[1.4.0]: https://github.com/johnapacher-sudo/claude-code-fleet/compare/v1.3.2...v1.4.0
[1.3.2]: https://github.com/johnapacher-sudo/claude-code-fleet/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/johnapacher-sudo/claude-code-fleet/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/johnapacher-sudo/claude-code-fleet/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/johnapacher-sudo/claude-code-fleet/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/johnapacher-sudo/claude-code-fleet/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/johnapacher-sudo/claude-code-fleet/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/johnapacher-sudo/claude-code-fleet/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/johnapacher-sudo/claude-code-fleet/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/johnapacher-sudo/claude-code-fleet/releases/tag/v1.0.0
