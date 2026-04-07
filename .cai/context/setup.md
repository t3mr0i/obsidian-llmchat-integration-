---
name: setup
description: Dev setup and commands for the Obsidian LLM Chat plugin — install, build, link into a vault, run E2E.
triggers:
  - "setup"
  - "install"
  - "getting started"
  - "build"
  - "dev mode"
  - "test"
  - "e2e"
  - "wdio"
edges:
  - target: stack.md
    condition: when specific technology versions or tooling details are needed
  - target: architecture.md
    condition: when understanding which file the build entry points to
  - target: decisions.md
    condition: when wondering why no unit tests / why E2E only
last_updated: 2026-04-07
---

# Setup

## Prerequisites

- **Node.js 20+** (`@types/node ^20.19.30`).
- **npm** (no other package manager configured).
- **Obsidian** desktop app (≥ `1.0.0`). Plugin is desktop-only (`isDesktopOnly: true`).
- **At least one provider** for actual use:
  - Cloud: install one of `claude` (`@anthropic-ai/claude-code`), `codex` (`@openai/codex`), `opencode`, `gemini` CLIs.
  - Local: Ollama, LM Studio, vLLM, llama.cpp, MLX, LocalAI, Jan, or text-generation-webui.

## First-time Setup

```bash
git clone https://github.com/t3mr0i/obsidian-llmchat-integration-.git
cd obsidian-llmchat-integration-
npm install
npm run build
```

Then link/copy the build artifacts into a test vault:

```
<your-vault>/.obsidian/plugins/obsidian-llm/
  main.js
  manifest.json
  styles.css
```

For active development, run `npm run dev` (esbuild watch mode) and either symlink the plugin folder or copy on save. Reload the plugin in Obsidian (Settings → Community Plugins → reload) after each rebuild.

## Environment Variables

There are no plugin-managed environment variables. Authentication for cloud providers is handled by the underlying CLIs (`claude`, `gemini`, `codex`, `opencode`) — configure them via their own setup commands.

`getShellEnv()` (`src/utils/shellPath.ts`) inherits the user's interactive shell `PATH` so spawned CLIs are findable when Obsidian is launched from Finder/Dock.

## Common Commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | esbuild watch — rebuilds `main.js` on change. No typecheck. |
| `npm run build` | `tsc -noEmit -skipLibCheck` then production esbuild bundle. Use before commit. |
| `npm run test:e2e` | Full E2E build + WebdriverIO run (`./wdio.conf.ts`). |
| `npm run test:e2e:fast` | E2E, only `test/specs/plugin.e2e.ts`. |
| `npm run test:e2e:claude` | E2E filtered by `@claude` mocha grep tag. |
| `npm run test:e2e:gemini` | E2E filtered by `@gemini` mocha grep tag. |
| `npm run test:e2e:providers` | E2E filtered by `@provider`. |
| `npm run test:e2e:files` | E2E filtered by `@files`. |
| `npm run wdio` | Raw `wdio run ./wdio.conf.ts` without rebuild. |

There is no `npm test`, no lint script, no format script. Typechecking happens only as part of `npm run build`.

## Common Issues

- **`spawn claude ENOENT` (or any other CLI):** Obsidian was launched with an empty `PATH` (typical when launched from Finder). `getShellEnv` should handle this — verify the CLI works in a terminal first, then check that the user's shell rc file actually exports the CLI's directory.
- **Local LLM connection refused / hangs:** make sure the URL uses `127.0.0.1`, not `localhost`. `LocalLLMExecutor.normalizeUrl` does this automatically; if you bypassed it somewhere, that is the bug.
- **Settings revert after enabling a provider:** likely a code path saved with `saveData(this.settings)` directly instead of going through `LLMPlugin.saveSettings()`. The merge step is what protects cloud-synced state — see `decisions.md`.
- **OpenCode ACP behaving oddly:** OpenCode ACP is intentionally disabled at load time (HTTP transport, not stdio). If you re-enabled it, expect failures.
- **MiniSearch eats RAM on a large vault:** confirm chunk content is in `chunkContent` Map, not in MiniSearch `storeFields`. Indexing is supposed to be batched via `requestIdleCallback`.
- **E2E never finds the ribbon icon:** check that `npm run build` actually produced a fresh `main.js` and that the test vault points at it. The first `before` block in `plugin.e2e.ts` waits 30s for the workspace; if that times out, the plugin failed to load — check the Obsidian dev console.
