---
name: decisions
description: Key architectural decisions for this plugin — why ACP for some providers, why http not fetch, why merge-on-save, why MiniSearch, why no unit tests.
triggers:
  - "why do we"
  - "why is it"
  - "decision"
  - "alternative"
  - "trade-off"
edges:
  - target: architecture.md
    condition: when a decision relates to system structure (executors, view ownership)
  - target: stack.md
    condition: when a decision relates to a specific library or version
  - target: conventions.md
    condition: when a decision is enforced as a coding rule
  - target: setup.md
    condition: when a decision affects how to build, run, or test the project
last_updated: 2026-04-07
---

# Decisions

## Decision Log

### Cloud LLMs go through user-installed CLIs, not SDKs
We do not bundle `@anthropic-ai/sdk`, OpenAI SDK, etc. The plugin shells out to `claude`, `gemini`, `codex`, `opencode`. **Why:** users already configure auth in those CLIs (API keys, OAuth, MFA) and we inherit that for free, no key handling, no auth UI, no key storage in `data.json`. **Trade-off:** users must install the CLI separately; we have to parse multiple bespoke output formats; PATH discovery is fragile (mitigated by `shellPath.ts`).

### ACP enabled for claude/gemini/codex; OpenCode stays on CLI mode
`ACP_SUPPORTED_PROVIDERS = ["claude", "gemini", "codex"]` (`src/types.ts`). OpenCode also speaks ACP but over **HTTP**, not stdio, and the HTTP transport has been unreliable for our use. There is even an explicit migration in `LLMPlugin.loadSettings` that force-disables `providers.opencode.useAcp`. **Why:** ACP gives us persistent sessions and richer progress events, but only for stdio agents. **How to apply:** when adding a new provider, only set ACP if it speaks stdio ACP.

### `LocalLLMExecutor` uses Node `http`, not `fetch`
`src/executor/LocalLLMExecutor.ts` calls `http.request` directly. **Why:** Electron/Obsidian's `fetch` has misbehaved against local HTTP servers on macOS (CORS-style preflight quirks, hanging on `localhost`). `http` is reliable and gives us streaming. **Related rule:** also normalize `localhost` → `127.0.0.1` in `normalizeUrl` to dodge DNS resolution issues.

### Settings save merges with disk before writing
`LLMPlugin.saveSettings()` calls `mergeBeforeSave()` (`main.ts`), which re-reads `data.json` and merges in-memory state with whatever may have arrived via cloud sync (Obsidian Sync, iCloud, Syncthing). **Why:** without this, enabling a provider on one device would silently overwrite the other device's configuration on next save. **How to apply:** never call `saveData(this.settings)` directly — always go through `saveSettings`. Chat sessions take a fast path (`saveChatSessions`) and skip the merge because they are local-only.

### MiniSearch with content stored outside the index
`VaultSearch` keeps chunk content in a separate `Map` (`chunkContent`) and only stores `path/title/heading` in MiniSearch's `storeFields`. **Why:** MiniSearch keeps `storeFields` in memory; storing 2KB chunks for an entire vault would double RAM. We pay one map lookup at retrieval time instead.

### Vault is chunked by heading, max 2000 chars
`MAX_CHUNK_CHARS = 2000`, splits on heading. **Why:** balances retrieval precision (small enough to surface the right section) against index overhead. Combined with the no-truncation rule (never truncate input to the LLM), this is how we feed long notes into prompts — RAG retrieves only relevant chunks.

### Re-indexing is debounced 1s on file modify
`MODIFY_DEBOUNCE_MS = 1000`. **Why:** Obsidian fires `modify` on every keystroke save during auto-save; without debounce we thrashed the index.

### No unit tests, only WebdriverIO E2E
`test/specs/*.e2e.ts` driven by `wdio-obsidian-service`. **Why:** the plugin is mostly UI integration and subprocess orchestration — unit tests would be heavy on mocking and light on signal. E2E inside a real Obsidian gives the only assurance that matters: "does it actually work in the host."

### One bundled `main.js` via esbuild, no second build step
`esbuild.config.mjs` produces a single CJS bundle. `tsc` is run only as `--noEmit` for typechecking before the esbuild prod build. **Why:** Obsidian loads a single `main.js`; multi-file builds add nothing; esbuild is fast enough for watch mode.

### `PROVIDER_DISPLAY_NAMES` lives in `src/types.ts` only
Earlier the settings tab had its own copy. The recent commit `fce0418` centralized this. **Why:** divergence between the settings dropdown and the chat view dropdown caused user-visible inconsistency.

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
