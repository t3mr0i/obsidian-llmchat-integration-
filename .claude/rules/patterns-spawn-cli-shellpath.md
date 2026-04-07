<!-- cai:start -->
# patterns/spawn-cli-shellpath.md (auto-generated — edit .cai/patterns/spawn-cli-shellpath.md)

# Spawn a CLI from the plugin (PATH-safe)

## Anchor

`src/utils/shellPath.ts`:

```ts
export function getShellPATH(): string {
  if (cachedPath) return cachedPath;
  try {
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
  // ... fallback list ...
}
```

`src/executor/LLMExecutor.ts`:

```ts
const child = spawn(cmd, args, {
  cwd: cwd || undefined,
  env: getShellEnv(config.envVars),
  shell: false,
  stdio: useStdin ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
});
```

## Context

GUI apps launched from the macOS Dock / Finder do **not** inherit the user's interactive
shell PATH. Anything installed via homebrew, nvm, asdf, cargo, pyenv, etc. is invisible to
`spawn` unless we resolve PATH ourselves. The plugin runs `$SHELL -ilc 'echo $PATH'` once
on first use and caches the result for the session. Read `context/decisions.md` → "Resolve `$PATH`
via login shell on macOS" for the rationale.

## Steps

1. **Import the helper:**
   ```ts
   import { getShellEnv } from "../utils/shellPath"; // or "./utils/shellPath"
   ```
2. **Always pass `env: getShellEnv(extraVars?)`** to `spawn` / `exec` / `execFile`. Pass
   per-provider `envVars` from `ProviderConfig.envVars` as the optional argument so the
   user's overrides win.
3. **Always set `shell: false`** and pass arguments as an array. Never interpolate user
   input into a shell string — both for safety and to avoid quoting bugs.
4. **For `stdin` prompts**, use `stdio: ["pipe", "pipe", "pipe"]` and write the prompt to
   `child.stdin` after spawn, calling `.end()` to flush. Used for long prompts to avoid
   `ARG_MAX` (`E2BIG`) errors. Otherwise use `stdio: ["ignore", "pipe", "pipe"]` and pass
   the prompt as a positional arg.
5. **Track the active process** on your executor (`this.activeProcess = child`) and clear
   it in *both* the `error` and `close` handlers, so `cancel()` can SIGTERM it cleanly.
6. **Set a timeout.** Use `setTimeout` + `child.kill("SIGTERM")` based on `config.timeout
   ?? this.settings.defaultTimeout`. Clear the timeout in the `close` handler.
7. **For one-shot helpers** like `cli models`, prefer `promisify(exec)` from
   `node:util` — but still set `env: getShellEnv()` and a `timeout`.

## Gotchas

- **`shell: true` opens injection holes** and changes argument parsing. Don't use it.
- **`shellPath` is cached for the lifetime of the plugin process.** If a user installs a
  CLI without restarting Obsidian, they'll need to reload — there is currently no manual
  cache bust. Document this in your error message if relevant.
- **Login shell can be slow.** `$SHELL -ilc` sources the user's full rc file (5s timeout
  in `getShellPATH`). Don't call it on hot paths — `getShellEnv()` is safe because it
  goes through the cached `getShellPATH()`.
- **Windows PATH is not handled.** The plugin is desktop-only macOS/Linux in practice;
  the fallback list is POSIX-flavoured.
- **Killing by SIGTERM may not be enough** for some Node CLIs that ignore signals. If a
  process is hung on stdin you may need to also `child.stdin?.destroy()` before kill.

## Verify

- [ ] `npm run build` succeeds.
- [ ] On macOS, the new spawn finds CLIs installed via homebrew/nvm even when Obsidian
      was launched from the Dock.
- [ ] Cancelling a request from the chat UI kills the child process within ~1s.
- [ ] No `shell: true` introduced anywhere.
- [ ] No interpolation of user input into a string passed to `spawn`/`exec`.

## Debug

- Enable Debug mode and look for `[LLMExecutor] Executing command:` log lines — they
  print the resolved `cmd` and first arg.
- If `ENOENT` persists, run the same `$SHELL -ilc 'echo $PATH'` from a terminal and
  confirm the CLI directory is in the result. If not, fix the user's shell rc file.
- For `EACCES`, the binary is on PATH but not executable — chmod +x or reinstall.

## After This Task
- [ ] If you added a new spawn site, update `.cai/context/architecture.md` if it
      represents a new component or external dependency.
<!-- cai:end -->
