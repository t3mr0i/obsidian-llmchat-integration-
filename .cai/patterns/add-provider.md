---
name: add-provider
description: Add a new LLM provider (CLI or local HTTP) end-to-end — types, executor, settings, detection.
triggers:
  - "add provider"
  - "new provider"
  - "support a new model"
  - "integrate cli"
edges:
  - target: ../context/architecture.md
    condition: when you need the executor flow and where the provider plugs in
  - target: ../context/conventions.md
    condition: when you need the file/type rules and the verify checklist
last_updated: 2026-04-07
---

# Add a New Provider

## Anchor — relevant code

`src/types.ts` is the single source of truth. Every new provider touches this exact set:

```ts
export type LLMProvider = "claude" | "opencode" | "codex" | "gemini" | "local";
export const PROVIDER_DISPLAY_NAMES: Record<LLMProvider, string> = { … };
export const ACP_SUPPORTED_PROVIDERS: LLMProvider[] = ["claude", "gemini", "codex"];
export const PROVIDER_MODELS: Record<LLMProvider, { value: string; label: string }[]> = { … };
export const DEFAULT_PROVIDER_CONFIGS: Record<LLMProvider, ProviderConfig> = { … };
```

And `src/executor/LLMExecutor.ts`:

```ts
const DEFAULT_COMMANDS: Record<CLIProvider, string[]> = {
  claude: ["claude", "--verbose", "--output-format", "stream-json"],
  gemini: ["gemini", "--output-format", "json"],
  codex: ["codex", "exec", "--skip-git-repo-check"],
  opencode: ["opencode", "run", "--format", "json"],
};
const PARSERS: Record<CLIProvider, (output: string) => ParsedResponse> = { … };
```

## Context

Decide first: is this a **CLI provider** (spawned subprocess, possibly with ACP) or a **local HTTP provider** (Ollama-style or OpenAI-compatible)? CLI providers go through `LLMExecutor` and optionally `AcpExecutor`. Local HTTP providers extend `LocalLLMExecutor` instead.

## Steps

1. **Add the literal to the union** in `src/types.ts`:
   - `LLMProvider` union
   - `PROVIDER_DISPLAY_NAMES` (used by ChatView dropdown AND SettingsTab — do not duplicate the constant)
   - `PROVIDER_MODELS` (one entry per known model with `value` and `label`)
   - `DEFAULT_PROVIDER_CONFIGS` (sensible defaults; for CLI providers prefer `enabled: false` unless this is the flagship)
   - `ACP_SUPPORTED_PROVIDERS` only if the provider speaks **stdio** ACP. **HTTP-only ACP does not count** — see OpenCode for the cautionary tale.
2. **CLI provider:** Add to `DEFAULT_COMMANDS` and `PARSERS` in `src/executor/LLMExecutor.ts`. Write a parser function that handles the provider's output format and returns `{ content, tokens?, cost? }`. If the provider streams JSON, parse line-by-line and tolerate non-JSON lines as plain text (see `parseClaudeOutput` for the pattern).
3. **ACP provider:** Add the `Agent` SDK adapter in `AcpExecutor.ts` if it requires special handshake/options. Most stdio ACP agents work with the default flow.
4. **Local HTTP provider:** If the wire format isn't already covered by `serverType: "ollama" | "openai-compatible"`, extend `LocalServerType` and add request/response shaping in `LocalLLMExecutor.ts`. Always call `normalizeUrl` and use `httpRequest` (Node `http`), never `fetch`.
5. **Auto-detect:** Add an entry to `LOCAL_SERVER_PROBES` (HTTP) or to the CLI detection list in `src/utils/autoDetect.ts`. Include install paths for macOS `.app` bundles if applicable, plus `listModelsCommand` and `pullCommand` for local servers.
6. **Settings UI:** `SettingsTab.ts` reads `PROVIDER_DISPLAY_NAMES` / `PROVIDER_MODELS` automatically. Only edit it if your provider needs a unique field (e.g. a new toggle like `yoloMode`); add the field to `ProviderConfig` in `types.ts` first.
7. **Migration:** if older `data.json` shapes exist, add a one-shot fix in `LLMPlugin.loadSettings()` (pattern: check the offending shape, normalize in place, no save needed — next save flows through `mergeBeforeSave`).

## Gotchas

- **PROVIDER_DISPLAY_NAMES used to be duplicated** in `SettingsTab.ts`. Commit `fce0418` centralized it. Do not re-introduce a copy.
- **OpenCode has ACP, but it is HTTP** — do not set `useAcp: true` for it. There is even a load-time migration that flips it back to `false`.
- **CLI not found at runtime** even though it works in your terminal: you forgot `getShellEnv()` in the `spawn` call. Obsidian-from-Finder has empty PATH.
- **Streaming parsers must tolerate partial lines and non-JSON output** — many CLIs print warnings on stderr that occasionally leak to stdout.
- **`local` is not a `CLIProvider`** — `CLIProvider = Exclude<LLMProvider, "local">`. The CLI executor explicitly throws if asked to handle `local`.

## Verify

- [ ] Typecheck passes (`npm run build` first half).
- [ ] Provider appears in the SettingsTab dropdown and the ChatView header dropdown.
- [ ] `npm run test:e2e:providers` passes (or add a new spec under `test/specs/`).
- [ ] Auto-detect surfaces the new provider when its CLI/server is installed.
- [ ] Conventions.md verify checklist items 1, 3, 7, 8 all pass.

## Debug

- Enable `debugMode` in settings, then check the Obsidian dev console — the executor logs prefixed with `[LLM Plugin]`.
- If responses are blank: run the CLI by hand with the same args as `DEFAULT_COMMANDS` to confirm the format you're parsing matches what the CLI actually emits.
- If ACP hangs: check that the agent really speaks stdio ACP (not HTTP), and that the SDK version (`@agentclientprotocol/sdk ^0.13.1`) supports it.

## After This Task
- [ ] Update `.cai/ROUTER.md` "Current Project State" if the supported provider list changed.
- [ ] Update `.cai/context/architecture.md` "External Dependencies" with the new provider.
- [ ] Update `.cai/context/stack.md` if a new library was added.
