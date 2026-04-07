#!/usr/bin/env node

// src/learn/recorder.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
var CACHE_DIR = join(".cai", ".cache");
var LOG_FILE = "sessions.jsonl";
var STATE_FILE = "learn-enabled";
var MAX_PROMPT_BYTES = 8 * 1024;
function logPath(projectRoot) {
  return join(projectRoot, CACHE_DIR, LOG_FILE);
}
function statePath(projectRoot) {
  return join(projectRoot, CACHE_DIR, STATE_FILE);
}
function isLearnEnabled(projectRoot) {
  return existsSync(statePath(projectRoot));
}
function enableLearn(projectRoot) {
  mkdirSync(join(projectRoot, CACHE_DIR), { recursive: true });
  writeFileSync(statePath(projectRoot), (/* @__PURE__ */ new Date()).toISOString() + "\n", "utf8");
}
function disableLearn(projectRoot) {
  const path = statePath(projectRoot);
  if (existsSync(path)) rmSync(path);
}
function forgetLearn(projectRoot) {
  let deletedBytes = 0;
  const log = logPath(projectRoot);
  if (existsSync(log)) {
    deletedBytes = statSync(log).size;
    rmSync(log);
  }
  disableLearn(projectRoot);
  return { deletedBytes };
}
function recordPrompt(projectRoot, prompt, options = {}) {
  try {
    if (!isLearnEnabled(projectRoot)) return;
    const path = logPath(projectRoot);
    mkdirSync(dirname(path), { recursive: true });
    const trimmed = prompt.length > MAX_PROMPT_BYTES ? prompt.slice(0, MAX_PROMPT_BYTES) + "\u2026" : prompt;
    const entry = { ts: Date.now(), prompt: trimmed };
    if (options.source) entry.source = options.source;
    if (options.stack) entry.stack = options.stack;
    appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
  } catch {
  }
}
function readPrompts(projectRoot, opts = {}) {
  const path = logPath(projectRoot);
  if (!existsSync(path)) return [];
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const cutoff = opts.sinceMs ?? 0;
  const entries = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.ts >= cutoff) entries.push(parsed);
    } catch {
    }
  }
  return entries;
}
function sessionLogStats(projectRoot) {
  const path = logPath(projectRoot);
  const enabled = isLearnEnabled(projectRoot);
  if (!existsSync(path)) return { entries: 0, bytes: 0, enabled };
  try {
    const raw = readFileSync(path, "utf8");
    const entries = raw.split("\n").filter(Boolean).length;
    const bytes = statSync(path).size;
    return { entries, bytes, enabled };
  } catch {
    return { entries: 0, bytes: 0, enabled };
  }
}

export {
  isLearnEnabled,
  enableLearn,
  disableLearn,
  forgetLearn,
  recordPrompt,
  readPrompts,
  sessionLogStats
};
//# sourceMappingURL=chunk-CBJHHV5O.js.map