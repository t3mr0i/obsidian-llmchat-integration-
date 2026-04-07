---
name: local-llm-http
description: Talking to local LLM servers (Ollama, OpenAI-compatible) — Node http, no fetch, normalize localhost.
triggers:
  - "ollama"
  - "lm studio"
  - "local llm"
  - "local server"
  - "openai compatible"
  - "http request"
edges:
  - target: ../context/decisions.md
    condition: when you need to know why we don't use fetch and why we rewrite localhost
  - target: ../context/architecture.md
    condition: when integrating LocalLLMExecutor with the rest of the executor flow
last_updated: 2026-04-07
---

# Local LLM HTTP Calls

## Anchor — relevant code

`src/executor/LocalLLMExecutor.ts`:

```ts
/**
 * Normalize URL: replace "localhost" with "127.0.0.1" to avoid
 * DNS resolution issues in Electron/Obsidian on macOS.
 */
function normalizeUrl(url: string): string {
  return url.replace(/\/\/localhost([:/])/, "//127.0.0.1$1");
}

/**
 * Make an HTTP request using Node's http module (bypasses Electron fetch issues).
 */
function httpRequest(url: string, options: { method: string; body?: string; timeout?: number }) { … }
```

## Context

Two non-obvious rules govern every local-server call in this plugin:

1. **Use Node's `http` module, not `fetch`.** Electron's `fetch` has misbehaved against local HTTP servers — preflight quirks, hangs against `localhost`, no useful streaming. Node `http` is reliable.
2. **Normalize `localhost` → `127.0.0.1`.** DNS resolution against `localhost` is flaky in Electron on macOS.

Local servers come in two API shapes (`LocalServerType`):
- `"ollama"` — Ollama's native `/api/chat` and `/api/tags` shape.
- `"openai-compatible"` — `/v1/chat/completions` and `/v1/models` (LM Studio, vLLM, llama.cpp, MLX, LocalAI, Jan, text-generation-webui).

Both flow through `LocalLLMExecutor`. `autoDetect.ts` knows the default ports.

## Steps

To **add a new local server type**:

1. If the server speaks an existing wire format, just add a probe entry in `autoDetect.ts` `LOCAL_SERVER_PROBES` with the right `type`. No code change in `LocalLLMExecutor` needed.
2. If the wire format is new: add a member to `LocalServerType` in `src/types.ts`, then branch on it in `LocalLLMExecutor` for `chat`, `streamChat`, and `listModels`. Always go through `httpRequest` and `normalizeUrl`.
3. If the server's binary is installable as a CLI: add a `LOCAL_SOFTWARE` entry in `autoDetect.ts` with `binaries`, `appPaths`, optional `startCommand`, `listModelsCommand`, `defaultModel`, and `pullCommand`.
4. Update `DEFAULT_PROVIDER_CONFIGS.local` only if the new server should become the user's default.

To **make a one-off local request** elsewhere in the plugin: don't. Route through `LocalLLMExecutor`. If you absolutely must, copy the `httpRequest` + `normalizeUrl` pattern — do not call `fetch`.

## Gotchas

- **`fetch()` looks like it works in dev** and silently fails or hangs in production builds against some local servers. Always use `http`.
- **`http.request` defaults to port 80** if you don't supply one. The code reads `parsed.port || 80` which is fine for our explicit URLs but means a malformed URL like `http://127.0.0.1/api/chat` will hit `:80`. Make sure the user's URL has an explicit port.
- **Streaming Ollama responses** are NDJSON, not SSE. Each line is a JSON object with a `done` flag. Don't try to use the `EventSource`-style code from elsewhere in the plugin.
- **Connection refused vs timeout** — `httpRequest` distinguishes them. Treat refused as "server not running" (offer to start it via `autoDetect.startLocalServer`); treat timeout as "model is slow" (longer timeout, not a different action).
- **Local provider is excluded from `CLIProvider`** (`Exclude<LLMProvider, "local">`). The CLI executor explicitly throws if asked to handle it. The chat view picks `LocalLLMExecutor` based on `provider === "local"`.

## Verify

- [ ] No `fetch(` call against any local URL added in your diff (`grep -rn "fetch(" src/`).
- [ ] All local URLs go through `normalizeUrl` (or are already `127.0.0.1`).
- [ ] Connection-refused error surfaces a useful Notice (not a stack trace).
- [ ] `npm run build` passes.

## Debug

- Server unreachable: hit it with `curl http://127.0.0.1:<port>/...` from a terminal. If curl works and the plugin doesn't, double-check you went through `httpRequest` and not `fetch`.
- Hanging request: lower the `timeout` and confirm the timeout fires. Then check whether the server actually flushes responses promptly (some local servers buffer until the full response is ready).
- Wrong model list: the `listModels` path differs by `serverType`. Check `autoDetect.ts` and `LocalLLMExecutor` use the same `serverType` value.

## After This Task
- [ ] Update `.cai/context/architecture.md` external dependencies if a new local server type was added.
- [ ] Update `.cai/context/decisions.md` only if the http-vs-fetch or localhost rule itself changes (it shouldn't).
