---
name: conventions
description: Code conventions for this Obsidian plugin — file layout, type centralization, executor pattern, settings persistence rules.
triggers:
  - "convention"
  - "naming"
  - "where do I put"
  - "how should I"
  - "new provider"
  - "new command"
  - "settings field"
edges:
  - target: architecture.md
    condition: when a convention depends on understanding executor/view layout
  - target: decisions.md
    condition: when the rule traces back to a deliberate trade-off (merge save, http vs fetch)
  - target: stack.md
    condition: when picking which library to use for a new feature
last_updated: 2026-04-07
---

# Conventions

## Naming

- **Files:** camelCase for utilities (`vaultSearch.ts`, `autoDetect.ts`, `shellPath.ts`, `modelFetcher.ts`), PascalCase for classes that define the file (`ChatView.ts`, `LLMExecutor.ts`, `AcpExecutor.ts`, `LocalLLMExecutor.ts`, `SettingsTab.ts`, `QuickPromptModal.ts`).
- **Classes:** PascalCase. The plugin entry class is `LLMPlugin` (`main.ts`).
- **Types & interfaces:** PascalCase. Provider keys are lowercase string literals: `"claude" | "opencode" | "codex" | "gemini" | "local"`.
- **Constants:** UPPER_SNAKE_CASE for module-level lookup tables (`DEFAULT_COMMANDS`, `PROVIDER_MODELS`, `PROVIDER_DISPLAY_NAMES`, `ACP_SUPPORTED_PROVIDERS`, `DEFAULT_SETTINGS`, `DEFAULT_PROVIDER_CONFIGS`, `CHAT_VIEW_TYPE`).
- **Provider display strings:** centralized in `PROVIDER_DISPLAY_NAMES` in `src/types.ts`. Do not duplicate elsewhere — `SettingsTab.ts` historically had its own copy; if you find one, fold it into `types.ts`.

## Structure

```
main.ts                    # Plugin entry, lifecycle, settings load/save, commands
src/
  types.ts                 # All shared types, defaults, lookup tables — single source of truth
  executor/
    LLMExecutor.ts         # CLI subprocess executor (claude/gemini/codex/opencode)
    AcpExecutor.ts         # ACP persistent connection
    LocalLLMExecutor.ts    # HTTP client for Ollama / OpenAI-compatible servers
  views/
    ChatView.ts            # ItemView — chat UI, owns its three executor instances
    index.ts               # Re-exports
  modals/
    QuickPromptModal.ts    # One-shot prompt modal (used by command palette)
    index.ts
  settings/
    SettingsTab.ts         # PluginSettingTab UI
  utils/
    vaultSearch.ts         # MiniSearch RAG over vault
    autoDetect.ts          # Probe installed CLIs and local servers
    modelFetcher.ts        # Static + dynamic model lists
    shellPath.ts           # Resolve interactive shell PATH for spawned CLIs
test/specs/
  plugin.e2e.ts            # WebdriverIO E2E
  providers.e2e.ts
```

- **All shared types live in `src/types.ts`.** Importing modules use `import type { … } from "../types"`. Do not create per-file type duplicates.
- **Executors are class-based and stateful.** They own session ids, active processes, and a `settings` reference. Update via `updateSettings()` rather than re-instantiating where possible.
- **Views own their executors.** `ChatView` constructs its own `LLMExecutor`, `AcpExecutor`, `LocalLLMExecutor`. The plugin-level `LLMExecutor` on `LLMPlugin` is for command-palette / non-view flows.

## Patterns

- **New provider:** add the literal to `LLMProvider` in `src/types.ts`, populate `PROVIDER_DISPLAY_NAMES`, `PROVIDER_MODELS`, `DEFAULT_PROVIDER_CONFIGS`, and `ACP_SUPPORTED_PROVIDERS` if relevant. Add a parser + entry in `LLMExecutor.ts`'s `DEFAULT_COMMANDS`/`PARSERS` if CLI-based, or extend `LocalLLMExecutor` if HTTP-based. Add detection in `autoDetect.ts`.
- **Settings persistence:** **never call `saveData(this.settings)` directly.** Use `LLMPlugin.saveSettings()` which goes through `mergeBeforeSave()` to preserve cloud-synced changes from other devices. Chat sessions have their own light-weight save path (`saveChatSessions`) that bypasses the merge because sessions are local-only.
- **Local server URLs:** always normalize `localhost` to `127.0.0.1` (see `LocalLLMExecutor.normalizeUrl`). Electron/Obsidian on macOS hits DNS issues with `localhost`.
- **Spawning CLIs:** always merge env from `getShellEnv()` so the user's interactive `PATH` is available — Obsidian launched from Finder has an empty PATH.
- **Streaming:** progress reaches the UI as `ProgressEvent` (`thinking | tool_use | text | status`). Add new event types to the union in `src/types.ts`, not as ad-hoc strings.
- **Markdown rendering in views:** use Obsidian's `MarkdownRenderer.render` and track the `Component` instances on `markdownComponents` for cleanup on view close.
- **Debug logging:** gate behind `this.settings.debugMode`. Use `[LLM Plugin]` prefix.
- **Migrations:** put one-shot data migrations in `LLMPlugin.loadSettings()` (see existing examples: old `systemPrompt` string → file-based, OpenCode ACP → false, ensure `local` provider exists).
- **Truncation rule:** **never truncate content sent to the LLM.** If a message would be too large, route it through `VaultSearch`/RAG. (Project-wide rule — see user memory.)

## AI Response Efficiency
- Respond concisely. Lead with the answer or action, not the reasoning.
- No trailing summaries repeating what was just done.
- Only add code comments where the logic is non-obvious.
- Prefer editing existing files over creating new ones.
- When reading context via MCP, use `cai_search` or `mode: summary` before loading full files.

## Verify Checklist

After any change in `src/` or `main.ts`:

1. **Typecheck passes:** `tsc -noEmit -skipLibCheck` (this is the first half of `npm run build`).
2. **Bundle builds:** `npm run build` produces `main.js` without errors.
3. **No new shared types defined outside `src/types.ts`** (unless they are private to one file).
4. **No new `localhost` literal** when constructing local server URLs — use `127.0.0.1` or pass through `normalizeUrl`.
5. **No direct `saveData(this.settings)` call** — went through `saveSettings()`/`mergeBeforeSave()` instead.
6. **No direct `fetch()` call to a local LLM server** — used the `http` helper in `LocalLLMExecutor`.
7. **All `spawn(...)` calls** include env from `getShellEnv()`.
8. **If a new provider was added:** updated `LLMProvider` union, `PROVIDER_DISPLAY_NAMES`, `PROVIDER_MODELS`, `DEFAULT_PROVIDER_CONFIGS`, plus parser + detection.
9. **Manifest + package version** in sync if the change is a release.
10. **For UI changes:** if it touched `ChatView`, run `npm run test:e2e:fast` at minimum.
