---
name: agents
description: Always-loaded project anchor for obsidian-llm. Project identity, non-negotiables, key conventions, commands, navigation pointer. Survives context compaction.
last_updated: 2026-04-07
---

# obsidian-llm — AI Chat Integration

## What This Is
Desktop-only Obsidian community plugin that adds a sidebar chat against Claude / Gemini / Codex / OpenCode CLIs and local LLM servers (Ollama, OpenAI-compatible). Authenticates by shelling out to user-installed CLIs — no bundled vendor SDKs, no API keys held by the plugin.

## Non-Negotiables
- **Never truncate user notes before sending to a model.** Use `VaultSearch` (`src/utils/vaultSearch.ts`) MiniSearch RAG to retrieve relevant chunks instead.
- **Never write the plugin data file directly.** All persistence goes through `LLMPlugin.saveSettings` / `saveChatSessions`, which call `mergeBeforeSave` in `main.ts` to stay safe against Obsidian Sync from another device.
- **Every `child_process.spawn` must use `getShellEnv()` from `src/utils/shellPath.ts`** with `shell: false` and array-form args. GUI Obsidian on macOS does not inherit shell PATH, and shell-string interpolation is an injection risk.
- **Local LLM HTTP uses raw Node `http`, never `fetch`.** Every URL passes through `normalizeUrl` (`localhost` → `127.0.0.1`).
- **OpenCode does not get ACP-stdio support.** Its ACP transport is HTTP. Enforced by `ACP_SUPPORTED_PROVIDERS` in `src/types.ts` and a load-time migration in `main.ts`.
- **Desktop only.** `manifest.json` must keep `isDesktopOnly: true`.

## Key Conventions
- All shared types live in `src/types.ts` — never duplicate `LLMProvider`, `PROVIDER_DISPLAY_NAMES`, `PROVIDER_MODELS`, etc.
- One executor class per **transport**, not per provider. Provider differences live as switch statements inside `LLMExecutor` / `AcpExecutor` / `LocalLLMExecutor`.
- Single CJS bundle via esbuild. `obsidian`, `electron`, CodeMirror and Lezer packages are marked `external` in `esbuild.config.mjs`.
- Strict null checks on (`tsconfig.json` has `strictNullChecks: true`, `noImplicitAny: true`).

## Commands
- Dev (esbuild watch + auto-deploy): `npm run dev`
- Build (typecheck + production bundle + deploy): `npm run build`
- E2E full: `npm run test:e2e`
- E2E fast (smoke only): `npm run test:e2e:fast`
- E2E filtered: `npm run test:e2e:claude` / `:gemini` / `:providers` / `:files`
- WDIO direct (no rebuild): `npm run wdio`

Configure `npm run dev` deploy targets via `OBSIDIAN_PLUGIN_DIRS` env var or `deploy-targets.json` at the repo root — see `esbuild.config.mjs` `getDeployDirs`.

There is no `npm test`, no lint script, no formatter script.

## After Every Task
After completing any task: update `.cai/ROUTER.md` project state and any `.cai/` context files that are now out of date. If no pattern existed for this task type, create one in `.cai/patterns/`.

## Compact Instructions
Preserve across compaction: all Non-Negotiables, all Key Conventions, all Commands, and the navigation pointer to `.cai/ROUTER.md`.

## Navigation
Read `.cai/ROUTER.md` at the start of every session before doing anything else. Local CLAUDE.md files exist in `src/executor/` for danger-zone modules.
