#!/usr/bin/env node

// src/pattern/cluster.ts
import { execFileSync } from "child_process";
function detectTaskTypeFromFiles(files) {
  const f = files.join(" ").toLowerCase();
  if (/auth|login|logout|session|token|jwt|oauth|password/.test(f)) return "auth-flow";
  if (/route|controller|handler|endpoint|\bapi\b/.test(f)) return "api-endpoint";
  if (/model|schema|entity|migration|prisma/.test(f)) return "data-model";
  if (/\.test\.|\.spec\.|__tests?__|^tests?\//m.test(f)) return "test-coverage";
  if (/config|\.env|settings|dockerfile|\.yaml$|\.yml$/.test(f)) return "config-change";
  if (files.length >= 3) return "new-feature";
  return "general-change";
}
var MIN_OCCURRENCES = 3;
var RECENT_DAYS = 30;
var MAX_COMMITS_TO_SCAN = 50;
function git(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 8 * 1024 * 1024
    });
  } catch {
    return "";
  }
}
function readRecentCommits(projectRoot, maxCount = MAX_COMMITS_TO_SCAN) {
  const sep = "";
  const marker = "CAICOMMIT";
  const out = git(projectRoot, [
    "log",
    `-${maxCount}`,
    "--name-only",
    `--format=${marker}%H${sep}%aI${sep}%s`
  ]);
  if (!out.trim()) return [];
  const commits = [];
  const blocks = out.split(marker).filter((b) => b.trim());
  for (const block of blocks) {
    const lines = block.split("\n").filter(Boolean);
    if (lines.length === 0) continue;
    const headerParts = lines[0].split(sep);
    if (headerParts.length < 3) continue;
    const [hash, date, subject] = headerParts;
    const files = lines.slice(1);
    const taskType = detectTaskTypeFromFiles(files);
    commits.push({ hash: hash.slice(0, 7), date, subject, files, taskType });
  }
  return commits;
}
function clusterCommits(commits) {
  const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1e3;
  const recent = commits.filter((c) => new Date(c.date).getTime() >= cutoff);
  const byType = /* @__PURE__ */ new Map();
  for (const c of recent) {
    if (c.taskType === "general-change") continue;
    const list = byType.get(c.taskType) ?? [];
    list.push(c);
    byType.set(c.taskType, list);
  }
  const clusters = [];
  for (const [taskType, group] of byType) {
    if (group.length < MIN_OCCURRENCES) continue;
    const commonFiles = extractCommonFiles(group);
    const lastSeen = group.map((c) => c.date).sort((a, b) => b.localeCompare(a))[0];
    clusters.push({ taskType, commits: group, commonFiles, lastSeen });
  }
  return clusters.sort((a, b) => {
    if (b.commits.length !== a.commits.length) return b.commits.length - a.commits.length;
    return b.lastSeen.localeCompare(a.lastSeen);
  });
}
function extractCommonFiles(commits) {
  const counts = /* @__PURE__ */ new Map();
  for (const c of commits) {
    for (const f of c.files) {
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
  }
  const threshold = Math.floor(commits.length / 2) + 1;
  return Array.from(counts.entries()).filter(([, n]) => n >= threshold).sort((a, b) => b[1] - a[1]).map(([f]) => f);
}
export {
  clusterCommits,
  extractCommonFiles,
  readRecentCommits
};
//# sourceMappingURL=cluster-EEXGHMFP.js.map