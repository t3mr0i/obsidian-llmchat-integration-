---
name: add-cli-provider
description: Add a new CLI-based LLM provider end-to-end (types, executor command + parser, models, settings UI). The most common extension task in this codebase.
triggers:
  - "add provider"
  - "new provider"
  - "support new cli"
  - "add llm"
edges:
  - target: ../context/conventions.md
    condition: when verifying you touched every required slot for a new provider
  - target: ../context/architecture.md
    condition: when you need to understand executor boundaries before extending them
last_updated: 2026-04-07
---

# Add a new CLI-based LLM provider

## Anchor

`src/executor/LLMExecutor.ts:27` — every provider exists in two parallel tables; both must
gain an entry:

```ts
const DEFAULT_COMMANDS: Record<CLIProvider, string[]> = {
  claude: ["claude", "--verbose", "--output-format", "stream-json"],
  gemini: ["gemini", "--output-format", "json"],
  codex: ["codex", "exec", "--skip-git-repo-check"],
  opencode: ["opencode", "run", "--format", "json"],
};

const PARSERS: Record<CLIProvider, (output: string) => ParsedResponse> = {
  claude: parseClaudeOutput,
  gemini: parseGeminiOutput,
  codex: parseCodexOutput,
  opencode: parseOpenCodeOutput,
};
```

`src/types.ts:4` — the union type `LLMProvider` is the spine. Adding a value here causes
TypeScript to flag every record/switch that needs updating, which is the cheapest way to
discover the full surface.

## Context

Read `context/architecture.md` "Key Components" → `LLMExecutor`, then
`context/conventions.md` "Adding or changing a CLI provider" for the canonical checklist.
The provider's CLI must accept the prompt either on stdin or as a final positional arg, and
should be able to emit JSON (ideally streaming JSON) for token usage.

## Steps

1. **Decide the value name.** It becomes a key in many records — keep it short and
   lower-case (e.g. `"mistral"`, not `"MistralCLI"`).
2. **Edit `src/types.ts`:**
   - Add the literal to the `LLMProvider` union.
   - Add an entry to `PROVIDER_DISPLAY_NAMES`.
   - Add an entry to `PROVIDER_MODELS` (start with just `{ value: "", label: "Default" }`
     and a few common models).
   - Add an entry to `DEFAULT_PROVIDER_CONFIGS` with `enabled: false`.
   - If the CLI supports ACP-over-stdio, also add it to `ACP_SUPPORTED_PROVIDERS`.
3. **Edit `src/executor/LLMExecutor.ts`:**
   - Add an entry to `DEFAULT_COMMANDS` with the binary name and any flags that select a
     JSON output format.
   - Write a `parse<Name>Output(output: string): ParsedResponse` function next to the other
     parsers. Extract the assistant text and (if available) input/output tokens.
   - Add the parser to `PARSERS`.
   - In `buildCommand` (`LLMExecutor.ts:543`), add a case to the model-flag switch.
   - If the prompt should be sent on stdin (recommended for long prompts to avoid
     `ARG_MAX`), add the provider to the `useStdin` test in `runCLI` (`LLMExecutor.ts:406`).
   - If the CLI streams events, add a branch in `parseStreamingEvents` so progress events
     reach the chat UI.
4. **Settings UI:** add a section in `src/settings/SettingsTab.ts` mirroring the existing
   provider sections — at minimum: enable toggle, model dropdown (uses
   `fetchModelsForProvider`), custom-command field, additional-args field.
5. **Auto-detection (optional but expected):** add the binary name to the detection logic
   in `src/utils/autoDetect.ts` so it shows up in "Scan for AI providers".
6. **Models fetching (optional):** if the CLI exposes `cli models`, mirror
   `fetchOpenCodeModels` in `src/utils/modelFetcher.ts`.

## Gotchas

- **Forgetting `useStdin`:** if the CLI accepts long prompts only on stdin and you leave
  it on the positional-arg path, prompts above ~256 KB will hit `E2BIG` / `ARG_MAX` and
  spawn will fail with no useful error.
- **Skipping `getShellEnv`:** all spawns must inherit shell PATH. The shared `runCLI`
  already handles this — but if you write a side-channel spawn (e.g. for `cli models`),
  use `getShellEnv()` from `src/utils/shellPath.ts`.
- **CJS wrapper inside the parser:** parsers receive the full stdout buffer. For streaming
  formats, parse line-by-line and skip blank lines — see `parseClaudeOutput` for the
  template.
- **`PROVIDER_MODELS` with stale ids:** if your CLI's models list drifts, `defaultProvider`
  saved in user settings can become invalid. The repo already has a fix for this
  (commit `40382ea`: reset stored model when not in fetched list) — preserve it.

## Verify

- [ ] `npm run build` succeeds — TS catches missed switch arms.
- [ ] The provider appears in the settings tab and can be enabled.
- [ ] Sending a prompt from `ChatView` returns text.
- [ ] Token counts (if the CLI returns them) appear in `LLMResponse.tokensUsed`.
- [ ] Cancelling mid-stream from the chat UI actually kills the child process.
- [ ] If you added an ACP-capable provider, also follow `add-acp-support.md`.

## Debug

- Enable Debug mode in plugin settings, then check the developer console for
  `[LLMExecutor]` lines (the command, stdout/stderr chunks, exit code).
- If the spawn fails with `ENOENT`, the binary is not on PATH from inside Obsidian — see
  `spawn-cli-shellpath.md`.
- If parsing returns an empty `content`, log the raw `output` argument inside your parser
  to see whether the CLI is emitting JSON at all on this version.

## After This Task
- [ ] Update `.cai/ROUTER.md` "Current Project State" if a new provider materially changes what's working.
- [ ] Update `.cai/context/architecture.md` "External Dependencies" with the new CLI.
- [ ] If this is a new task type without a pattern, create one in `.cai/patterns/` and add to `INDEX.md`.
