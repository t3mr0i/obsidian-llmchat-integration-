---
name: debug-cli-failure
description: Diagnose hung, errored, or empty-response CLI calls — the most common failure boundary in the plugin.
triggers:
  - "debug"
  - "cli failed"
  - "timeout"
  - "empty response"
  - "ENOENT"
  - "hang"
edges:
  - target: ../context/architecture.md
    condition: when you need to identify which executor handles the failing provider
  - target: spawn-cli-shellpath.md
    condition: when the failure is ENOENT / not-found
  - target: ../context/conventions.md
    condition: when you need the debug logging convention
last_updated: 2026-04-07
---

# Debug a failing CLI / ACP / local-server call

## Anchor

`src/executor/LLMExecutor.ts:614` shows the user-facing error mapping that will obscure
the original stderr if you read only the toast text:

```ts
private parseErrorMessage(provider: CLIProvider, stderr: string, exitCode: number): string {
  const stderrLower = stderr.toLowerCase();
  if (stderrLower.includes("model not found") || ...) {
    return `Model not found: "${modelName}". Check your ${provider} settings ...`;
  }
  if (stderrLower.includes("authentication") || ...) {
    return `Authentication failed for ${provider}. ...`;
  }
  // ...
}
```

The full original stderr is logged via `this.debug(...)` only when **Debug mode** is on
in plugin settings. Always enable that before diagnosing.

## Context

There are three transports and any of them can fail. Identify which executor is in play
first:

- `LLMExecutor` (CLI subprocess) — for any provider with ACP off, plus OpenCode.
- `AcpExecutor` (persistent stdio session) — for claude/gemini/codex when "Use ACP" is on.
- `LocalLLMExecutor` (Node http) — for the `local` provider.

The status bar shows the active provider; the chat view shows the configured provider per
tab. If you don't know which path is firing, the developer console will show
`[LLMExecutor]` / `[AcpExecutor]` / `[LocalLLMExecutor]` lines once Debug is on.

## Steps

1. **Enable Debug mode** in plugin settings (`debugMode: true`). This unlocks
   `this.debug(...)` calls in all three executors.
2. **Open the developer console** (Ctrl/Cmd+Shift+I in Obsidian).
3. **Reproduce the failure** with a short prompt.
4. **Read the log lines in order:**
   - `Executing command: <cmd> <first arg>` — confirms which binary and args.
   - `Working directory:` — confirms `cwd`.
   - `stdout chunk:` / `stderr:` — actual CLI output (truncated to 500 chars per chunk).
   - `Process closed - code: N signal: ...` — exit code or signal.
5. **Match the symptom:**

| Symptom | Likely cause | Where to look |
|---|---|---|
| `Failed to spawn <cmd>: ENOENT` | Binary not on PATH from Obsidian | `spawn-cli-shellpath.md`, restart Obsidian to bust shell PATH cache |
| `Process was killed` after exactly N seconds | Hit `timeout` (per-provider or `defaultTimeout`) | Increase timeout; check the last `stdout chunk` for what the CLI was doing |
| Empty `content` but exit code 0 | Parser didn't recognise the output format | Add a `console.log(output)` inside the parser; check if the CLI changed its JSON shape |
| `Model not found` toast | The CLI rejected `--model <id>` | Verify `PROVIDER_MODELS` ids against the CLI's current list; commit `40382ea` resets stored model when not in fetched list |
| `Authentication failed` | The CLI is not logged in | Run the CLI from a terminal once to authenticate |
| ACP "connecting…" forever | First-run `npx -y` is downloading the adapter, or stdio framing error | Check `[AcpExecutor]` lines; try running `npx -y @zed-industries/claude-code-acp` from a terminal |
| Local server "Cannot reach server" | Wrong URL, IPv6/DNS, or server down | Confirm `127.0.0.1` (not `localhost`); curl the URL from a terminal; check `LocalLLMExecutor` log |

6. **If you suspect the parser**, capture the raw `output` argument:
   ```ts
   function parseClaudeOutput(output: string): ParsedResponse {
     console.log("[parseClaudeOutput] raw:", output.slice(0, 2000));
     // ...
   }
   ```
7. **If the process hangs without exiting**, check whether stdin was closed. The plugin
   writes the prompt then calls `child.stdin.end()` (`LLMExecutor.ts:534`) — if you added
   a code path that forgets the `.end()`, the CLI will wait forever.

## Gotchas

- The `parseErrorMessage` mapper rewrites stderr into friendly text — the original
  stderr is **only** in the debug log, not in the exception message you see in the chat.
- `[AcpExecutor]` errors are often JSON-RPC framing issues from a partially-buffered
  stdio chunk. They surface as cryptic SDK exceptions rather than clean parse errors.
- Cancelling from the chat UI sets `activeProcess = null` and SIGTERMs. If you see a
  later `WARNING: close event fired again - ignoring` line (`LLMExecutor.ts:489`) that's
  benign — the plugin guards against double-handling.
- Local servers may return HTTP 200 with an error body. `LocalLLMExecutor` checks
  `statusCode >= 400` only for the streaming path — inspect bodies on the non-stream
  path.

## Verify (after the fix)

- [ ] The previously failing prompt now succeeds end-to-end.
- [ ] The `parseErrorMessage` mapping for the failure mode is still useful (or update it).
- [ ] Add or update a test in `test/specs/providers.e2e.ts` if the failure was
      reproducible at the e2e level.
- [ ] If the root cause was a CLI version drift, note the version in `setup.md` "Common
      Issues".

## After This Task
- [ ] Update `.cai/context/setup.md` "Common Issues" with the new failure signature and fix.
- [ ] If a new debug pattern emerged, add it to this file.
