#!/usr/bin/env node

// src/session-auto.ts
import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
var DEFAULT_MAX_CHARS = 800;
function git(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 1024 * 1024,
      timeout: 500
    });
  } catch {
    return "";
  }
}
function buildAutoContext(opts) {
  const { projectRoot } = opts;
  const statusOut = git(projectRoot, ["status", "--porcelain"]);
  const changedFiles = [];
  for (const line of statusOut.split("\n")) {
    if (!line.trim()) continue;
    const file = line.slice(3).trim();
    if (file.startsWith(".cai/") || file.startsWith(".claude/")) continue;
    changedFiles.push(file);
  }
  const logOut = git(projectRoot, ["log", "-3", "--format=%h %s"]);
  const recentCommits = logOut.split("\n").filter(Boolean);
  const hotFiles = readHotFiles(projectRoot, opts.hotFilesDays ?? 7);
  const driftSummary = readLatestDrift(projectRoot);
  return { changedFiles, recentCommits, hotFiles, driftSummary };
}
function readHotFiles(projectRoot, days) {
  const path = join(projectRoot, ".cai", ".cache", "queries.jsonl");
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf8");
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1e3;
    const counts = /* @__PURE__ */ new Map();
    for (const line of raw.split("\n")) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.ts < cutoff || !parsed.file) continue;
        counts.set(parsed.file, (counts.get(parsed.file) ?? 0) + 1);
      } catch {
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([f]) => f);
  } catch {
    return [];
  }
}
function readLatestDrift(projectRoot) {
  const path = join(projectRoot, ".cai", ".cache", "drift-history.jsonl");
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    if (lines.length === 0) return null;
    const last = JSON.parse(lines[lines.length - 1]);
    const scoreLabel = last.weightedScore !== void 0 ? `${last.score} (weighted ${last.weightedScore})` : `${last.score}`;
    return `drift: ${scoreLabel}/100, ${last.errors}E ${last.warnings}W`;
  } catch {
    return null;
  }
}
function renderAutoContext(ctx, maxChars = DEFAULT_MAX_CHARS) {
  const parts = [];
  if (ctx.driftSummary) {
    parts.push(`[cai] ${ctx.driftSummary}`);
  }
  if (ctx.changedFiles.length > 0) {
    const head = ctx.changedFiles.slice(0, 8);
    const more = ctx.changedFiles.length > 8 ? ` (+${ctx.changedFiles.length - 8} more)` : "";
    parts.push(`[cai] uncommitted: ${head.join(", ")}${more}`);
  }
  if (ctx.recentCommits.length > 0) {
    parts.push(`[cai] recent commits:
  ${ctx.recentCommits.join("\n  ")}`);
  }
  if (ctx.hotFiles.length > 0) {
    parts.push(`[cai] hot context files (last 7d): ${ctx.hotFiles.join(", ")}`);
  }
  if (parts.length === 0) return "";
  const full = parts.join("\n");
  if (full.length <= maxChars) return full;
  return full.slice(0, maxChars - 1) + "\u2026";
}
function renderHookOutput(text) {
  if (!text) return {};
  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: text
    }
  };
}
function runSessionAuto(projectRoot) {
  try {
    if (!existsSync(join(projectRoot, ".cai")) && !existsSync(join(projectRoot, ".context-condensing"))) {
      return "{}";
    }
    const ctx = buildAutoContext({ projectRoot });
    const text = renderAutoContext(ctx);
    return JSON.stringify(renderHookOutput(text));
  } catch {
    return "{}";
  }
}
export {
  buildAutoContext,
  renderAutoContext,
  renderHookOutput,
  runSessionAuto
};
//# sourceMappingURL=session-auto-GMRPIB3P.js.map