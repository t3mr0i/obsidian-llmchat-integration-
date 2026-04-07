---
name: agents
description: Always-loaded project anchor for obsidian-llm. Project identity, non-negotiables, commands, and pointer to ROUTER.md.
last_updated: 2026-04-07
---

# obsidian-llm (AI Chat Integration)

## What This Is
Obsidian desktop plugin that adds an in-editor chat panel for multiple LLM providers — Claude, Codex, OpenCode, Gemini via user-installed CLIs, plus local models via Ollama / LM Studio / vLLM / etc. Single-bundle TypeScript + esbuild build. ACP (Agent Client Protocol) for persistent stdio sessions; spawn-per-request fallback; Node `http` for local servers.

## Non-Negotiables
- **Never truncate content sent to the LLM.** If a payload would be too large, route it through `VaultSearch` / RAG instead.
- **Never call `saveData(this.settings)` directly.** Use `LLMPlugin.saveSettings()` so `mergeBeforeSave()` preserves cloud-synced changes from other devices.
- **Never use `fetch()` for local LLM servers.** Use the Node `http` helper in `LocalLLMExecutor`. Always normalize `localhost` → `127.0.0.1`.
- **Always pass `getShellEnv()` env when spawning CLIs.** Obsidian launched from Finder has an empty `PATH`.
- **All shared types live in `src/types.ts`** — no per-file duplicates of `LLMProvider`, `PROVIDER_DISPLAY_NAMES`, etc.
- **Desktop only** — `manifest.json` must keep `isDesktopOnly: true`. Do not use mobile-incompatible APIs without acknowledging this.
- **OpenCode does not use ACP** — its ACP transport is HTTP, not stdio, and is force-disabled at load time. Do not re-enable.
- **Typecheck must pass before commit:** `npm run build` (runs `tsc -noEmit -skipLibCheck` then esbuild).

## Commands
- Dev (esbuild watch): `npm run dev`
- Build (typecheck + prod bundle): `npm run build`
- E2E (full): `npm run test:e2e`
- E2E (fast — plugin spec only): `npm run test:e2e:fast`
- E2E (filtered): `npm run test:e2e:claude` / `:gemini` / `:providers` / `:files`
- Raw wdio (no rebuild): `npm run wdio`

There is no `npm test`, no lint script, and no formatter script.

## Keeping Context Current
After every task: create a pattern if none exists for this task type. Update any context file that is now out of date. See step 5 of the Task Protocol in `ROUTER.md`.

## Navigation
Read `ROUTER.md` at the start of every session before doing anything else.

<!-- cai:start -->
` / `
<!-- cai:end -->
