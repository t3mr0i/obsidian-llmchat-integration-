---
name: executor
description: Local rules for src/executor/ — subprocess spawning, ACP stdio handshake, stream-JSON parsing. Loads automatically when reading files in this folder.
---

# src/executor/ — Danger Zone

Three classes, one transport each. Provider differences are switch-statements inside; do not split into per-provider classes.

## Key files

| File | What it owns | Don't break |
|------|--------------|-------------|
| `LLMExecutor.ts` | One CLI subprocess per request. `DEFAULT_COMMANDS` + `PARSERS` tables. stdin for claude/opencode (long prompts), positional arg for gemini/codex. Resumable session ids per provider. | The parsers — non-JSON warning lines on stdout are normal; tolerate them. |
| `AcpExecutor.ts` | Persistent stdio session via `@agentclientprotocol/sdk`. Wraps Node child stdio in WHATWG streams (`nodeToWebReadable` / `nodeToWebWritable`). Drives the live model picker via `setAcpModels`. | The stream wrappers — Node streams ≠ Web streams; the SDK requires Web. |
| `LocalLLMExecutor.ts` | HTTP to Ollama (`/api/chat`, `/api/tags`) or OpenAI-compatible (`/v1/chat/completions`, `/v1/models`). Raw Node `http`. | `normalizeUrl` (`localhost` → `127.0.0.1`) and the no-`fetch` rule. |

## Hard rules in this folder

- **`spawn(cmd, args, { env: getShellEnv(config.envVars), shell: false })`** — both pieces are required. No shell strings, ever. No bare `process.env`.
- **Track `activeProcess`** so `cancel()` can SIGTERM it. Clear it in **both** `error` and `close` handlers — only one of them fires per process exit.
- **Stream-JSON parsers must tolerate non-JSON lines.** CLIs print warnings on stdout that are not always valid JSON. Wrap each `JSON.parse` in try/catch and treat the line as plain text on failure (see `parseClaudeOutput`).
- **Claude parser:** the canonical content is `assistant.message.content[].text` blocks. The `result` event duplicates that — only fall back to it when `hasAssistantContent` is false. Don't add both, you'll double output.
- **OpenCode tracks pending text per `messageID`** to distinguish intermediate from final. Resetting that state belongs in `resetOpenCodeState()`, not scattered.
- **`local` is excluded from `CLIProvider`** (`Exclude<LLMProvider, "local">`). The CLI executor explicitly throws if asked to handle it. The view picks `LocalLLMExecutor` based on `provider === "local"`.
- **OpenCode does NOT get ACP-stdio.** Its ACP transport is HTTP, not stdio. There's a load-time migration in `main.ts` that flips `useAcp` back to `false` for OpenCode — do not re-enable it here.

## Streaming protocol the view expects

Two callbacks per `execute` call:
- `onStream(chunk: string)` — cumulative assistant text (the chat bubble grows from this)
- `onProgress(event: ProgressEvent)` — structured `thinking | tool_use | text | status` (the progress strip above the input)

Text events feed both — callers don't subscribe twice. New event shapes go in the `ProgressEvent` union in `src/types.ts`, never as ad-hoc strings.

## Debug

- `this.debug(msg, ...)` is gated on `settings.debugMode`. Prefix with the class name in brackets, e.g. `[LLMExecutor]`. Truncate long payloads to ~500 chars.
- If responses are blank: dump raw stdout temporarily and confirm the parser branch you expect is matching. Most "empty response" bugs are parser bugs.
- If ACP hangs at handshake: flip `useAcp: false` for that provider and retry via `LLMExecutor`. If CLI mode works, the bug is in the ACP path or in the agent's ACP support, not in your parser.

## Related patterns

- `.cai/patterns/add-cli-provider.md` — full add-a-provider workflow
- `.cai/patterns/add-acp-support.md` — wiring a provider into AcpExecutor
- `.cai/patterns/spawn-cli-shellpath.md` — PATH-safety details
- `.cai/patterns/debug-cli-failure.md` — diagnose hung / failed calls
