#!/usr/bin/env node
import {
  collectDependencies,
  listLibrary
} from "./chunk-VJPOQJFL.js";

// src/pattern/matching.ts
var MAX_LIB_BONUS = 3;
var RECENCY_WINDOW_DAYS = 30;
function scoreEntry(entry, project) {
  const reasons = [];
  let score = 0;
  const projectStack = project.rootManifest?.type ?? null;
  if (projectStack && entry.stack === projectStack) {
    score += 2;
    reasons.push(`same stack (${projectStack})`);
  }
  const projectDeps = new Set(collectDependencies(project));
  const overlap = entry.dependencies.filter((d) => projectDeps.has(d));
  if (overlap.length > 0) {
    const bonus = Math.min(overlap.length, MAX_LIB_BONUS);
    score += bonus;
    const sample = overlap.slice(0, 3).join(", ");
    reasons.push(`shared deps: ${sample}${overlap.length > 3 ? `, +${overlap.length - 3}` : ""}`);
  }
  const ageDays = (Date.now() - new Date(entry.createdAt).getTime()) / (1e3 * 60 * 60 * 24);
  if (ageDays < RECENCY_WINDOW_DAYS) {
    const recencyBonus = (RECENCY_WINDOW_DAYS - ageDays) / RECENCY_WINDOW_DAYS;
    score += recencyBonus;
    if (recencyBonus > 0.5) reasons.push(`recent (${Math.round(ageDays)}d ago)`);
  }
  return { entry, score: Math.round(score * 10) / 10, reasons };
}
function findMatching(project) {
  return listLibrary().map((entry) => scoreEntry(entry, project)).filter((m) => m.score > 0).sort((a, b) => b.score - a.score);
}
export {
  findMatching,
  scoreEntry
};
//# sourceMappingURL=matching-QQS2CJGZ.js.map