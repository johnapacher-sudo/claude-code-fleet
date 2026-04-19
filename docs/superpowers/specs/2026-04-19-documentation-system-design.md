# Documentation System Design

**Date:** 2026-04-19
**Status:** Draft

## Goal

Build a documentation system that gives AI coding tools (primarily Claude Code) instant project context, enabling efficient code modification, understanding, and feature extension. Secondary audience: human developers.

## Approach

Hybrid documentation: a concise CLAUDE.md as the auto-loaded entry point, plus structured docs/ for in-depth reference.

## File Plan

### 1. CLAUDE.md (~150-200 lines)

Auto-loaded by Claude Code at every conversation start. Contains everything an AI needs to understand the project in a single scan.

Sections:

1. **Project Summary** — One-paragraph description of what claude-code-fleet does
2. **Architecture Overview** — Three runtime contexts (CLI, Observer, Hook) and the adapter pattern
3. **Source Map** — Table of every `src/` file with one-line responsibility
4. **Key Data Flow** — Hook Event → hook-client → Unix Socket → Master → TUI pipeline
5. **Adapter Pattern** — Abstract interface, registration, dual-runtime usage (CLI/Observer vs Hook)
6. **Configuration & State** — models.json schema, notify.json schema, hooks directory layout
7. **Coding Conventions** — CommonJS (src/) vs ESM (components/), test framework, import paths
8. **Common Tasks** — Pointers to detailed docs for: adding adapters, modifying TUI, adding hook events

### 2. docs/architecture.md (~100-150 lines)

In-depth architecture reference.

- Three runtime contexts with lifecycle and responsibility details
- Module dependency graph (textual)
- Complete hook event data flow (step by step)
- Worker state machine (active → thinking → idle → offline)
- Session persistence and recovery mechanism

### 3. docs/adapter-guide.md (~80-120 lines)

How to add a new tool adapter.

- ToolAdapter abstract interface checklist (required getters and methods)
- Implementation differences between existing adapters (Claude, Codex, Copilot)
- Step-by-step guide to add a new adapter
- Test template and naming conventions

### 4. docs/protocol.md (~80-120 lines)

Interface and protocol specifications.

- Hook event payload format (canonical fields)
- Unix socket protocol (newline-delimited JSON)
- Tool-specific payload formats and normalization rules
- Configuration file schemas (models.json, notify.json, tool config locations)
- Hook event types and when they fire

### 5. docs/tui-components.md (~60-100 lines)

TUI component architecture.

- Component tree and hierarchy
- Props and state management pattern
- Keyboard interaction handling
- Worker status derivation logic
- Color system and theming

### 6. docs/cli-reference.md (~80-120 lines)

Complete CLI command reference.

- All commands with descriptions, aliases, and examples
- Global flags
- Interactive UI components used by each command
- Model profile system operations

## Design Principles

1. **CLAUDE.md is the source of truth for quick context** — AI should be able to work effectively after reading just CLAUDE.md
2. **docs/ files are for depth** — consulted when modifying specific subsystems
3. **No duplication** — CLAUDE.md summarizes; docs/ files elaborate. Facts live in one place.
4. **Factual over tutorial** — Reference-style, not step-by-step tutorials. AI can infer steps from facts.
5. **Update-friendly** — Each file has a clear scope, so changes to one subsystem don't require touching all docs.

## Implementation Steps

1. Create CLAUDE.md with all 8 sections
2. Create docs/architecture.md
3. Create docs/adapter-guide.md
4. Create docs/protocol.md
5. Create docs/tui-components.md
6. Create docs/cli-reference.md
7. Review all docs for accuracy against current source code
8. Commit
