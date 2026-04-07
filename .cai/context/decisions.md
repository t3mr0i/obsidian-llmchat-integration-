---
name: decisions
description: Architectural and technical decisions for the obsidian-llm plugin with reasoning. Load when making design choices or understanding why something is built a certain way.
triggers:
  - "why do we"
  - "why is it"
  - "decision"
  - "alternative"
  - "we chose"
  - "rationale"
edges:
  - target: context/architecture.md
    condition: when a decision relates to system structure or component boundaries
  - target: context/stack.md
    condition: when a decision relates to a library or build choice
  - target: context/conventions.md
    condition: when a decision is enforced by a coding convention
  - target: patterns/add-acp-support.md
    condition: when justifying which providers can/can't use ACP (OpenCode case)
  - target: patterns/settings-persistence.md
    condition: when justifying mergeBeforeSave and the cloud-sync-safe persistence rule
  - target: patterns/spawn-cli-shellpath.md
    condition: when justifying the shell PATH workaround for macOS GUI apps
last_updated: 2026-04-07
---

# Decisions

## Decision Log

### Shell out to user-installed CLIs instead of bundling vendor SDKs
- **Why:** the user already authenticates `claude`, `gemini`, `codex`, `opencode` CLIs on
  their machine. Bundling SDKs would force us to handle API keys, billing, rate limits, and
  per-vendor auth flows inside an Obsidian plugin. Using the CLI also lets us inherit the
  user's chosen model defaults and any local config.
- **Trade-off:** we depend on the user keeping the CLI installed and on PATH. Mitigated by
  `autoDetectProviders` and clear error messages from `parseErrorMessage`.

### Resolve `$PATH` via login shell on macOS
- **Why:** GUI apps launched from Finder/Dock on macOS do not inherit the user's shell PATH
  (homebrew, nvm, asdf, cargo, …). Without this, every CLI spawn fails with `ENOENT`.
- **How:** `src/utils/shellPath.ts` runs `$SHELL -ilc 'echo $PATH'` once and caches it. Every
  `spawn` in `LLMExecutor` / `AcpExecutor` / `autoDetect` uses `getShellEnv()`.
- **Alternatives considered:** asking the user to launch Obsidian from a terminal (terrible
  UX); hard-coding common paths only (works on most Macs but breaks on nvm).

### Cloud-sync-safe `mergeBeforeSave` for the plugin data file
- **Why:** Obsidian Sync replicates the plugin data file between devices. If we just call
  `saveData(this.settings)`, settings the user changed on another device get clobbered.
- **How:** `LLMPlugin.mergeBeforeSave` (`main.ts`) re-reads the plugin data file from disk before
  every save and merges per-provider configs and chat sessions by id. In-memory wins
  per-field, but extra keys from disk are preserved.
- **Constraint:** never write to the plugin data file outside `saveSettings` / `saveChatSessions`.
  See user memory `feedback_merge_not_overwrite`.

### OpenCode uses CLI mode, not ACP
- **Why:** OpenCode's ACP transport is HTTP-based, not stdio. Our `AcpExecutor` is built
  around `@agentclientprotocol/sdk`'s stdio `ClientSideConnection`. The CLI mode is more
  reliable for OpenCode anyway.
- **Where it's enforced:** `ACP_SUPPORTED_PROVIDERS = ["claude", "gemini", "codex"]` in
  `src/types.ts` and an in-place migration that flips `useAcp` off for OpenCode in
  `LLMPlugin.loadSettings` (`main.ts`).

### Raw Node `http` for local LLM servers (not Electron `fetch`)
- **Why:** Electron's fetch implementation has caused intermittent failures against
  `localhost` LLM servers (Ollama / LM Studio) — DNS resolution and connection-reuse quirks.
  Node's `http` module is predictable and lets us stream chunks line-by-line.
- **Companion decision:** rewrite `localhost` → `127.0.0.1` in `normalizeUrl`
  (`LocalLLMExecutor.ts`) to dodge IPv6 / DNS edge cases entirely.

### MiniSearch RAG over prompt truncation
- **Why:** vault notes can be huge. Truncating before sending to the model loses context
  silently. Indexing the vault and retrieving the relevant heading-level chunks gives the
  model focused context without hitting prompt limits. Reinforced by user memory
  `feedback_no_truncation`.
- **How:** `src/utils/vaultSearch.ts` splits notes by headings (`MAX_CHUNK_CHARS = 2000`),
  indexes them in MiniSearch with field boosts (title 3, heading 2, tags 2, content 1),
  and stores chunk text in a separate `Map` to avoid doubling RAM in the index.

### Stream-JSON output format for Claude
- **Why:** Claude's `--output-format stream-json` emits one JSON event per line, giving us
  intermediate `assistant` / `content_block_delta` / `message_delta` events. We parse them
  in `parseClaudeOutput` (`LLMExecutor.ts`) to surface progress (thinking, tool use,
  tokens) in the UI without waiting for the full response.

### Single CJS bundle via esbuild
- **Why:** Obsidian's plugin loader requires CommonJS. esbuild handles tree-shaking and
  inline source maps in dev. No webpack / rollup overhead.
- **Constraint:** `obsidian` and CodeMirror packages are marked `external` — Obsidian
  injects them at runtime.

### E2E-only test strategy
- **Why:** the hard parts of this plugin live at integration boundaries (subprocess spawn,
  CLI parsing, ACP stream handling, Obsidian DOM). Unit tests of the parsers in isolation
  would not catch the actual failure modes. WebdriverIO + `wdio-obsidian-service` boots a
  real Obsidian and exercises the full UI.

### Auto-start local server when models are present
- **Why:** Ollama and LM Studio are commonly installed but not always running. Detecting
  models on disk and starting the server in the background turns "I have Ollama installed"
  into a working provider with zero clicks. See `LLMPlugin.autoDetect` (`main.ts`) and
  `startLocalServer` in `src/utils/autoDetect.ts`.

## Token Optimization

### Prompt Caching
When building API integrations with Claude, structure prompts for cache efficiency:
- Place stable content first (system prompt, tool definitions), variable content last (user messages).
- Anthropic caches prompt prefixes automatically. A cache hit costs 90% less than processing.
- Minimum cacheable size: 2,048 tokens (Sonnet), 4,096 tokens (Opus/Haiku).
- Cache TTL: 5 minutes (default) or 1 hour (2x write cost, pays off after 2 reads).
- If tool definitions change, all downstream cache is invalidated — keep tools stable.

### Token-Efficient Tool Use
When using Claude API with tools, add the beta header `token-efficient-tools-2025-02-19`.
This reduces output token usage for tool calls by up to 70% (average 14%).
Available for Sonnet 4.6, Opus 4.6, and Haiku 4.5.

### Why Output Brevity Matters
Output tokens cost 5x more than input tokens across all Claude models.
A single instruction like "keep responses concise" in CLAUDE.md can save more money
than elaborate input-token optimization strategies.
