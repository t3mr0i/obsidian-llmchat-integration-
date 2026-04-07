#!/usr/bin/env node

// src/learn/corrections.ts
import { createHash } from "crypto";
var NEGATION_RE = /\b(no|nope|nein|stop|don'?t|never|do not|nicht)\b/i;
var REINSTRUCT_RE = /\b(instead|actually|i (told|said) you|remember to|always|please don'?t|stop doing)\b/i;
var REVERT_RE = /\b(undo|revert|go back|original|previous version)\b/i;
function clusterId(signature) {
  return createHash("sha1").update(signature).digest("hex").slice(0, 6);
}
var MIN_CLUSTER_SIZE = 2;
var MIN_PROMPT_LEN = 4;
var MAX_PROMPT_LEN_FOR_DETECTION = 280;
function detectCorrections(entries, opts = {}) {
  const corrections = [];
  for (const e of entries) {
    if (opts.stack && e.stack && e.stack !== opts.stack) continue;
    const text = e.prompt.trim();
    if (text.length < MIN_PROMPT_LEN || text.length > MAX_PROMPT_LEN_FOR_DETECTION) continue;
    let signal = null;
    if (REVERT_RE.test(text)) signal = "revert";
    else if (REINSTRUCT_RE.test(text)) signal = "reinstruct";
    else if (NEGATION_RE.test(text)) signal = "negation";
    if (signal) corrections.push({ ts: e.ts, prompt: text, signal, stack: e.stack });
  }
  return corrections;
}
function normalizeForCluster(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\b(please|bitte|just|the|a|an|to|for|that|this|it|its|de|der|die|das|den)\b/g, "").replace(/\s+/g, " ").trim();
}
function clusterCorrections(corrections) {
  const byKey = /* @__PURE__ */ new Map();
  for (const c of corrections) {
    const key = normalizeForCluster(c.prompt);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(c);
    byKey.set(key, list);
  }
  const clusters = [];
  for (const [signature, list] of byKey) {
    if (list.length < MIN_CLUSTER_SIZE) continue;
    const example = list.slice().sort((a, b) => a.prompt.length - b.prompt.length)[0];
    clusters.push({
      id: clusterId(signature),
      signature,
      example: example.prompt,
      count: list.length,
      signal: example.signal,
      firstSeen: Math.min(...list.map((l) => l.ts)),
      lastSeen: Math.max(...list.map((l) => l.ts))
    });
  }
  return clusters.sort((a, b) => b.count - a.count);
}
function findClusterById(clusters, id) {
  return clusters.find((c) => c.id === id) ?? null;
}
function appendLearnedRule(claudeMdContent, rule) {
  const SECTION_START = "<!-- cai:learn-start -->";
  const SECTION_END = "<!-- cai:learn-end -->";
  const SECTION_HEADER = "## Learned Rules";
  const SECTION_NOTE = "_Added by `cai learn write-rule` from recurring corrections you gave Claude. Edit or remove freely._";
  if (claudeMdContent.includes(SECTION_START) && claudeMdContent.includes(SECTION_END)) {
    return claudeMdContent.replace(SECTION_END, `${rule}
${SECTION_END}`);
  }
  const trimmed = claudeMdContent.replace(/\n+$/, "");
  return `${trimmed}

${SECTION_START}

${SECTION_HEADER}

${SECTION_NOTE}

${rule}

${SECTION_END}
`;
}
function suggestRule(cluster) {
  const text = cluster.example.trim().replace(/[.!?]+$/, "");
  return `- ${text}`;
}

export {
  detectCorrections,
  normalizeForCluster,
  clusterCorrections,
  findClusterById,
  appendLearnedRule,
  suggestRule
};
//# sourceMappingURL=chunk-ILOHIW4R.js.map