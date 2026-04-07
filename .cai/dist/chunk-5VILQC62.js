#!/usr/bin/env node

// src/mcp/install.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";
function isMcpRegistered(settingsPath) {
  if (!existsSync(settingsPath)) return false;
  try {
    const raw = readFileSync(settingsPath, "utf8");
    const json = JSON.parse(raw);
    const servers = json.mcpServers;
    return Boolean(servers?.cai);
  } catch {
    return false;
  }
}
function writeDirectly(settingsPath) {
  let json = {};
  if (existsSync(settingsPath)) {
    try {
      json = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
    }
  }
  const servers = json.mcpServers ?? {};
  servers.cai = { command: "cai", args: ["mcp", "start"] };
  json.mcpServers = servers;
  mkdirSync(join(settingsPath, ".."), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(json, null, 2) + "\n", "utf8");
}
function ensureMcpRegistered(projectRoot) {
  const projectSettings = join(projectRoot, ".claude", "settings.json");
  const globalSettings = join(homedir(), ".claude", "settings.json");
  if (isMcpRegistered(projectSettings) || isMcpRegistered(globalSettings)) {
    return { status: "already_registered" };
  }
  const result = spawnSync("claude", ["mcp", "add", "cai", "--", "cai", "mcp", "start"], {
    cwd: projectRoot,
    stdio: "pipe"
  });
  if (result.error) {
    const code = result.error.code;
    if (code === "ENOENT") {
      try {
        writeDirectly(projectSettings);
        return {
          status: "registered",
          message: "written to .claude/settings.json (claude CLI not found)"
        };
      } catch (err) {
        return { status: "claude_not_found" };
      }
    }
    return { status: "failed", message: result.error.message };
  }
  const stderr = result.stderr?.toString() ?? "";
  if (result.status !== 0 && stderr.toLowerCase().includes("already")) {
    return { status: "already_registered" };
  }
  if (result.status !== 0) {
    try {
      writeDirectly(projectSettings);
      return { status: "registered" };
    } catch {
      return { status: "failed", message: stderr.trim() || "unknown error" };
    }
  }
  return { status: "registered" };
}
function ensureCaiHooks(projectRoot) {
  const settingsPath = join(projectRoot, ".claude", "settings.json");
  let json = {};
  if (existsSync(settingsPath)) {
    try {
      json = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
    }
  }
  const hooks = json.hooks ?? {};
  let installed = 0;
  if (hooks.postCompact) {
    delete hooks.postCompact;
  }
  if (hooks.preToolUse) {
    delete hooks.preToolUse;
  }
  if (!hooks.PreCompact) {
    hooks.PreCompact = [
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: "echo 'Context was compacted. Re-read CLAUDE.md and .cai/ROUTER.md before continuing. Verify your current task and plan are still loaded.'"
          }
        ]
      }
    ];
    installed++;
  }
  if (!hooks.PreToolUse) {
    hooks.PreToolUse = [
      {
        matcher: "Bash",
        hooks: [
          {
            type: "command",
            command: "jq -r '.tool_input.command // empty' | grep -qE 'git +push.*--force' && { echo 'BLOCKED: Force push detected.' >&2; exit 2; } || exit 0"
          }
        ]
      }
    ];
    installed++;
  }
  const existingStopHooks = hooks.Stop ?? [];
  const verifyAlreadyPresent = existingStopHooks.some(
    (block) => (block.hooks ?? []).some((h) => (h.command || "").includes("cai verify --hook"))
  );
  if (!verifyAlreadyPresent) {
    const verifyBlock = {
      matcher: "",
      hooks: [{ type: "command", command: "cai verify --hook" }]
    };
    hooks.Stop = existingStopHooks.length === 0 ? [verifyBlock] : [...existingStopHooks, verifyBlock];
    installed++;
  }
  if (installed > 0 || Object.keys(hooks).length > 0) {
    json.hooks = hooks;
    mkdirSync(join(settingsPath, ".."), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(json, null, 2) + "\n", "utf8");
  }
  return installed;
}
function ensureLearnHook(projectRoot) {
  return installHook(projectRoot, "UserPromptSubmit", "cai learn record");
}
function ensureSessionAutoHook(projectRoot) {
  return installHook(projectRoot, "UserPromptSubmit", "cai session --auto");
}
function removeSessionAutoHook(projectRoot) {
  return removeHook(projectRoot, "UserPromptSubmit", "cai session --auto");
}
function ensureVerifyHook(projectRoot) {
  return installHook(projectRoot, "Stop", "cai verify --hook");
}
function removeVerifyHook(projectRoot) {
  return removeHook(projectRoot, "Stop", "cai verify --hook");
}
function installHook(projectRoot, event, command) {
  const settingsPath = join(projectRoot, ".claude", "settings.json");
  let json = {};
  if (existsSync(settingsPath)) {
    try {
      json = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
    }
  }
  const hooks = json.hooks ?? {};
  const existing = hooks[event] ?? [];
  for (const block of existing) {
    if (!block.hooks) continue;
    for (const h of block.hooks) {
      if (h.command && h.command.includes(command)) {
        return "already-present";
      }
    }
  }
  const newBlock = {
    matcher: "",
    hooks: [{ type: "command", command }]
  };
  const result = existing.length === 0 ? "installed" : "merged";
  hooks[event] = existing.length === 0 ? [newBlock] : [...existing, newBlock];
  json.hooks = hooks;
  mkdirSync(join(settingsPath, ".."), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(json, null, 2) + "\n", "utf8");
  return result;
}
function removeHook(projectRoot, event, commandFragment) {
  const settingsPath = join(projectRoot, ".claude", "settings.json");
  if (!existsSync(settingsPath)) return false;
  let json;
  try {
    json = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    return false;
  }
  const hooks = json.hooks ?? {};
  const existing = hooks[event] ?? [];
  if (existing.length === 0) return false;
  let changed = false;
  const filtered = existing.map((block) => {
    if (!block.hooks) return block;
    const before = block.hooks.length;
    const remaining = block.hooks.filter((h) => !(h.command || "").includes(commandFragment));
    if (remaining.length !== before) changed = true;
    return { ...block, hooks: remaining };
  }).filter((block) => (block.hooks ?? []).length > 0);
  if (!changed) return false;
  if (filtered.length === 0) {
    delete hooks[event];
  } else {
    hooks[event] = filtered;
  }
  json.hooks = hooks;
  writeFileSync(settingsPath, JSON.stringify(json, null, 2) + "\n", "utf8");
  return true;
}
function removeLearnHook(projectRoot) {
  return removeHook(projectRoot, "UserPromptSubmit", "cai learn record");
}

export {
  ensureMcpRegistered,
  ensureCaiHooks,
  ensureLearnHook,
  ensureSessionAutoHook,
  removeSessionAutoHook,
  ensureVerifyHook,
  removeVerifyHook,
  removeLearnHook
};
//# sourceMappingURL=chunk-5VILQC62.js.map