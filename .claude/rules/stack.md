<!-- cai:start -->
---
description: "Technology stack, library choices, and version constraints."
globs:
  - "package.json"
  - "tsconfig.json"
  - "*.config.*"
---

# stack (auto-generated — edit .cai/context/stack.md)

# Stack

## Core Technologies

- **TypeScript** (`typescript ^5.0.0`). `tsconfig.json`: `target: ES6`, `module: ESNext`,
  `moduleResolution: node`, `strictNullChecks: true`, `noImplicitAny: true`,
  `isolatedModules: true`, `inlineSourceMap: true`. Type-only check via
  `tsc -noEmit -skipLibCheck` runs as part of `npm run build`.
- **esbuild** (`esbuild ^0.25.12`) as the only bundler. Single-entry build: `main.ts` → `main.js`
  (CJS, target `es2018`, treeshake on). See `esbuild.config.mjs`.
- **Node.js / Electron runtime** (Obsidian's embedded Chromium + Node). Plugin uses Node
  `child_process.spawn` / `exec` and the raw Node `http` module.
- **Obsidian Plugin API** — provided by the host application at runtime, not bundled. Listed
  as devDependency `obsidian: latest` for typings only and marked `external` in
  `esbuild.config.mjs`.

## Key Libraries

- **`@agentclientprotocol/sdk`** — Agent Client Protocol SDK. Used by
  `src/executor/AcpExecutor.ts` to keep a long-lived stdio session with Claude / Gemini /
  Codex ACP adapters. Provides `ClientSideConnection`, `ndJsonStream`, and the session
  notification / model state types.
- **`minisearch`** — Tiny BM25 full-text search. Used by `src/utils/vaultSearch.ts`
  to index vault notes (split into heading-level chunks) for RAG, instead of stuffing whole
  notes into prompts.
- **`zod`** — Schema validation. Declared as a dep; reach for it before hand-rolling
  validators when parsing CLI / HTTP responses.

## Dev / Test Libraries

- **`wdio-obsidian-service` ^2.2.1** + **`wdio-obsidian-reporter` ^2.2.1** —
  WebdriverIO service that boots a real Obsidian instance for e2e testing.
- **`@wdio` packages ^9.23** — WDIO local runner, mocha framework, spec reporter.
- **`@types/mocha` ^10**, **`expect-webdriverio` ^5.6** — test types and matchers.
- **`builtin-modules` ^3.3** — supplies the Node builtin list for esbuild's `external`.
- **`tslib` ^2.4** — TS helper runtime.

## What We Deliberately Do NOT Use

- **No `fetch` for local-server calls.** `LocalLLMExecutor` uses raw Node `http` because
  Electron's fetch implementation has misbehaved against `localhost` LLM servers — see
  `context/decisions.md`.
- **No CommonJS/ESM dual build.** Output is CJS only; Obsidian's plugin loader expects it.
- **No unit-test framework** (no jest / vitest / mocha standalone). Only WebdriverIO e2e.
- **No CSS framework / UI library.** Plain DOM via Obsidian's API and `styles.css`.
- **No Anthropic / OpenAI / Google SDKs.** The plugin never holds API keys; it spawns the
  user's installed CLI tools instead.
- **No mobile / cross-platform polyfills.** `isDesktopOnly: true` in `manifest.json`.

## Version Constraints

- **Node `>=20`** for the build (matches `@types/node` v20).
- **Obsidian `minAppVersion: 1.0.0`** declared in `manifest.json`.
- **Plugin version `0.4.0`** (kept in sync between `package.json` and `manifest.json`).
- **esbuild target `es2018`** — Obsidian's Electron is modern, but `es2018` is the
  established floor for the community plugin ecosystem.
- **Format `cjs`** — required by Obsidian's plugin loader.
<!-- cai:end -->
