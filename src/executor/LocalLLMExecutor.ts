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
 * Executor for local LLM servers (Ollama, LM Studio, etc.)
 * Uses the OpenAI-compatible /v1/chat/completions API
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

  /**
   * Execute a chat completion against the local server
   */
  async execute(
    messages: ChatMessage[],
    onStream?: StreamCallback,
    onProgress?: ProgressCallback
  ): Promise<LLMResponse> {
    const config = this.settings.providers.local;
    const serverUrl = config.serverUrl || "http://localhost:11434";
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
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        return {
          content: "",
          provider: "local",
          durationMs: Date.now() - startTime,
          error: this.parseError(response.status, errorText, serverUrl),
        };
      }

      onProgress?.({ type: "thinking", content: "Generating..." });

      const content = await this.readStream(response, onStream, onProgress);

      return {
        content,
        provider: "local",
        durationMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      const error = err as Error;
      if (error.name === "AbortError") {
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

  /**
   * Read SSE stream from the server
   */
  private async readStream(
    response: Response,
    onStream?: StreamCallback,
    onProgress?: ProgressCallback
  ): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    let fullContent = "";
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
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
            // Skip malformed JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return fullContent;
  }

  /**
   * Extract text delta from a streaming chunk
   * Handles both OpenAI format and Ollama format
   */
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

  /**
   * Get chat completions endpoint URL
   */
  private getChatEndpoint(serverUrl: string, serverType?: LocalServerType): string {
    const base = serverUrl.replace(/\/$/, "");
    if (serverType === "ollama") {
      return `${base}/v1/chat/completions`;
    }
    return `${base}/v1/chat/completions`;
  }

  /**
   * Cancel the current request
   */
  cancel(): void {
    this.abortController?.abort();
  }

  /**
   * Test connection to the server
   */
  static async testConnection(
    serverUrl: string,
    serverType: LocalServerType
  ): Promise<{ ok: boolean; error?: string; models?: string[] }> {
    try {
      const base = serverUrl.replace(/\/$/, "");
      const url =
        serverType === "ollama"
          ? `${base}/api/tags`
          : `${base}/v1/models`;

      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return { ok: false, error: `Server returned ${response.status}` };
      }

      const data = await response.json();
      const models = LocalLLMExecutor.parseModelList(data, serverType);

      return { ok: true, models };
    } catch (err: unknown) {
      const error = err as Error;
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        return { ok: false, error: "Connection timed out (5s)" };
      }
      return {
        ok: false,
        error: `Cannot reach ${serverUrl} — is the server running?`,
      };
    }
  }

  /**
   * Fetch available models from the server
   */
  static async fetchModels(
    serverUrl: string,
    serverType: LocalServerType
  ): Promise<{ value: string; label: string }[]> {
    const base = serverUrl.replace(/\/$/, "");
    const url =
      serverType === "ollama"
        ? `${base}/api/tags`
        : `${base}/v1/models`;

    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const data = await response.json();
    const modelIds = LocalLLMExecutor.parseModelList(data, serverType);

    return modelIds.map((id) => ({
      value: id,
      label: id,
    }));
  }

  /**
   * Parse model list from server response
   */
  private static parseModelList(
    data: Record<string, unknown>,
    serverType: LocalServerType
  ): string[] {
    if (serverType === "ollama") {
      // Ollama: { models: [{ name: "llama3:latest", ... }] }
      const models = data.models as Array<{ name?: string }> | undefined;
      return models?.map((m) => m.name || "").filter(Boolean) || [];
    }
    // OpenAI-compatible: { data: [{ id: "model-name" }] }
    const list = data.data as Array<{ id?: string }> | undefined;
    return list?.map((m) => m.id || "").filter(Boolean) || [];
  }

  private parseError(status: number, body: string, serverUrl: string): string {
    if (status === 404) {
      return `Model not found on server. Check that the model is pulled/available at ${serverUrl}.`;
    }
    if (status === 500) {
      return `Server error from ${serverUrl}. Check server logs for details.`;
    }
    try {
      const parsed = JSON.parse(body);
      return (parsed.error?.message as string) || (parsed.error as string) || body;
    } catch {
      return `Server error (${status}): ${body.slice(0, 200)}`;
    }
  }

  private parseConnectionError(error: Error, serverUrl: string): string {
    const msg = error.message.toLowerCase();
    if (msg.includes("fetch") || msg.includes("econnrefused") || msg.includes("networkerror")) {
      return `Cannot connect to ${serverUrl}. Make sure your local LLM server is running.`;
    }
    return `Connection error: ${error.message}`;
  }
}
