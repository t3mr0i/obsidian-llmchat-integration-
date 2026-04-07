#!/usr/bin/env node

// src/drift/history.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, renameSync } from "fs";
import { dirname, join } from "path";
var CACHE_DIR = join(".cai", ".cache");
var HISTORY_FILE = "drift-history.jsonl";
var ROTATE_AT_BYTES = 256 * 1024;
function isDisabled() {
  return Boolean(process.env.CAI_NO_TELEMETRY);
}
function historyPath(projectRoot) {
  return join(projectRoot, CACHE_DIR, HISTORY_FILE);
}
function appendHistory(projectRoot, entry) {
  if (isDisabled()) return;
  try {
    const path = historyPath(projectRoot);
    mkdirSync(dirname(path), { recursive: true });
    const line = JSON.stringify({ ts: Date.now(), ...entry }) + "\n";
    appendFileSync(path, line, "utf8");
    if (Math.random() < 0.02) {
      maybeRotate(path);
    }
  } catch {
  }
}
function maybeRotate(path) {
  try {
    const size = statSync(path).size;
    if (size < ROTATE_AT_BYTES) return;
    renameSync(path, `${path}.old`);
  } catch {
  }
}
function readHistory(projectRoot) {
  const path = historyPath(projectRoot);
  if (!existsSync(path)) return [];
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const entries = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
    }
  }
  return entries.sort((a, b) => a.ts - b.ts);
}
var SPARK_CHARS = ["\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"];
function renderSparkline(values) {
  if (values.length === 0) return "";
  if (values.length === 1) return SPARK_CHARS[7];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values.map((v) => {
    const idx = Math.round((v - min) / range * (SPARK_CHARS.length - 1));
    return SPARK_CHARS[idx];
  }).join("");
}
function summarizeHistory(entries) {
  if (entries.length === 0) return null;
  const scores = entries.map((e) => e.weightedScore ?? e.score);
  const current = scores[scores.length - 1];
  const previous = scores.length > 1 ? scores[scores.length - 2] : null;
  const delta = previous !== null ? current - previous : null;
  const sum = scores.reduce((a, b) => a + b, 0);
  const sparkSeries = scores.slice(-30);
  return {
    count: entries.length,
    current,
    previous,
    delta,
    best: Math.max(...scores),
    worst: Math.min(...scores),
    average: Math.round(sum / scores.length),
    sparkline: renderSparkline(sparkSeries)
  };
}

export {
  appendHistory,
  readHistory,
  renderSparkline,
  summarizeHistory
};
//# sourceMappingURL=chunk-WX2YGCKP.js.map