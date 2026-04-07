#!/usr/bin/env node
import {
  scanProjectModel
} from "./chunk-S2JQZXY2.js";
import {
  aggregateByFile,
  readQueries
} from "./chunk-XAVW3U2U.js";
import {
  appendHistory
} from "./chunk-WX2YGCKP.js";

// src/drift/index.ts
import { resolve as resolve7, relative as relative3 } from "path";
import { existsSync as existsSync7, readFileSync as readFileSync9 } from "fs";
import { globSync as globSync3 } from "glob";

// src/drift/claims.ts
import { readFileSync, statSync } from "fs";
import { visit as visit2 } from "unist-util-visit";

// src/markdown.ts
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import YAML from "yaml";
var parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]);
function parseMarkdown(content) {
  return parser.parse(content);
}
function extractFrontmatter(content) {
  const tree = parseMarkdown(content);
  let frontmatter = null;
  visit(tree, "yaml", (node) => {
    try {
      frontmatter = YAML.parse(node.value);
    } catch {
    }
  });
  return frontmatter;
}
function getHeadingAtLine(tree, line) {
  let currentHeading = null;
  for (const node of tree.children) {
    if (!node.position) continue;
    if (node.position.start.line > line) break;
    if (node.type === "heading") {
      currentHeading = getTextContent(node);
    }
  }
  return currentHeading;
}
function getTextContent(node) {
  if ("value" in node && typeof node.value === "string") {
    return node.value;
  }
  if ("children" in node) {
    return node.children.map(getTextContent).join("");
  }
  return "";
}
function isNegatedSection(heading) {
  if (!heading) return false;
  const lower = heading.toLowerCase();
  return lower.includes("not exist") || lower.includes("not use") || lower.includes("do not") || lower.includes("don't") || lower.includes("deliberately not") || lower.includes("excluded") || lower.includes("removed") || lower.includes("deprecated") || lower.includes("avoided") || lower.includes("alternatives considered") || lower.includes("superseded");
}

// src/drift/claims.ts
var KNOWN_EXTENSIONS = /\.(ts|js|tsx|jsx|py|go|rs|rb|java|json|yaml|yml|toml|md|css|scss|html|vue|svelte|sh)$/;
var COMMAND_PREFIXES = /^(npm|yarn|pnpm|bun|make|cargo|python|pip|go|node|npx|tsx|dotnet|mvn|gradle|\.\/gradlew|rake|bundle|mix|swift|rustup|dotnet-script)\s/;
var DEPENDENCY_SECTION_PATTERNS = /key\s*libraries|core\s*technologies|dependencies|stack|tech/i;
var TEMPLATE_PLACEHOLDER = /[<>\[\]{}]/;
var COMMON_NON_PACKAGE_TERMS = /* @__PURE__ */ new Set([
  "rest api",
  "websocket",
  "oauth",
  "frontend",
  "backend",
  "database",
  "database layer",
  "service layer",
  "tailwind css",
  // Protocols
  "http",
  "https",
  "grpc",
  "graphql",
  "sse",
  "mqtt",
  "amqp",
  // Architecture
  "microservices",
  "monolith",
  "serverless",
  "edge functions",
  "cdn",
  "api gateway",
  "reverse proxy",
  "load balancer",
  "event sourcing",
  "cqrs",
  "ddd",
  // Common infra terms that appear bolded in docs
  "api",
  "sdk",
  "cli",
  "ui"
]);
var COMPARISON_NEGATION = /\b(vs\.?|versus|instead of|alternative to|rather than|prefer\w* over|replaced by|not use|not using|excluded|deprecated|removed|considered|evaluated|compared to)\b/i;
var HTTP_METHOD_PREFIX = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\//;
var PLACEHOLDER_WORDS = /(?:^|[/_-])(?:new|example|your|sample|my|foo|bar|placeholder|template)(?:[/_.-]|$)/i;
function isNotAPath(value) {
  if (value.startsWith("/") && !KNOWN_EXTENSIONS.test(value)) return true;
  if (HTTP_METHOD_PREFIX.test(value)) return true;
  if (/[=();,]/.test(value)) return true;
  if (/["']/.test(value)) return true;
  if (value.startsWith("*")) return true;
  return false;
}
var CLAIMS_CACHE_MAX = 500;
var claimsCache = /* @__PURE__ */ new Map();
function extractClaims(filePath, source) {
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(filePath).mtimeMs;
  } catch {
    return [];
  }
  const cacheKey = `${filePath}:${mtimeMs}`;
  const cached = claimsCache.get(cacheKey);
  if (cached) {
    claimsCache.delete(cacheKey);
    claimsCache.set(cacheKey, cached);
    return cached;
  }
  let content;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }
  const tree = parseMarkdown(content);
  const claims = [];
  visit2(tree, "inlineCode", (node) => {
    const line = node.position?.start.line ?? 0;
    const heading = getHeadingAtLine(tree, line);
    const negated = isNegatedSection(heading);
    if (node.value.includes("/") || KNOWN_EXTENSIONS.test(node.value)) {
      if (!COMMAND_PREFIXES.test(node.value) && !TEMPLATE_PLACEHOLDER.test(node.value) && !isNotAPath(node.value)) {
        claims.push(
          createClaim("path", node.value, source, line, heading, negated, "inline_code")
        );
      }
    }
    if (COMMAND_PREFIXES.test(node.value)) {
      claims.push(
        createClaim("command", node.value, source, line, heading, negated, "inline_code")
      );
    }
  });
  visit2(tree, "code", (node) => {
    const line = node.position?.start.line ?? 0;
    const heading = getHeadingAtLine(tree, line);
    const negated = isNegatedSection(heading);
    for (const codeLine of node.value.split("\n")) {
      const trimmed = codeLine.trim();
      if (COMMAND_PREFIXES.test(trimmed)) {
        claims.push(
          createClaim("command", trimmed, source, line, heading, negated, "code_block")
        );
      }
    }
  });
  const contentLines = content.split("\n");
  visit2(tree, "strong", (node) => {
    const line = node.position?.start.line ?? 0;
    const heading = getHeadingAtLine(tree, line);
    const negated = isNegatedSection(heading);
    if (heading && DEPENDENCY_SECTION_PATTERNS.test(heading)) {
      const text = getStrongText(node);
      if (!text || !looksLikeDependencyClaim(text)) return;
      const sourceLine = contentLines[line - 1] ?? "";
      const isComparison = COMPARISON_NEGATION.test(sourceLine);
      const versionMatch = text.match(/^(.+?)\s+[v^~>=<]*(\d[\d.]*\S*)$/);
      if (versionMatch) {
        claims.push(
          createClaim("dependency", versionMatch[1].trim(), source, line, heading, negated || isComparison, "strong_text")
        );
        claims.push(
          createClaim("version", text, source, line, heading, negated || isComparison, "strong_text")
        );
      } else {
        claims.push(
          createClaim("dependency", text, source, line, heading, negated || isComparison, "strong_text")
        );
      }
    }
  });
  visit2(tree, "tableCell", (node) => {
    const line = node.position?.start.line ?? 0;
    const heading = getHeadingAtLine(tree, line);
    const negated = isNegatedSection(heading);
    if (!heading || !DEPENDENCY_SECTION_PATTERNS.test(heading)) return;
    const text = getNodeText(node).trim();
    if (!text || !looksLikeDependencyClaim(text)) return;
    const versionMatch = text.match(/^(.+?)\s+[v^~>=<]*(\d[\d.]*\S*)$/);
    if (versionMatch) {
      claims.push(
        createClaim("dependency", versionMatch[1].trim(), source, line, heading, negated, "table_cell")
      );
      claims.push(
        createClaim("version", text, source, line, heading, negated, "table_cell")
      );
      return;
    }
    claims.push(
      createClaim("dependency", text, source, line, heading, negated, "table_cell")
    );
  });
  visit2(tree, "listItem", (node) => {
    const line = node.position?.start.line ?? 0;
    const heading = getHeadingAtLine(tree, line);
    const negated = isNegatedSection(heading);
    if (!heading || !DEPENDENCY_SECTION_PATTERNS.test(heading)) return;
    if (containsNodeType(node, "strong")) return;
    const text = extractDependencyCandidate(getNodeText(node));
    if (!text || !looksLikeDependencyClaim(text)) return;
    const versionMatch = text.match(/^(.+?)\s+[v^~>=<]*(\d[\d.]*\S*)$/);
    if (versionMatch) {
      claims.push(
        createClaim("dependency", versionMatch[1].trim(), source, line, heading, negated, "list_item")
      );
      claims.push(
        createClaim("version", text, source, line, heading, negated, "list_item")
      );
      return;
    }
    claims.push(
      createClaim("dependency", text, source, line, heading, negated, "list_item")
    );
  });
  if (claimsCache.size >= CLAIMS_CACHE_MAX) {
    const first = claimsCache.keys().next().value;
    if (first !== void 0) claimsCache.delete(first);
  }
  claimsCache.set(cacheKey, claims);
  return claims;
}
function getStrongText(node) {
  const textNode = node.children.find(
    (c) => c.type === "text"
  );
  return textNode?.value ?? null;
}
function getNodeText(node) {
  if (!node.children) return "";
  const values = [];
  for (const child of node.children) {
    if (!child || typeof child !== "object" || !("type" in child)) continue;
    if ("value" in child && typeof child.value === "string") {
      values.push(child.value);
      continue;
    }
    if ("children" in child && Array.isArray(child.children)) {
      values.push(getNodeText(child));
    }
  }
  return values.join(" ").replace(/\s+/g, " ").trim();
}
function containsNodeType(node, type) {
  if (!node.children) return false;
  for (const child of node.children) {
    if (!child || typeof child !== "object" || !("type" in child)) continue;
    if (child.type === type) return true;
    if ("children" in child && Array.isArray(child.children) && containsNodeType(child, type)) {
      return true;
    }
  }
  return false;
}
function extractDependencyCandidate(text) {
  return text.split(/\s+[-:—]\s+/)[0]?.trim().replace(/\.$/, "") ?? "";
}
function looksLikeDependencyClaim(text) {
  const normalized = text.trim().replace(/\s+/g, " ");
  const lower = normalized.toLowerCase();
  if (COMMON_NON_PACKAGE_TERMS.has(lower)) return false;
  if (/^[A-Z0-9\s.+-]+$/.test(normalized) && !/[a-z]/.test(normalized)) return false;
  const versionless = normalized.replace(/\s+[v^~>=<]*(\d[\d.]*\S*)$/, "");
  const words = versionless.split(" ");
  if (words.length > 1 && !/[@/._-]/.test(versionless)) return false;
  if (/layer|architecture|protocol/i.test(versionless)) return false;
  return true;
}
function createClaim(kind, value, source, line, section, negated, origin) {
  const { intent, confidence } = classifyClaim(kind, value, origin, section);
  return {
    kind,
    value,
    source,
    line,
    section,
    negated,
    origin,
    intent,
    confidence
  };
}
var CANONICAL_HEADING = /\b(setup|install|build|deploy|run|development|getting\s*started|quick\s*start|usage|commands)\b/i;
var EXAMPLE_HEADING = /\b(example|alternative|optional|comparison|deprecated)\b/i;
function classifyClaim(kind, value, origin, section) {
  if (kind === "path") {
    if (PLACEHOLDER_WORDS.test(value)) {
      return { intent: "example", confidence: "low" };
    }
    return {
      intent: "exact",
      confidence: value.includes("/") ? "high" : "medium"
    };
  }
  if (kind === "command") {
    if (origin === "code_block") {
      const isCanonical = section != null && CANONICAL_HEADING.test(section) && !EXAMPLE_HEADING.test(section);
      const isExample = section != null && EXAMPLE_HEADING.test(section);
      if (isCanonical) return { intent: "exact", confidence: "high" };
      if (isExample) return { intent: "example", confidence: "low" };
      return { intent: "example", confidence: "medium" };
    }
    return { intent: "exact", confidence: "high" };
  }
  if (kind === "dependency") {
    return {
      intent: "exact",
      confidence: origin === "strong_text" ? "high" : "medium"
    };
  }
  return {
    intent: "exact",
    confidence: origin === "strong_text" ? "high" : "medium"
  };
}

// src/drift/scoring.ts
var SEVERITY_COST = {
  error: 10,
  warning: 2,
  info: 0
};
var MAX_DEDUCTION = {
  error: 100,
  // errors are uncapped — 10 errors = score 0
  warning: 30,
  // warnings capped at 30 points total
  info: 0
  // info is free
};
function computeScore(issues) {
  const deductions = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) {
    deductions[issue.severity] += SEVERITY_COST[issue.severity];
  }
  let total = 0;
  for (const sev of ["error", "warning", "info"]) {
    total += Math.min(deductions[sev], MAX_DEDUCTION[sev]);
  }
  return Math.max(0, Math.min(100, 100 - total));
}

// src/drift/registry.ts
import { relative as relative2 } from "path";

// src/drift/frontmatter.ts
import { readFileSync as readFileSync2 } from "fs";
function parseFrontmatter(filePath) {
  try {
    const content = readFileSync2(filePath, "utf-8");
    return extractFrontmatter(content);
  } catch {
    return null;
  }
}

// src/drift/checkers/command.ts
import { readFileSync as readFileSync3, existsSync, readdirSync } from "fs";
import { resolve } from "path";
function checkCommands(claims, projectRoot, project) {
  const issues = [];
  const commandClaims = claims.filter(
    (c) => c.kind === "command" && !c.negated
  );
  const pkgScripts = loadPackageScripts(projectRoot);
  const makeTargets = loadMakeTargets(projectRoot);
  const shellScripts = loadShellScripts(projectRoot);
  const dcServices = loadDockerComposeServices(projectRoot);
  const workspaceLookup = buildWorkspaceScriptLookup(project);
  for (const claim of commandClaims) {
    const cmd = claim.value.trim();
    const scriptRef = parseScriptReference(cmd);
    if (scriptRef) {
      if (!scriptExists(scriptRef.script, scriptRef.workspaceSelector, pkgScripts, workspaceLookup)) {
        issues.push({
          code: "DEAD_COMMAND",
          severity: "error",
          file: claim.source,
          line: claim.line,
          message: scriptRef.workspaceSelector ? `Script "${scriptRef.script}" not found for workspace "${scriptRef.workspaceSelector}"` : `Script "${scriptRef.script}" not found in package.json scripts`,
          explanation: scriptRef.workspaceSelector ? `Command was parsed as a workspace-scoped script reference and matched against workspace "${scriptRef.workspaceSelector}".` : "Command was parsed as a root package script reference and matched against package.json scripts.",
          suggestion: scriptRef.workspaceSelector ? `Document a real script for workspace "${scriptRef.workspaceSelector}", or change this command to one of that workspace's existing scripts.` : `Update the scaffold to an existing package.json script, or add "${scriptRef.script}" to the root scripts if it should exist.`,
          claim
        });
      }
      continue;
    }
    const makeMatch = cmd.match(/^make\s+(\S+)/);
    if (makeMatch) {
      const target = makeMatch[1];
      if (makeTargets && !makeTargets.has(target)) {
        issues.push({
          code: "DEAD_COMMAND",
          severity: "error",
          file: claim.source,
          line: claim.line,
          message: `Make target "${target}" not found in Makefile`,
          explanation: "Command was parsed as a Make target reference and matched against the local Makefile.",
          suggestion: `Update the scaffold to an existing Make target, or add "${target}" to the Makefile if it should exist.`,
          claim
        });
      }
      continue;
    }
    const scriptMatch = cmd.match(/^(?:bash\s+|sh\s+|\.\/)?scripts\/([^\s]+)/);
    if (scriptMatch) {
      const scriptName = scriptMatch[1];
      if (shellScripts && !shellScripts.has(scriptName)) {
        issues.push({
          code: "DEAD_COMMAND",
          severity: "error",
          file: claim.source,
          line: claim.line,
          message: `Script "scripts/${scriptName}" not found in scripts/ directory`,
          suggestion: `Update the scaffold or create scripts/${scriptName}.`,
          claim
        });
      }
      continue;
    }
    const dockerMatch = cmd.match(/^docker[\s-]compose\s+(?:up|run|exec)\s+(\S+)/);
    if (dockerMatch) {
      const service = dockerMatch[1];
      if (dcServices && !dcServices.has(service)) {
        issues.push({
          code: "DEAD_COMMAND",
          severity: "warning",
          file: claim.source,
          line: claim.line,
          message: `Docker Compose service "${service}" not found in compose file`,
          suggestion: `Update the scaffold or add "${service}" to your Docker Compose config.`,
          claim
        });
      }
    }
  }
  return issues;
}
function loadPackageScripts(projectRoot) {
  const pkgPath = resolve(projectRoot, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync3(pkgPath, "utf-8"));
    return new Set(Object.keys(pkg.scripts ?? {}));
  } catch {
    return null;
  }
}
function buildWorkspaceScriptLookup(project) {
  const lookup = /* @__PURE__ */ new Map();
  if (!project) return lookup;
  for (const workspace of project.workspaces) {
    const scripts = new Set(Object.keys(workspace.manifest.scripts));
    const aliases = /* @__PURE__ */ new Set([workspace.path]);
    if (workspace.manifest.name) aliases.add(workspace.manifest.name);
    const basename = workspace.path.split("/").pop();
    if (basename) aliases.add(basename);
    for (const alias of aliases) {
      lookup.set(alias, scripts);
    }
  }
  return lookup;
}
function parseScriptReference(command) {
  const npmMatch = command.match(/^npm\s+run\s+([^\s]+)/);
  if (npmMatch) {
    return {
      script: npmMatch[1],
      workspaceSelector: extractWorkspaceSelector(command)
    };
  }
  const bunMatch = command.match(/^bun\s+run\s+([^\s]+)/);
  if (bunMatch) {
    return {
      script: bunMatch[1],
      workspaceSelector: extractWorkspaceSelector(command)
    };
  }
  const yarnWorkspaceMatch = command.match(/^yarn\s+workspace\s+([^\s]+)\s+([^\s]+)/);
  if (yarnWorkspaceMatch) {
    return {
      workspaceSelector: yarnWorkspaceMatch[1],
      script: yarnWorkspaceMatch[2]
    };
  }
  const yarnMatch = command.match(/^yarn\s+([^\s]+)/);
  if (yarnMatch) {
    return {
      script: yarnMatch[1],
      workspaceSelector: extractWorkspaceSelector(command)
    };
  }
  if (command.startsWith("pnpm ")) {
    const remainder = command.slice("pnpm ".length).trim();
    const script = extractTrailingScript(remainder);
    if (!script) return null;
    return {
      script,
      workspaceSelector: extractWorkspaceSelector(command)
    };
  }
  const turboMatch = command.match(/^turbo\s+run\s+([^\s]+)(?:\s+(.+))?$/);
  if (turboMatch) {
    return {
      script: turboMatch[1],
      workspaceSelector: extractWorkspaceSelector(command)
    };
  }
  return null;
}
function extractWorkspaceSelector(command) {
  const filterMatch = command.match(/--filter(?:=|\s+)([^\s]+)/);
  if (filterMatch) return filterMatch[1];
  const workspaceFlagMatch = command.match(/--workspace(?:=|\s+)([^\s]+)/);
  if (workspaceFlagMatch) return workspaceFlagMatch[1];
  return null;
}
function extractTrailingScript(rest) {
  const tokens = rest.split(/\s+/).filter(Boolean);
  for (let index = tokens.length - 1; index >= 0; index--) {
    if (!tokens[index].startsWith("-")) {
      return tokens[index];
    }
  }
  return null;
}
function scriptExists(script, workspaceSelector, rootScripts, workspaceLookup) {
  if (workspaceSelector) {
    if (workspaceLookup.size === 0) return true;
    const workspaceScripts = workspaceLookup.get(workspaceSelector);
    return workspaceScripts ? workspaceScripts.has(script) : false;
  }
  if (!rootScripts) return true;
  return rootScripts.has(script);
}
function loadShellScripts(projectRoot) {
  const scriptsDir = resolve(projectRoot, "scripts");
  if (!existsSync(scriptsDir)) return null;
  try {
    const entries = readdirSync(scriptsDir);
    return new Set(entries);
  } catch {
    return null;
  }
}
function loadDockerComposeServices(projectRoot) {
  const candidates = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];
  for (const name of candidates) {
    const path = resolve(projectRoot, name);
    if (!existsSync(path)) continue;
    try {
      const content = readFileSync3(path, "utf-8");
      const services = /* @__PURE__ */ new Set();
      let inServices = false;
      for (const line of content.split("\n")) {
        if (/^services:\s*$/.test(line)) {
          inServices = true;
          continue;
        }
        if (inServices && /^\S/.test(line)) break;
        if (inServices) {
          const match = line.match(/^\s{2}(\w[\w-]*):/);
          if (match) services.add(match[1]);
        }
      }
      return services.size > 0 ? services : null;
    } catch {
      continue;
    }
  }
  return null;
}
function loadMakeTargets(projectRoot) {
  const makePath = resolve(projectRoot, "Makefile");
  if (!existsSync(makePath)) return null;
  try {
    const content = readFileSync3(makePath, "utf-8");
    const targets = /* @__PURE__ */ new Set();
    for (const line of content.split("\n")) {
      const match = line.match(/^(\w[\w-]*):/);
      if (match) targets.add(match[1]);
    }
    return targets;
  } catch {
    return null;
  }
}

// src/drift/checkers/cross-file.ts
function checkCrossFile(claims) {
  const issues = [];
  const versionsByDep = /* @__PURE__ */ new Map();
  for (const claim of claims.filter((c) => c.kind === "version" && !c.negated)) {
    const match = claim.value.match(/^(.+?)\s+v?(\d[\d.]*\S*)$/);
    if (!match) continue;
    const depName = match[1].trim().toLowerCase();
    if (!versionsByDep.has(depName)) versionsByDep.set(depName, []);
    versionsByDep.get(depName).push(claim);
  }
  for (const [dep, versionClaims] of versionsByDep) {
    if (versionClaims.length < 2) continue;
    const normalizeVersion = (v) => {
      const m = v.match(/^(.+?)\s+v?([~^>=<]*)(\d[\d.]*)/);
      if (!m) return v;
      return `${m[1].trim().toLowerCase()} ${m[3].replace(/\.0+$/, "")}`;
    };
    const uniqueVersions = new Set(versionClaims.map((c) => normalizeVersion(c.value)));
    if (uniqueVersions.size > 1) {
      const sources = versionClaims.map((c) => `${c.source}:${c.line} says "${c.value}"`).join(", ");
      issues.push({
        code: "CROSS_FILE_CONFLICT",
        severity: "error",
        file: versionClaims[0].source,
        line: versionClaims[0].line,
        message: `Conflicting versions for "${dep}": ${sources}`
      });
    }
  }
  const commandsByScript = /* @__PURE__ */ new Map();
  for (const claim of claims.filter((c) => c.kind === "command" && !c.negated)) {
    const npmMatch = claim.value.match(
      /^(?:npm\s+run|yarn|pnpm|bun\s+run)\s+(\S+)/
    );
    if (npmMatch) {
      const script = npmMatch[1];
      if (!commandsByScript.has(script)) commandsByScript.set(script, []);
      commandsByScript.get(script).push(claim);
    }
  }
  for (const [script, cmdClaims] of commandsByScript) {
    if (cmdClaims.length < 2) continue;
    const fromDifferentFiles = new Set(cmdClaims.map((c) => c.source)).size > 1;
    if (!fromDifferentFiles) continue;
    const managers = new Set(
      cmdClaims.map((c) => c.value.split(/\s/)[0])
    );
    if (managers.size > 1) {
      issues.push({
        code: "CROSS_FILE_CONFLICT",
        severity: "warning",
        file: cmdClaims[0].source,
        line: cmdClaims[0].line,
        message: `Script "${script}" referenced with different package managers across files: ${[...managers].join(", ")}`
      });
    }
  }
  return issues;
}

// src/drift/checkers/dependency.ts
var KNOWN_NON_PACKAGES = /* @__PURE__ */ new Set([
  // Runtimes & languages
  "node.js",
  "node",
  "nodejs",
  "python",
  "cpython",
  "go",
  "golang",
  "rust",
  "ruby",
  "java",
  "jdk",
  "jre",
  "deno",
  "bun",
  "swift",
  "kotlin",
  "typescript",
  "javascript",
  ".net",
  "c#",
  "php",
  "elixir",
  "scala",
  "dart",
  // Package managers & build tools
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "pip",
  "poetry",
  "cargo",
  "maven",
  "gradle",
  "cocoapods",
  "carthage",
  "spm",
  "homebrew",
  "apt",
  "nix",
  "turbo",
  "turborepo",
  "nx",
  "lerna",
  "vite",
  "webpack",
  "esbuild",
  "rollup",
  "tsup",
  "swc",
  "babel",
  // Databases & data stores
  "sqlite",
  "sqlite3",
  "postgresql",
  "postgres",
  "mysql",
  "mariadb",
  "mongodb",
  "mongo",
  "redis",
  "elasticsearch",
  "opensearch",
  "dynamodb",
  "cassandra",
  "cockroachdb",
  "supabase",
  "firebase",
  "firestore",
  "neon",
  "planetscale",
  "turso",
  // Infrastructure & cloud
  "docker",
  "kubernetes",
  "k8s",
  "helm",
  "terraform",
  "pulumi",
  "aws",
  "gcp",
  "azure",
  "vercel",
  "netlify",
  "fly.io",
  "railway",
  "heroku",
  "cloudflare",
  "digitalocean",
  "hetzner",
  "linode",
  "s3",
  "ec2",
  "lambda",
  "cloud run",
  "cloud functions",
  "ecs",
  "fargate",
  // Auth & identity services
  "keycloak",
  "auth0",
  "okta",
  "firebase auth",
  "clerk",
  "azure entra id",
  "azure ad",
  "active directory",
  "cognito",
  "oauth",
  "oauth 2.0",
  "saml",
  "oidc",
  "openid connect",
  "jwt",
  // Monitoring & observability
  "langfuse",
  "grafana",
  "prometheus",
  "datadog",
  "sentry",
  "newrelic",
  "new relic",
  "honeycomb",
  "jaeger",
  "zipkin",
  "opentelemetry",
  "logstash",
  "kibana",
  "splunk",
  "pagerduty",
  // Message queues & event systems
  "rabbitmq",
  "kafka",
  "nats",
  "pulsar",
  "sqs",
  "sns",
  "eventbridge",
  "redis pub/sub",
  "bullmq",
  // CI/CD & dev tools
  "github actions",
  "gitlab ci",
  "jenkins",
  "circleci",
  "bitbucket pipelines",
  "argocd",
  "flux",
  // Protocols & patterns
  "rest",
  "rest api",
  "graphql",
  "grpc",
  "websocket",
  "websockets",
  "mqtt",
  "amqp",
  "http/2",
  "http/3",
  "sse",
  "server-sent events",
  // Architecture concepts (not packages)
  "frontend",
  "backend",
  "database",
  "database layer",
  "service layer",
  "microservices",
  "monolith",
  "serverless",
  "edge functions",
  "cdn",
  "reverse proxy",
  "load balancer",
  "api gateway",
  // CSS frameworks (often referenced by name, not always in package.json)
  "tailwind css",
  "tailwind",
  "bootstrap",
  // AI / LLM services & platforms
  "openai api",
  "openai platform",
  "azure openai",
  "anthropic",
  "google ai",
  "hugging face",
  "huggingface",
  "cohere",
  "mistral",
  "ollama",
  "llm",
  "llms",
  "large language model",
  // Storage & CDN services
  "cloudinary",
  "imgix",
  "bunny.net",
  "fastly",
  "google cloud storage",
  "azure blob storage",
  "r2",
  // Payment & comms services
  "stripe",
  "paddle",
  "lemon squeezy",
  "twilio",
  "sendgrid",
  "resend",
  "postmark",
  // Additional common architectural terms
  "api",
  "rest endpoint",
  "http",
  "https",
  "webhook",
  "webhooks",
  "cron",
  "cron job",
  "background job",
  "background jobs",
  "worker",
  "rate limiting",
  "rate limit",
  "caching",
  "cache",
  "pagination",
  "search",
  "full-text search",
  "feature flag",
  "feature flags",
  "a/b testing",
  "error tracking",
  "logging",
  "log aggregation",
  "event sourcing",
  "cqrs",
  "ddd"
]);
var NON_PACKAGE_PATTERNS = [
  /\s+\/\s+/,
  // "Keycloak / Azure Entra ID" — space-slash-space = multi-tool mention (not @scope/pkg)
  /\s(api|sdk|cli|ui|platform|service|server|cloud|saas|layer)$/i,
  /^(self[- ]hosted|managed|hosted)/i
];
var KNOWN_ALIASES = /* @__PURE__ */ new Map([
  // Frameworks
  ["next.js", ["next"]],
  ["next", ["next"]],
  ["nuxt.js", ["nuxt"]],
  ["nuxt", ["nuxt"]],
  ["vue.js", ["vue"]],
  ["vue", ["vue"]],
  ["react", ["react"]],
  ["angular", ["@angular/core"]],
  ["svelte", ["svelte"]],
  ["solid.js", ["solid-js"]],
  ["solid", ["solid-js"]],
  ["remix", ["@remix-run/react", "@remix-run/node"]],
  ["astro", ["astro"]],
  ["express", ["express"]],
  ["fastify", ["fastify"]],
  ["hono", ["hono"]],
  ["nest.js", ["@nestjs/core"]],
  ["nestjs", ["@nestjs/core"]],
  ["koa", ["koa"]],
  // UI & styling
  ["tailwind", ["tailwindcss"]],
  ["tailwind css", ["tailwindcss"]],
  ["shadcn", ["class-variance-authority", "@radix-ui"]],
  ["shadcn/ui", ["class-variance-authority", "@radix-ui"]],
  ["radix", ["@radix-ui"]],
  ["radix ui", ["@radix-ui"]],
  ["material ui", ["@mui/material"]],
  ["mui", ["@mui/material"]],
  ["ant design", ["antd"]],
  ["chakra", ["@chakra-ui/react"]],
  ["chakra ui", ["@chakra-ui/react"]],
  ["styled components", ["styled-components"]],
  ["styled-components", ["styled-components"]],
  ["framer motion", ["framer-motion"]],
  ["lucide", ["lucide-react"]],
  ["heroicons", ["@heroicons/react"]],
  // State management
  ["react query", ["@tanstack/react-query"]],
  ["tanstack query", ["@tanstack/react-query"]],
  ["tanstack router", ["@tanstack/react-router"]],
  ["redux", ["@reduxjs/toolkit", "redux"]],
  ["zustand", ["zustand"]],
  ["jotai", ["jotai"]],
  ["recoil", ["recoil"]],
  // Data & forms
  ["prisma", ["prisma", "@prisma/client"]],
  ["drizzle", ["drizzle-orm"]],
  ["typeorm", ["typeorm"]],
  ["sequelize", ["sequelize"]],
  ["mongoose", ["mongoose"]],
  ["react hook form", ["react-hook-form"]],
  ["formik", ["formik"]],
  // Auth
  ["next-auth", ["next-auth", "@auth/core"]],
  ["nextauth", ["next-auth", "@auth/core"]],
  ["passport", ["passport"]],
  ["lucia", ["lucia"]],
  // Validation
  ["zod", ["zod"]],
  ["yup", ["yup"]],
  ["joi", ["joi"]],
  // API & communication
  ["trpc", ["@trpc/server", "@trpc/client"]],
  ["axios", ["axios"]],
  ["socket.io", ["socket.io"]],
  // Testing
  ["jest", ["jest"]],
  ["vitest", ["vitest"]],
  ["playwright", ["@playwright/test", "playwright"]],
  ["cypress", ["cypress"]],
  ["testing library", ["@testing-library/react"]],
  // i18n
  ["next-intl", ["next-intl"]],
  ["i18next", ["i18next"]],
  ["react-intl", ["react-intl"]],
  // Misc
  ["openai", ["openai"]],
  ["langchain", ["langchain", "@langchain/core"]],
  ["cva", ["class-variance-authority"]],
  ["class-variance-authority", ["class-variance-authority"]],
  ["jose", ["jose"]],
  ["jsonwebtoken", ["jsonwebtoken"]],
  ["date-fns", ["date-fns"]],
  ["dayjs", ["dayjs"]],
  ["lodash", ["lodash"]],
  ["underscore", ["underscore"]]
]);
function checkDependencies(claims, projectRoot, project) {
  const issues = [];
  const deps = loadAllDependencies(projectRoot, project);
  if (!deps) return issues;
  const depClaims = claims.filter(
    (c) => c.kind === "dependency" && !c.negated
  );
  const versionClaims = claims.filter(
    (c) => c.kind === "version" && !c.negated
  );
  for (const claim of depClaims) {
    const name = claim.value.toLowerCase();
    if (KNOWN_NON_PACKAGES.has(name)) continue;
    const parts = claim.value.split(/\s*[\/,&]\s*/).map((p) => p.trim().toLowerCase());
    if (parts.length > 1 && parts.every((p) => KNOWN_NON_PACKAGES.has(p))) continue;
    if (NON_PACKAGE_PATTERNS.some((re) => re.test(claim.value))) continue;
    if (claim.confidence === "low") continue;
    const aliases = KNOWN_ALIASES.get(name);
    const normalized = name.replace(/\.js$/, "").replace(/\.ts$/, "").replace(/[^a-z0-9@/_-]/g, "");
    const found = deps.find((d) => {
      const depName = d.name.toLowerCase();
      if (depName === name || depName === normalized || depName.endsWith(`/${normalized}`)) return true;
      if (aliases?.some((alias) => depName === alias || depName.startsWith(`${alias}/`))) return true;
      if (depName.includes(`/${normalized}`) || depName.startsWith(`@${normalized}/`) || depName.startsWith(`@${normalized}-`)) return true;
      return false;
    });
    if (!found) {
      issues.push({
        code: "DEPENDENCY_MISSING",
        severity: "warning",
        file: claim.source,
        line: claim.line,
        message: `Claimed dependency "${claim.value}" not found in any manifest`,
        claim,
        suggestion: `Either remove "${claim.value}" from the scaffold, or add the actual package name to the project manifest if it is truly required.`
      });
    }
  }
  for (const claim of versionClaims) {
    const match = claim.value.match(/^(.+?)\s+v?(\d[\d.]*\S*)$/);
    if (!match) continue;
    const name = match[1].trim().toLowerCase();
    const claimedVersion = match[2];
    const found = deps.find(
      (d) => d.name.toLowerCase() === name
    );
    if (found && !found.version.includes(claimedVersion)) {
      issues.push({
        code: "VERSION_MISMATCH",
        severity: "warning",
        file: claim.source,
        line: claim.line,
        message: `Claimed "${claim.value}" but manifest has version "${found.version}"`,
        claim,
        suggestion: `Update the scaffold version reference for "${claim.value}" to match manifest version "${found.version}", or update the manifest if the scaffold is the source of truth.`
      });
    }
  }
  return issues;
}
function loadAllDependencies(projectRoot, project) {
  const model = project ?? scanProjectModel(projectRoot);
  const entries = [];
  const manifests = model.rootManifest ? [model.rootManifest] : [];
  for (const ws of model.workspaces) {
    manifests.push(ws.manifest);
  }
  for (const manifest of manifests) {
    for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
      entries.push({ name, version: String(version) });
      addAliasEntries(entries, name, version);
    }
    for (const [name, version] of Object.entries(manifest.devDependencies ?? {})) {
      entries.push({ name, version: String(version) });
      addAliasEntries(entries, name, version);
    }
  }
  return entries.length ? entries : null;
}
function addAliasEntries(entries, name, version) {
  if (!name.includes("/")) return;
  const alias = name.split("/").pop();
  if (!alias || alias === name) return;
  entries.push({ name: alias, version: String(version) });
}

// src/drift/checkers/edges.ts
import { existsSync as existsSync2 } from "fs";
import { resolve as resolve2 } from "path";
function checkEdges(frontmatter, _filePath, source, projectRoot, scaffoldRoot) {
  if (!frontmatter?.edges) return [];
  const issues = [];
  for (const edge of frontmatter.edges) {
    if (!edge.target) continue;
    const fromProject = resolve2(projectRoot, edge.target);
    const fromScaffold = resolve2(scaffoldRoot, edge.target);
    if (!existsSync2(fromProject) && !existsSync2(fromScaffold)) {
      issues.push({
        code: "DEAD_EDGE",
        severity: "error",
        file: source,
        line: null,
        message: `Frontmatter edge target does not exist: ${edge.target}`
      });
    }
  }
  return issues;
}

// src/drift/checkers/index-sync.ts
import { readFileSync as readFileSync4, existsSync as existsSync3 } from "fs";
import { resolve as resolve3 } from "path";
import { globSync } from "glob";
function checkIndexSync(projectRoot, scaffoldRoot) {
  let patternsDir = resolve3(scaffoldRoot, "patterns");
  if (!existsSync3(patternsDir)) {
    patternsDir = resolve3(projectRoot, "patterns");
  }
  const indexPath = resolve3(patternsDir, "INDEX.md");
  if (!existsSync3(indexPath)) return [];
  if (!existsSync3(patternsDir)) return [];
  const issues = [];
  const patternFiles = globSync("*.md", { cwd: patternsDir, ignore: ["node_modules/**"] }).filter((f) => f !== "INDEX.md" && f !== "README.md");
  const rawContent = readFileSync4(indexPath, "utf-8");
  const indexContent = rawContent.replace(/<!--[\s\S]*?-->/g, "");
  const referencedFiles = /* @__PURE__ */ new Set();
  const linkPattern = /\[.*?\]\((.+?\.md(?:#[\w-]+)?)\)/g;
  let match;
  while ((match = linkPattern.exec(indexContent)) !== null) {
    referencedFiles.add(match[1].replace(/#.*$/, ""));
  }
  const backtickPattern = /`([\w-]+\.md)`/g;
  while ((match = backtickPattern.exec(indexContent)) !== null) {
    referencedFiles.add(match[1]);
  }
  for (const file of patternFiles) {
    if (!referencedFiles.has(file)) {
      issues.push({
        code: "INDEX_MISSING_ENTRY",
        severity: "warning",
        file: "patterns/INDEX.md",
        line: null,
        message: `Pattern file patterns/${file} exists but is not referenced in INDEX.md`,
        explanation: "A real pattern file exists on disk but the pattern registry in INDEX.md does not mention it.",
        suggestion: `Add an INDEX.md entry for \`${file}\` so agents can discover and route to this pattern.`
      });
    }
  }
  for (const ref of referencedFiles) {
    const refPath = resolve3(patternsDir, ref);
    if (!existsSync3(refPath)) {
      issues.push({
        code: "INDEX_ORPHAN_ENTRY",
        severity: "warning",
        file: "patterns/INDEX.md",
        line: null,
        message: `INDEX.md references ${ref} but the file does not exist`,
        explanation: "The pattern index links to a file that is missing from the patterns directory.",
        suggestion: `Remove the stale INDEX.md reference to \`${ref}\`, or recreate the missing pattern file.`
      });
    }
  }
  return issues;
}

// src/drift/checkers/path.ts
import { existsSync as existsSync4, readFileSync as readFileSync5 } from "fs";
import { resolve as resolve4, join } from "path";
import { globSync as globSync2 } from "glob";
var PLACEHOLDER_WORDS2 = /(?:^|[/_-])(?:new|example|your|sample|my|foo|bar|placeholder|template)(?:[/_.-]|$)/i;
var SCOPED_NPM_RE = /^@[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*(?:\/|$)/i;
var tsConfigCache = /* @__PURE__ */ new Map();
function loadTsPaths(projectRoot) {
  if (tsConfigCache.has(projectRoot)) return tsConfigCache.get(projectRoot);
  const tsconfigPath = join(projectRoot, "tsconfig.json");
  if (!existsSync4(tsconfigPath)) {
    tsConfigCache.set(projectRoot, null);
    return null;
  }
  try {
    const raw = readFileSync5(tsconfigPath, "utf-8").replace(/\/\/.*$/gm, "").replace(/,\s*([\]}])/g, "$1");
    const tsconfig = JSON.parse(raw);
    const paths = tsconfig?.compilerOptions?.paths;
    if (!paths || Object.keys(paths).length === 0) {
      tsConfigCache.set(projectRoot, null);
      return null;
    }
    const mappings = [];
    for (const [pattern, targets] of Object.entries(paths)) {
      const prefix = pattern.replace(/\*$/, "");
      const resolved = targets.map((t) => t.replace(/\*$/, ""));
      mappings.push({ prefix, targets: resolved });
    }
    tsConfigCache.set(projectRoot, mappings);
    return mappings;
  } catch {
    tsConfigCache.set(projectRoot, null);
    return null;
  }
}
function resolveAlias(value, projectRoot) {
  const mappings = loadTsPaths(projectRoot);
  if (mappings) {
    for (const { prefix, targets } of mappings) {
      if (value.startsWith(prefix)) {
        const rest = value.slice(prefix.length);
        for (const target of targets) {
          if (existsSync4(resolve4(projectRoot, target + rest))) return true;
        }
      }
    }
  }
  if (value.startsWith("~/")) {
    const stripped = value.slice(2);
    if (existsSync4(resolve4(projectRoot, stripped))) return true;
    if (existsSync4(resolve4(projectRoot, "src", stripped))) return true;
  }
  return false;
}
function checkPaths(claims, projectRoot, scaffoldRoot) {
  const issues = [];
  const pathClaims = claims.filter(
    (c) => c.kind === "path" && !c.negated
  );
  for (const claim of pathClaims) {
    if (SCOPED_NPM_RE.test(claim.value)) continue;
    if (pathExists(claim.value, projectRoot, scaffoldRoot)) continue;
    const isPattern = claim.source.includes("patterns/");
    const isPlaceholder = PLACEHOLDER_WORDS2.test(claim.value);
    const isExample = claim.intent === "example" || claim.confidence === "low";
    const isBareFilename = !claim.value.includes("/");
    const isMediumConfidence = claim.confidence === "medium";
    const severity = isPattern || isPlaceholder || isExample || isBareFilename || isMediumConfidence ? "warning" : "error";
    issues.push({
      code: "MISSING_PATH",
      severity,
      file: claim.source,
      line: claim.line,
      message: `Referenced path does not exist: ${claim.value}`,
      claim,
      suggestion: isExample ? `Replace the illustrative path \`${claim.value}\` with a real repo path or mark it more explicitly as an example.` : `Update this scaffold reference to an existing path, or create the missing file at \`${claim.value}\` if it should exist.`
    });
  }
  return issues;
}
var pathExistsCache = /* @__PURE__ */ new Map();
var fileIndexProject = null;
var fileIndex = null;
function getFileIndex(projectRoot) {
  if (fileIndex && fileIndexProject === projectRoot) return fileIndex;
  fileIndex = /* @__PURE__ */ new Map();
  fileIndexProject = projectRoot;
  const allFiles = globSync2("**/*", {
    cwd: projectRoot,
    ignore: ["node_modules/**", ".cai/**", ".context-condensing/**", "dist/**", ".git/**", "build/**"],
    maxDepth: 6,
    nodir: true
  });
  for (const f of allFiles) {
    const name = f.split("/").pop();
    if (!fileIndex.has(name)) fileIndex.set(name, []);
    fileIndex.get(name).push(f);
  }
  return fileIndex;
}
function pathExists(value, projectRoot, scaffoldRoot) {
  const cacheKey = `${projectRoot}:${value}`;
  const cached = pathExistsCache.get(cacheKey);
  if (cached !== void 0) return cached;
  const result = pathExistsUncached(value, projectRoot, scaffoldRoot);
  pathExistsCache.set(cacheKey, result);
  return result;
}
function pathExistsUncached(value, projectRoot, scaffoldRoot) {
  if (existsSync4(resolve4(projectRoot, value))) return true;
  if (scaffoldRoot !== projectRoot) {
    if (existsSync4(resolve4(scaffoldRoot, value))) return true;
  }
  for (const prefix of [".cai/", ".context-condensing/"]) {
    if (value.startsWith(prefix)) {
      const withoutPrefix = value.slice(prefix.length);
      if (existsSync4(resolve4(projectRoot, withoutPrefix))) return true;
    }
  }
  if (value.startsWith("@") || value.startsWith("~/")) {
    if (resolveAlias(value, projectRoot)) return true;
  }
  const fileName = value.split("/").pop();
  if (fileName) {
    const idx = getFileIndex(projectRoot);
    const candidates = idx.get(fileName);
    if (candidates?.some((c) => c === value || c.endsWith("/" + value))) return true;
  }
  return false;
}

// src/drift/checkers/script-coverage.ts
import { readFileSync as readFileSync6, existsSync as existsSync5 } from "fs";
import { resolve as resolve5 } from "path";
var IGNORED_SCRIPTS = /* @__PURE__ */ new Set([
  "preinstall",
  "install",
  "postinstall",
  "preuninstall",
  "uninstall",
  "postuninstall",
  "prepublish",
  "prepublishOnly",
  "publish",
  "postpublish",
  "prepack",
  "pack",
  "postpack",
  "prepare",
  "preshrinkwrap",
  "shrinkwrap",
  "postshrinkwrap"
]);
function checkScriptCoverage(scaffoldFiles, projectRoot) {
  const scripts = loadPackageScripts2(projectRoot);
  if (!scripts) return [];
  const MAX_CHARS_PER_FILE = 5e3;
  const scaffoldText = scaffoldFiles.map((f) => {
    try {
      const raw = readFileSync6(f, "utf-8");
      return raw.length > MAX_CHARS_PER_FILE ? raw.slice(0, MAX_CHARS_PER_FILE) : raw;
    } catch {
      return "";
    }
  }).join("\n");
  const issues = [];
  for (const script of scripts) {
    if (IGNORED_SCRIPTS.has(script)) continue;
    if (script.startsWith("pre") && scripts.has(script.slice(3)) || script.startsWith("post") && scripts.has(script.slice(4))) {
      continue;
    }
    if (script.includes(":")) {
      const base = script.split(":")[0];
      if (scaffoldText.includes(base)) continue;
    }
    if (!scaffoldText.includes(script)) {
      issues.push({
        code: "UNDOCUMENTED_SCRIPT",
        severity: "warning",
        file: "package.json",
        line: null,
        message: `Script "${script}" exists in package.json but is not mentioned in any scaffold file`,
        explanation: "This script exists in package.json but does not appear in the scaffold text used to guide the agent.",
        suggestion: `Mention "${script}" in setup or workflow documentation if agents are expected to use it.`
      });
    }
  }
  return issues;
}
function loadPackageScripts2(projectRoot) {
  const pkgPath = resolve5(projectRoot, "package.json");
  if (!existsSync5(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync6(pkgPath, "utf-8"));
    const scripts = pkg.scripts ?? {};
    return Object.keys(scripts).length ? new Set(Object.keys(scripts)) : null;
  } catch {
    return null;
  }
}

// src/git.ts
import simpleGit from "simple-git";
import { execFile } from "child_process";
import { promisify } from "util";
var execFileAsync = promisify(execFile);
function getGit(cwd) {
  return simpleGit(cwd ?? process.cwd());
}
async function getGitDiff(paths, cwd) {
  try {
    const git2 = getGit(cwd);
    return await git2.diff(["HEAD~2", "HEAD", "--", ...paths]);
  } catch {
    return "";
  }
}
async function batchFileGitInfo(filePaths, cwd) {
  const result = /* @__PURE__ */ new Map();
  if (filePaths.length === 0) return result;
  const now = Date.now();
  const fileLastCommit = /* @__PURE__ */ new Map();
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", "--max-count=200", "--format=%H %aI", "--name-only", "--diff-filter=ACMR", "--", ...filePaths],
      { cwd, maxBuffer: 10 * 1024 * 1024 }
    );
    let currentHash = "";
    let currentDate = "";
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^[0-9a-f]{40} /.test(trimmed)) {
        const spaceIdx = trimmed.indexOf(" ");
        currentHash = trimmed.slice(0, spaceIdx);
        currentDate = trimmed.slice(spaceIdx + 1);
        continue;
      }
      if (currentHash && !fileLastCommit.has(trimmed)) {
        fileLastCommit.set(trimmed, { hash: currentHash, date: new Date(currentDate) });
      }
    }
  } catch {
    for (const fp of filePaths) result.set(fp, { days: null, commits: null });
    return result;
  }
  const uniqueHashes = [...new Set([...fileLastCommit.values()].map((v) => v.hash))];
  const hashCommitCount = /* @__PURE__ */ new Map();
  await Promise.all(uniqueHashes.map(async (hash) => {
    try {
      const { stdout } = await execFileAsync("git", ["rev-list", "--count", `${hash}..HEAD`], { cwd });
      const count = parseInt(stdout.trim(), 10);
      if (!isNaN(count)) hashCommitCount.set(hash, count);
    } catch {
    }
  }));
  for (const fp of filePaths) {
    const info = fileLastCommit.get(fp);
    if (!info) {
      result.set(fp, { days: null, commits: null });
      continue;
    }
    const days = Math.floor((now - info.date.getTime()) / (1e3 * 60 * 60 * 24));
    const commits = hashCommitCount.get(info.hash) ?? null;
    result.set(fp, { days, commits });
  }
  return result;
}
async function getChangedFiles(cwd) {
  try {
    const git2 = getGit(cwd);
    const status = await git2.status();
    return [
      ...status.modified,
      ...status.created,
      ...status.renamed.map((r) => r.to),
      ...status.deleted,
      ...status.staged
    ].filter((v, i, a) => a.indexOf(v) === i);
  } catch {
    return [];
  }
}

// src/drift/checkers/staleness.ts
async function checkStalenessBatch(filePaths, cwd, thresholds) {
  const issues = [];
  const gitInfo = await batchFileGitInfo(filePaths, cwd);
  for (const source of filePaths) {
    const info = gitInfo.get(source);
    const days = info?.days ?? null;
    const commits = info?.commits ?? null;
    const daySev = days !== null && days >= thresholds.errorDays ? "error" : days !== null && days >= thresholds.warnDays ? "warning" : null;
    const commitSev = commits !== null && commits >= thresholds.errorCommits ? "error" : commits !== null && commits >= thresholds.warnCommits ? "warning" : null;
    const severity = daySev === "error" || commitSev === "error" ? "error" : daySev === "warning" || commitSev === "warning" ? "warning" : null;
    if (severity) {
      const parts = [];
      if (daySev) parts.push(`${days}d since last update`);
      if (commitSev) parts.push(`${commits} commits behind`);
      issues.push({
        code: "STALE_FILE",
        severity,
        file: source,
        line: null,
        message: parts.join(", ")
      });
    }
  }
  return issues;
}

// src/drift/checkers/tool-configs.ts
import { existsSync as existsSync6, mkdirSync, readFileSync as readFileSync7, writeFileSync } from "fs";
import { dirname, resolve as resolve6 } from "path";

// src/utils/merge.ts
var CAI_START = "<!-- cai:start -->";
var CAI_END = "<!-- cai:end -->";
function mergeWithMarkers(existing, generated) {
  const block = `${CAI_START}
${generated.trimEnd()}
${CAI_END}`;
  if (!existing) {
    return block + "\n";
  }
  const startCount = occurrences(existing, CAI_START);
  const endCount = occurrences(existing, CAI_END);
  if (startCount > 1 || endCount > 1) {
    throw new Error(
      `File contains duplicate CAI markers (${startCount} start, ${endCount} end). Remove extra "${CAI_START}" / "${CAI_END}" markers and retry.`
    );
  }
  const startIdx = existing.indexOf(CAI_START);
  const endIdx = existing.indexOf(CAI_END);
  if (startIdx !== -1 !== (endIdx !== -1)) {
    throw new Error(
      `File contains an unpaired CAI marker. Both "${CAI_START}" and "${CAI_END}" must be present, or neither.`
    );
  }
  if (startIdx !== -1 && endIdx !== -1 && endIdx <= startIdx) {
    throw new Error(
      `CAI markers are in wrong order \u2014 "${CAI_END}" appears before "${CAI_START}".`
    );
  }
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return existing.slice(0, startIdx) + block + existing.slice(endIdx + CAI_END.length);
  }
  const trimmed = existing.trimEnd();
  return trimmed ? `${trimmed}

${block}
` : `${block}
`;
}
function occurrences(text, marker) {
  let count = 0;
  let idx = 0;
  while ((idx = text.indexOf(marker, idx)) !== -1) {
    count++;
    idx += marker.length;
  }
  return count;
}
function extractCaiSection(content) {
  const startIdx = content.indexOf(CAI_START);
  const endIdx = content.indexOf(CAI_END);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;
  return content.slice(startIdx + CAI_START.length, endIdx).trim();
}

// src/drift/checkers/tool-configs.ts
var TOOL_CONFIG_PATHS = [
  "CLAUDE.md",
  "AGENTS.md",
  ".cursorrules",
  ".cursor/rules/cai.mdc",
  ".windsurfrules",
  ".github/copilot-instructions.md",
  ".agent.md"
];
function getExistingToolConfigs(projectRoot) {
  return TOOL_CONFIG_PATHS.map((relativePath) => resolve6(projectRoot, relativePath)).filter((path) => existsSync6(path)).map((path) => ({
    path,
    content: readFileSync7(path, "utf-8").replace(/\r\n/g, "\n").trimEnd()
  }));
}
function checkToolConfigs(projectRoot) {
  const configs = getExistingToolConfigs(projectRoot);
  if (configs.length < 2) return [];
  const primary = configs[0];
  const primarySection = extractCaiSection(primary.content);
  const issues = [];
  const primaryCaiContent = primarySection ?? primary.content;
  for (const config of configs.slice(1)) {
    const targetSection = extractCaiSection(config.content);
    const targetCaiContent = targetSection ?? config.content;
    if (targetCaiContent === primaryCaiContent) continue;
    issues.push({
      code: "TOOL_CONFIG_OUT_OF_SYNC",
      severity: "warning",
      file: relativeToProject(projectRoot, config.path),
      line: null,
      message: `Tool config differs from ${relativeToProject(projectRoot, primary.path)}`
    });
  }
  return issues;
}
function syncToolConfigs(projectRoot) {
  const configs = getExistingToolConfigs(projectRoot);
  if (configs.length === 0) {
    return { primary: null, updated: [], skipped: [] };
  }
  const primary = configs[0];
  const updated = [];
  const skipped = [relativeToProject(projectRoot, primary.path)];
  const caiContent = extractCaiSection(primary.content) ?? primary.content;
  for (const target of configs.slice(1)) {
    mkdirSync(dirname(target.path), { recursive: true });
    const existing = existsSync6(target.path) ? readFileSync7(target.path, "utf-8") : null;
    const merged = mergeWithMarkers(existing, caiContent);
    const final = merged.endsWith("\n") ? merged : merged + "\n";
    if (final !== target.content + (target.content.endsWith("\n") ? "" : "\n")) {
      writeFileSync(target.path, final);
    }
    updated.push(relativeToProject(projectRoot, target.path));
  }
  return {
    primary: relativeToProject(projectRoot, primary.path),
    updated,
    skipped
  };
}
function relativeToProject(projectRoot, absolutePath) {
  return absolutePath.slice(projectRoot.length + 1);
}

// src/drift/checkers/workspace-dependencies.ts
import { readFileSync as readFileSync8 } from "fs";
import { relative } from "path";
var RELATIONSHIP_HINT = /\b(depends on|uses|imports|consumes|shares|shared with|backed by|powered by|built on top of)\b/i;
var TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}/;
function checkWorkspaceDependencies(scaffoldFiles, project, projectRoot) {
  if (project.workspaces.length < 2 || project.workspaceDependencies.length === 0) {
    return [];
  }
  const documentedEdges = extractDocumentedWorkspaceEdges(scaffoldFiles, project.workspaces);
  const documentedKeys = new Set(documentedEdges.map(toEdgeKey));
  const actualKeys = new Set(project.workspaceDependencies.map(toEdgeKey));
  const issues = [];
  const preferredDocFile = pickPreferredWorkspaceDoc(scaffoldFiles, projectRoot);
  for (const edge of project.workspaceDependencies) {
    if (documentedKeys.has(toEdgeKey(edge))) continue;
    const suggestion = buildWorkspaceSuggestion(edge);
    issues.push({
      code: "WORKSPACE_DEPENDENCY_MISSING",
      severity: "warning",
      file: preferredDocFile,
      line: null,
      message: `Workspace dependency is not documented in scaffold: ${edge.from} -> ${edge.to}`,
      explanation: `The repo contains an internal workspace ${edge.type} from ${edge.from} to ${edge.to}, derived from manifest dependency "${edge.dependencyName}", but no scaffold line mentions that relationship.`,
      suggestion: `Add under ${suggestion.section}: ${suggestion.line}`
    });
  }
  for (const documented of documentedEdges) {
    if (actualKeys.has(toEdgeKey(documented))) continue;
    issues.push({
      code: "WORKSPACE_DEPENDENCY_INVALID",
      severity: "warning",
      file: relative(projectRoot, documented.file),
      line: documented.line,
      message: `Documented workspace dependency does not exist: ${documented.from} -> ${documented.to}`,
      explanation: `This scaffold line suggests an internal dependency relation, but the workspace manifests do not define it: "${documented.snippet}". The checker only accepts relations backed by actual internal workspace dependencies.`
    });
  }
  return issues;
}
function extractDocumentedWorkspaceEdges(scaffoldFiles, workspaces) {
  const aliases = buildWorkspaceAliases(workspaces);
  const edges = [];
  for (const file of scaffoldFiles) {
    let content = "";
    const MAX_CHARS_PER_FILE = 5e3;
    try {
      const raw = readFileSync8(file, "utf-8");
      content = raw.length > MAX_CHARS_PER_FILE ? raw.slice(0, MAX_CHARS_PER_FILE) : raw;
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!lineHasRelationshipHint(line)) continue;
      const matched = aliases.map((entry) => {
        const match = line.match(entry.pattern);
        return match?.index !== void 0 ? { workspace: entry.workspace, index: match.index } : null;
      }).filter((entry) => Boolean(entry)).sort((a, b) => a.index - b.index);
      const ordered = dedupeWorkspaceOrder(matched.map((entry) => entry.workspace));
      if (ordered.length < 2) continue;
      const [from, ...targets] = ordered;
      for (const to of targets) {
        if (from.path === to.path) continue;
        edges.push({
          file,
          line: index + 1,
          from: from.path,
          to: to.path,
          snippet: line.trim()
        });
      }
    }
  }
  return dedupeDocumentedEdges(edges);
}
function buildWorkspaceAliases(workspaces) {
  return workspaces.flatMap((workspace) => {
    const identifiers = /* @__PURE__ */ new Set([workspace.path]);
    if (workspace.manifest.name) identifiers.add(workspace.manifest.name);
    const basename = workspace.path.split("/").pop();
    if (basename) identifiers.add(basename);
    return [...identifiers].filter(Boolean).map((identifier) => ({
      workspace,
      pattern: new RegExp(`(^|[^A-Za-z0-9@/_-])${escapeRegExp(identifier)}([^A-Za-z0-9@/_-]|$)`, "i")
    }));
  });
}
function dedupeDocumentedEdges(edges) {
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
  for (const edge of edges) {
    const key = `${edge.file}:${edge.line}:${edge.from}:${edge.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(edge);
  }
  return deduped;
}
function dedupeWorkspaceOrder(workspaces) {
  const seen = /* @__PURE__ */ new Set();
  return workspaces.filter((workspace) => {
    if (seen.has(workspace.path)) return false;
    seen.add(workspace.path);
    return true;
  });
}
function lineHasRelationshipHint(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (TABLE_DIVIDER.test(trimmed)) return false;
  return RELATIONSHIP_HINT.test(line);
}
function pickPreferredWorkspaceDoc(scaffoldFiles, projectRoot) {
  const preferredSuffixes = [
    "context/architecture.md",
    "context/conventions.md",
    "context/stack.md",
    "ROUTER.md"
  ];
  for (const suffix of preferredSuffixes) {
    const match = scaffoldFiles.find((file) => file.endsWith(suffix));
    if (match) return relative(projectRoot, match);
  }
  return "ROUTER.md";
}
function buildWorkspaceSuggestion(edge) {
  const section = "## Workspace Relationships";
  const relation = edge.type === "devDependency" ? `${edge.from} depends on ${edge.to} for development and tooling shared through \`${edge.dependencyName}\`.` : `${edge.from} uses ${edge.to} via internal package \`${edge.dependencyName}\`.`;
  return {
    section,
    line: `- ${relation}`
  };
}
function toEdgeKey(edge) {
  return `${edge.from}->${edge.to}`;
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// src/drift/registry.ts
var AVAILABLE_DRIFT_CHECKERS = [
  "edges",
  "staleness",
  "path",
  "command",
  "dependency",
  "cross-file",
  "workspace-dependencies",
  "index-sync",
  "tool-configs",
  "script-coverage"
];
function createDriftRegistry() {
  return [
    {
      name: "edges",
      run(context) {
        let checked = 0;
        const issues = [];
        for (const filePath of context.scaffoldFiles) {
          const source = relative2(context.projectRoot, filePath);
          const frontmatter = parseFrontmatter(filePath);
          issues.push(
            ...checkEdges(
              frontmatter,
              filePath,
              source,
              context.projectRoot,
              context.scaffoldRoot
            )
          );
          checked++;
        }
        return { issues, checked };
      }
    },
    {
      name: "staleness",
      async run(context) {
        const sources = context.scaffoldFiles.map((f) => relative2(context.projectRoot, f));
        const issues = await checkStalenessBatch(
          sources,
          context.projectRoot,
          context.staleness
        );
        return { issues, checked: sources.length };
      }
    },
    {
      name: "path",
      run(context) {
        const checked = context.claims.filter((claim) => claim.kind === "path" && !claim.negated).length;
        return {
          issues: checkPaths(context.claims, context.projectRoot, context.scaffoldRoot),
          checked
        };
      }
    },
    {
      name: "command",
      run(context) {
        const checked = context.claims.filter((claim) => claim.kind === "command" && !claim.negated).length;
        return { issues: checkCommands(context.claims, context.projectRoot, context.project), checked };
      }
    },
    {
      name: "dependency",
      run(context) {
        const checked = context.claims.filter(
          (claim) => (claim.kind === "dependency" || claim.kind === "version") && !claim.negated
        ).length;
        return { issues: checkDependencies(context.claims, context.projectRoot, context.project), checked };
      }
    },
    {
      name: "cross-file",
      run(context) {
        const checked = context.claims.filter((claim) => claim.kind === "version" && !claim.negated).length;
        return { issues: checkCrossFile(context.claims), checked };
      }
    },
    {
      name: "workspace-dependencies",
      run(context) {
        return {
          issues: checkWorkspaceDependencies(
            context.scaffoldFiles,
            context.project,
            context.projectRoot
          ),
          checked: context.project.workspaceDependencies.length
        };
      }
    },
    {
      name: "index-sync",
      run(context) {
        return {
          issues: checkIndexSync(context.projectRoot, context.scaffoldRoot),
          checked: 1
        };
      }
    },
    {
      name: "tool-configs",
      run(context) {
        return {
          issues: checkToolConfigs(context.projectRoot),
          checked: getExistingToolConfigs(context.projectRoot).length
        };
      }
    },
    {
      name: "script-coverage",
      run(context) {
        return {
          issues: checkScriptCoverage(context.scaffoldFiles, context.projectRoot),
          checked: 1
        };
      }
    }
  ];
}
function selectDriftRegistry(registry, opts) {
  const only = opts.only ? new Set(opts.only) : null;
  const skip = opts.skip ? new Set(opts.skip) : null;
  return registry.filter((checker) => {
    if (only && !only.has(checker.name)) return false;
    if (skip && skip.has(checker.name)) return false;
    return true;
  });
}
async function runCheckerRegistry(context, registry = createDriftRegistry()) {
  const allIssues = [];
  const summaries = [];
  for (const checker of registry) {
    try {
      const result = await checker.run(context);
      allIssues.push(...result.issues);
      summaries.push({
        name: checker.name,
        checked: result.checked,
        issuesFound: result.issues.length
      });
    } catch (err) {
      const message = err.message;
      allIssues.push({
        code: "CHECKER_ERROR",
        severity: "warning",
        file: `[checker:${checker.name}]`,
        line: null,
        message: `Checker '${checker.name}' failed: ${message}`
      });
      summaries.push({ name: checker.name, checked: 0, issuesFound: 0, error: message });
    }
  }
  return { issues: allIssues, summaries };
}

// src/git/blame.ts
import { execFileSync } from "child_process";
var cache = /* @__PURE__ */ new Map();
function git(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 4 * 1024 * 1024
    });
  } catch {
    return "";
  }
}
function parseRelative(rel) {
  return rel.trim();
}
function findDeletionCommit(projectRoot, relPath) {
  const cacheKey = `${projectRoot}:${relPath}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;
  const log = git(projectRoot, [
    "log",
    "--diff-filter=D",
    "--follow",
    "-1",
    "--format=%H|%s|%ar",
    "--",
    relPath
  ]);
  if (!log.trim()) {
    cache.set(cacheKey, null);
    return null;
  }
  const [commit, message, ago] = log.trim().split("|");
  if (!commit) {
    cache.set(cacheKey, null);
    return null;
  }
  const nameStatus = git(projectRoot, ["show", "--name-status", "--format=", commit]);
  let renamedTo;
  for (const line of nameStatus.split("\n")) {
    if (line.startsWith("R")) {
      const parts = line.split("	");
      if (parts.length >= 3 && parts[1] === relPath) {
        renamedTo = parts[2];
        break;
      }
    }
  }
  const info = {
    commit: commit.slice(0, 7),
    message,
    ago: parseRelative(ago),
    renamedTo
  };
  cache.set(cacheKey, info);
  return info;
}

// src/drift/severity.ts
var TYPE_WEIGHT = {
  // High: AI immediately fails or hallucinates
  MISSING_PATH: 3,
  DEAD_COMMAND: 3,
  // Medium: AI may use wrong API or version
  DEPENDENCY_MISSING: 2,
  VERSION_MISMATCH: 2,
  CROSS_FILE_CONFLICT: 2,
  WORKSPACE_DEPENDENCY_MISSING: 2,
  WORKSPACE_DEPENDENCY_INVALID: 2,
  // Low: cosmetic / hygiene
  UNDOCUMENTED_SCRIPT: 1,
  STALE_FILE: 1,
  TOOL_CONFIG_OUT_OF_SYNC: 1,
  INDEX_MISSING_ENTRY: 1,
  INDEX_ORPHAN_ENTRY: 1,
  DEAD_EDGE: 1,
  CHECKER_ERROR: 1
};
var DEFAULT_WEIGHT = 1;
function hotPathMultiplier(file, byFile) {
  const agg = byFile.get(file);
  if (!agg) return 1;
  const bonus = Math.min(1, Math.log2(agg.hits + 1) / 6);
  return 1 + bonus;
}
function weightedScore(issues, aggregations = []) {
  const byFile = /* @__PURE__ */ new Map();
  for (const a of aggregations) byFile.set(a.file, a);
  let totalWeight = 0;
  for (const issue of issues) {
    const typeWeight = TYPE_WEIGHT[issue.code] ?? DEFAULT_WEIGHT;
    const sevMultiplier = issue.severity === "error" ? 3 : issue.severity === "warning" ? 1 : 0;
    const hot = hotPathMultiplier(issue.file, byFile);
    totalWeight += typeWeight * sevMultiplier * hot;
  }
  const clamped = Math.min(100, totalWeight);
  const score = Math.max(0, Math.round(100 - clamped));
  return {
    score,
    totalWeight: Math.round(totalWeight * 10) / 10,
    usedTelemetry: aggregations.length > 0
  };
}

// src/drift/index.ts
var DEFAULT_STALENESS = {
  warnDays: 30,
  errorDays: 90,
  warnCommits: 50,
  errorCommits: 200
};
async function runDriftCheck(config, opts = {}) {
  const { projectRoot, scaffoldRoot } = config;
  const staleness = resolveStalenessThresholds(
    config.settings.staleness,
    opts
  );
  let scaffoldFiles = findScaffoldFiles(projectRoot, scaffoldRoot).filter((f) => !f.includes("/codex/"));
  if (opts.incremental) {
    const changed = await getChangedFiles(projectRoot);
    const changedSet = new Set(changed.map((f) => resolve7(projectRoot, f)));
    const filtered = scaffoldFiles.filter((f) => changedSet.has(f));
    if (filtered.length > 0) scaffoldFiles = filtered;
  }
  const allClaims = [];
  const project = scanProjectModel(projectRoot);
  for (const filePath of scaffoldFiles) {
    const source = relative3(projectRoot, filePath);
    const claims = extractClaims(filePath, source);
    allClaims.push(...claims);
  }
  const context = {
    projectRoot,
    scaffoldRoot,
    scaffoldFiles,
    claims: allClaims,
    project,
    config,
    staleness
  };
  const registry = selectDriftRegistry(createDriftRegistry(), {
    only: opts.only,
    skip: opts.skip
  });
  const { issues: allIssues, summaries: checkerSummaries } = await runCheckerRegistry(context, registry);
  for (const issue of allIssues) {
    if (issue.code === "MISSING_PATH" && issue.claim) {
      const info = findDeletionCommit(projectRoot, issue.claim.value);
      if (info) {
        issue.gitContext = {
          commit: info.commit,
          message: info.message,
          ago: info.ago,
          renamedTo: info.renamedTo
        };
      }
    }
  }
  const score = computeScore(allIssues);
  const queries = readQueries(projectRoot, { sinceMs: Date.now() - 7 * 24 * 60 * 60 * 1e3 });
  const aggregations = aggregateByFile(queries);
  const weighted = weightedScore(allIssues, aggregations);
  const errors = allIssues.filter((i) => i.severity === "error").length;
  const warnings = allIssues.filter((i) => i.severity === "warning").length;
  appendHistory(projectRoot, {
    score,
    weightedScore: weighted.usedTelemetry ? weighted.score : void 0,
    errors,
    warnings,
    filesChecked: scaffoldFiles.length
  });
  return {
    score,
    weightedScore: weighted.score,
    usedTelemetry: weighted.usedTelemetry,
    issues: allIssues,
    filesChecked: scaffoldFiles.length,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    diagnostics: opts.verbose ? {
      scaffoldFiles: scaffoldFiles.map((file) => relative3(projectRoot, file)),
      claimsByKind: {
        path: allClaims.filter((claim) => claim.kind === "path").length,
        command: allClaims.filter((claim) => claim.kind === "command").length,
        dependency: allClaims.filter((claim) => claim.kind === "dependency").length,
        version: allClaims.filter((claim) => claim.kind === "version").length
      },
      project: {
        rootManifestType: project.rootManifest?.type ?? null,
        rootManifestName: project.rootManifest?.name ?? null,
        workspaceCount: project.workspaces.length,
        workspaceNames: project.workspaces.map((workspace) => workspace.manifest.name ?? workspace.path).slice(0, 5),
        workspaceDependencyCount: project.workspaceDependencies.length,
        commandCount: project.commands.length,
        sampleCommands: project.commands.slice(0, 5)
      },
      checkerSummaries
    } : void 0
  };
}
function findScaffoldFiles(projectRoot, scaffoldRoot) {
  const scaffoldPatterns = [
    "context/*.md",
    "patterns/*.md",
    "codex/*.md",
    "ROUTER.md",
    "AGENTS.md",
    "SETUP.md",
    "SYNC.md"
  ];
  const ignorePatterns = loadCaiIgnore(scaffoldRoot, projectRoot);
  const files = [];
  for (const pattern of scaffoldPatterns) {
    const matches = globSync3(pattern, {
      cwd: scaffoldRoot,
      absolute: true,
      ignore: ["node_modules/**", ...ignorePatterns]
    });
    files.push(...matches);
  }
  if (scaffoldRoot !== projectRoot) {
    for (const name of ["CLAUDE.md", ".cursorrules", ".windsurfrules"]) {
      const matches = globSync3(name, {
        cwd: projectRoot,
        absolute: true,
        ignore: ["node_modules/**", ...ignorePatterns]
      });
      files.push(...matches);
    }
  }
  return [...new Set(files)];
}
function loadCaiIgnore(scaffoldRoot, projectRoot) {
  const patterns = [];
  const locations = [.../* @__PURE__ */ new Set([scaffoldRoot, projectRoot])];
  for (const dir of locations) {
    const ignoreFile = resolve7(dir, ".caiignore");
    if (!existsSync7(ignoreFile)) continue;
    try {
      const lines = readFileSync9(ignoreFile, "utf-8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
      patterns.push(...lines);
    } catch {
    }
  }
  return patterns;
}
function resolveStalenessThresholds(settings, opts) {
  return {
    warnDays: opts.staleDays ?? settings?.warnDays ?? DEFAULT_STALENESS.warnDays,
    errorDays: settings?.errorDays ?? DEFAULT_STALENESS.errorDays,
    warnCommits: opts.staleCommits ?? settings?.warnCommits ?? DEFAULT_STALENESS.warnCommits,
    errorCommits: settings?.errorCommits ?? DEFAULT_STALENESS.errorCommits
  };
}

export {
  extractClaims,
  parseFrontmatter,
  getGit,
  getGitDiff,
  batchFileGitInfo,
  mergeWithMarkers,
  checkToolConfigs,
  syncToolConfigs,
  AVAILABLE_DRIFT_CHECKERS,
  DEFAULT_STALENESS,
  runDriftCheck,
  findScaffoldFiles
};
//# sourceMappingURL=chunk-QSCBXJG5.js.map