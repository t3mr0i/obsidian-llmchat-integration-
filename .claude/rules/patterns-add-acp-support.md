<!-- cai:start -->
# patterns/add-acp-support.md (auto-generated — edit .cai/patterns/add-acp-support.md)

# Add ACP support to a provider

## Anchor

`src/types.ts`:

```ts
export const ACP_SUPPORTED_PROVIDERS: LLMProvider[] = ["claude", "gemini", "codex"]; // OpenCode ACP uses HTTP, not stdio
```

`src/executor/AcpExecutor.ts` — `getAcpCommand` is the dispatcher for which binary to
spawn for which provider's ACP transport:

```ts
switch (provider) {
  case "opencode":
    baseCmd = providerConfig.customCommand || "opencode";
    baseArgs = ["acp"];
    break;
  case "claude":
    baseCmd = "npx";
    baseArgs = ["-y", "@zed-industries/claude-code-acp"];
    break;
  case "gemini":
    baseCmd = providerConfig.customCommand || "gemini";
    baseArgs = ["--experimental-acp"];
    break;
  case "codex":
    baseCmd = "npx";
    baseArgs = ["-y", "@zed-industries/codex-acp"];
    break;
  default:
    return null;
}
```

## Context

ACP gives us a long-lived session with model state, thinking modes, and structured tool
events instead of spawning a fresh subprocess per turn. We use
`@agentclientprotocol/sdk`'s stdio `ClientSideConnection`. The provider's adapter **must
speak ACP over stdio** — OpenCode does not (its ACP is HTTP-based) and is excluded.

Read `context/architecture.md` "Key Components" → `AcpExecutor` and the WHATWG-stream
adapter functions `nodeToWebReadable` / `nodeToWebWritable` (`AcpExecutor.ts`).

## Steps

1. **Verify the adapter speaks stdio ACP.** If it speaks HTTP, stop — use the CLI executor
   instead and document why in `context/decisions.md`.
2. Add the provider to `ACP_SUPPORTED_PROVIDERS` in `src/types.ts`.
3. Add a `case` to `AcpExecutor.getAcpCommand` returning `{ cmd, args, env? }`. If the
   adapter is published as an npm package, use `npx -y <pkg>` so users don't have to
   pre-install it (matches `claude` / `codex`). If it's a CLI flag on the existing binary,
   use the user's `customCommand` override pattern (matches `gemini`).
4. If the provider exposes thinking modes or model selection through ACP, the existing
   `setAcpModels` call (already wired) will populate the model picker on connect.
5. Default `useAcp` for the provider in `DEFAULT_PROVIDER_CONFIGS` in `src/types.ts` —
   typically `true` for first-class providers, `false` for experimental ones.

## Gotchas

- **Stdio drain backpressure.** `nodeToWebWritable` already handles `drain` events. If you
  see hangs writing to the agent, verify `streamClosed` flag handling.
- **`onunload` cleanup.** ACP holds a child process. The plugin must `await` disconnect on
  unload — check `LLMPlugin.onunload` and `ChatView` cleanup paths if you change lifecycle.
- **`npx -y` first run is slow.** First invocation downloads the adapter package. Surface
  this in the UI as "connecting…" status, not as a hang.
- **Model picker churn.** When ACP disconnects, call `clearAcpModels(provider)` so the UI
  falls back to the CLI/static model list — already done in `AcpExecutor`.
- **OpenCode special case.** `LLMPlugin.loadSettings` (`main.ts`) force-flips
  `providers.opencode.useAcp` to `false` on every load. Do not undo that migration.

## Verify

- [ ] `npm run build` succeeds.
- [ ] Toggling "Use ACP" in settings creates a connection without spawning per-prompt.
- [ ] The model dropdown shows ACP-reported models (not the static `PROVIDER_MODELS` list).
- [ ] Disabling the provider or unloading the plugin fully terminates the child process
      (check Activity Monitor / `ps`).
- [ ] Streaming text events appear word-by-word in the chat view.

## Debug

- Enable Debug mode and watch for `[AcpExecutor]` log lines around connect, session
  start, prompt, and disconnect.
- If `ndJsonStream` errors, inspect raw stdout from the adapter — many errors are JSON-RPC
  framing issues (newline missing, partial chunks).
- If the connection succeeds but prompts time out, check whether the adapter expects
  `cwd` to be set — pass the vault path through `connect(provider, workingDirectory)`.

## After This Task
- [ ] Update `.cai/ROUTER.md` "Current Project State" if ACP support for the provider
      changes what works.
- [ ] If this is a new task type without a pattern, create one in `.cai/patterns/`.
<!-- cai:end -->
