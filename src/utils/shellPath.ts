import { execSync, exec } from "child_process";

let cachedPath: string | null = null;
let prewarmPromise: Promise<void> | null = null;

/**
 * Get the full user shell PATH.
 *
 * macOS GUI apps don't inherit the user's shell PATH (nvm, homebrew, etc. are missing).
 * This runs a login shell to get the real PATH and caches the result.
 */
function getShellPATH(): string {
  if (cachedPath) return cachedPath;

  try {
    // Run user's default shell as login shell to source .zshrc/.bashrc
    const shell = process.env.SHELL || "/bin/zsh";
    const result = execSync(`${shell} -ilc 'echo $PATH'`, {
      timeout: 5000,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (result) {
      cachedPath = result;
      return result;
    }
  } catch {
    // Fallback: try common paths manually
  }

  // Fallback: append common binary locations to existing PATH
  const fallbackPaths = [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    `${process.env.HOME}/.local/bin`,
    `${process.env.HOME}/.nvm/versions/node/current/bin`,
    `${process.env.HOME}/.cargo/bin`,
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];

  cachedPath = [process.env.PATH, ...fallbackPaths].filter(Boolean).join(":");
  return cachedPath;
}

/**
 * Get a full process.env with the correct shell PATH.
 */
export function getShellEnv(extra?: Record<string, string>): Record<string, string> {
  return {
    ...process.env as Record<string, string>,
    PATH: getShellPATH(),
    ...extra,
  };
}

// Resolve the shell PATH asynchronously on plugin load so the first real spawn
// doesn't pay the login-shell boot cost (can be 100–500 ms).
export function prewarmShellPath(): Promise<void> {
  if (cachedPath) return Promise.resolve();
  if (prewarmPromise) return prewarmPromise;

  prewarmPromise = new Promise<void>((resolve) => {
    const shell = process.env.SHELL || "/bin/zsh";
    exec(`${shell} -ilc 'echo $PATH'`, { timeout: 5000, encoding: "utf-8" }, (err, stdout) => {
      if (!err && stdout) {
        const trimmed = stdout.trim();
        if (trimmed) cachedPath = trimmed;
      }
      resolve();
    });
  });
  return prewarmPromise;
}
