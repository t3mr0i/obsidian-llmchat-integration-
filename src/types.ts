/**
 * Supported LLM providers - CLI tools and local servers
 */
export type LLMProvider = "claude" | "opencode" | "codex" | "gemini" | "local";

/**
 * Providers that use CLI subprocess execution (excludes HTTP-based providers)
 */
export type CLIProvider = Exclude<LLMProvider, "local">;

/**
 * Local LLM server types
 */
export type LocalServerType = "ollama" | "openai-compatible";

/**
 * Configuration for a specific LLM provider
 */
export interface ProviderConfig {
  /** Whether this provider is enabled */
  enabled: boolean;
  /** Model to use (provider-specific, e.g., "claude-3-5-haiku-latest", "gemini-2.0-flash") */
  model?: string;
  /** Custom command to invoke (if different from default) */
  customCommand?: string;
  /** Additional CLI arguments */
  additionalArgs?: string[];
  /** Environment variables to set */
  envVars?: Record<string, string>;
  /** Timeout in seconds (optional - uses default if not set) */
  timeout?: number;
  /** Gemini: Enable yolo mode (auto-confirm dangerous operations) */
  yoloMode?: boolean;
  /** Use ACP (Agent Client Protocol) for persistent connection (supported: claude, opencode, gemini) */
  useAcp?: boolean;
  /** Thinking mode level for ACP (e.g., "none", "low", "medium", "high") - agent-specific */
  thinkingMode?: string;
  /** Local LLM: Server URL (e.g., http://127.0.0.1:11434) */
  serverUrl?: string;
  /** Local LLM: Server type for API compatibility */
  serverType?: LocalServerType;
  /** Local LLM: Temperature (0.0 - 2.0) */
  temperature?: number;
  /** Local LLM: Max tokens for response (0 = unlimited) */
  maxTokens?: number;
}

/**
 * Display names for each provider
 */
export const PROVIDER_DISPLAY_NAMES: Record<LLMProvider, string> = {
  claude: "Claude",
  opencode: "OpenCode",
  codex: "Codex",
  gemini: "Gemini",
  local: "Local LLM",
};

/**
 * Providers that support ACP (Agent Client Protocol)
 */
export const ACP_SUPPORTED_PROVIDERS: LLMProvider[] = ["claude", "opencode", "gemini", "codex"];

/**
 * Common model options per provider
 * Updated April 2026 - see each provider's documentation for latest models
 */
export const PROVIDER_MODELS: Record<LLMProvider, { value: string; label: string }[]> = {
  claude: [
    { value: "", label: "Default (CLI default)" },
    // Current generation
    { value: "claude-opus-4-6", label: "Claude Opus 4.6 (flagship)" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (balanced)" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fast)" },
    // Previous generation
    { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { value: "claude-opus-4-5", label: "Claude Opus 4.5" },
    { value: "claude-opus-4-1", label: "Claude Opus 4.1" },
    { value: "claude-sonnet-4-0", label: "Claude Sonnet 4" },
    { value: "claude-opus-4-0", label: "Claude Opus 4" },
  ],
  gemini: [
    { value: "", label: "Default (CLI default)" },
    // Latest
    { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (flagship, preview)" },
    { value: "gemini-3-flash-preview", label: "Gemini 3 Flash (fast, preview)" },
    { value: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite (budget, preview)" },
    // Production
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro (reasoning)" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (fast)" },
    { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite (budget)" },
    // Specialized
    { value: "gemini-3.1-flash-live-preview", label: "Gemini 3.1 Flash Live (realtime)" },
    { value: "deep-research-pro-preview-12-2025", label: "Deep Research Pro (autonomous)" },
  ],
  opencode: [
    { value: "", label: "Default (CLI default)" },
    // Anthropic
    { value: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6 (flagship)" },
    { value: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6 (balanced)" },
    { value: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5 (fast)" },
    // OpenAI
    { value: "openai/gpt-5.4", label: "GPT-5.4 (flagship)" },
    { value: "openai/gpt-5.4-mini", label: "GPT-5.4 Mini (fast)" },
    { value: "openai/gpt-5.4-nano", label: "GPT-5.4 Nano (budget)" },
    { value: "openai/o3", label: "o3 (reasoning)" },
    { value: "openai/o4-mini", label: "o4-mini (reasoning, fast)" },
    // Copilot
    { value: "github-copilot/gpt-5", label: "GPT-5 (Copilot)" },
    { value: "github-copilot/gpt-5-mini", label: "GPT-5 Mini (Copilot)" },
  ],
  codex: [
    { value: "", label: "Default (CLI default)" },
    { value: "gpt-5.4", label: "GPT-5.4 (flagship)" },
    { value: "gpt-5.4-mini", label: "GPT-5.4 Mini (fast)" },
    { value: "gpt-5.4-nano", label: "GPT-5.4 Nano (budget)" },
    { value: "o3", label: "o3 (reasoning)" },
    { value: "o4-mini", label: "o4-mini (reasoning, fast)" },
    { value: "gpt-5", label: "GPT-5" },
    { value: "gpt-4o", label: "GPT-4o (legacy)" },
  ],
  local: [
    { value: "", label: "Fetch models from server..." },
  ],
};

/**
 * Plugin settings
 */
export interface LLMPluginSettings {
  /** Default provider to use */
  defaultProvider: LLMProvider;
  /** Per-provider configurations */
  providers: Record<LLMProvider, ProviderConfig>;
  /** Where to insert LLM responses */
  insertPosition: "cursor" | "end" | "replace-selection";
  /** Whether to show streaming output */
  streamOutput: boolean;
  /** Path to system prompt file in vault (empty = none) */
  systemPromptFile: string;
  /** Default timeout in seconds for all providers */
  defaultTimeout: number;
  /** Conversation history settings */
  conversationHistory: {
    enabled: boolean;
    maxMessages: number;
  };
  /** Allow LLM to write/edit files (requires dangerous permissions) */
  allowFileWrites: boolean;
  /** Enable debug logging to console */
  debugMode: boolean;
}

/**
 * Default provider configurations based on deliberate tool patterns
 */
export const DEFAULT_PROVIDER_CONFIGS: Record<LLMProvider, ProviderConfig> = {
  claude: {
    enabled: true,
    useAcp: true,
  },
  opencode: {
    enabled: false,
    useAcp: true,
  },
  codex: {
    enabled: false,
    useAcp: true,
  },
  gemini: {
    enabled: false,
    useAcp: true,
  },
  local: {
    enabled: false,
    serverUrl: "http://127.0.0.1:11434",
    serverType: "ollama",
    temperature: 0.7,
    maxTokens: 0,
  },
};

/**
 * Default plugin settings
 */
export const DEFAULT_SETTINGS: LLMPluginSettings = {
  defaultProvider: "claude",
  providers: DEFAULT_PROVIDER_CONFIGS,
  insertPosition: "cursor",
  streamOutput: true,
  systemPromptFile: "",
  defaultTimeout: 120,
  conversationHistory: {
    enabled: true,
    maxMessages: 10,
  },
  allowFileWrites: false,
  debugMode: false,
};

/**
 * Message in a conversation
 */
export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  provider: LLMProvider;
}

/**
 * Result from an LLM invocation
 */
export interface LLMResponse {
  content: string;
  provider: LLMProvider;
  tokensUsed?: {
    input: number;
    output: number;
  };
  durationMs: number;
  error?: string;
}

/**
 * Progress event types emitted during LLM execution
 */
export type ProgressEvent =
  | { type: "thinking"; content: string }
  | { type: "tool_use"; tool: string; input?: string; status?: "started" | "completed" }
  | { type: "text"; content: string }
  | { type: "status"; message: string };
