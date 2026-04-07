---
name: setup
description: Dev environment setup, build, deploy-to-vault, and e2e test commands for obsidian-llm. Load when setting up the project for the first time or running it locally.
triggers:
  - "setup"
  - "install"
  - "build"
  - "dev"
  - "deploy"
  - "wdio"
  - "test"
  - "how do I run"
edges:
  - target: context/stack.md
    condition: when specific tool versions or library details are needed
  - target: context/architecture.md
    condition: when understanding which file the build is producing or where it lands
last_updated: 2026-04-07
---

# Setup

## Prerequisites

- **Node.js >= 20** (`@types/node ^20.19.30`).
- **npm** (the lockfile is `package-lock.json`).
- **Obsidian desktop** (>= 1.0.0). The plugin is desktop-only — `isDesktopOnly: true`.
- **An LLM provider on your machine.** At least one of:
  - `claude` CLI (`npm install -g @anthropic-ai/claude-code`)
  - `gemini` CLI
  - `codex` CLI (`npm install -g @openai/codex`)
  - `opencode` CLI
  - A local server: Ollama, LM Studio, MLX, vLLM, llama.cpp, etc. — auto-detected via
    `src/utils/autoDetect.ts`.
- **macOS users:** install CLIs into a location your shell PATH already knows about
  (homebrew or nvm). The plugin re-derives PATH via your login shell at startup
  (`src/utils/shellPath.ts`), so anything in `~/.zshrc` / `~/.bashrc` is fine.

## First-time Setup

```bash
git clone https://github.com/t3mr0i/obsidian-llmchat-integration-.git
cd obsidian-llmchat-integration-
npm install
```

To have `npm run dev` auto-deploy build artefacts into one or more vaults, create a
`deploy-targets.json` at the repo root:

```json
{
  "dirs": [
    "/Users/me/MyVault/.obsidian/plugins/obsidian-llm",
    "/Users/me/SecondVault/.obsidian/plugins/obsidian-llm"
  ]
}
```

Or set `OBSIDIAN_PLUGIN_DIRS` (colon-separated paths). See `esbuild.config.mjs:49`
(`getDeployDirs`) for the resolution logic. If neither is set, the build runs but does not
deploy — you can copy `main.js`, `manifest.json`, `styles.css` into the vault plugin folder
manually.

## Common Commands

| Command | What it does |
|---|---|
| `npm run dev` | esbuild watch + auto-deploy on each rebuild. Use this while developing. |
| `npm run build` | Type-check (`tsc -noEmit -skipLibCheck`) then production esbuild and deploy once. |
| `npm run test:e2e` | Build, then run the full WebdriverIO suite against a real Obsidian. |
| `npm run test:e2e:fast` | Build + run only `test/specs/plugin.e2e.ts`. |
| `npm run test:e2e:claude` | Run only mocha tests tagged `@claude`. |
| `npm run test:e2e:gemini` | Run only mocha tests tagged `@gemini`. |
| `npm run test:e2e:providers` | Run only `@provider`-tagged tests. |
| `npm run test:e2e:files` | Run only `@files`-tagged tests. |
| `npm run wdio` | Run WDIO directly without rebuilding. |

## Environment Variables

- `OBSIDIAN_PLUGIN_DIRS` — colon-separated list of plugin directories to auto-deploy build
  output into. Read in `esbuild.config.mjs`.
- `SHELL` — used by `src/utils/shellPath.ts` to pick the user's shell when resolving PATH.
  Defaults to `/bin/zsh`.

This plugin **does not** read provider API keys from env. Authentication is handled by
each user-installed CLI or local server.

## Common Issues

- **`Failed to spawn claude: ENOENT`** — the CLI is not on PATH from inside Obsidian. Make
  sure your shell rc file (`~/.zshrc` / `~/.bashrc`) puts the CLI directory on PATH; the
  plugin re-derives PATH from a login shell. Restart Obsidian to bust the
  `getShellPATH()` cache.
- **`Process was killed by SIGTERM` after exactly N seconds** — hit `defaultTimeout` (or
  the per-provider timeout). Increase in settings, or enable Debug mode to see the last
  stdout/stderr chunk before the kill.
- **Local server "Cannot reach server"** — make sure you set the URL to `127.0.0.1`, not
  `localhost`. The plugin normalises this in code (`normalizeUrl`), but copy-pasted URLs in
  custom fields may still surprise you.
- **Settings disappeared after Obsidian Sync** — check that you only ever wrote to
  `data.json` via `saveSettings` / `saveChatSessions`. Direct `saveData` writes bypass
  `mergeBeforeSave` and lose remote changes.
- **OpenCode + ACP toggle is greyed-out / off** — intentional. OpenCode ACP is HTTP-only,
  not stdio. See decisions.md.
- **e2e tests cannot find Obsidian binary** — `wdio-obsidian-service` downloads it on first
  run; ensure network access and disk space. The wdio config lives at `wdio.conf.ts`.
