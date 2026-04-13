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

`obsidian-llm` v0.9.2 — desktop-only Obsidian community plugin "AI Chat Integration".
Sidebar chat that talks to Claude / Gemini / Codex / OpenCode CLIs and to local LLM servers
(Ollama / OpenAI-compatible). Three executors split by transport: `LLMExecutor` (CLI
subprocess + stream-json), `AcpExecutor` (persistent ACP stdio session), `LocalLLMExecutor`
(raw Node `http`). MiniSearch RAG over the vault via `VaultSearch`. Single CJS bundle built
by esbuild.

What's working: all four CLI providers, ACP for claude/gemini/codex (OpenCode is CLI-only),
local server auto-detect + auto-start for Ollama and LM Studio, vault RAG, chat tabs,
cloud-sync-safe settings merge, `[[Link]]`-resolution in prompt, chat export as note,
AI follow-up chips, quick-action buttons with context detection, thinking blocks.

Recent changes:
- OpenCode streaming error events now surface immediately as `StreamChunk { type: "error" }` (vs. silently ignored until process exit)
- Pin-Note button: user can pin any vault note as persistent context for the conversation (`pinnedNote` state + `togglePinnedNote`)
- System-prompt quick-switcher: dropdown in header lets user switch system prompt per session without going into settings (`sessionSystemPromptFile` override)
- CSS: `overflow: hidden` on `.llm-chat-view` to fix input disappearing in vaults with sidebar plugins
- AI follow-up chips fixed (await main request before generating chips) (v0.9.2)
- Strong button feedback with pulse animation until response complete (v0.9.1)

## Routing Table

Load the relevant file based on the current task. Always load `context/architecture.md` first if not already in context this session.

| Task type | Load |
|-----------|------|
| Understanding how the system works | `context/architecture.md` |
| Working with a specific technology | `context/stack.md` |
| Writing or reviewing code | `context/conventions.md` |
| Making a design decision | `context/decisions.md` |
| Setting up or running the project | `context/setup.md` |
| Adding or changing a CLI provider | `patterns/add-cli-provider.md` |
| Adding ACP support to a provider | `patterns/add-acp-support.md` |
| Persisting plugin settings or sessions | `patterns/settings-persistence.md` |
| Spawning a CLI from the plugin | `patterns/spawn-cli-shellpath.md` |
| Debugging a hung / failed CLI call | `patterns/debug-cli-failure.md` |
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
