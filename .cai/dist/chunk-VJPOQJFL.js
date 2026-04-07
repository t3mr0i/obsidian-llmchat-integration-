#!/usr/bin/env node

// src/pattern/library.ts
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from "fs";
import { homedir } from "os";
import { join, basename } from "path";
import { createHash } from "crypto";
function libraryRoot() {
  return process.env.CAI_HOME ?? join(homedir(), ".cai");
}
function patternsDir() {
  return join(libraryRoot(), "patterns");
}
function ensureDir() {
  mkdirSync(patternsDir(), { recursive: true });
}
function hashPattern(name, content) {
  return createHash("sha1").update(`${name}
${content}`).digest("hex").slice(0, 12);
}
function extractDescription(content) {
  const fmMatch = content.match(/^---[\s\S]*?description:\s*(.+?)\s*\n[\s\S]*?---/);
  if (fmMatch) return fmMatch[1].replace(/^["']|["']$/g, "");
  const h1Match = content.match(/^#\s+(.+)$/m);
  return h1Match ? h1Match[1] : "(no description)";
}
function addToLibrary(patternPath, project, sourceProjectRoot) {
  if (!existsSync(patternPath)) {
    throw new Error(`Pattern file not found: ${patternPath}`);
  }
  ensureDir();
  const content = readFileSync(patternPath, "utf8");
  const name = basename(patternPath, ".md");
  const hash = hashPattern(name, content);
  const contentPath = join(patternsDir(), `${hash}.md`);
  const metaPath = join(patternsDir(), `${hash}.meta.json`);
  if (existsSync(contentPath)) {
    return readEntry(hash);
  }
  const existingVersions = listVersions(name);
  const latestVersion2 = existingVersions.length > 0 ? Math.max(...existingVersions.map((e) => e.version ?? 1)) : 0;
  const previousHashes = existingVersions.sort((a, b) => (a.version ?? 1) - (b.version ?? 1)).map((e) => e.hash);
  const meta = {
    hash,
    name,
    description: extractDescription(content),
    stack: project.rootManifest?.type ?? null,
    dependencies: collectDependencies(project),
    source: sourceProjectRoot,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    version: latestVersion2 + 1,
    previousHashes: previousHashes.length > 0 ? previousHashes : void 0
  };
  writeFileSync(contentPath, content, "utf8");
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
  return { ...meta, contentPath };
}
function listVersions(name) {
  return listLibrary().filter((e) => e.name === name);
}
function latestVersion(name) {
  const versions = listVersions(name);
  if (versions.length === 0) return null;
  return versions.sort((a, b) => (b.version ?? 1) - (a.version ?? 1))[0];
}
function listLibrary() {
  if (!existsSync(patternsDir())) return [];
  const entries = [];
  for (const file of readdirSync(patternsDir())) {
    if (!file.endsWith(".meta.json")) continue;
    try {
      const meta = JSON.parse(readFileSync(join(patternsDir(), file), "utf8"));
      entries.push({ ...meta, contentPath: join(patternsDir(), `${meta.hash}.md`) });
    } catch {
    }
  }
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
function readEntry(hash) {
  const metaPath = join(patternsDir(), `${hash}.meta.json`);
  const contentPath = join(patternsDir(), `${hash}.md`);
  if (!existsSync(metaPath) || !existsSync(contentPath)) {
    throw new Error(`Library entry not found: ${hash}`);
  }
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  return { ...meta, contentPath };
}
function readEntryContent(hash) {
  return readFileSync(readEntry(hash).contentPath, "utf8");
}
function findEntry(query) {
  const all = listLibrary();
  const byHashPrefix = all.filter((e) => e.hash.startsWith(query));
  if (byHashPrefix.length === 1) return byHashPrefix[0];
  const byName = all.filter((e) => e.name === query);
  if (byName.length === 0) return null;
  return byName.sort((a, b) => {
    const va = a.version ?? 1;
    const vb = b.version ?? 1;
    if (vb !== va) return vb - va;
    return b.createdAt.localeCompare(a.createdAt);
  })[0];
}
function collectDependencies(project) {
  const deps = /* @__PURE__ */ new Set();
  if (project.rootManifest) {
    Object.keys(project.rootManifest.dependencies).forEach((d) => deps.add(d));
    Object.keys(project.rootManifest.devDependencies).forEach((d) => deps.add(d));
  }
  for (const ws of project.workspaces) {
    Object.keys(ws.manifest.dependencies).forEach((d) => deps.add(d));
    Object.keys(ws.manifest.devDependencies).forEach((d) => deps.add(d));
  }
  return Array.from(deps).sort();
}
function libraryStats() {
  if (!existsSync(patternsDir())) return { entries: 0, bytes: 0 };
  let bytes = 0;
  let entries = 0;
  for (const file of readdirSync(patternsDir())) {
    try {
      bytes += statSync(join(patternsDir(), file)).size;
      if (file.endsWith(".meta.json")) entries++;
    } catch {
    }
  }
  return { entries, bytes };
}

export {
  libraryRoot,
  addToLibrary,
  listVersions,
  latestVersion,
  listLibrary,
  readEntry,
  readEntryContent,
  findEntry,
  collectDependencies,
  libraryStats
};
//# sourceMappingURL=chunk-VJPOQJFL.js.map