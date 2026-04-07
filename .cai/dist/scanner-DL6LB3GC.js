#!/usr/bin/env node
import {
  scanProjectModel
} from "./chunk-S2JQZXY2.js";

// src/scanner/entry-points.ts
import { globSync } from "glob";
var MAIN_PATTERNS = [
  // JS/TS
  "src/index.{ts,js,tsx,jsx}",
  "src/main.{ts,js,tsx,jsx}",
  "src/app.{ts,js,tsx,jsx}",
  "index.{ts,js}",
  "server.{ts,js,py}",
  "src/cli.{ts,js}",
  // Go
  "main.go",
  "cmd/*/main.go",
  // Python
  "main.py",
  "app.py",
  "__main__.py",
  "src/__main__.py",
  // Rust
  "src/main.rs",
  "src/lib.rs",
  // Ruby
  "app.rb",
  "lib/*.rb",
  // C# / .NET
  "Program.cs",
  "src/**/Program.cs",
  // Java
  "src/main/java/**/*Application.java",
  "src/main/java/**/Main.java"
];
var TEST_PATTERNS = [
  // JS/TS
  "src/**/*.test.{ts,js,tsx,jsx}",
  "src/**/*.spec.{ts,js,tsx,jsx}",
  // Python
  "tests/**/*.py",
  "test/**/*.py",
  // Go
  "**/*_test.go",
  // C# / .NET
  "**/*.Tests.cs",
  "**/*Tests.cs",
  "**/*Test.cs",
  // Java
  "src/test/java/**/*.java"
  // Rust
  // (inline in src/lib.rs — no separate pattern needed)
];
var CONFIG_PATTERNS = [
  // JS/TS
  "tsconfig.json",
  "vite.config.{ts,js}",
  "next.config.{ts,js,mjs}",
  "webpack.config.{ts,js}",
  "jest.config.{ts,js}",
  "vitest.config.{ts,js}",
  ".eslintrc.{js,json,yml}",
  "eslint.config.{js,mjs}",
  // Python
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "tox.ini",
  // Go
  "go.mod",
  // Rust
  "Cargo.toml",
  // C# / .NET / Unity
  "*.sln",
  "*.csproj",
  "src/**/*.csproj",
  "global.json",
  "Directory.Build.props",
  // Java
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  // Ruby
  "Gemfile",
  // Generic
  "Makefile",
  "CMakeLists.txt",
  ".editorconfig"
];
function scanEntryPoints(projectRoot) {
  const entries = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (patterns, type, limit) => {
    let count = 0;
    for (const pattern of patterns) {
      const matches = globSync(pattern, {
        cwd: projectRoot,
        ignore: [
          "node_modules/**",
          "dist/**",
          "build/**",
          ".git/**",
          // .NET / Unity
          "bin/**",
          "obj/**",
          "Library/**",
          "Temp/**",
          "Logs/**",
          // Python
          ".venv/**",
          "venv/**",
          "__pycache__/**",
          // Java
          "target/**",
          ".gradle/**",
          // Rust
          "target/**"
        ]
      });
      for (const path of matches) {
        if (seen.has(path)) continue;
        seen.add(path);
        entries.push({ path, type });
        count++;
        if (limit && count >= limit) return;
      }
    }
  };
  add(MAIN_PATTERNS, "main");
  add(TEST_PATTERNS, "test", 10);
  add(CONFIG_PATTERNS, "config");
  return entries;
}

// src/scanner/service-graph.ts
import { existsSync, readFileSync } from "fs";
import { dirname, join, normalize, relative } from "path";
import { globSync as globSync2 } from "glob";
var SERVICE_PATTERNS = [
  "src/services/**/*.{ts,tsx,js,jsx}",
  "src/providers/**/*.{ts,tsx,js,jsx}",
  "src/handlers/**/*.{ts,tsx,js,jsx}",
  "src/controllers/**/*.{ts,tsx,js,jsx}",
  "src/routes/**/*.{ts,tsx,js,jsx}",
  "src/api/**/*.{ts,tsx,js,jsx}",
  "app/api/**/*.{ts,tsx,js,jsx}"
];
var IMPORT_PATTERNS = [
  /import\s+(?:type\s+)?(?:[^"'`]+?\s+from\s+)?["'`]([^"'`]+)["'`]/g,
  /export\s+[^"'`]+?\s+from\s+["'`]([^"'`]+)["'`]/g,
  /require\(["'`]([^"'`]+)["'`]\)/g
];
var RESOLUTION_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx"
];
function scanServiceGraph(projectRoot, entryPoints) {
  const entryPaths = entryPoints.filter((entry) => entry.type === "main").map((entry) => entry.path);
  const servicePaths = SERVICE_PATTERNS.flatMap(
    (pattern) => globSync2(pattern, {
      cwd: projectRoot,
      ignore: ["node_modules/**", "dist/**", "build/**", ".git/**"]
    })
  );
  const allPaths = [.../* @__PURE__ */ new Set([...entryPaths, ...servicePaths])].sort();
  const nodeMap = /* @__PURE__ */ new Map();
  for (const path of allPaths) {
    nodeMap.set(path, {
      path,
      kind: entryPaths.includes(path) ? "entry" : "service"
    });
  }
  const edges = [];
  const edgeKeys = /* @__PURE__ */ new Set();
  for (const path of allPaths) {
    const absolutePath = join(projectRoot, path);
    if (!existsSync(absolutePath)) continue;
    let content = "";
    try {
      content = readFileSync(absolutePath, "utf8");
    } catch {
      continue;
    }
    for (const specifier of extractImportSpecifiers(content)) {
      if (!specifier.startsWith(".")) continue;
      const resolved = resolveRelativeImport(projectRoot, path, specifier);
      if (!resolved || !nodeMap.has(resolved)) continue;
      const key = `${path}->${resolved}`;
      if (edgeKeys.has(key) || path === resolved) continue;
      edgeKeys.add(key);
      edges.push({ from: path, to: resolved });
    }
  }
  return {
    nodes: [...nodeMap.values()],
    edges: edges.sort((a, b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`))
  };
}
function extractImportSpecifiers(content) {
  const values = [];
  for (const pattern of IMPORT_PATTERNS) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      values.push(match[1]);
    }
    pattern.lastIndex = 0;
  }
  return values;
}
function resolveRelativeImport(projectRoot, fromPath, specifier) {
  const fromDir = dirname(join(projectRoot, fromPath));
  const normalizedBase = normalize(join(fromDir, specifier));
  for (const suffix of RESOLUTION_SUFFIXES) {
    const candidate = normalize(`${normalizedBase}${suffix}`);
    if (!existsSync(candidate)) continue;
    return relative(projectRoot, candidate);
  }
  return null;
}

// src/scanner/reconciliation.ts
function scanReconciliation(readme, project) {
  const content = readme ?? "";
  const documentedCommands = project.commands.filter(
    (command) => isCommandDocumented(content, command)
  );
  const undocumentedCommands = project.commands.filter(
    (command) => !documentedCommands.includes(command)
  );
  const workspacePaths = project.workspaces.map((workspace) => workspace.path);
  const documentedWorkspaces = workspacePaths.filter(
    (workspacePath) => content.includes(workspacePath)
  );
  const undocumentedWorkspaces = workspacePaths.filter(
    (workspacePath) => !documentedWorkspaces.includes(workspacePath)
  );
  return {
    documentedCommands,
    undocumentedCommands,
    documentedWorkspaces,
    undocumentedWorkspaces
  };
}
function isCommandDocumented(content, command) {
  const [scope, script] = command.split(":");
  if (!scope || !script) return false;
  if (content.includes(`npm run ${script}`) || content.includes(`pnpm ${script}`) || content.includes(`pnpm run ${script}`) || content.includes(`yarn ${script}`) || content.includes(`bun run ${script}`) || content.includes(`turbo run ${script}`) || content.includes(`make ${script}`)) {
    return true;
  }
  if (scope === "root") {
    return content.includes(`\`${script}\``) || content.includes(`"${script}"`);
  }
  return content.includes(`${scope}:${script}`) || content.includes(`${scope} ${script}`);
}

// src/scanner/folder-tree.ts
import { readdirSync, statSync } from "fs";
import { resolve } from "path";
var CATEGORY_PATTERNS = {
  routes: /^(routes?|pages?|api|endpoints?)/i,
  models: /^(models?|entities|schemas?|types?)/i,
  services: /^(services?|providers?|handlers?|controllers?|actions?)/i,
  tests: /^(tests?|__tests__|spec|__spec__)/i,
  config: /^(config|configs?|settings?)/i,
  utils: /^(utils?|helpers?|lib|shared|common)/i,
  views: /^(views?|components?|templates?|layouts?|ui)/i,
  other: /./
};
var IGNORE_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  "vendor",
  ".cai",
  ".context-condensing"
]);
function scanFolderTree(projectRoot) {
  const categories = [];
  let entries;
  try {
    entries = readdirSync(projectRoot);
  } catch {
    return categories;
  }
  for (const entry of entries) {
    if (entry.startsWith(".") && entry !== ".github") continue;
    if (IGNORE_DIRS.has(entry)) continue;
    const fullPath = resolve(projectRoot, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const fileCount = countFiles(fullPath);
    const category = categorize(entry);
    categories.push({
      name: entry,
      path: entry,
      fileCount,
      category
    });
  }
  return categories.sort((a, b) => b.fileCount - a.fileCount);
}
function categorize(dirName) {
  for (const [category, pattern] of Object.entries(CATEGORY_PATTERNS)) {
    if (category === "other") continue;
    if (pattern.test(dirName)) return category;
  }
  return "other";
}
function countFiles(dir, depth = 0) {
  if (depth > 3) return 0;
  let count = 0;
  try {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(".")) continue;
      if (IGNORE_DIRS.has(entry)) continue;
      const fullPath = resolve(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isFile()) count++;
        else if (stat.isDirectory()) count += countFiles(fullPath, depth + 1);
      } catch {
        continue;
      }
    }
  } catch {
  }
  return count;
}

// src/scanner/tooling.ts
import { existsSync as existsSync2 } from "fs";
import { resolve as resolve2 } from "path";
import { globSync as globSync3 } from "glob";
function scanTooling(projectRoot) {
  return {
    testRunner: detectTestRunner(projectRoot),
    buildTool: detectBuildTool(projectRoot),
    linter: detectLinter(projectRoot),
    formatter: detectFormatter(projectRoot),
    packageManager: detectPackageManager(projectRoot)
  };
}
function exists(root, ...files) {
  return files.some((f) => existsSync2(resolve2(root, f)));
}
function detectTestRunner(root) {
  if (exists(root, "vitest.config.ts", "vitest.config.js")) return "vitest";
  if (exists(root, "jest.config.ts", "jest.config.js", "jest.config.json")) return "jest";
  if (exists(root, "pytest.ini", "conftest.py")) return "pytest";
  if (exists(root, ".mocharc.yml", ".mocharc.json")) return "mocha";
  if (globHas(root, "**/*.Tests.csproj") || globHas(root, "**/*Tests.csproj")) return "dotnet-test";
  if (exists(root, "pom.xml")) return "junit";
  if (exists(root, "build.gradle", "build.gradle.kts")) return "gradle-test";
  if (exists(root, "Cargo.toml")) return "cargo-test";
  if (exists(root, "spec", ".rspec")) return "rspec";
  return null;
}
function detectBuildTool(root) {
  if (exists(root, "tsup.config.ts", "tsup.config.js")) return "tsup";
  if (exists(root, "vite.config.ts", "vite.config.js")) return "vite";
  if (exists(root, "next.config.ts", "next.config.js", "next.config.mjs")) return "next";
  if (exists(root, "webpack.config.ts", "webpack.config.js")) return "webpack";
  if (exists(root, "rollup.config.ts", "rollup.config.js")) return "rollup";
  if (exists(root, "esbuild.config.ts")) return "esbuild";
  if (globHas(root, "*.sln") || globHas(root, "*.csproj") || globHas(root, "src/**/*.csproj")) return "dotnet";
  if (exists(root, "build.gradle", "build.gradle.kts")) return "gradle";
  if (exists(root, "pom.xml")) return "maven";
  if (exists(root, "Cargo.toml")) return "cargo";
  if (exists(root, "Makefile")) return "make";
  if (exists(root, "CMakeLists.txt")) return "cmake";
  return null;
}
function detectLinter(root) {
  if (exists(root, "eslint.config.js", "eslint.config.mjs", ".eslintrc.js", ".eslintrc.json", ".eslintrc.yml"))
    return "eslint";
  if (exists(root, "biome.json", "biome.jsonc")) return "biome";
  if (exists(root, "ruff.toml") || exists(root, ".ruff.toml")) return "ruff";
  if (exists(root, ".pylintrc", "pylintrc")) return "pylint";
  if (exists(root, ".flake8")) return "flake8";
  if (exists(root, ".golangci.yml", ".golangci.yaml")) return "golangci-lint";
  if (exists(root, ".rubocop.yml")) return "rubocop";
  if (exists(root, "Directory.Build.props")) return "roslyn";
  return null;
}
function detectFormatter(root) {
  if (exists(root, ".prettierrc", ".prettierrc.json", ".prettierrc.js", "prettier.config.js"))
    return "prettier";
  if (exists(root, "biome.json")) return "biome";
  if (exists(root, ".editorconfig")) return "editorconfig";
  return null;
}
function detectPackageManager(root) {
  if (exists(root, "bun.lockb", "bun.lock")) return "bun";
  if (exists(root, "pnpm-lock.yaml")) return "pnpm";
  if (exists(root, "yarn.lock")) return "yarn";
  if (exists(root, "package-lock.json")) return "npm";
  if (exists(root, "package.json")) return "npm";
  return null;
}
function globHas(root, pattern) {
  try {
    return globSync3(pattern, { cwd: root }).length > 0;
  } catch {
    return false;
  }
}

// src/scanner/readme.ts
import { readFileSync as readFileSync2, existsSync as existsSync3 } from "fs";
import { resolve as resolve3 } from "path";
function scanReadme(projectRoot) {
  const candidates = ["README.md", "readme.md", "Readme.md", "README"];
  for (const name of candidates) {
    const path = resolve3(projectRoot, name);
    if (existsSync3(path)) {
      try {
        const content = readFileSync2(path, "utf-8");
        return content.length > 3e3 ? content.slice(0, 3e3) + "\n... (truncated)" : content;
      } catch {
        return null;
      }
    }
  }
  return null;
}

// src/scanner/index.ts
async function runScan(config, opts) {
  const brief = buildBrief(config.projectRoot);
  if (opts.jsonOnly) return brief;
  return buildPrompt(brief);
}
function buildBrief(projectRoot) {
  const safe = (label, fn, fallback) => {
    try {
      return fn();
    } catch (err) {
      process.stderr.write(`Warning: scanner '${label}' failed: ${err.message}
`);
      return fallback;
    }
  };
  const project = safe("manifest", () => scanProjectModel(projectRoot), {
    rootManifest: null,
    workspaces: [],
    workspaceDependencies: [],
    commands: []
  });
  const entryPoints = safe("entry-points", () => scanEntryPoints(projectRoot), []);
  const readme = safe("readme", () => scanReadme(projectRoot), null);
  return {
    schemaVersion: "1.0",
    manifest: project.rootManifest,
    project,
    entryPoints,
    serviceGraph: safe("service-graph", () => scanServiceGraph(projectRoot, entryPoints), { nodes: [], edges: [] }),
    reconciliation: safe("reconciliation", () => scanReconciliation(readme, project), { documentedCommands: [], undocumentedCommands: [], documentedWorkspaces: [], undocumentedWorkspaces: [] }),
    folderTree: safe("folder-tree", () => scanFolderTree(projectRoot), []),
    tooling: safe("tooling", () => scanTooling(projectRoot), { testRunner: null, buildTool: null, linter: null, formatter: null, packageManager: null }),
    readme,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
}
var README_MAX_CHARS = 3e3;
function buildPrompt(brief) {
  const capped = brief.readme && brief.readme.length > README_MAX_CHARS ? { ...brief, readme: brief.readme.slice(0, README_MAX_CHARS) + "\n\u2026 [truncated]" } : brief;
  const briefJson = JSON.stringify(capped);
  return `Here is a pre-analyzed brief of the codebase \u2014 do NOT explore the filesystem yourself, reason from this brief:

<brief>
${briefJson}
</brief>

Using this brief, populate the CAI \xB7 Coherence AI scaffold files. Focus on:
1. context/architecture.md \u2014 system components, data flow, integrations
2. context/stack.md \u2014 technologies, versions, key libraries
3. context/conventions.md \u2014 code patterns, naming, file organization
4. context/decisions.md \u2014 architectural choices and their rationale
5. context/setup.md \u2014 how to set up and run the project
6. ROUTER.md \u2014 update the "Current Project State" section

For each file, use the information from the brief rather than exploring the filesystem.
Be precise about versions, paths, dependencies, workspace-specific commands, workspace relationships, service/import relationships, and README gaps surfaced in reconciliation \u2014 they come directly from the project model and scanner graph.`;
}
export {
  runScan
};
//# sourceMappingURL=scanner-DL6LB3GC.js.map