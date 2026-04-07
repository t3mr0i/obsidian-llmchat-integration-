<!-- cai:start -->
---
description: "Code conventions: naming, structure, patterns, and verification checklist."
globs:
  - "src/**"
---

# conventions (auto-generated — edit .cai/context/conventions.md)

# Conventions

## Naming

- **Files:** PascalCase for classes (`LLMExecutor.ts`, `ChatView.ts`, `SettingsTab.ts`,
  `QuickPromptModal.ts`), camelCase for utility modules (`vaultSearch.ts`, `shellPath.ts`,
  `modelFetcher.ts`, `autoDetect.ts`).
- **Folders:** `src/executor/`, `src/views/`, `src/settings/`, `src/modals/`, `src/utils/`.
  Each folder that exports more than one symbol has an `index.ts` barrel
  (`src/views/index.ts`, `src/modals/index.ts`).
- **Types:** All shared types live in `src/types.ts`. Provider-related constants
  (`PROVIDER_DISPLAY_NAMES`, `PROVIDER_MODELS`, `ACP_SUPPORTED_PROVIDERS`,
  `DEFAULT_PROVIDER_CONFIGS`) live there too — do not duplicate them.
- **Providers:** `LLMProvider = "claude" | "opencode" | "codex" | "gemini" | "local"`.
  CLI subset is `CLIProvider = Exclude<LLMProvider, "local">`. When you add a provider you
  update both unions plus every record keyed by them — TypeScript will tell you which.

## Structure

- **One executor class per transport, not per provider.** Provider differences live inside
  a single executor as switch statements (`buildCommand`, `parseStreamingEvents`, parser
  table, etc. in `LLMExecutor.ts`). Do not create provider-specific executor classes.
  - `LLMExecutor` — CLI subprocess for claude / gemini / codex / opencode.
  - `AcpExecutor` — persistent ACP stdio connection for claude / gemini / codex.
  - `LocalLLMExecutor` — HTTP for ollama / openai-compatible servers.
- **Settings live in `LLMPluginSettings`** (`src/types.ts`). All persistence goes through
  `LLMPlugin.loadSettings` and `LLMPlugin.saveSettings`. Never call `saveData` directly
  outside of `mergeBeforeSave` — see "Settings persistence" below.
- **Two streaming callbacks per execute call**: `onStream(text)` for cumulative assistant
  text and `onProgress(event)` for `ProgressEvent` (thinking / tool_use / status / text).
  `text` events also feed `onStream` so callers don't have to subscribe to both.

## Patterns

### Adding or changing a CLI provider
1. Update `LLMProvider` in `src/types.ts`. Add a `DEFAULT_PROVIDER_CONFIGS` entry.
2. Add an entry to `DEFAULT_COMMANDS` and `PARSERS` in `src/executor/LLMExecutor.ts`.
3. Implement a `parse<Provider>Output(output: string): ParsedResponse` function next to
   the existing parsers.
4. If the CLI streams JSON events line-by-line, add a branch in
   `LLMExecutor.parseStreamingEvents` so progress events flow into the chat UI.
5. If the prompt should arrive on stdin (recommended for long prompts — avoids `ARG_MAX`),
   add the provider to the `useStdin` check in `LLMExecutor.runCLI` (`LLMExecutor.ts`).
6. Add a model list to `PROVIDER_MODELS` in `src/types.ts`.
7. Add a display name to `PROVIDER_DISPLAY_NAMES`.
8. Add settings UI in `src/settings/SettingsTab.ts`.

### Adding ACP support to a provider
1. Add the provider to `ACP_SUPPORTED_PROVIDERS` in `src/types.ts`.
2. Add a case to `AcpExecutor.getAcpCommand` (`AcpExecutor.ts`) returning
   `{ cmd, args, env? }` for the ACP adapter or `--experimental-acp` flag.
3. Verify the adapter speaks ACP over **stdio**, not HTTP. OpenCode does *not* qualify.

### Settings persistence (cloud-sync safe)
- **Always go through `LLMPlugin.saveSettings`** — it calls `mergeBeforeSave`
  (`main.ts`), which re-reads the plugin data file from disk and merges per-provider configs and
  chat sessions. This protects user changes from another device that arrived via Obsidian
  Sync between our load and our save. Do **not** overwrite the plugin data file wholesale.
- New settings fields must be added to `DEFAULT_SETTINGS` and any in-place migration goes
  in `LLMPlugin.loadSettings` next to the existing migrations.
- Chat sessions are persisted under the `_chatSessions` key alongside settings via
  `LLMPlugin.saveChatSessions`. They are merged by id in `mergeBeforeSave`.

### Spawning child processes
- Always pass `env: getShellEnv(config.envVars)` from `src/utils/shellPath.ts`. Without it,
  GUI Obsidian on macOS will not find homebrew/nvm-installed CLIs.
- Use `shell: false` and pass arguments as an array — never interpolate user input into a
  shell string.
- Track the active process on the executor (`activeProcess`) so `cancel()` can SIGTERM it,
  and clear it in both `error` and `close` handlers.

### Local server HTTP
- Use the `httpRequest` / `httpStreamRequest` helpers in `LocalLLMExecutor.ts` (raw Node
  `http`). Do not use `fetch` against `localhost` LLM servers from inside Obsidian.
- Always run user-supplied URLs through `normalizeUrl` (`LocalLLMExecutor.ts`) so
  `localhost` becomes `127.0.0.1`.

### Vault context (RAG over truncation)
- When a feature wants to "include the user's notes", retrieve relevant chunks via
  `VaultSearch` (`src/utils/vaultSearch.ts`). Do not concatenate full note bodies and
  truncate — see the `feedback_no_truncation` user memory.

### Debug logging
- Each executor has a `debug` arrow function gated on `settings.debugMode`. Prefix logs
  with the class name in brackets (e.g. `[AcpExecutor]`). Truncate long payloads to ~500
  chars when logging.

## AI Response Efficiency
- Respond concisely. Lead with the answer or action, not the reasoning.
- No trailing summaries repeating what was just done.
- Only add code comments where the logic is non-obvious.
- Prefer editing existing files over creating new ones.
- When reading context via MCP, use `cai_search` or `mode: summary` before loading full files.

## Verify Checklist

Run these after any non-trivial change before reporting done:

- [ ] `npm run build` succeeds (this runs `tsc -noEmit -skipLibCheck` first).
- [ ] If you added a provider, the new provider appears everywhere it should:
      `LLMProvider` union, `DEFAULT_PROVIDER_CONFIGS`, `PROVIDER_DISPLAY_NAMES`,
      `PROVIDER_MODELS`, `DEFAULT_COMMANDS`, `PARSERS`, settings UI. TypeScript exhaustive
      switches will catch most omissions.
- [ ] Any new setting has a `DEFAULT_SETTINGS` entry and any necessary migration in
      `LLMPlugin.loadSettings`.
- [ ] Subprocess spawns use `getShellEnv(...)` and `shell: false`.
- [ ] Local server URLs are passed through `normalizeUrl`.
- [ ] No new use of `fetch()` against local LLM servers.
- [ ] No code overwrites the plugin data file directly — all writes go through `saveSettings` /
      `saveChatSessions`.
- [ ] If the change touches user-facing behaviour, update the README "Features" section.
<!-- cai:end -->
