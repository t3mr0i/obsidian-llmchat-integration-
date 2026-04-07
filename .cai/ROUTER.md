---
name: router
description: Project navigation hub. Read at the start of every session. Contains current state, routing table, and task protocol.
edges:
  - target: context/architecture.md
    condition: when working on system design, integrations, or understanding how components connect
  - target: context/stack.md
    condition: when working with specific technologies, libraries, or making tech decisions
  - target: context/conventions.md
    condition: when writing new code, reviewing code, or unsure about project patterns
  - target: context/decisions.md
    condition: when making architectural choices or understanding why something is built a certain way
  - target: context/setup.md
    condition: when setting up the dev environment or running the project for the first time
  - target: patterns/INDEX.md
    condition: when starting a task — check the pattern index for a matching pattern file
last_updated: 2026-04-07
---

# Project Context

If you haven't already read `AGENTS.md`, read it now — it contains the project identity, non-negotiables, and commands.

Then read this file fully before doing anything else in this session.

## Current Project State

**obsidian-llm v0.3.0** — Obsidian desktop plugin (TypeScript + esbuild) that adds an in-editor chat panel against multiple LLM providers via user-installed CLIs (Claude, Gemini, Codex, OpenCode) and local HTTP servers (Ollama, LM Studio, vLLM, …). Persistent ACP sessions for stdio agents; one-shot CLI spawn for OpenCode; Node `http` for local servers (not `fetch`). Vault RAG via MiniSearch with heading-chunked, externally-stored content. Settings persist via `loadData`/`saveData` with merge-on-save for cloud sync. Tests are WebdriverIO E2E only — no unit tests.

Recent work (per git log): centralized provider display names, MiniSearch RAG integration, autocomplete for note refs, auto-detect for local providers, chat session save optimization.

## Routing Table

Load the relevant file based on the current task. Always load `context/architecture.md` first if not already in context this session.

| Task type | Load |
|-----------|------|
| Understanding how the system works | `context/architecture.md` |
| Working with a specific technology | `context/stack.md` |
| Writing or reviewing code | `context/conventions.md` |
| Making a design decision | `context/decisions.md` |
| Setting up or running the project | `context/setup.md` |
| Adding or modifying a provider | `patterns/add-provider.md`, then `context/architecture.md` |
| Adding to or debugging settings persistence | `patterns/settings-persistence.md` |
| Adding/changing local LLM HTTP behavior | `patterns/local-llm-http.md` |
| Adding a Vault RAG / search feature | `patterns/vault-rag.md` |
| Diagnosing CLI subprocess failures | `patterns/debug-cli-spawn.md` |
| Any specific task | Check `patterns/INDEX.md` for a matching pattern |

## Task Protocol

For every task, follow this loop:

1. **ORIENT** — Use `cai_search` first to find relevant facts before loading full files. If you need more detail, load with `mode: summary`, then `mode: full` only if necessary. Check `patterns/INDEX.md` for a matching pattern. If one exists, follow it. Note which files you loaded.
2. **EXECUTE** — Do the work. If a pattern exists, follow its Steps. If you are about to deviate from an established pattern, say so before writing any code — state the deviation and why.
3. **CHECK** — Load `context/conventions.md` and run the Verify Checklist item by item. State each item and whether the output passes. Do not summarise — enumerate explicitly.
4. **DIAGNOSE** — If verification fails or something breaks, check `patterns/INDEX.md` for a debug pattern. Follow it. Fix the issue and re-run CHECK.
5. **UPDATE** — After completing the task:
   - If no pattern exists for this task type, create one in `patterns/` using the format in `patterns/README.md`. Add it to `patterns/INDEX.md`.
   - If a pattern exists but you deviated from it or discovered a new gotcha, update it with what you learned.
   - If any `context/` file is now out of date because of this work, update it surgically — do not rewrite entire files.
   - Update the "Current Project State" section above if the work was significant.
