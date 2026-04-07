#!/usr/bin/env node

// src/telemetry/query-log.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "fs";
import { dirname, join } from "path";
var ROTATE_AT_LINES = 1e4;
var CACHE_DIR = join(".cai", ".cache");
var LOG_FILE = "queries.jsonl";
var ROTATED_FILE = "queries.jsonl.old";
function isDisabled() {
  return Boolean(process.env.CAI_NO_TELEMETRY);
}
function logPath(projectRoot) {
  return join(projectRoot, CACHE_DIR, LOG_FILE);
}
function appendQuery(projectRoot, entry) {
  if (isDisabled()) return;
  try {
    const path = logPath(projectRoot);
    mkdirSync(dirname(path), { recursive: true });
    const line = JSON.stringify({ ts: Date.now(), ...entry }) + "\n";
    appendFileSync(path, line, "utf8");
    if (Math.random() < 0.01) {
      maybeRotate(path);
    }
  } catch {
  }
}
function maybeRotate(path) {
  try {
    const size = statSync(path).size;
    if (size < ROTATE_AT_LINES * 120) return;
    const lines = readFileSync(path, "utf8").split("\n");
    if (lines.length < ROTATE_AT_LINES) return;
    renameSync(path, join(dirname(path), ROTATED_FILE));
  } catch {
  }
}
function readQueries(projectRoot, opts = {}) {
  const path = logPath(projectRoot);
  if (!existsSync(path)) return [];
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const cutoff = opts.sinceMs ?? 0;
  const out = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.ts >= cutoff) out.push(parsed);
    } catch {
    }
  }
  return out;
}
function aggregateByFile(queries) {
  const map = /* @__PURE__ */ new Map();
  for (const q of queries) {
    if (!q.file) continue;
    const existing = map.get(q.file);
    if (existing) {
      existing.hits++;
      existing.tokens += q.tokens ?? 0;
      if (q.ts > existing.lastSeen) existing.lastSeen = q.ts;
    } else {
      map.set(q.file, {
        file: q.file,
        hits: 1,
        tokens: q.tokens ?? 0,
        lastSeen: q.ts
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.hits - a.hits);
}
function aggregateByTool(queries) {
  const map = /* @__PURE__ */ new Map();
  for (const q of queries) {
    map.set(q.tool, (map.get(q.tool) ?? 0) + 1);
  }
  return Array.from(map.entries()).map(([tool, hits]) => ({ tool, hits })).sort((a, b) => b.hits - a.hits);
}

export {
  appendQuery,
  readQueries,
  aggregateByFile,
  aggregateByTool
};
//# sourceMappingURL=chunk-XAVW3U2U.js.map