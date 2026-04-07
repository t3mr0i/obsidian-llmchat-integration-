#!/usr/bin/env node

// src/scanner/manifest.ts
import { readFileSync, existsSync } from "fs";
import { resolve, relative } from "path";
import { globSync } from "glob";
var MANIFEST_FILES = [
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile"
];
function scanManifest(projectRoot) {
  for (const file of MANIFEST_FILES) {
    const path = resolve(projectRoot, file);
    if (!existsSync(path)) continue;
    switch (file) {
      case "package.json":
        return parsePackageJson(path);
      case "pyproject.toml":
        return parsePyprojectStub(path);
      case "requirements.txt":
        return parseRequirementsTxt(path);
      case "go.mod":
        return parseGoModStub(path);
      case "Cargo.toml":
        return parseCargoStub(path);
      case "pom.xml":
        return parsePomStub(path);
      case "build.gradle":
      case "build.gradle.kts":
        return parseGradleStub(path, file);
      case "Gemfile":
        return parseGemfileStub(path);
    }
  }
  return null;
}
function scanProjectModel(projectRoot) {
  const rootManifest = scanManifest(projectRoot);
  const workspaces = rootManifest?.type === "package.json" ? scanPackageWorkspaces(projectRoot) : [];
  const workspaceDependencies = collectWorkspaceDependencies(workspaces);
  return {
    rootManifest,
    workspaces,
    workspaceDependencies,
    commands: collectCommands(rootManifest, workspaces)
  };
}
function parsePackageJson(path) {
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    return {
      type: "package.json",
      name: raw.name ?? null,
      version: raw.version ?? null,
      dependencies: raw.dependencies ?? {},
      devDependencies: raw.devDependencies ?? {},
      scripts: raw.scripts ?? {}
    };
  } catch {
    return null;
  }
}
function scanPackageWorkspaces(projectRoot) {
  const packageJsonPath = resolve(projectRoot, "package.json");
  if (!existsSync(packageJsonPath)) return [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  } catch {
    return [];
  }
  let workspacePatterns = extractWorkspacePatterns(raw);
  if (workspacePatterns.length === 0) {
    workspacePatterns = extractPnpmWorkspacePatterns(projectRoot);
  }
  if (workspacePatterns.length === 0) return [];
  const seen = /* @__PURE__ */ new Set();
  const workspaces = [];
  for (const pattern of workspacePatterns) {
    const normalizedPattern = pattern.endsWith("/package.json") ? pattern : `${pattern.replace(/\/$/, "")}/package.json`;
    const matches = globSync(normalizedPattern, {
      cwd: projectRoot,
      absolute: true,
      ignore: ["**/node_modules/**"]
    });
    for (const match of matches) {
      const manifest = parsePackageJson(match);
      if (!manifest) continue;
      const workspacePath = relative(projectRoot, match).replace(/\/package\.json$/, "");
      if (workspacePath === "" || seen.has(workspacePath)) continue;
      seen.add(workspacePath);
      workspaces.push({
        path: workspacePath,
        manifest
      });
    }
  }
  workspaces.sort((a, b) => a.path.localeCompare(b.path));
  return workspaces;
}
function extractWorkspacePatterns(raw) {
  if (Array.isArray(raw.workspaces)) {
    return raw.workspaces.filter((value) => typeof value === "string");
  }
  if (raw.workspaces && typeof raw.workspaces === "object" && Array.isArray(raw.workspaces.packages)) {
    return raw.workspaces.packages.filter((value) => typeof value === "string");
  }
  return [];
}
function extractPnpmWorkspacePatterns(projectRoot) {
  const pnpmWorkspacePath = resolve(projectRoot, "pnpm-workspace.yaml");
  if (!existsSync(pnpmWorkspacePath)) return [];
  try {
    const content = readFileSync(pnpmWorkspacePath, "utf-8");
    const packagesMatch = content.match(/packages:\s*\n((?:\s+-\s*.+\n?)*)/);
    if (!packagesMatch) return [];
    const lines = packagesMatch[1].split("\n");
    return lines.map((line) => line.replace(/^\s*-\s*['"]?/, "").replace(/['"]?\s*$/, "").trim()).filter((line) => line.length > 0 && !line.startsWith("!"));
  } catch {
    return [];
  }
}
function collectCommands(rootManifest, workspaces) {
  const commands = /* @__PURE__ */ new Set();
  for (const script of Object.keys(rootManifest?.scripts ?? {})) {
    commands.add(`root:${script}`);
  }
  for (const workspace of workspaces) {
    for (const script of Object.keys(workspace.manifest.scripts)) {
      commands.add(`${workspace.path}:${script}`);
    }
  }
  return [...commands].sort();
}
function collectWorkspaceDependencies(workspaces) {
  const workspaceByPackageName = /* @__PURE__ */ new Map();
  for (const workspace of workspaces) {
    if (workspace.manifest.name) {
      workspaceByPackageName.set(workspace.manifest.name, workspace);
    }
  }
  const edges = [];
  for (const workspace of workspaces) {
    for (const dependencyName of Object.keys(workspace.manifest.dependencies)) {
      const target = workspaceByPackageName.get(dependencyName);
      if (!target || target.path === workspace.path) continue;
      edges.push({
        from: workspace.path,
        to: target.path,
        dependencyName,
        type: "dependency"
      });
    }
    for (const dependencyName of Object.keys(workspace.manifest.devDependencies)) {
      const target = workspaceByPackageName.get(dependencyName);
      if (!target || target.path === workspace.path) continue;
      edges.push({
        from: workspace.path,
        to: target.path,
        dependencyName,
        type: "devDependency"
      });
    }
  }
  edges.sort((a, b) => {
    const fromCompare = a.from.localeCompare(b.from);
    if (fromCompare !== 0) return fromCompare;
    const toCompare = a.to.localeCompare(b.to);
    if (toCompare !== 0) return toCompare;
    return a.type.localeCompare(b.type);
  });
  return edges;
}
function parsePomStub(path) {
  const content = readFileSync(path, "utf-8");
  const artifactId = content.match(/<artifactId>([^<]+)<\/artifactId>/)?.[1] ?? null;
  const version = content.match(/<version>([^<]+)<\/version>/)?.[1] ?? null;
  const deps = {};
  for (const m of content.matchAll(/<dependency>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?<\/dependency>/g)) {
    deps[m[1]] = "*";
  }
  return { type: "pom.xml", name: artifactId, version, dependencies: deps, devDependencies: {}, scripts: {} };
}
function parseGradleStub(_path, file) {
  return { type: file, name: null, version: null, dependencies: {}, devDependencies: {}, scripts: {} };
}
function parseGemfileStub(path) {
  const content = readFileSync(path, "utf-8");
  const deps = {};
  for (const m of content.matchAll(/^gem\s+['"]([^'"]+)['"]/gm)) {
    deps[m[1]] = "*";
  }
  return { type: "Gemfile", name: null, version: null, dependencies: deps, devDependencies: {}, scripts: {} };
}
function parsePyprojectStub(path) {
  const content = readFileSync(path, "utf-8");
  const nameMatch = content.match(/^name\s*=\s*"(.+)"/m);
  const versionMatch = content.match(/^version\s*=\s*"(.+)"/m);
  const deps = parsePyprojectDependencies(content);
  const devDeps = parsePyprojectOptionalDependencies(content);
  const reqPath = resolve(path, "../requirements.txt");
  if (existsSync(reqPath)) {
    const reqDeps = parseRequirementsTxtContent(readFileSync(reqPath, "utf-8"));
    for (const [name, version] of Object.entries(reqDeps)) {
      if (!deps[name]) deps[name] = version;
    }
  }
  return {
    type: "pyproject.toml",
    name: nameMatch?.[1] ?? null,
    version: versionMatch?.[1] ?? null,
    dependencies: deps,
    devDependencies: devDeps,
    scripts: {}
  };
}
function parseRequirementsTxt(path) {
  const content = readFileSync(path, "utf-8");
  return {
    type: "requirements.txt",
    name: null,
    version: null,
    dependencies: parseRequirementsTxtContent(content),
    devDependencies: {},
    scripts: {}
  };
}
function parseRequirementsTxtContent(content) {
  const deps = {};
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("-")) continue;
    const withoutComment = line.split("#")[0].trim();
    const match = withoutComment.match(/^([A-Za-z0-9_.-]+(?:\[[^\]]*\])?)\s*([><=!~^].+)?$/);
    if (!match) continue;
    const name = match[1].replace(/\[.*\]$/, "");
    deps[name] = match[2]?.trim() ?? "*";
  }
  return deps;
}
function parseGoModStub(path) {
  const content = readFileSync(path, "utf-8");
  const moduleMatch = content.match(/^module\s+(.+)/m);
  return {
    type: "go.mod",
    name: moduleMatch?.[1] ?? null,
    version: null,
    dependencies: parseGoModDependencies(content),
    devDependencies: {},
    scripts: {}
  };
}
function parseCargoStub(path) {
  const content = readFileSync(path, "utf-8");
  const nameMatch = content.match(/^name\s*=\s*"(.+)"/m);
  const versionMatch = content.match(/^version\s*=\s*"(.+)"/m);
  return {
    type: "Cargo.toml",
    name: nameMatch?.[1] ?? null,
    version: versionMatch?.[1] ?? null,
    dependencies: parseCargoSection(content, "dependencies"),
    devDependencies: parseCargoSection(content, "dev-dependencies"),
    scripts: {}
  };
}
function parsePyprojectDependencies(content) {
  const match = content.match(/^\[project\][\s\S]*?^dependencies\s*=\s*\[(.*?)^\]/m);
  if (!match) return {};
  const deps = {};
  for (const entry of match[1].split("\n")) {
    const cleaned = entry.trim().replace(/,$/, "").replace(/^"(.*)"$/, "$1");
    if (!cleaned) continue;
    const depMatch = cleaned.match(/^([A-Za-z0-9._-]+)\s*(.*)$/);
    if (!depMatch) continue;
    deps[depMatch[1]] = depMatch[2].trim() || "*";
  }
  return deps;
}
function parsePyprojectOptionalDependencies(content) {
  const sectionMatch = content.match(/^\[project\.optional-dependencies\]\n([\s\S]*?)(?=^\[|\Z)/m);
  if (!sectionMatch) return {};
  const deps = {};
  const entryPattern = /^([A-Za-z0-9._-]+)\s*=\s*\[(.*?)^\]/gm;
  let match;
  while ((match = entryPattern.exec(sectionMatch[1])) !== null) {
    const groupName = match[1];
    const groupEntries = match[2].split("\n").map((line) => line.trim().replace(/,$/, "").replace(/^"(.*)"$/, "$1")).filter(Boolean);
    for (const entry of groupEntries) {
      const depMatch = entry.match(/^([A-Za-z0-9._-]+)\s*(.*)$/);
      if (!depMatch) continue;
      deps[depMatch[1]] = depMatch[2].trim() || `optional:${groupName}`;
    }
  }
  return deps;
}
function parseGoModDependencies(content) {
  const deps = {};
  const blockMatch = content.match(/^require\s*\(([\s\S]*?)^\)/m);
  if (blockMatch) {
    for (const line of blockMatch[1].split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//")) continue;
      const match = trimmed.match(/^(\S+)\s+(\S+)/);
      if (match) deps[match[1]] = match[2];
    }
  }
  const singleLinePattern = /^require\s+(\S+)\s+(\S+)/gm;
  let singleMatch;
  while ((singleMatch = singleLinePattern.exec(content)) !== null) {
    deps[singleMatch[1]] = singleMatch[2];
  }
  return deps;
}
function parseCargoSection(content, sectionName) {
  const sectionMatch = content.match(
    new RegExp(`^\\[${sectionName.replace("-", "\\-")}\\]\\n([\\s\\S]*?)(?=^\\[|\\Z)`, "m")
  );
  if (!sectionMatch) return {};
  const deps = {};
  for (const line of sectionMatch[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!match) continue;
    const versionMatch = match[2].match(/"([^"]+)"/);
    deps[match[1]] = versionMatch?.[1] ?? match[2].trim();
  }
  return deps;
}

export {
  scanManifest,
  scanProjectModel
};
//# sourceMappingURL=chunk-S2JQZXY2.js.map