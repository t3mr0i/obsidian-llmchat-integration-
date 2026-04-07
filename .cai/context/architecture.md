---
name: architecture
description: How the major pieces of this Obsidian plugin connect — entry point, executors, views, and external CLI/HTTP integrations.
triggers:
  - "architecture"
  - "system design"
  - "how does X connect to Y"
  - "executor"
  - "chat view"
  - "provider flow"
edges:
  - target: stack.md
    condition: when specific technology details are needed (esbuild, MiniSearch, ACP SDK, Obsidian API)
  - target: decisions.md
    condition: when understanding why the architecture is structured this way (ACP vs CLI, http vs fetch, merge save)
  - target: conventions.md
    condition: when adding a new component and needing module/file conventions
  - target: setup.md
    condition: when you need build/run commands to verify a change
last_updated: 2026-04-07
---

# Architecture

## System Overview

This is an Obsidian desktop plugin (`isDesktopOnly: true`) that adds an in-editor chat panel for talking to multiple LLM providers. There is no backend service — the plugin runs inside Obsidian's Electron renderer and talks to **external CLI tools** (Claude Code, Codex, OpenCode, Gemini CLI) via subprocess and to **local HTTP servers** (Ollama, LM Studio, vLLM, …) via Node `http`.

Single bundled output: esbuild compiles `main.ts` + everything under `src/` into a single CommonJS `main.js` that Obsidian loads. External modules: `obsidian`, `electron`, `@codemirror/*`, Node builtins.

Flow for a user prompt:
1. User types in `ChatView` (`src/views/ChatView.ts`) or `QuickPromptModal` (`src/modals/QuickPromptModal.ts`).
2. `ChatView` selects an executor based on provider + ACP setting:
   - ACP-capable + `useAcp` → `AcpExecutor` (persistent stdio session)
   - CLI providers without ACP → `LLMExecutor` (spawn-per-request)
   - `local` provider → `LocalLLMExecutor` (HTTP)
3. Executor streams `ProgressEvent`s back to the view, which renders markdown via Obsidian's `MarkdownRenderer`.
4. Sessions persist alongside settings via `loadData`/`saveData` (`main.ts`), merge-aware for cloud sync.

## Key Components

- **`main.ts`** — `LLMPlugin` (extends `Plugin`). Lifecycle, command registration, ribbon icon, status bar, settings load/save with merge. Owns `ChatSession[]` and a top-level `LLMExecutor` instance. Triggers background `autoDetectProviders()` on load.
- **`src/types.ts`** — Single source of truth for `LLMProvider`, `ProviderConfig`, `LLMPluginSettings`, `PROVIDER_DISPLAY_NAMES`, `PROVIDER_MODELS`, `ACP_SUPPORTED_PROVIDERS`, `DEFAULT_SETTINGS`, `ProgressEvent`. All other modules import from here.
- **`src/executor/LLMExecutor.ts`** — Spawns CLI tools (claude/gemini/codex/opencode) via `child_process.spawn`, parses provider-specific output formats (Claude streaming JSON, Gemini JSON, OpenCode line JSON, Codex plain). Tracks `sessionIds` for continuation. Also exports `detectAvailableProviders()`.
- **`src/executor/AcpExecutor.ts`** — Long-lived ACP (Agent Client Protocol) connection via `@agentclientprotocol/sdk`. Used for claude, gemini, codex when `useAcp: true`. Wraps Node streams as Web streams for the SDK. Reports `SessionUpdate`/`ContentChunk`/`ToolCall` events as `ProgressEvent`s.
- **`src/executor/LocalLLMExecutor.ts`** — HTTP client for local servers. Uses Node's `http` module directly (NOT `fetch`) to bypass Electron fetch issues. Normalizes `localhost` → `127.0.0.1`. Supports two API shapes: `ollama` and `openai-compatible`.
- **`src/views/ChatView.ts`** — `ItemView` with tabs, provider/model dropdowns, message list, input. Owns its own three executor instances. Uses `VaultSearch` for `[[note]]` autocomplete and RAG. Renders messages with `MarkdownRenderer.render` and tracks `Component`s for cleanup.
- **`src/modals/QuickPromptModal.ts`** — Lightweight modal for one-shot prompts (used by command palette commands "Quick Prompt", "Send Selection", "Summarize Selection", etc.).
- **`src/settings/SettingsTab.ts`** — `PluginSettingTab`. Per-provider config UI, model dropdowns (uses `fetchModelsForProvider`), system prompt file picker, auto-detect button, local server start/pull controls.
- **`src/utils/vaultSearch.ts`** — `VaultSearch`: MiniSearch BM25 index over the entire vault, split by heading into ≤2000-char chunks. Batched indexing via `requestIdleCallback`, debounced re-indexing on file modify (1s). Chunk content stored in a separate `Map` to avoid duplicating RAM in MiniSearch.
- **`src/utils/autoDetect.ts`** — Background probe for installed CLI tools and running local servers. Knows install paths, list-models commands, default pull commands.
- **`src/utils/modelFetcher.ts`** — Fetches model lists per provider (mix of static `PROVIDER_MODELS` and dynamic ACP/local server queries).
- **`src/utils/shellPath.ts`** — `getShellEnv()` — resolves the user's interactive shell `PATH` so spawned CLIs are findable when Obsidian was launched from Finder/Dock with an empty PATH.

## External Dependencies

- **Claude CLI** (`claude`) — Anthropic's Claude Code. Streamed via `--verbose --output-format stream-json`. Supports ACP.
- **Gemini CLI** (`gemini`) — Google. Invoked with `--output-format json`. Supports ACP.
- **Codex CLI** (`codex`) — OpenAI. Invoked as `codex exec --skip-git-repo-check`. Supports ACP.
- **OpenCode CLI** (`opencode`) — Multi-provider. Invoked as `opencode run --format json`. ACP intentionally disabled (HTTP transport, not stdio — see decisions.md).
- **Local LLM servers** — Ollama (`:11434`), LM Studio (`:1234`), vLLM, llama.cpp, MLX, LocalAI, Jan, text-generation-webui. Probed by `autoDetect.ts`.
- **Obsidian API** — `Plugin`, `ItemView`, `MarkdownRenderer`, `PluginSettingTab`, `FuzzySuggestModal`, `Notice`, vault events.
- **`@agentclientprotocol/sdk`** — ACP client implementation.
- **`minisearch`** — Vault RAG.
- **`zod`** — Listed as dep; runtime schema validation (where used).

## What Does NOT Exist Here

- No backend server, no API the plugin exposes.
- No bundler other than esbuild; no Vite/Webpack/Rollup.
- No test framework other than WebdriverIO + Mocha (E2E only). No unit tests, no Jest, no Vitest.
- No mobile support — `isDesktopOnly: true` in `manifest.json`.
- No direct Anthropic/OpenAI/Google SDK usage — all cloud LLM calls go through the user-installed CLI binaries.
- No `fetch()` calls to local LLM servers — uses Node `http` (decisions.md).
- No CommonJS for source modules — TS sources are ESM-style; only the bundled `main.js` is CJS (Obsidian requirement).
- No `.env` file loading — config lives in Obsidian's `data.json` per vault.
