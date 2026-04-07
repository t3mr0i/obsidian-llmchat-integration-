---
name: agents
description: Always-loaded project anchor. Read this first. Contains project identity, non-negotiables, commands, and pointer to ROUTER.md for full context.
last_updated: 2026-04-07
---

# obsidian-llm — AI Chat Integration

Desktop-only Obsidian community plugin that adds a sidebar chat panel for Claude, Gemini,
Codex, OpenCode, and local LLM servers (Ollama / OpenAI-compatible). Authenticates by
shelling out to the user's installed CLIs — no bundled vendor SDKs, no API keys.

## Non-Negotiables

- **Never truncate user notes before sending to a model.** Use `VaultSearch` (MiniSearch
  RAG) in `src/utils/vaultSearch.ts` to retrieve relevant chunks instead.
- **Never overwrite `data.json` directly.** All persistence goes through
  `LLMPlugin.saveSettings` / `saveChatSessions`, which call `mergeBeforeSave` to stay safe
  against Obsidian Sync from another device.
- **Every `child_process.spawn` must use `getShellEnv()` from `src/utils/shellPath.ts`.**
  GUI Obsidian on macOS does not inherit the user's shell PATH; without this, CLIs can't
  be found.
- **`shell: false` and array-form arguments only.** Never interpolate user input into a
  shell string.
- **Local LLM HTTP uses raw Node `http`, not `fetch`.** And every URL passes through
  `normalizeUrl` to rewrite `localhost` → `127.0.0.1`.
- **OpenCode does not get ACP-stdio support** — its ACP transport is HTTP. Enforced by
  `ACP_SUPPORTED_PROVIDERS` in `src/types.ts` and a load-time migration in `main.ts`.
- **Desktop only.** `manifest.json` has `isDesktopOnly: true` — do not add code that breaks
  this assumption.
- **Single CJS bundle.** Output is `main.js` only. Obsidian's plugin loader requires CJS.
- **Strict null checks on.** `tsconfig.json` has `strictNullChecks: true` and
  `noImplicitAny: true`.

## Commands

- Dev (watch + auto-deploy): `npm run dev`
- Build (typecheck + production esbuild + deploy): `npm run build`
- E2E (full): `npm run test:e2e`
- E2E (fast — plugin smoke only): `npm run test:e2e:fast`
- E2E filtered: `npm run test:e2e:claude` / `:gemini` / `:providers` / `:files`
- WDIO direct (no rebuild): `npm run wdio`

Configure `npm run dev` deploy targets via `OBSIDIAN_PLUGIN_DIRS` env var or
`deploy-targets.json` at the repo root — see `esbuild.config.mjs:49`.

## Keeping Context Current
After every task: create a pattern if none exists for this task type. Update any context file that is now out of date. See step 5 of the Task Protocol in `ROUTER.md`.

## Navigation
Read `ROUTER.md` at the start of every session before doing anything else.

<!-- cai:start -->
` / `
<!-- cai:end -->
