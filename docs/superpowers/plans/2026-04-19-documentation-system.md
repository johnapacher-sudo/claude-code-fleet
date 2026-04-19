# Documentation System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a hybrid documentation system (CLAUDE.md + docs/) that gives AI coding tools instant project context for efficient code modification, understanding, and feature extension.

**Architecture:** A concise CLAUDE.md as the auto-loaded entry point (~120 lines) plus 5 structured docs/ reference files. CLAUDE.md summarizes the whole project; docs/ files provide depth for specific subsystems.

**Tech Stack:** Markdown only, no tooling dependencies.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `CLAUDE.md` | AI auto-loaded project context entry point |
| Create | `docs/architecture.md` | In-depth architecture reference |
| Create | `docs/adapter-guide.md` | How to add a new tool adapter |
| Create | `docs/protocol.md` | Hook events, socket protocol, config schemas |
| Create | `docs/tui-components.md` | TUI component tree and interaction |
| Create | `docs/cli-reference.md` | Complete CLI command reference |

---

### Task 1: Create CLAUDE.md

- [ ] Write CLAUDE.md with all 8 sections (Project Summary, Architecture, Source Map, Data Flow, Adapter Pattern, Configuration, Conventions, Common Tasks)
- [ ] Verify line count ~100-120
- [ ] Commit

### Task 2: Create docs/architecture.md

- [ ] Write architecture.md covering three runtime contexts, module deps, data flow, worker state machine, session persistence
- [ ] Commit

### Task 3: Create docs/adapter-guide.md

- [ ] Write adapter-guide.md with ToolAdapter interface, adapter comparison, step-by-step guide, canonical payload spec
- [ ] Commit

### Task 4: Create docs/protocol.md

- [ ] Write protocol.md with hook event types, canonical payload, tool-specific inputs, socket protocol, config schemas
- [ ] Commit

### Task 5: Create docs/tui-components.md

- [ ] Write tui-components.md with component tree, state management, keyboard handling, WorkerCard, selector, terminal focus, colors
- [ ] Commit

### Task 6: Create docs/cli-reference.md

- [ ] Write cli-reference.md with all commands, flags, examples, model profile system, interactive UI
- [ ] Commit

### Task 7: Final review

- [ ] Verify all 6 files exist with correct content
- [ ] Check cross-references are consistent
- [ ] Final commit if needed
