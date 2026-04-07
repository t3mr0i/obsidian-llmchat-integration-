---
name: architecture
description: How the Obsidian LLM plugin connects providers, executors, and the chat view. Load when working on system design, integrations, or understanding how components interact.
triggers:
  - "architecture"
  - "system design"
  - "executor"
  - "chat view"
  - "provider"
  - "flow"
edges:
  - target: context/stack.md
    condition: when specific technology details (libraries, bundler, obsidian API) are needed
  - target: context/decisions.md
    condition: when understanding why the architecture is structured this way (CJS, shell PATH, merge save)
  - target: context/conventions.md
    condition: when extending an executor or adding a provider
  - target: context/setup.md
    condition: when running, building, or deploying the plugin into a vault
  - target: patterns/add-cli-provider.md
    condition: when adding a new CLI provider — touches LLMExecutor's command + parser tables
  - target: patterns/add-acp-support.md
    condition: when wiring a provider into AcpExecutor
  - target: patterns/debug-cli-failure.md
    condition: when diagnosing a failing CLI / ACP / local-server call
last_updated: 2026-04-07
---

# Architecture

## System Overview

This is an Obsidian community plugin (`obsidian-llm`, display name "AI Chat Integration") that
lets the user chat with multiple LLM providers from inside Obsidian. It is **desktop-only**
(`isDesktopOnly: true` in `manifest.json`) because it spawns child processes and uses Node `http`.

The plugin entry point `main.ts` is bundled by esbuild into a single `main.js` CJS file at the
repo root and shipped together with `manifest.json` and `styles.css` to a vault's
`.obsidian/plugins/obsidian-llm/` folder.

Flow:

```
User → ChatView (sidebar) ─┐
                           ├─→ LLMExecutor       (CLI subprocess, stream-json)
Commands / QuickPrompt ────┤                       providers: claude, gemini, codex, opencode
                           ├─→ AcpExecutor       (persistent ACP connection over stdio)
                           │                       providers: claude, gemini, codex
                           └─→ LocalLLMExecutor  (Node http → Ollama / OpenAI-compatible)
                                                   providers: local
```

`autoDetect` runs on plugin load and on the `detect-providers` command. It probes installed
CLIs (`claude`, `gemini`, `codex`, `opencode`) and local server endpoints (Ollama, LM Studio,
MLX, vLLM, llama.cpp, etc.), and can auto-start local server software when models are present
but the server is down (see `main.ts:193` `autoDetect()`).

## Key Components

- `main.ts` — Plugin entry. Registers `ChatView`, ribbon icon, status bar, commands
  (`open-llm-chat`, `quick-llm-prompt`, `send-selection-to-llm`, `summarize-selection`,
  `explain-selection`, `improve-writing`, `generate-from-context`, `detect-providers`).
  Handles settings load/save with cloud-sync-safe merge (`mergeBeforeSave`, `main.ts:350`)
  and persists `_chatSessions` alongside settings.
- `src/types.ts` — Single source of truth for `LLMProvider`, `ProviderConfig`,
  `LLMPluginSettings`, `ProgressEvent`, `PROVIDER_DISPLAY_NAMES`, `PROVIDER_MODELS`,
  `ACP_SUPPORTED_PROVIDERS`, `DEFAULT_SETTINGS`.
- `src/executor/LLMExecutor.ts` — Spawns CLI subprocess per request. Per-provider command
  table `DEFAULT_COMMANDS` (`LLMExecutor.ts:27`) and per-provider parser table `PARSERS`
  (`LLMExecutor.ts:37`). Claude uses `--output-format stream-json`, parsed line-by-line in
  `parseClaudeOutput` (`LLMExecutor.ts:48`). stdin is used for claude/opencode (long prompts);
  positional arg for gemini/codex. Streams text via `onStream` and structured events via
  `onProgress`. Tracks resumable session ids per provider.
- `src/executor/AcpExecutor.ts` — Persistent connection via `@agentclientprotocol/sdk`
  (`ClientSideConnection`, `ndJsonStream`). Wraps Node child stdio in WHATWG streams
  (`nodeToWebReadable` / `nodeToWebWritable`, lines 40–131). Used for claude / gemini / codex
  when `providerConfig.useAcp` is true. Provides `setAcpModels` to populate the model picker
  from the live ACP session. **OpenCode is excluded from ACP-stdio** — see decisions.
- `src/executor/LocalLLMExecutor.ts` — Talks HTTP to Ollama (`/api/chat`, `/api/tags`) or
  OpenAI-compatible servers (`/v1/chat/completions`, `/v1/models`). Uses raw Node `http` (not
  Electron `fetch`) to avoid Electron HTTP quirks. Normalises `localhost` → `127.0.0.1`
  (`LocalLLMExecutor.ts:21`).
- `src/views/ChatView.ts` — `ItemView` registered as `CHAT_VIEW_TYPE = "llm-chat-view"` in
  the right sidebar. Owns chat tabs, message rendering, model picker, all three executors,
  and a per-view `VaultSearch` instance.
- `src/utils/vaultSearch.ts` — `VaultSearch` class. MiniSearch BM25 index over vault
  markdown, split into heading-level chunks (`MAX_CHUNK_CHARS = 2000`). Used as a lightweight
  RAG layer so we never truncate large notes — we retrieve relevant chunks instead.
- `src/utils/autoDetect.ts` — Probes CLIs and local servers, can `startLocalServer` for
  Ollama/LM Studio. `applyDetectionResults` mutates settings idempotently.
- `src/utils/modelFetcher.ts` — Two-tier model cache: ACP models (preferred when connected)
  and CLI/static models (5-minute TTL). `setAcpModels` / `clearAcpModels` are called from
  `AcpExecutor` on connect/disconnect.
- `src/utils/shellPath.ts` — Resolves the user's real `$PATH` by running their login shell
  (`$SHELL -ilc 'echo $PATH'`). Cached for the session. **Critical** — without this, GUI
  Obsidian on macOS cannot find homebrew/nvm-installed CLIs.
- `src/settings/SettingsTab.ts` — Settings UI. Lets the user enable providers, set models,
  configure local server URL/type, ACP toggle, system-prompt note, etc.
- `src/modals/QuickPromptModal.ts` — Modal used by selection commands.
- `esbuild.config.mjs` — Bundles `main.ts` → `main.js` (CJS, target `es2018`). Optionally
  copies `main.js` / `manifest.json` / `styles.css` to one or more vault plugin directories
  configured via `OBSIDIAN_PLUGIN_DIRS` env var or `deploy-targets.json`.

## External Dependencies

- **Obsidian API** (`obsidian` package, dev-only — provided by host at runtime). `Plugin`,
  `ItemView`, `WorkspaceLeaf`, `MarkdownRenderer`, `TFile`, `Notice`, settings APIs.
- **`@agentclientprotocol/sdk` ^0.13.1** — ACP client bindings. Imported by `AcpExecutor`.
- **`minisearch` ^7.2.0** — In-memory BM25 index for the vault RAG.
- **`zod` ^4.3.6** — Schema validation (declared dep; used sparingly).
- **External CLIs** (not npm deps — user-installed binaries discovered via shell PATH):
  `claude`, `gemini`, `codex`, `opencode`, plus ACP adapters launched via `npx -y`
  (`@zed-industries/claude-code-acp`, `@zed-industries/codex-acp`).
- **Local LLM servers** (HTTP, optional): Ollama, LM Studio, MLX, vLLM, llama.cpp, Jan,
  text-generation-webui, LocalAI — see `LOCAL_SERVER_PROBES` in `src/utils/autoDetect.ts:10`.

## What Does NOT Exist Here

- **No mobile support.** `isDesktopOnly: true`. Anything that requires `child_process`,
  Node `http`, or shell PATH is desktop-only by definition.
- **No bundled API client for Anthropic / OpenAI / Google.** The plugin shells out to the
  user's installed CLI tools (or to a local server). It does not hold API keys itself.
- **No unit tests.** Only end-to-end tests via WebdriverIO + `wdio-obsidian-service`. See
  `test/specs/plugin.e2e.ts` and `test/specs/providers.e2e.ts`.
- **No build for ESM or browser.** Output is CJS only — Obsidian's plugin loader requires it.
- **No central state store / Redux / signals.** State lives in `LLMPlugin` and `ChatView`.
- **No telemetry / analytics.**
