---
name: stack
description: Technology stack — TypeScript + esbuild Obsidian plugin, ACP SDK, MiniSearch, WebdriverIO E2E. Load when picking libraries or hitting version constraints.
triggers:
  - "library"
  - "package"
  - "dependency"
  - "esbuild"
  - "minisearch"
  - "acp"
  - "webdriverio"
  - "obsidian api"
edges:
  - target: decisions.md
    condition: when the reasoning behind a tech choice is needed
  - target: conventions.md
    condition: when understanding how a library is used in this codebase
  - target: architecture.md
    condition: when seeing where a library plugs into the component flow
  - target: setup.md
    condition: when you need install commands or version prerequisites for the toolchain
last_updated: 2026-04-07
---

# Stack

## Core Technologies

- **TypeScript** `^5.0.0` — strict typing throughout `src/`.
- **Obsidian Plugin API** (`obsidian` `latest` devDep) — `Plugin`, `ItemView`, `MarkdownRenderer`, `PluginSettingTab`, `FuzzySuggestModal`, `WorkspaceLeaf`, vault events.
- **esbuild** `^0.25.12` — single bundler (`esbuild.config.mjs`). Output: `main.js`, format `cjs`, target `es2018`, entry `main.ts`. Externals: `obsidian`, `electron`, `@codemirror/*`, `@lezer/*`, Node builtins.
- **Node.js** — runs inside Obsidian's Electron renderer. Uses `child_process.spawn` (CLI executors) and `http` (local LLM executor) directly.

## Key Libraries

- **`@agentclientprotocol/sdk` `^0.13.1`** — Agent Client Protocol. Used in `src/executor/AcpExecutor.ts` for persistent sessions with claude/gemini/codex. Requires Web streams (Node streams are wrapped via `nodeToWebReadable`/`nodeToWebWritable`).
- **`minisearch` `^7.2.0`** — BM25 full-text index for the vault. Used in `src/utils/vaultSearch.ts`. Configured with field boosts: `title:3, heading:2, tags:2, content:1`. Content is stored in a separate `Map`, not in MiniSearch's `storeFields`, to avoid doubling RAM.
- **`zod` `^4.3.6`** — Runtime schema validation (declared dependency).

## Test / Build Tooling

- **WebdriverIO** `^9.23.x` (`@wdio/cli`, `@wdio/local-runner`, `@wdio/mocha-framework`, `@wdio/spec-reporter`, `@wdio/globals`) — E2E test runner.
- **`wdio-obsidian-service` / `wdio-obsidian-reporter` `^2.2.x`** — launches Obsidian for E2E.
- **Mocha** (via `@wdio/mocha-framework`) + `@types/mocha` — test framework.
- **`expect-webdriverio` `^5.6.3`** — assertions.
- **`builtin-modules` `^3.3.0`** — supplies the externals list for esbuild.
- **`tslib` `^2.4.0`** — TypeScript runtime helpers.
- **Package manager:** npm (no lockfile-enforced alternative).

## What We Deliberately Do NOT Use

- **No `fetch()` for local LLM servers** — `LocalLLMExecutor` uses Node `http` directly to bypass Electron fetch issues on macOS. See `decisions.md`.
- **No unit-test framework** (Jest, Vitest, Mocha-as-unit). Only WebdriverIO E2E specs under `test/specs/`.
- **No linter / formatter wired into `package.json` scripts.** No ESLint, no Prettier script. (Some `eslint-disable` comments exist in source but there is no project-level config.)
- **No second bundler.** Only esbuild. No Vite, Webpack, Rollup, swc.
- **No native Anthropic/OpenAI/Google SDKs.** All cloud calls go through user-installed CLIs.
- **No mobile build** — `manifest.json` declares `isDesktopOnly: true`.
- **No state library** (Redux, Zustand). State is held on view/executor instances and persisted via `loadData`/`saveData`.

## Version Constraints

- **Obsidian:** `minAppVersion: 1.0.0` in `manifest.json`.
- **Node types:** `@types/node ^20.19.30` — assume Node 20+ APIs available.
- **TypeScript target:** `es2018` (esbuild target, not necessarily `tsconfig`).
- **Plugin id / version:** `obsidian-llm` / `0.3.0` (from `package.json` and `manifest.json` — keep these in sync on release).
- **Author:** Kai Detmers (`manifest.json`).
