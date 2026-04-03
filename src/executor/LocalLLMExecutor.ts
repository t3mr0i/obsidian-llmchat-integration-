import http from "http";
import type {
  LLMResponse,
  LLMPluginSettings,
  ProgressEvent,
  LocalServerType,
} from "../types";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

type StreamCallback = (chunk: string) => void;
type ProgressCallback = (event: ProgressEvent) => void;

/**
 * Normalize URL: replace "localhost" with "127.0.0.1" to avoid
 * DNS resolution issues in Electron/Obsidian on macOS.
 */
function normalizeUrl(url: string): string {
  return url.replace(/\/\/localhost([:/])/, "//127.0.0.1$1");
}

/**
 * Make an HTTP request using Node's http module (bypasses Electron fetch issues).
 * Returns { statusCode, body } or throws on connection error.
 */
function httpRequest(
  url: string,
  options: { method: string; body?: string; timeout?: number }
): Promise<{ statusCode: number; body: string; rawResponse: http.IncomingMessage }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 80,
        path: parsed.pathname + parsed.search,
        method: options.method,
        headers: options.body
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(options.body) }
          : undefined,
        timeout: options.timeout || 10000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        res.on("end", () => resolve({ statusCode: res.statusCode || 0, body, rawResponse: res }));
        res.on("error", reject);
      }
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Connection timed out"));
    });

    if (options.body) req.write(options.body);
    req.end();
  });
}

/**
 * Make a streaming HTTP request. Calls onChunk for each data chunk.
 */
function httpStreamRequest(
  url: string,
  body: string,
  onChunk: (chunk: string) => void,
  abortSignal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 80,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 120000,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let errBody = "";
          res.on("data", (chunk: Buffer) => { errBody += chunk.toString(); });
          res.on("end", () => reject(new Error(`HTTP ${res.statusCode}: ${errBody}`)));
          return;
        }
        res.on("data", (chunk: Buffer) => onChunk(chunk.toString()));
        res.on("end", resolve);
        res.on("error", reject);
      }
    );

    if (abortSignal) {
      abortSignal.addEventListener("abort", () => {
        req.destroy();
        reject(new Error("Request cancelled"));
      });
    }

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Connection timed out"));
    });

    req.write(body);
    req.end();
  });
}

/**
 * Executor for local LLM servers (Ollama, LM Studio, etc.)
 * Uses Node's http module to avoid Electron fetch issues with localhost.
 */
export class LocalLLMExecutor {
  private settings: LLMPluginSettings;
  private abortController: AbortController | null = null;

  constructor(settings: LLMPluginSettings) {
    this.settings = settings;
  }

  updateSettings(settings: LLMPluginSettings): void {
    this.settings = settings;
  }

  async execute(
    messages: ChatMessage[],
    onStream?: StreamCallback,
    onProgress?: ProgressCallback
  ): Promise<LLMResponse> {
    const config = this.settings.providers.local;
    const serverUrl = normalizeUrl(config.serverUrl || "http://127.0.0.1:11434");
    const model = config.model || "";

    if (!model) {
      return {
        content: "",
        provider: "local",
        durationMs: 0,
        error: "No model selected. Open settings and select a model from your local server.",
      };
    }

    const startTime = Date.now();
    this.abortController = new AbortController();

    onProgress?.({ type: "status", message: `Connecting to ${serverUrl}...` });

    const endpoint = this.getChatEndpoint(serverUrl, config.serverType);

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: true,
    };
    if (config.temperature !== undefined) {
      body.temperature = config.temperature;
    }
    if (config.maxTokens && config.maxTokens > 0) {
      body.max_tokens = config.maxTokens;
    }

    try {
      onProgress?.({ type: "thinking", content: "Generating..." });

      let fullContent = "";
      let buffer = "";

      await httpStreamRequest(
        endpoint,
        JSON.stringify(body),
        (chunk) => {
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === "data: [DONE]") continue;

            const data = trimmed.startsWith("data: ")
              ? trimmed.slice(6)
              : trimmed;

            try {
              const parsed = JSON.parse(data);
              const delta = this.extractDelta(parsed);
              if (delta) {
                fullContent += delta;
                onStream?.(delta);
                onProgress?.({ type: "text", content: delta });
              }
            } catch {
              // Skip malformed JSON
            }
          }
        },
        this.abortController.signal
      );

      return {
        content: fullContent,
        provider: "local",
        durationMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message === "Request cancelled") {
        return {
          content: "",
          provider: "local",
          durationMs: Date.now() - startTime,
          error: "Request cancelled.",
        };
      }
      return {
        content: "",
        provider: "local",
        durationMs: Date.now() - startTime,
        error: this.parseConnectionError(error, serverUrl),
      };
    } finally {
      this.abortController = null;
    }
  }

  private extractDelta(chunk: Record<string, unknown>): string | null {
    // OpenAI format: { choices: [{ delta: { content: "..." } }] }
    const choices = chunk.choices as Array<{ delta?: { content?: string } }> | undefined;
    if (choices?.[0]?.delta?.content) {
      return choices[0].delta.content;
    }

    // Ollama native format: { message: { content: "..." } }
    const message = chunk.message as { content?: string } | undefined;
    if (message?.content) {
      return message.content;
    }

    return null;
  }

  private getChatEndpoint(serverUrl: string, serverType?: LocalServerType): string {
    const base = serverUrl.replace(/\/$/, "");
    return `${base}/v1/chat/completions`;
  }

  cancel(): void {
    this.abortController?.abort();
  }

  /**
   * Test connection using Node http (not fetch).
   */
  static async testConnection(
    serverUrl: string,
    serverType: LocalServerType
  ): Promise<{ ok: boolean; error?: string; models?: string[] }> {
    try {
      const base = normalizeUrl(serverUrl).replace(/\/$/, "");
      const url =
        serverType === "ollama"
          ? `${base}/api/tags`
          : `${base}/v1/models`;

      const result = await httpRequest(url, { method: "GET", timeout: 10000 });

      if (result.statusCode !== 200) {
        return { ok: false, error: `Server returned ${result.statusCode}` };
      }

      const data = JSON.parse(result.body);
      const models = LocalLLMExecutor.parseModelList(data, serverType);

      return { ok: true, models };
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message === "Connection timed out") {
        return { ok: false, error: "Connection timed out (10s)" };
      }
      return {
        ok: false,
        error: `Cannot reach ${serverUrl} — is the server running?`,
      };
    }
  }

  /**
   * Fetch available models using Node http.
   */
  static async fetchModels(
    serverUrl: string,
    serverType: LocalServerType
  ): Promise<{ value: string; label: string }[]> {
    const base = normalizeUrl(serverUrl).replace(/\/$/, "");
    const url =
      serverType === "ollama"
        ? `${base}/api/tags`
        : `${base}/v1/models`;

    const result = await httpRequest(url, { method: "GET", timeout: 10000 });

    if (result.statusCode !== 200) {
      throw new Error(`Server returned ${result.statusCode}`);
    }

    const data = JSON.parse(result.body);
    const modelIds = LocalLLMExecutor.parseModelList(data, serverType);

    return modelIds.map((id) => ({
      value: id,
      label: id,
    }));
  }

  private static parseModelList(
    data: Record<string, unknown>,
    serverType: LocalServerType
  ): string[] {
    if (serverType === "ollama") {
      const models = data.models as Array<{ name?: string }> | undefined;
      return models?.map((m) => m.name || "").filter(Boolean) || [];
    }
    const list = data.data as Array<{ id?: string }> | undefined;
    return list?.map((m) => m.id || "").filter(Boolean) || [];
  }

  private parseConnectionError(error: Error, serverUrl: string): string {
    const msg = error.message.toLowerCase();
    if (msg.includes("econnrefused") || msg.includes("network")) {
      return `Cannot connect to ${serverUrl}. Make sure your local LLM server is running.`;
    }
    if (msg.includes("timed out")) {
      return `Connection to ${serverUrl} timed out.`;
    }
    if (msg.startsWith("http ")) {
      // HTTP error from stream
      return `Server error: ${error.message}`;
    }
    return `Connection error: ${error.message}`;
  }
}
