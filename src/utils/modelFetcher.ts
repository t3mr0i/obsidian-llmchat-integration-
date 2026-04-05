/**
 * Utility for dynamically fetching available models from CLI tools
 */
import { exec } from "child_process";
import { promisify } from "util";
import type { LLMProvider, ProviderConfig } from "../types";
import { PROVIDER_MODELS } from "../types";
import { LocalLLMExecutor } from "../executor/LocalLLMExecutor";

const execAsync = promisify(exec);

export interface ModelOption {
  value: string;
  label: string;
}

// Cache fetched models to avoid repeated CLI calls
const modelCache: Map<LLMProvider, { models: ModelOption[]; timestamp: number }> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ACP models cache - populated when ACP connects, preferred over CLI/static models
const acpModelCache: Map<LLMProvider, ModelOption[]> = new Map();

/**
 * Set ACP models for a provider (called when ACP connects)
 * These are preferred over static/CLI models when available
 */
export function setAcpModels(
  provider: LLMProvider,
  models: Array<{ modelId: string; name: string; description?: string | null }>
): void {
  const options: ModelOption[] = [{ value: "", label: "Default (ACP default)" }];

  for (const model of models) {
    options.push({
      value: model.modelId,
      label: model.name || model.modelId,
    });
  }

  acpModelCache.set(provider, options);
}

/**
 * Clear ACP models for a provider (called when ACP disconnects)
 */
export function clearAcpModels(provider: LLMProvider): void {
  acpModelCache.delete(provider);
}

/**
 * Check if ACP models are available for a provider
 */
export function hasAcpModels(provider: LLMProvider): boolean {
  return acpModelCache.has(provider);
}

/**
 * Get models for OpenCode by calling `opencode models`
 */
async function fetchOpenCodeModels(): Promise<ModelOption[]> {
  try {
    const { stdout } = await execAsync("opencode models", { timeout: 10000 });
    const models: ModelOption[] = [{ value: "", label: "Default (CLI default)" }];

    // Parse the output - each line has "provider/model" format
    // Skip lines that don't look like model IDs (e.g., INFO logs)
    const lines = stdout.trim().split("\n");
    for (const line of lines) {
      const model = line.trim();
      // Skip empty lines, INFO/WARN/ERROR logs, and lines without /
      if (!model || model.startsWith("INFO") || model.startsWith("WARN") || model.startsWith("ERROR")) {
        continue;
      }
      if (model.includes("/")) {
        // Create a friendly label from the model ID
        const [provider, name] = model.split("/", 2);
        const label = `${name} (${provider})`;
        models.push({ value: model, label });
      }
    }

    return models.length > 1 ? models : PROVIDER_MODELS.opencode;
  } catch {
    // CLI not available or failed - use static fallback
    return PROVIDER_MODELS.opencode;
  }
}

/**
 * Get models from a local LLM server
 */
async function fetchLocalModels(config?: ProviderConfig): Promise<ModelOption[]> {
  const serverUrl = config?.serverUrl || "http://localhost:11434";
  const serverType = config?.serverType || "ollama";
  try {
    const models = await LocalLLMExecutor.fetchModels(serverUrl, serverType);
    if (models.length === 0) {
      return [{ value: "", label: "No models found on server" }];
    }
    return models;
  } catch {
    return [{ value: "", label: "Cannot reach server — check settings" }];
  }
}

/**
 * Fetch available models for a provider
 * Prefers ACP models if available, otherwise uses CLI/static models
 */
export async function fetchModelsForProvider(
  provider: LLMProvider,
  providerConfig?: ProviderConfig
): Promise<ModelOption[]> {
  // Prefer ACP models if available (more accurate when connected)
  const acpModels = acpModelCache.get(provider);
  if (acpModels && acpModels.length > 1) {
    return acpModels;
  }

  // Check CLI cache
  const cached = modelCache.get(provider);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.models;
  }

  let models: ModelOption[];
  switch (provider) {
    case "opencode":
      models = await fetchOpenCodeModels();
      break;
    case "local":
      models = await fetchLocalModels(providerConfig);
      break;
    default:
      // Claude, Gemini, Codex — use static model lists
      models = PROVIDER_MODELS[provider] ?? [{ value: "", label: "Default" }];
  }

  modelCache.set(provider, { models, timestamp: Date.now() });
  return models;
}

/**
 * Clear the model cache (useful after settings changes)
 */
export function clearModelCache(): void {
  modelCache.clear();
}

/**
 * Clear all caches (both CLI and ACP)
 */
export function clearAllModelCaches(): void {
  modelCache.clear();
  acpModelCache.clear();
}
