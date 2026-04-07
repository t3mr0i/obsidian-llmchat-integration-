import { spawn } from "child_process";
import type { LLMProvider, LLMPluginSettings, LocalServerType } from "../types";
import { detectAvailableProviders } from "../executor/LLMExecutor";
import { LocalLLMExecutor } from "../executor/LocalLLMExecutor";
import { getShellEnv } from "./shellPath";

/**
 * Known local LLM server endpoints to probe
 */
const LOCAL_SERVER_PROBES: {
  name: string;
  url: string;
  type: LocalServerType;
}[] = [
  { name: "Ollama", url: "http://127.0.0.1:11434", type: "ollama" },
  { name: "LM Studio", url: "http://127.0.0.1:1234", type: "openai-compatible" },
  { name: "MLX", url: "http://127.0.0.1:8080", type: "openai-compatible" },
  { name: "vLLM", url: "http://127.0.0.1:8000", type: "openai-compatible" },
  { name: "llama.cpp", url: "http://127.0.0.1:8081", type: "openai-compatible" },
  { name: "text-generation-webui", url: "http://127.0.0.1:5000", type: "openai-compatible" },
  { name: "LocalAI", url: "http://127.0.0.1:8082", type: "openai-compatible" },
  { name: "Jan", url: "http://127.0.0.1:1337", type: "openai-compatible" },
];

/**
 * Known install locations for local LLM software (macOS + Linux)
 */
const LOCAL_SOFTWARE: {
  name: string;
  /** CLI binary names to check in PATH */
  binaries: string[];
  /** macOS .app bundle paths */
  appPaths: string[];
  /** Default server port */
  url: string;
  type: LocalServerType;
  /** Command to start the server (if binary found) */
  startCommand?: { cmd: string; args: string[] };
  /** Command to list installed models */
  listModelsCommand?: { cmd: string; args: string[] };
  /** Recommended small model to pull if none installed */
  defaultModel?: string;
  /** Command to pull a model */
  pullCommand?: (model: string) => { cmd: string; args: string[] };
}[] = [
  {
    name: "Ollama",
    binaries: ["ollama"],
    appPaths: ["/Applications/Ollama.app"],
    url: "http://127.0.0.1:11434",
    type: "ollama",
    startCommand: { cmd: "ollama", args: ["serve"] },
    listModelsCommand: { cmd: "ollama", args: ["list"] },
    defaultModel: "qwen3.5:0.8b",
    pullCommand: (model) => ({ cmd: "ollama", args: ["pull", model] }),
  },
  {
    name: "LM Studio",
    binaries: ["lms"],
    appPaths: ["/Applications/LM Studio.app"],
    url: "http://127.0.0.1:1234",
    type: "openai-compatible",
    startCommand: { cmd: "lms", args: ["server", "start"] },
  },
  {
    name: "MLX",
    binaries: ["mlx_lm.server"],
    appPaths: [],
    url: "http://127.0.0.1:8080",
    type: "openai-compatible",
    // MLX needs a --model argument, can't auto-start without knowing the model
  },
];

export interface DetectedProvider {
  provider: LLMProvider;
  name: string;
  serverName?: string;
  serverUrl?: string;
  serverType?: LocalServerType;
  models?: string[];
}

export interface LocalSoftwareStatus {
  name: string;
  installed: boolean;
  serverRunning: boolean;
  hasModels: boolean;
  models: string[];
  url: string;
  type: LocalServerType;
  canAutoStart: boolean;
  canPullModels: boolean;
  defaultModel?: string;
}

export interface DetectionResult {
  detected: DetectedProvider[];
  localSoftware: LocalSoftwareStatus[];
  hasNew: boolean;
}

// ────────────────────────────────────────────
//  Main detection
// ────────────────────────────────────────────

/**
 * Full scan: CLI tools, installed software, running servers
 */
export async function autoDetectProviders(): Promise<DetectionResult> {
  const detected: DetectedProvider[] = [];

  const [cliProviders, localStatuses] = await Promise.all([
    detectAvailableProviders(),
    detectLocalSoftware(),
  ]);

  // CLI providers
  const cliNames: Record<string, string> = {
    claude: "Claude CLI",
    opencode: "OpenCode CLI",
    codex: "Codex CLI",
    gemini: "Gemini CLI",
  };
  for (const provider of cliProviders) {
    detected.push({ provider, name: cliNames[provider] || provider });
  }

  // Local servers (running + have models)
  for (const status of localStatuses) {
    if (status.serverRunning && status.hasModels) {
      detected.push({
        provider: "local",
        name: `Local LLM (${status.name})`,
        serverName: status.name,
        serverUrl: status.url,
        serverType: status.type,
        models: status.models,
      });
    }
  }

  return {
    detected,
    localSoftware: localStatuses,
    hasNew: detected.length > 0,
  };
}

// ────────────────────────────────────────────
//  Local software detection
// ────────────────────────────────────────────

/**
 * Check each known local LLM software:
 * Is it installed? Is the server running? Are there models?
 */
async function detectLocalSoftware(): Promise<LocalSoftwareStatus[]> {
  return Promise.all(LOCAL_SOFTWARE.map(checkSoftware));
}

/**
 * Public alias for detectLocalSoftware — used by ChatView for auto-start.
 */
export function detectLocalSoftwareStatuses(): Promise<LocalSoftwareStatus[]> {
  return detectLocalSoftware();
}

async function checkSoftware(
  sw: (typeof LOCAL_SOFTWARE)[number]
): Promise<LocalSoftwareStatus> {
  const status: LocalSoftwareStatus = {
    name: sw.name,
    installed: false,
    serverRunning: false,
    hasModels: false,
    models: [],
    url: sw.url,
    type: sw.type,
    canAutoStart: !!sw.startCommand,
    canPullModels: !!sw.pullCommand,
    defaultModel: sw.defaultModel,
  };

  // 1. Check if installed (binary in PATH or .app exists)
  const [binaryFound, appFound] = await Promise.all([
    checkBinaryExists(sw.binaries),
    checkAppExists(sw.appPaths),
  ]);
  status.installed = binaryFound || appFound;

  if (!status.installed) return status;

  // 2. Check if server is running + get models from API
  try {
    const result = await LocalLLMExecutor.testConnection(sw.url, sw.type);
    status.serverRunning = result.ok;
    if (result.ok && result.models) {
      status.models = result.models;
      status.hasModels = result.models.length > 0;
    }
  } catch {
    status.serverRunning = false;
  }

  // 3. If server not running or no models from API, check CLI for locally installed models
  //    (Ollama stores models locally — `ollama list` works even when server is down)
  if (!status.hasModels && sw.listModelsCommand && binaryFound) {
    const cliModels = await listModelsViaCLI(sw.listModelsCommand);
    if (cliModels.length > 0) {
      status.models = cliModels;
      status.hasModels = true;
    }
  }

  return status;
}

/**
 * Run a CLI command to list locally installed models (e.g. `ollama list`).
 * Parses table output where the first column is the model name.
 */
function listModelsViaCLI(command: { cmd: string; args: string[] }): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawn(command.cmd, command.args, {
      stdio: ["ignore", "pipe", "ignore"],
      env: getShellEnv(),
    });

    let output = "";
    child.stdout?.on("data", (data: Buffer) => {
      output += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        resolve([]);
        return;
      }
      // Parse: skip header line, first column is model name
      const lines = output.trim().split("\n").slice(1);
      const models = lines
        .map((line) => line.trim().split(/\s+/)[0])
        .filter(Boolean);
      resolve(models);
    });

    child.on("error", () => resolve([]));
    setTimeout(() => { child.kill(); resolve([]); }, 5000);
  });
}

function checkBinaryExists(binaries: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    if (binaries.length === 0) {
      resolve(false);
      return;
    }
    // Use `which` to check all binaries
    let found = false;
    let pending = binaries.length;
    for (const bin of binaries) {
      const child = spawn("which", [bin], { stdio: ["ignore", "pipe", "ignore"], env: getShellEnv() });
      child.on("close", (code) => {
        if (code === 0) found = true;
        pending--;
        if (pending === 0) resolve(found);
      });
      child.on("error", () => {
        pending--;
        if (pending === 0) resolve(found);
      });
    }
    setTimeout(() => resolve(found), 3000);
  });
}

function checkAppExists(appPaths: string[]): Promise<boolean> {
  if (appPaths.length === 0) return Promise.resolve(false);
  // Use `test -d` for each path
  return new Promise((resolve) => {
    let found = false;
    let pending = appPaths.length;
    for (const p of appPaths) {
      const child = spawn("test", ["-d", p], { stdio: "ignore" });
      child.on("close", (code) => {
        if (code === 0) found = true;
        pending--;
        if (pending === 0) resolve(found);
      });
      child.on("error", () => {
        pending--;
        if (pending === 0) resolve(found);
      });
    }
    setTimeout(() => resolve(found), 2000);
  });
}

// ────────────────────────────────────────────
//  Server start / model pull
// ────────────────────────────────────────────

/**
 * Start a local LLM server in the background.
 * Returns true if the server became reachable within the timeout.
 */
export async function startLocalServer(
  softwareName: string
): Promise<{ ok: boolean; error?: string }> {
  const sw = LOCAL_SOFTWARE.find((s) => s.name === softwareName);
  if (!sw || !sw.startCommand) {
    return { ok: false, error: `Cannot auto-start ${softwareName}` };
  }

  // Start server as detached background process
  const child = spawn(sw.startCommand.cmd, sw.startCommand.args, {
    stdio: "ignore",
    detached: true,
    env: getShellEnv(),
  });
  child.unref();

  // Wait for server to become reachable (up to 15s)
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    try {
      const result = await LocalLLMExecutor.testConnection(sw.url, sw.type);
      if (result.ok) {
        return { ok: true };
      }
    } catch {
      // Not yet ready
    }
  }

  return { ok: false, error: `${softwareName} server did not start within 15 seconds` };
}

/**
 * Pull/download a model. Returns when the pull completes.
 * onProgress is called with status lines from the CLI.
 */
export async function pullModel(
  softwareName: string,
  modelName: string,
  onProgress?: (line: string) => void
): Promise<{ ok: boolean; error?: string }> {
  const sw = LOCAL_SOFTWARE.find((s) => s.name === softwareName);
  if (!sw || !sw.pullCommand) {
    return { ok: false, error: `${softwareName} does not support pulling models` };
  }

  const { cmd, args } = sw.pullCommand(modelName);

  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: getShellEnv(),
    });

    let lastLine = "";

    child.stdout?.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        lastLine = line;
        onProgress?.(line);
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        lastLine = line;
        onProgress?.(line);
      }
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, error: lastLine || `Exit code ${code}` });
      }
    });

    child.on("error", (err) => {
      resolve({ ok: false, error: err.message });
    });

    // Timeout after 10 minutes (large models take a while)
    setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: "Download timed out after 10 minutes" });
    }, 600_000);
  });
}

// ────────────────────────────────────────────
//  Also probe unknown servers (ports without known software)
// ────────────────────────────────────────────

/**
 * Probe all known ports for running servers.
 * Used as fallback if no known software was detected.
 */
export async function probeAllPorts(): Promise<
  { name: string; url: string; type: LocalServerType; models: string[] }[]
> {
  const results = await Promise.all(
    LOCAL_SERVER_PROBES.map(async (probe) => {
      try {
        const result = await LocalLLMExecutor.testConnection(probe.url, probe.type);
        if (result.ok && result.models && result.models.length > 0) {
          return { ...probe, models: result.models };
        }
      } catch {
        // Not reachable
      }
      return null;
    })
  );
  return results.filter((r): r is NonNullable<typeof r> => r !== null);
}

// ────────────────────────────────────────────
//  Apply results to settings
// ────────────────────────────────────────────

export function applyDetectionResults(
  settings: LLMPluginSettings,
  result: DetectionResult
): boolean {
  let changed = false;

  const hasAnyEnabled = Object.values(settings.providers).some((p) => p.enabled);

  for (const det of result.detected) {
    const config = settings.providers[det.provider];

    if (det.provider === "local" && det.serverUrl && det.serverType) {
      if (!config.enabled || !config.model) {
        config.enabled = true;
        config.serverUrl = det.serverUrl;
        config.serverType = det.serverType;
        if (det.models && det.models.length > 0 && !config.model) {
          config.model = det.models[0];
        }
        changed = true;
      }
    } else if (!config.enabled && !hasAnyEnabled) {
      config.enabled = true;
      changed = true;
    }
  }

  // Set default to first detected+enabled provider if current default isn't available
  if (result.detected.length > 0) {
    const currentDefault = settings.defaultProvider;
    const currentDefaultDetected = result.detected.some(
      (d) => d.provider === currentDefault
    );
    const currentDefaultEnabled = settings.providers[currentDefault]?.enabled;

    if (!currentDefaultDetected || !currentDefaultEnabled) {
      const firstEnabled = result.detected.find(
        (d) => settings.providers[d.provider].enabled
      );
      if (firstEnabled) {
        settings.defaultProvider = firstEnabled.provider;
        changed = true;
      }
    }
  }

  return changed;
}

// ────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
