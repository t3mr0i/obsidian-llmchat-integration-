---
name: debug-cli-spawn
description: Diagnose CLI subprocess failures (claude/gemini/codex/opencode) — PATH, parsing, ACP handshake.
triggers:
  - "spawn"
  - "enoent"
  - "cli not found"
  - "empty response"
  - "acp hang"
  - "executor failure"
edges:
  - target: ../context/architecture.md
    condition: when you need to know which executor handles which provider
  - target: add-provider.md
    condition: when the failure is in a provider you just added
last_updated: 2026-04-07
---

# Debug CLI Subprocess Failures

## Anchor — relevant code

`src/executor/LLMExecutor.ts`:

```ts
const DEFAULT_COMMANDS: Record<CLIProvider, string[]> = {
  claude: ["claude", "--verbose", "--output-format", "stream-json"],
  gemini: ["gemini", "--output-format", "json"],
  codex: ["codex", "exec", "--skip-git-repo-check"],
  opencode: ["opencode", "run", "--format", "json"],
};
```

`src/utils/shellPath.ts` — `getShellEnv()` is what makes spawned CLIs findable when Obsidian was launched from Finder.

## Context

CLI failures fall into a small number of buckets:

1. **PATH** — `spawn ENOENT`. The binary works in your terminal but not from Obsidian.
2. **Parsing** — the CLI runs and exits 0 but the chat shows an empty or garbled response.
3. **ACP handshake** — using the persistent executor and the agent never sends the first session update.
4. **Auth** — the CLI prompts for login or returns an auth error inside its JSON output. The plugin can't fix this; the user must run the CLI's own login flow once.
5. **Hanging** — the CLI is waiting on stdin (interactive mode) instead of running non-interactively.

Find the right boundary first, then apply the fix below. Don't shotgun.

## Steps

1. **Reproduce on the command line.** Copy the args from `DEFAULT_COMMANDS` and run the CLI directly with the same prompt. If it doesn't work in a terminal either, the bug is in the CLI or the user's CLI config — not in the plugin.
2. **Enable `debugMode`** in plugin settings. Open Obsidian's dev console (Cmd-Opt-I) and look for `[LLM Plugin]` lines. The executor logs the resolved command, working directory, and parsed output.
3. **Check PATH:** in the dev console, run `process.env.PATH`. Compare to `/bin/zsh -ilc 'echo $PATH'` in a terminal. If they differ, `getShellEnv()` either isn't being called or isn't picking up the right shell.
4. **Check parsing:** if the CLI ran fine and printed output but the chat is empty, dump the raw stdout in the executor (temporarily) and confirm the parser branch you expect is matching. Stream-json parsers must tolerate non-JSON warning lines on stdout.
5. **ACP hang:** disable ACP for that provider in settings (`useAcp: false`) and retry via `LLMExecutor`. If CLI mode works, the bug is in the ACP code path or in the agent's ACP support, not in the parser.
6. **Hanging waiting for stdin:** confirm the args force non-interactive mode. The current commands all do (`exec`, `run`, etc.) — if you added a new provider and forgot, that's your bug.

## Gotchas

- **`spawn ENOENT` does NOT mean the CLI is missing.** It usually means PATH is empty. Check `getShellEnv()` was passed to `spawn` options.
- **OpenCode `useAcp: true` will silently misbehave** — there's a load-time migration that flips it back to `false`. If you re-set it in code, expect failure. Use CLI mode for OpenCode.
- **Claude streaming JSON has multiple event types.** A common parser bug is to take only `result` events; the canonical content is `assistant.message.content[].text` blocks. The current parser uses `hasAssistantContent` to avoid duplicating the result fallback.
- **CWD matters.** Some CLIs (codex, opencode) behave differently inside vs outside a git repo. The plugin passes `cwd` to `spawn` — if it's wrong, behavior changes.
- **`activeProcess` is only one slot.** Sending a second prompt while one is in flight will overwrite the reference. Cancel the first or wait.
- **Sessions don't survive a settings change.** `updateSettings()` does not clear `sessionIds`, but any change that re-creates the executor does — this can show up as "the chat forgot the previous turn".

## Verify

- [ ] Same args succeed in a terminal.
- [ ] `debugMode` log shows the expected command, env, and cwd.
- [ ] If parsing is the issue, raw stdout matches the parser's expected shape.
- [ ] If ACP is the issue, falling back to CLI works.

## After This Task
- [ ] If you discovered a new failure mode, add it to the Gotchas list above.
- [ ] If the fix changed the executor's public surface, update `.cai/context/architecture.md`.
