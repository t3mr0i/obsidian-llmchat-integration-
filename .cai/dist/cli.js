#!/usr/bin/env node
import {
  HOOK_MARKERS
} from "./chunk-I42G66PB.js";
import {
  rebuildPatternIndex
} from "./chunk-3HS3FYZ2.js";
import {
  extractExports,
  extractImports
} from "./chunk-55Z3WHTN.js";
import {
  runSync
} from "./chunk-AWGJUVUQ.js";
import {
  generateRules
} from "./chunk-7GLRTQA4.js";
import {
  AVAILABLE_DRIFT_CHECKERS,
  DEFAULT_STALENESS,
  batchFileGitInfo,
  checkToolConfigs,
  extractClaims,
  findScaffoldFiles,
  getGit,
  parseFrontmatter,
  runDriftCheck,
  syncToolConfigs
} from "./chunk-MM7NAXI3.js";
import {
  estimateFileTokens,
  stripFrontmatter,
  writeIfChanged
} from "./chunk-TBA32Z4B.js";
import {
  scanProjectModel
} from "./chunk-OSCCDOHW.js";

// src/cli.ts
import chalk8 from "chalk";
import { Command } from "commander";
import { existsSync as existsSync11 } from "fs";
import { join as join10 } from "path";
import { spawnSync as spawnSync4 } from "child_process";

// src/bootstrap.ts
import chalk from "chalk";
import {
  cpSync,
  existsSync as existsSync2,
  mkdirSync as mkdirSync2,
  readFileSync as readFileSync2,
  readdirSync,
  rmSync,
  writeFileSync as writeFileSync2
} from "fs";
import { dirname, join as join2, resolve } from "path";
import { fileURLToPath } from "url";
import { spawnSync as spawnSync2 } from "child_process";

// src/mcp/install.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";
function isMcpRegistered(settingsPath) {
  if (!existsSync(settingsPath)) return false;
  try {
    const raw = readFileSync(settingsPath, "utf8");
    const json = JSON.parse(raw);
    const servers = json.mcpServers;
    return Boolean(servers?.cai);
  } catch {
    return false;
  }
}
function writeDirectly(settingsPath) {
  let json = {};
  if (existsSync(settingsPath)) {
    try {
      json = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
    }
  }
  const servers = json.mcpServers ?? {};
  servers.cai = { command: "cai", args: ["mcp", "start"] };
  json.mcpServers = servers;
  mkdirSync(join(settingsPath, ".."), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(json, null, 2) + "\n", "utf8");
}
function ensureMcpRegistered(projectRoot) {
  const projectSettings = join(projectRoot, ".claude", "settings.json");
  const globalSettings = join(homedir(), ".claude", "settings.json");
  if (isMcpRegistered(projectSettings) || isMcpRegistered(globalSettings)) {
    return { status: "already_registered" };
  }
  const result = spawnSync("claude", ["mcp", "add", "cai", "--", "cai", "mcp", "start"], {
    cwd: projectRoot,
    stdio: "pipe"
  });
  if (result.error) {
    const code = result.error.code;
    if (code === "ENOENT") {
      try {
        writeDirectly(projectSettings);
        return {
          status: "registered",
          message: "written to .claude/settings.json (claude CLI not found)"
        };
      } catch (err) {
        return { status: "claude_not_found" };
      }
    }
    return { status: "failed", message: result.error.message };
  }
  const stderr = result.stderr?.toString() ?? "";
  if (result.status !== 0 && stderr.toLowerCase().includes("already")) {
    return { status: "already_registered" };
  }
  if (result.status !== 0) {
    try {
      writeDirectly(projectSettings);
      return { status: "registered" };
    } catch {
      return { status: "failed", message: stderr.trim() || "unknown error" };
    }
  }
  return { status: "registered" };
}
function ensurePostCompactHook(projectRoot) {
  return ensureCaiHooks(projectRoot) > 0;
}
function ensureCaiHooks(projectRoot) {
  const settingsPath = join(projectRoot, ".claude", "settings.json");
  let json = {};
  if (existsSync(settingsPath)) {
    try {
      json = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
    }
  }
  const hooks = json.hooks ?? {};
  let installed = 0;
  if (hooks.postCompact) {
    delete hooks.postCompact;
  }
  if (hooks.preToolUse) {
    delete hooks.preToolUse;
  }
  if (!hooks.PreCompact) {
    hooks.PreCompact = [
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: "echo 'Context was compacted. Re-read CLAUDE.md and .cai/ROUTER.md before continuing. Verify your current task and plan are still loaded.'"
          }
        ]
      }
    ];
    installed++;
  }
  if (!hooks.PreToolUse) {
    hooks.PreToolUse = [
      {
        matcher: "Bash",
        hooks: [
          {
            type: "command",
            command: "jq -r '.tool_input.command // empty' | grep -qE 'git +push.*--force' && { echo 'BLOCKED: Force push detected.' >&2; exit 2; } || exit 0"
          }
        ]
      }
    ];
    installed++;
  }
  if (installed > 0 || Object.keys(hooks).length > 0) {
    json.hooks = hooks;
    mkdirSync(join(settingsPath, ".."), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(json, null, 2) + "\n", "utf8");
  }
  return installed;
}

// src/bootstrap.ts
var BOOTSTRAP_ENTRIES = [
  ".tool-configs",
  "AGENTS.md",
  "CLAUDE.md",
  "LICENSE",
  "README.md",
  "ROUTER.md",
  "SETUP.md",
  "SYNC.md",
  "context",
  "dist",
  "mascot",
  "package.json",
  "patterns",
  "screenshots",
  "setup.sh",
  "sync.sh",
  "tsup.config.ts",
  "update.sh",
  "visualize.sh"
];
function runBootstrap(opts = {}) {
  const sourceRoot = opts.sourceRoot ?? getPackageRoot();
  const projectRoot = resolve(opts.targetDir ?? process.cwd());
  const destination = join2(projectRoot, ".cai");
  if (sourceRoot === destination) {
    throw new Error("Refusing to bootstrap CAI into itself.");
  }
  if (existsSync2(destination)) {
    const hasContent = readdirSync(destination).length > 0;
    if (hasContent && !opts.force) {
      throw new Error(`.cai already exists in ${projectRoot}. Use --force to replace it.`);
    }
    rmSync(destination, { recursive: true, force: true });
  }
  mkdirSync2(destination, { recursive: true });
  const copied = [];
  for (const entry of BOOTSTRAP_ENTRIES) {
    const from = join2(sourceRoot, entry);
    if (!existsSync2(from)) continue;
    const to = join2(destination, entry);
    cpSync(from, to, { recursive: true });
    copied.push(entry);
  }
  stripTemplateComments(destination);
  const mcp = ensureMcpRegistered(projectRoot);
  const hookInstalled = ensurePostCompactHook(projectRoot);
  let rulesGenerated = 0;
  try {
    const config = { projectRoot, scaffoldRoot: destination, settings: {} };
    const rules = generateRules(config);
    rulesGenerated = rules.written.length;
  } catch {
  }
  const skillsGenerated = generateSkills(projectRoot);
  return {
    targetDir: destination,
    copied,
    mcpStatus: mcp.status,
    rulesGenerated,
    skillsGenerated,
    postCompactHook: hookInstalled
  };
}
function printBootstrapResult(result) {
  const b = chalk.bold;
  const dim = chalk.dim;
  console.log();
  console.log(`  ${b("cai setup")} ${dim("\xB7 scaffold installed")}`);
  console.log();
  console.log(chalk.green(`  \u2713 ${result.targetDir}`));
  console.log(dim(`  ${result.copied.length} entries written`));
  console.log();
  if (result.rulesGenerated && result.rulesGenerated > 0) {
    console.log(chalk.green(`  \u2713 ${result.rulesGenerated} path-scoped rules`) + dim(" \u2014 Claude loads context only when touching matching files"));
  }
  if (result.mcpStatus === "registered") {
    console.log(chalk.green(`  \u2713 MCP server registered`) + dim(" \u2014 Claude can query context on-demand"));
  } else if (result.mcpStatus === "already_registered") {
    console.log(chalk.green(`  \u2713 MCP server active`));
  } else if (result.mcpStatus === "claude_not_found") {
    console.log(dim(`  \u2139 MCP: run ${chalk.white("cai mcp install")} to connect Claude once installed`));
  }
  if (result.skillsGenerated && result.skillsGenerated > 0) {
    console.log(chalk.green(`  \u2713 ${result.skillsGenerated} skill${result.skillsGenerated !== 1 ? "s" : ""} generated`) + dim(" \u2014 use /cai-check and /cai-sync in Claude Code"));
  }
  if (result.postCompactHook) {
    console.log(chalk.green(`  \u2713 PreCompact hook installed`) + dim(" \u2014 Claude re-reads context after compaction"));
  }
  console.log();
  if (result.setupRan) {
    console.log(dim("  Run cai check to verify everything is in order."));
  } else {
    console.log(dim("  Run cai setup to initialise your project context."));
  }
  console.log();
}
function runBootstrappedSetup(projectRoot) {
  const setupScript = join2(projectRoot, ".cai", "setup.sh");
  if (!existsSync2(setupScript)) {
    throw new Error(`No setup script found at ${setupScript}`);
  }
  const result = spawnSync2("bash", [setupScript], {
    cwd: projectRoot,
    stdio: "inherit"
  });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === "number" && result.status !== 0 && result.status !== 130 && result.status !== 143) {
    throw new Error(`.cai/setup.sh exited with code ${result.status}`);
  }
}
function stripTemplateComments(scaffoldDir) {
  const dirs = ["", "context", "patterns"];
  for (const sub of dirs) {
    const dir = sub ? join2(scaffoldDir, sub) : scaffoldDir;
    if (!existsSync2(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".md")) continue;
      const filePath = join2(dir, entry);
      const content = readFileSync2(filePath, "utf8");
      const stripped = stripCommentsPreservingMarkers(content);
      if (stripped !== content) {
        writeFileSync2(filePath, stripped, "utf8");
      }
    }
  }
}
function stripCommentsPreservingMarkers(content) {
  const lines = content.split("\n");
  const out = [];
  let inCodeBlock = false;
  let inComment = false;
  for (const line of lines) {
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      out.push(line);
      continue;
    }
    if (inCodeBlock) {
      out.push(line);
      continue;
    }
    if (line.includes("<!-- cai:")) {
      out.push(line);
      continue;
    }
    if (inComment) {
      if (line.includes("-->")) {
        inComment = false;
      }
      continue;
    }
    if (line.trimStart().startsWith("<!--")) {
      if (line.includes("-->")) {
        continue;
      }
      inComment = true;
      continue;
    }
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}
function generateSkills(projectRoot) {
  const skillsDir = join2(projectRoot, ".claude", "skills");
  let count = 0;
  const skills = [
    {
      name: "cai-check",
      content: `---
description: "Run CAI drift detection to verify scaffold docs match the codebase."
---

Run \`cai check\` in the project root and report the results. If the score is below 80, suggest running \`cai fix\` for safe auto-repairs.

If errors remain after fix, list the top 3 issues and suggest what to update.
`
    },
    {
      name: "cai-sync",
      content: `---
description: "Fix all drift issues \u2014 safe auto-fixes first, then AI-assisted updates."
---

1. Run \`cai fix\` to apply safe deterministic repairs.
2. Check results with \`cai check --quiet\`.
3. If issues remain, read each affected .cai/ file and fix the drift issues directly.
4. After fixing, run \`cai check\` again to verify score is 100.
5. Do not modify source code files \u2014 only update .cai/ scaffold documentation.
`
    }
  ];
  for (const skill of skills) {
    try {
      const dir = join2(skillsDir, skill.name);
      const filePath = join2(dir, "SKILL.md");
      if (existsSync2(filePath)) continue;
      mkdirSync2(dir, { recursive: true });
      writeFileSync2(filePath, skill.content, "utf8");
      count++;
    } catch {
    }
  }
  return count;
}
function getPackageRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

// src/config.ts
import { existsSync as existsSync3, readFileSync as readFileSync3 } from "fs";
import { resolve as resolve2, dirname as dirname2 } from "path";
var PRIMARY_SCAFFOLD_DIR = ".cai";
var LEGACY_SCAFFOLD_DIR = ".context-condensing";
var configCache = /* @__PURE__ */ new Map();
function findConfig(startDir) {
  const dir = resolve2(startDir ?? process.cwd());
  const cached = configCache.get(dir);
  if (cached) return cached;
  const nearestScaffoldProjectRoot = findNearestScaffoldProjectRoot(dir);
  const projectRoot = nearestScaffoldProjectRoot ?? findProjectRoot(dir) ?? dir;
  const scaffoldRoot = findScaffoldRoot(projectRoot);
  if (!scaffoldRoot) {
    throw new Error(buildScaffoldNotFoundMessage(dir, projectRoot));
  }
  const config = {
    projectRoot,
    scaffoldRoot,
    settings: loadSettings(projectRoot, scaffoldRoot)
  };
  configCache.set(dir, config);
  return config;
}
function buildScaffoldNotFoundMessage(startDir, projectRoot) {
  if (startDir.includes(`/${PRIMARY_SCAFFOLD_DIR}/`) || startDir.includes(`/${LEGACY_SCAFFOLD_DIR}/`)) {
    return `You are inside a scaffold directory, not a project root.

  Change to your project root and try again:

    cd ..
    cai check
`;
  }
  const gitRoot = findProjectRoot(startDir);
  if (!gitRoot) {
    return `No git repository found from ${startDir}.

  CAI works inside a git-tracked project.

  Initialize git first, then run setup:

    git init
    cai setup
`;
  }
  return `No CAI scaffold found in ${projectRoot}.

  CAI needs to be set up for this project first.
  This creates a .cai/ directory with structured context about your codebase
  that AI agents use to understand your project.

  Run:  cai setup
`;
}
function findNearestScaffoldProjectRoot(dir) {
  let current = resolve2(dir);
  while (true) {
    if (findScaffoldRoot(current)) {
      return current;
    }
    const parent = dirname2(current);
    if (parent === current) return null;
    current = parent;
  }
}
function findProjectRoot(dir) {
  let current = resolve2(dir);
  while (true) {
    if (existsSync3(resolve2(current, ".git"))) {
      return current;
    }
    const parent = dirname2(current);
    if (parent === current) return null;
    current = parent;
  }
}
function findScaffoldRoot(projectRoot) {
  const primaryDir = resolve2(projectRoot, PRIMARY_SCAFFOLD_DIR);
  if (existsSync3(primaryDir)) return primaryDir;
  const legacyDir = resolve2(projectRoot, LEGACY_SCAFFOLD_DIR);
  if (existsSync3(legacyDir)) return legacyDir;
  const contextDir = resolve2(projectRoot, "context");
  if (existsSync3(contextDir)) return projectRoot;
  return null;
}
function loadSettings(projectRoot, scaffoldRoot) {
  const candidates = [
    resolve2(projectRoot, PRIMARY_SCAFFOLD_DIR, "config.json"),
    resolve2(projectRoot, LEGACY_SCAFFOLD_DIR, "config.json"),
    resolve2(projectRoot, "cai.config.json"),
    resolve2(projectRoot, "context-condensing.config.json")
  ];
  if (scaffoldRoot !== projectRoot) {
    candidates.unshift(resolve2(scaffoldRoot, "config.json"));
  }
  for (const path of candidates) {
    if (!existsSync3(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync3(path, "utf-8"));
      return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch (err) {
      process.stderr.write(`Warning: could not parse config at ${path}: ${err.message}
`);
      continue;
    }
  }
  return {};
}

// src/doctor.ts
import { relative, resolve as resolve3 } from "path";
import { existsSync as existsSync4, readFileSync as readFileSync4 } from "fs";
var statusIcon = {
  ok: "\u2714",
  warn: "\u26A0",
  info: "\u2139"
};
function runDoctor(config) {
  const project = scanProjectModel(config.projectRoot);
  const toolConfigIssues = checkToolConfigs(config.projectRoot);
  const relativeScaffoldRoot = config.scaffoldRoot === config.projectRoot ? "." : relative(config.projectRoot, config.scaffoldRoot);
  const checks = [
    {
      name: "scaffold",
      status: "ok",
      message: `Scaffold root detected at ${relativeScaffoldRoot}`
    }
  ];
  if (project.rootManifest) {
    checks.push({
      name: "manifest",
      status: "ok",
      message: `Primary manifest: ${project.rootManifest.type}${project.rootManifest.name ? ` (${project.rootManifest.name})` : ""}`
    });
  } else {
    checks.push({
      name: "manifest",
      status: "warn",
      message: "No supported root manifest found.",
      advice: "Add a package.json, Cargo.toml, or similar manifest to your project root."
    });
  }
  if (toolConfigIssues.length > 0) {
    checks.push({
      name: "tool-configs",
      status: "warn",
      message: `${toolConfigIssues.length} tool config file${toolConfigIssues.length === 1 ? "" : "s"} out of sync`,
      advice: "Run cai fix to bring tool config files back in sync."
    });
  } else {
    checks.push({
      name: "tool-configs",
      status: "ok",
      message: "Tool config files are in sync."
    });
  }
  if (project.workspaces.length === 0) {
    checks.push({
      name: "workspaces",
      status: "info",
      message: "No package.json workspaces detected \u2014 single-package project."
    });
  } else {
    const isolated = findIsolatedWorkspaces(project);
    checks.push({
      name: "workspaces",
      status: isolated.length > 0 ? "info" : "ok",
      message: `${project.workspaces.length} workspace${project.workspaces.length === 1 ? "" : "s"}, ${project.workspaceDependencies.length} internal dependenc${project.workspaceDependencies.length === 1 ? "y" : "ies"}` + (isolated.length > 0 ? `, ${isolated.length} isolated (no internal deps)` : ""),
      advice: isolated.length > 0 ? "Isolated workspaces are not necessarily a problem \u2014 verify they are intentionally standalone." : void 0
    });
  }
  if (project.commands.length === 0) {
    checks.push({
      name: "commands",
      status: "warn",
      message: "No root or workspace scripts detected.",
      advice: "Add scripts to your package.json so cai can track and verify them."
    });
  } else {
    checks.push({
      name: "commands",
      status: "ok",
      message: `${project.commands.length} command target${project.commands.length === 1 ? "" : "s"} found in manifests.`
    });
  }
  const hookPath = resolve3(config.projectRoot, ".git", "hooks", "post-commit");
  if (!existsSync4(hookPath)) {
    checks.push({
      name: "post-commit",
      status: "info",
      message: "No post-commit hook installed.",
      advice: "Run 'cai watch' to auto-check drift after every commit."
    });
  } else {
    const hookContent = readFileSync4(hookPath, "utf-8");
    if (hookContent.includes(HOOK_MARKERS.start)) {
      checks.push({
        name: "post-commit",
        status: "ok",
        message: "cai post-commit hook is installed and active."
      });
    } else if (hookContent.includes(HOOK_MARKERS.legacy)) {
      checks.push({
        name: "post-commit",
        status: "warn",
        message: "Legacy cai hook detected \u2014 installed by an older version.",
        advice: "Run 'cai watch --uninstall && cai watch' to upgrade to the current hook format."
      });
    } else {
      checks.push({
        name: "post-commit",
        status: "info",
        message: "A post-commit hook exists but was not installed by cai.",
        advice: "Run 'cai watch' to add cai drift checking to your existing hook."
      });
    }
  }
  const settingsPath = resolve3(config.projectRoot, ".claude", "settings.json");
  if (existsSync4(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync4(settingsPath, "utf-8"));
      const hooks = settings.hooks;
      if (hooks?.PreCompact) {
        checks.push({
          name: "pre-compact",
          status: "ok",
          message: "PreCompact hook installed \u2014 Claude re-reads context after compaction."
        });
      } else {
        checks.push({
          name: "pre-compact",
          status: "warn",
          message: "No PreCompact hook \u2014 context may be lost after compaction.",
          advice: "Run 'cai setup' to install the PreCompact hook, or add it manually to .claude/settings.json."
        });
      }
    } catch {
      checks.push({
        name: "post-compact",
        status: "info",
        message: "Could not parse .claude/settings.json."
      });
    }
  } else {
    checks.push({
      name: "post-compact",
      status: "info",
      message: "No .claude/settings.json found.",
      advice: "Run 'cai setup' to create Claude Code configuration with MCP and PreCompact hook."
    });
  }
  return {
    projectRoot: config.projectRoot,
    scaffoldRoot: config.scaffoldRoot,
    project,
    checks
  };
}
function printDoctor(report) {
  const hasWarnings = report.checks.some((c) => c.status === "warn");
  console.log();
  console.log("cai doctor \u2014 scaffold diagnostics");
  console.log();
  console.log(`  Project:  ${report.projectRoot}`);
  console.log(`  Scaffold: ${report.scaffoldRoot}`);
  console.log();
  for (const check of report.checks) {
    const icon2 = statusIcon[check.status];
    console.log(`${icon2} ${check.name.padEnd(14)} ${check.message}`);
    if (check.advice) {
      console.log(`  \u2139 ${check.advice}`);
    }
  }
  if (report.project.workspaces.length > 0) {
    console.log();
    console.log("Workspace topology:");
    for (const workspace of report.project.workspaces) {
      const name = workspace.manifest.name ?? "(unnamed)";
      const outgoing = report.project.workspaceDependencies.filter((edge) => edge.from === workspace.path);
      const deps = outgoing.length > 0 ? outgoing.map((edge) => edge.to).join(", ") : "no internal deps";
      console.log(`  \xB7 ${workspace.path} (${name}) \u2192 ${deps}`);
    }
  }
  console.log();
  if (hasWarnings) {
    console.log("  \u2139 Run cai check for full drift analysis, or cai fix to repair safe issues.");
  } else {
    console.log("  \u2139 Scaffold looks healthy. Run cai check for full drift analysis.");
  }
  console.log();
}
function findIsolatedWorkspaces(project) {
  const connected = /* @__PURE__ */ new Set();
  for (const edge of project.workspaceDependencies) {
    connected.add(edge.from);
    connected.add(edge.to);
  }
  return project.workspaces.map((workspace) => workspace.path).filter((path) => !connected.has(path));
}

// src/fix.ts
import chalk2 from "chalk";
import { existsSync as existsSync5, readFileSync as readFileSync5, writeFileSync as writeFileSync3 } from "fs";
import { basename, join as join3 } from "path";
import { globSync } from "glob";
var FIXABLE_ISSUES = /* @__PURE__ */ new Map([
  ["TOOL_CONFIG_OUT_OF_SYNC", "sync-tool-configs"],
  ["INDEX_MISSING_ENTRY", "rebuild-pattern-index"],
  ["INDEX_ORPHAN_ENTRY", "rebuild-pattern-index"],
  ["UNDOCUMENTED_SCRIPT", "document-scripts"],
  ["MISSING_PATH", "normalize-path-references"]
]);
async function runAutoFix(config, opts = {}) {
  const initialReport = await runDriftCheck(config, {
    only: opts.only,
    skip: opts.skip
  });
  const actions = collectFixActions(config, initialReport.issues);
  const applied = [];
  const skipped = [];
  for (const action of actions) {
    const preview = describeFixAction(action, config, initialReport.issues);
    if (preview.changed.length === 0) continue;
    if (opts.dryRun) {
      skipped.push(preview);
      continue;
    }
    const result = applyFixAction(config, action, initialReport.issues);
    if (result.changed.length > 0) {
      applied.push(result);
    }
  }
  const finalReport = opts.dryRun || actions.length === 0 ? initialReport : await runDriftCheck(config, {
    only: opts.only,
    skip: opts.skip
  });
  return {
    applied,
    skipped,
    initialIssueCount: initialReport.issues.length,
    remainingIssueCount: finalReport.issues.length
  };
}
var ACTION_LABELS = {
  "sync-tool-configs": "Sync tool config files",
  "rebuild-pattern-index": "Rebuild patterns/INDEX.md",
  "document-scripts": "Add undocumented scripts to setup.md",
  "normalize-path-references": "Normalize stale path references"
};
function printFixResult(result, opts = {}) {
  const b = chalk2.bold;
  const dim = chalk2.dim;
  console.log();
  if (opts.dryRun) {
    console.log(`  ${b("cai fix")} ${dim("\xB7 dry run \u2014 no changes written")}`);
    console.log();
    if (result.skipped.length === 0) {
      console.log(`  ${chalk2.cyan("\u2139")} ${dim("No auto-fixable scaffold drift found.")}`);
      console.log(`     ${dim("Run ")}${chalk2.white("cai sync")}${dim(" to let AI update the remaining docs.")}`);
    } else {
      for (const action of result.skipped) {
        const label = ACTION_LABELS[action.action] ?? action.action;
        const files = action.changed.length > 0 ? chalk2.cyan(action.changed.join(", ")) : dim("(no file changes)");
        console.log(`  ${chalk2.yellow("\u26A0")} ${label} \u2014 ${files}`);
      }
    }
    console.log();
    return;
  }
  console.log(`  ${b("cai fix")} ${dim("\xB7 updating scaffold docs")}`);
  console.log();
  if (result.applied.length === 0) {
    console.log(`  ${chalk2.cyan("\u2139")} ${dim("No auto-fixable scaffold drift found.")}`);
    console.log();
    console.log(`     ${dim("Run ")}${chalk2.white("cai sync")}${dim(" to let AI update the remaining docs.")}`);
  } else {
    for (const action of result.applied) {
      const label = ACTION_LABELS[action.action] ?? action.action;
      const files = action.changed.length > 0 ? `  ${dim("\u2192")} ${chalk2.cyan(action.changed.join(", "))}` : "";
      console.log(`  ${chalk2.green("\u2714")} ${label}${files}`);
    }
    console.log();
    const fixed = result.initialIssueCount - result.remainingIssueCount;
    if (result.remainingIssueCount > 0) {
      console.log(dim(`  ${fixed} issue${fixed !== 1 ? "s" : ""} resolved \xB7 ${result.remainingIssueCount} remaining`));
      console.log(`  ${chalk2.cyan("\u2139")} ${dim("Run ")}${chalk2.white("cai sync")}${dim(" to let AI fix the rest.")}`);
    } else {
      console.log(`  ${chalk2.green("\u2714")} ${chalk2.green("All issues resolved.")}`);
    }
  }
  console.log();
}
function collectFixActions(config, issues) {
  const actions = /* @__PURE__ */ new Set();
  for (const issue of issues) {
    const action = FIXABLE_ISSUES.get(issue.code);
    if (!action) continue;
    if (!isFixActionAvailable(action, config, issues)) continue;
    actions.add(action);
  }
  return [...actions];
}
function isFixActionAvailable(action, config, issues) {
  switch (action) {
    case "sync-tool-configs":
    case "rebuild-pattern-index":
      return true;
    case "document-scripts":
      return findUndocumentedScripts(config, issues).length > 0;
    case "normalize-path-references":
      return findPathNormalizationTargets(config, issues).length > 0;
  }
}
function describeFixAction(action, config, issues) {
  switch (action) {
    case "sync-tool-configs":
      return {
        action,
        changed: [
          ...new Set(
            issues.filter((issue) => issue.code === "TOOL_CONFIG_OUT_OF_SYNC").map((issue) => issue.file)
          )
        ]
      };
    case "rebuild-pattern-index":
      return { action, changed: ["patterns/INDEX.md"] };
    case "document-scripts":
      return {
        action,
        changed: findUndocumentedScripts(config, issues).length > 0 ? [pickScriptDocPath(config)] : []
      };
    case "normalize-path-references":
      return {
        action,
        changed: [...new Set(findPathNormalizationTargets(config, issues).map((target) => target.file))]
      };
  }
}
function applyFixAction(config, action, issues) {
  switch (action) {
    case "sync-tool-configs": {
      const result = syncToolConfigs(config.projectRoot);
      return {
        action,
        changed: result.updated
      };
    }
    case "rebuild-pattern-index": {
      const result = rebuildPatternIndex(config);
      return {
        action,
        changed: [result.file]
      };
    }
    case "document-scripts": {
      const result = addScriptDocumentationStubs(config, issues);
      return {
        action,
        changed: result ? [result] : []
      };
    }
    case "normalize-path-references": {
      return {
        action,
        changed: normalizePathReferences(config, issues)
      };
    }
  }
}
function addScriptDocumentationStubs(config, issues) {
  const scripts = findUndocumentedScripts(config, issues);
  if (scripts.length === 0) return null;
  const uniqueScripts = [...new Set(scripts)].sort();
  const relativeDocPath = pickScriptDocPath(config);
  const absoluteDocPath = join3(config.scaffoldRoot, relativeDocPath);
  if (!existsSync5(absoluteDocPath)) return null;
  const content = readFileSync5(absoluteDocPath, "utf8");
  const updated = injectScriptBullets(content, uniqueScripts);
  if (updated === content) return relativeDocPath;
  writeFileSync3(absoluteDocPath, updated, "utf8");
  return relativeDocPath;
}
function findUndocumentedScripts(config, issues) {
  const relativeDocPath = pickScriptDocPath(config);
  const absoluteDocPath = join3(config.scaffoldRoot, relativeDocPath);
  if (!existsSync5(absoluteDocPath)) return [];
  return [
    ...new Set(
      issues.filter((issue) => issue.code === "UNDOCUMENTED_SCRIPT").map((issue) => issue.message.match(/Script "(.+?)"/)?.[1] ?? null).filter((value) => Boolean(value))
    )
  ].sort();
}
function pickScriptDocPath(config) {
  const preferred = ["context/setup.md", "SETUP.md"];
  for (const relativePath of preferred) {
    if (existsSync5(join3(config.scaffoldRoot, relativePath))) {
      return relativePath;
    }
  }
  return "context/setup.md";
}
function injectScriptBullets(content, scripts) {
  const heading = "## Common Commands";
  const existingScriptNames = scripts.filter((script) => content.includes(`\`${script}\``));
  const missingScripts = scripts.filter((script) => !existingScriptNames.includes(script));
  if (missingScripts.length === 0) return content;
  const lines = content.split("\n");
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  const bullets = missingScripts.map(
    (script) => `- \`${script}\` \u2014 [AUTO-FIX] document what this command does and when to use it`
  );
  if (headingIndex === -1) {
    return `${content}${content.endsWith("\n") ? "" : "\n"}
${heading}
${bullets.join("\n")}
`;
  }
  let insertAt = headingIndex + 1;
  while (insertAt < lines.length && lines[insertAt].trim().startsWith("<!--")) {
    while (insertAt < lines.length && !lines[insertAt].includes("-->")) {
      insertAt++;
    }
    insertAt++;
  }
  while (insertAt < lines.length && lines[insertAt].trim() === "") {
    insertAt++;
  }
  lines.splice(insertAt, 0, ...bullets);
  return `${lines.join("\n")}${content.endsWith("\n") ? "" : "\n"}`;
}
function normalizePathReferences(config, issues) {
  const targets = findPathNormalizationTargets(config, issues);
  const changed = /* @__PURE__ */ new Set();
  for (const target of targets) {
    const absolutePath = join3(config.scaffoldRoot, target.file);
    if (!existsSync5(absolutePath)) continue;
    const content = readFileSync5(absolutePath, "utf8");
    const updated = replacePathReference(content, target);
    if (updated === content) continue;
    writeFileSync3(absolutePath, updated, "utf8");
    changed.add(target.file);
  }
  return [...changed].sort();
}
function findPathNormalizationTargets(config, issues) {
  const targets = [];
  const seen = /* @__PURE__ */ new Set();
  for (const issue of issues) {
    if (issue.code !== "MISSING_PATH" || !issue.claim) continue;
    if (issue.claim.intent === "example" || issue.claim.confidence === "low") continue;
    const match = resolveUniquePathMatch(config.projectRoot, issue.claim.value);
    if (!match || match === issue.claim.value) continue;
    const key = `${issue.file}:${issue.line}:${issue.claim.value}:${match}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({
      file: issue.file,
      from: issue.claim.value,
      to: match,
      line: issue.line
    });
  }
  return targets;
}
function resolveUniquePathMatch(projectRoot, claimedPath) {
  const fileName = basename(claimedPath);
  if (!fileName || fileName === claimedPath) return null;
  const matches = globSync(`**/${fileName}`, {
    cwd: projectRoot,
    ignore: ["node_modules/**", ".git/**", "dist/**", "build/**", ".cai/**", ".context-condensing/**"]
  });
  const uniqueMatches = [...new Set(matches)].sort();
  if (uniqueMatches.length !== 1) return null;
  return uniqueMatches[0];
}
function replacePathReference(content, target) {
  const lines = content.split("\n");
  if (target.line && target.line > 0 && target.line <= lines.length) {
    const index = target.line - 1;
    const currentLine = lines[index];
    const updatedLine = replacePathReferenceInLine(currentLine, target.from, target.to);
    if (updatedLine !== currentLine) {
      lines[index] = updatedLine;
      return lines.join("\n");
    }
  }
  return content;
}
function replacePathReferenceInLine(line, from, to) {
  const codeSpan = `\`${from}\``;
  if (line.includes(codeSpan)) {
    return line.replaceAll(codeSpan, `\`${to}\``);
  }
  const quoted = `"${from}"`;
  if (line.includes(quoted)) {
    return line.replaceAll(quoted, `"${to}"`);
  }
  const singleQuoted = `'${from}'`;
  if (line.includes(singleQuoted)) {
    return line.replaceAll(singleQuoted, `'${to}'`);
  }
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\w/])${escaped}(?![\\w])`, "g");
  return line.replace(re, to);
}

// src/reporter.ts
import chalk3 from "chalk";
var icon = {
  error: chalk3.red("\u2716"),
  warning: chalk3.yellow("\u26A0"),
  info: chalk3.cyan("\u2139"),
  ok: chalk3.green("\u2714")
};
var severityColor = {
  error: chalk3.red,
  warning: chalk3.yellow,
  info: chalk3.cyan
};
var ISSUE_LABELS = {
  STALE_FILE: "Scaffold file is out of date",
  MISSING_PATH: "Path no longer exists",
  DEAD_COMMAND: "Script or command not found",
  DEPENDENCY_MISSING: "Claimed dependency not in manifest",
  VERSION_MISMATCH: "Version in scaffold doesn't match manifest",
  CROSS_FILE_CONFLICT: "Conflicting information across files",
  WORKSPACE_DEPENDENCY_MISSING: "Undocumented workspace dependency",
  WORKSPACE_DEPENDENCY_INVALID: "Documented workspace dependency doesn't exist",
  DEAD_EDGE: "Frontmatter link target doesn't exist",
  INDEX_MISSING_ENTRY: "Pattern not listed in INDEX.md",
  INDEX_ORPHAN_ENTRY: "INDEX.md references a file that doesn't exist",
  UNDOCUMENTED_SCRIPT: "Script not mentioned in scaffold",
  TOOL_CONFIG_OUT_OF_SYNC: "Tool config files are out of sync",
  CHECKER_ERROR: "Drift checker failed during execution"
};
function getAdvice(issue) {
  switch (issue.code) {
    case "STALE_FILE":
      return `Run ${chalk3.cyan("cai sync")} to let AI update this file, or ${chalk3.cyan("cai fix")} for safe auto-fixes.`;
    case "MISSING_PATH":
      return issue.suggestion ?? `Update this reference in ${chalk3.cyan(issue.file)}, or create the missing file.`;
    case "DEAD_COMMAND":
      return issue.suggestion ?? `Update the command in ${chalk3.cyan(issue.file)} to match an existing script, or add it to your package.json.`;
    case "DEPENDENCY_MISSING":
      return issue.suggestion ?? `Remove the reference from ${chalk3.cyan(issue.file)}, or add the package to your manifest.`;
    case "VERSION_MISMATCH":
      return issue.suggestion ?? `Update the version in ${chalk3.cyan(issue.file)} to match what's actually installed.`;
    case "CROSS_FILE_CONFLICT":
      return `Run ${chalk3.cyan("cai sync")} so AI can reconcile the conflicting information.`;
    case "WORKSPACE_DEPENDENCY_MISSING":
      return issue.suggestion ?? `Document this dependency in your scaffold.`;
    case "DEAD_EDGE":
      return `Fix or remove the frontmatter \`edges:\` entry in ${chalk3.cyan(issue.file)}.`;
    case "INDEX_MISSING_ENTRY":
      return `Run ${chalk3.cyan("cai fix")} \u2014 it will add the missing entry automatically.`;
    case "INDEX_ORPHAN_ENTRY":
      return `Run ${chalk3.cyan("cai fix")} \u2014 it will remove the stale entry automatically.`;
    case "UNDOCUMENTED_SCRIPT":
      return `Run ${chalk3.cyan("cai fix")} to add a stub entry, then fill in what the script does.`;
    case "TOOL_CONFIG_OUT_OF_SYNC":
      return `Run ${chalk3.cyan("cai fix")} or ${chalk3.cyan("cai sync-configs")} to re-sync tool config files.`;
    case "CHECKER_ERROR":
      return `A drift checker crashed. Run ${chalk3.cyan("cai doctor")} to diagnose. This is usually a git or configuration issue.`;
    default:
      return issue.suggestion ?? null;
  }
}
function getDelta(issue) {
  if (!issue.claim?.value) return null;
  switch (issue.code) {
    case "MISSING_PATH":
      return { before: issue.claim.value, after: "(not found in repo)" };
    case "DEAD_COMMAND":
      return { before: issue.claim.value, after: "(not in package.json / Makefile)" };
    case "DEPENDENCY_MISSING":
      return { before: issue.claim.value, after: "(not in manifest)" };
    case "VERSION_MISMATCH": {
      const match = issue.message.match(/manifest has version "(.+?)"/);
      if (match) return { before: issue.claim.value, after: match[1] };
      return null;
    }
    default:
      return null;
  }
}
function reportConsole(report, opts = {}) {
  if (opts.verbose && report.diagnostics) {
    printDiagnostics(report);
    console.log();
  }
  if (report.issues.length === 0) {
    printSummary(report);
    return;
  }
  const grouped = groupByFile(report.issues);
  for (const [file, issues] of Object.entries(grouped)) {
    const errorCount = issues.filter((i) => i.severity === "error").length;
    const warnCount = issues.filter((i) => i.severity === "warning").length;
    const countParts = [
      errorCount ? chalk3.red(`${errorCount} error${errorCount !== 1 ? "s" : ""}`) : "",
      warnCount ? chalk3.yellow(`${warnCount} warning${warnCount !== 1 ? "s" : ""}`) : ""
    ].filter(Boolean).join(chalk3.dim(", "));
    console.log(chalk3.bold(file) + chalk3.dim("  ") + countParts);
    for (const issue of issues) {
      const sev = issue.severity;
      const sym = icon[sev === "info" ? "info" : sev];
      const label = ISSUE_LABELS[issue.code] ?? issue.message;
      console.log(`  ${sym} ${severityColor[sev](label)}`);
      const delta = getDelta(issue);
      if (delta) {
        console.log(`     ${chalk3.dim("scaffold says")}  ${chalk3.red(delta.before)}`);
        console.log(`     ${chalk3.dim("reality is   ")}  ${chalk3.yellow(delta.after)}`);
      } else if (issue.message && issue.message !== label) {
        console.log(`     ${chalk3.dim(issue.message)}`);
      }
      const advice = getAdvice(issue);
      if (advice) {
        console.log(`     ${icon.info} ${chalk3.dim(advice)}`);
      }
      if (opts.verbose && issue.claim) {
        console.log(
          chalk3.dim(`     claim: kind=${issue.claim.kind}, intent=${issue.claim.intent}, confidence=${issue.claim.confidence}`)
        );
      }
    }
    console.log();
  }
  printSummary(report);
}
function reportQuiet(report) {
  const errors = report.issues.filter((i) => i.severity === "error").length;
  const warnings = report.issues.filter((i) => i.severity === "warning").length;
  const parts = [];
  if (errors) parts.push(`${errors} error${errors > 1 ? "s" : ""}`);
  if (warnings) parts.push(`${warnings} warning${warnings > 1 ? "s" : ""}`);
  const detail = parts.length ? ` (${parts.join(", ")})` : "";
  const color = report.score >= 80 ? chalk3.green : report.score >= 50 ? chalk3.yellow : chalk3.red;
  console.log(`CAI: drift score ${color(`${report.score}/100`)}${detail}`);
}
function reportJSON(report) {
  console.log(JSON.stringify(report, null, 2));
}
function reportExplain(report, query) {
  const normalized = query.trim().toLowerCase();
  const exactCodeMatches = report.issues.filter(
    (issue) => issue.code.toLowerCase() === normalized
  );
  const matches = exactCodeMatches.length > 0 ? exactCodeMatches : report.issues.filter(
    (issue) => issue.code.toLowerCase().includes(normalized) || issue.file.toLowerCase().includes(normalized) || issue.message.toLowerCase().includes(normalized)
  );
  if (matches.length === 0) {
    const knownCodes = [...new Set(report.issues.map((issue) => issue.code))].sort();
    console.log(chalk3.bold(`No drift issues matched "${query}".`));
    if (knownCodes.length > 0) {
      console.log(chalk3.dim(`Available issue codes: ${knownCodes.join(", ")}`));
    }
    return;
  }
  console.log(chalk3.bold(`Explain: ${query}`));
  console.log(chalk3.dim(`${matches.length} matching issue${matches.length === 1 ? "" : "s"}`));
  console.log();
  for (const issue of matches) {
    const sev = issue.severity;
    const sym = icon[sev === "info" ? "info" : sev];
    const label = ISSUE_LABELS[issue.code] ?? issue.message;
    const loc = issue.line ? `:${issue.line}` : "";
    console.log(`${sym} ${severityColor[sev](label)}  ${chalk3.dim(issue.file + loc)}`);
    console.log(`  ${chalk3.dim(issue.message)}`);
    const delta = getDelta(issue);
    if (delta) {
      console.log(`  ${chalk3.dim("scaffold says")}  ${chalk3.red(delta.before)}`);
      console.log(`  ${chalk3.dim("reality is   ")}  ${chalk3.yellow(delta.after)}`);
    }
    const advice = getAdvice(issue);
    if (advice) console.log(`  ${icon.info} ${chalk3.dim(advice)}`);
    if (issue.claim) {
      console.log(
        chalk3.dim(`  claim: ${issue.claim.value} [kind=${issue.claim.kind}, origin=${issue.claim.origin}, intent=${issue.claim.intent}, confidence=${issue.claim.confidence}]`)
      );
    }
    console.log();
  }
}
function printSummary(report) {
  const errors = report.issues.filter((i) => i.severity === "error").length;
  const warnings = report.issues.filter((i) => i.severity === "warning").length;
  const color = report.score >= 80 ? chalk3.green : report.score >= 50 ? chalk3.yellow : chalk3.red;
  console.log(
    chalk3.bold(`  Drift score: ${color(`${report.score}/100`)}`) + chalk3.dim(`  \xB7  ${report.filesChecked} file${report.filesChecked !== 1 ? "s" : ""} checked`)
  );
  if (errors === 0 && warnings === 0) {
    console.log(`  ${icon.ok} ${chalk3.green("Scaffold is accurate \u2014 no drift detected.")}`);
  } else if (errors > 0) {
    console.log(
      chalk3.dim(
        `  ${errors} error${errors !== 1 ? "s" : ""}${warnings > 0 ? `, ${warnings} warning${warnings !== 1 ? "s" : ""}` : ""} \u2014 some scaffold files have drifted from the codebase.`
      )
    );
    console.log(
      chalk3.dim(`  \u2192 `) + chalk3.white("cai fix") + chalk3.dim(" for safe auto-fixes  \xB7  ") + chalk3.white("cai sync") + chalk3.dim(" to let AI update what's broken")
    );
  } else {
    console.log(chalk3.dim(`  ${warnings} warning${warnings !== 1 ? "s" : ""} \u2014 scaffold may be slightly out of date.`));
    console.log(chalk3.dim(`  \u2192 `) + chalk3.white("cai sync --warnings") + chalk3.dim(" to address them"));
  }
}
function printDiagnostics(report) {
  const diagnostics = report.diagnostics;
  if (!diagnostics) return;
  console.log(chalk3.bold("  Verbose diagnostics"));
  console.log();
  console.log(chalk3.dim("  Scaffold files scanned"));
  for (const file of diagnostics.scaffoldFiles) {
    console.log(`    ${chalk3.dim("\xB7")} ${file}`);
  }
  console.log();
  console.log(chalk3.dim("  Claims extracted"));
  for (const [kind, count] of Object.entries(diagnostics.claimsByKind)) {
    console.log(`    ${chalk3.dim("\xB7")} ${kind}: ${count}`);
  }
  console.log();
  console.log(chalk3.dim("  Project model"));
  const manifestLabel = diagnostics.project.rootManifestType ? diagnostics.project.rootManifestName ? `${diagnostics.project.rootManifestType} (${diagnostics.project.rootManifestName})` : diagnostics.project.rootManifestType : "none";
  console.log(`    ${chalk3.dim("\xB7")} root manifest: ${manifestLabel}`);
  console.log(`    ${chalk3.dim("\xB7")} workspaces: ${diagnostics.project.workspaceCount}, internal deps: ${diagnostics.project.workspaceDependencyCount}`);
  if (diagnostics.project.workspaceNames.length > 0) {
    console.log(`    ${chalk3.dim("\xB7")} workspace sample: ${diagnostics.project.workspaceNames.join(", ")}`);
  }
  console.log(`    ${chalk3.dim("\xB7")} commands discovered: ${diagnostics.project.commandCount}`);
  if (diagnostics.project.sampleCommands.length > 0) {
    console.log(`    ${chalk3.dim("\xB7")} command sample: ${diagnostics.project.sampleCommands.join(", ")}`);
  }
  console.log();
  console.log(chalk3.dim("  Checker summary"));
  for (const summary of diagnostics.checkerSummaries) {
    console.log(`    ${chalk3.dim("\xB7")} ${summary.name}: ${summary.checked} checked, ${summary.issuesFound} issues`);
  }
}
function groupByFile(issues) {
  const grouped = {};
  for (const issue of issues) {
    if (!grouped[issue.file]) grouped[issue.file] = [];
    grouped[issue.file].push(issue);
  }
  return grouped;
}

// src/update.ts
import { cpSync as cpSync2, existsSync as existsSync6, mkdirSync as mkdirSync3, rmSync as rmSync2 } from "fs";
import { basename as basename2, dirname as dirname3, join as join4, resolve as resolve4 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
var UPDATEABLE_SCAFFOLD_ENTRIES = [
  ".tool-configs",
  "CLAUDE.md",
  "LICENSE",
  "README.md",
  "SETUP.md",
  "SYNC.md",
  "dist",
  "mascot",
  "package.json",
  "screenshots",
  "setup.sh",
  "sync.sh",
  "tsup.config.ts",
  "update.sh",
  "visualize.sh"
];
var PROTECTED_SCAFFOLD_ENTRIES = [
  "AGENTS.md",
  "ROUTER.md",
  "context",
  "patterns"
];
function runUpdate(opts) {
  const sourceRoot = opts.sourceRoot ?? getPackageRoot2();
  const scaffoldRoot = resolve4(opts.scaffoldRoot);
  if (!existsSync6(scaffoldRoot)) {
    throw new Error(`No scaffold directory found at ${scaffoldRoot}`);
  }
  const scaffoldDirName = basename2(scaffoldRoot);
  if (scaffoldDirName !== ".cai" && scaffoldDirName !== ".context-condensing") {
    throw new Error(`Refusing to update non-scaffold directory: ${scaffoldRoot}`);
  }
  const updated = [];
  const missingInSource = [];
  for (const entry of UPDATEABLE_SCAFFOLD_ENTRIES) {
    const from = join4(sourceRoot, entry);
    const to = join4(scaffoldRoot, entry);
    if (!existsSync6(from)) {
      missingInSource.push(entry);
      continue;
    }
    if (existsSync6(to)) {
      rmSync2(to, { recursive: true, force: true });
    } else {
      mkdirSync3(dirname3(to), { recursive: true });
    }
    cpSync2(from, to, { recursive: true });
    updated.push(entry);
  }
  const projectRoot = resolve4(scaffoldRoot, "..");
  const mcp = ensureMcpRegistered(projectRoot);
  ensurePostCompactHook(projectRoot);
  let rulesGenerated = 0;
  try {
    const config = { projectRoot, scaffoldRoot, settings: {} };
    const rules = generateRules(config);
    rulesGenerated = rules.written.length;
  } catch {
  }
  return {
    scaffoldRoot,
    updated,
    missingInSource,
    protected: [...PROTECTED_SCAFFOLD_ENTRIES],
    mcpStatus: mcp.status,
    rulesGenerated
  };
}
function printUpdateResult(result) {
  console.log();
  console.log("cai update \u2014 infrastructure refreshed");
  console.log();
  console.log(`\u2714 ${result.scaffoldRoot}`);
  console.log(`  ${result.updated.length} entries updated`);
  if (result.updated.length > 0) {
    for (const entry of result.updated) {
      console.log(`    \xB7 ${entry}`);
    }
  }
  console.log();
  console.log(`  Preserved (your edits are safe): ${result.protected.join(", ")}`);
  console.log(`  \u2139 These files contain your project-specific configuration and are never overwritten.`);
  console.log();
  if (result.rulesGenerated && result.rulesGenerated > 0) {
    console.log(`\u2714 ${result.rulesGenerated} path-scoped rules refreshed from updated scaffold`);
  }
  if (result.mcpStatus === "registered") {
    console.log("\u2714 MCP server registered \u2014 Claude can now read your scaffold context directly");
  } else if (result.mcpStatus === "already_registered") {
    console.log("\u2714 MCP server active");
  } else if (result.mcpStatus === "claude_not_found") {
    console.log("  \u2139 MCP not connected \u2014 run: cai mcp install  (only needed once after installing Claude)");
  }
  console.log();
  if (result.setupRan) {
    console.log("  \u2139 Run cai check to verify everything is in order.");
  } else {
    console.log("  \u2139 Run cai check to verify, or cai update --setup to re-run AI setup.");
  }
  console.log();
}
function getPackageRoot2() {
  const cliDist = fileURLToPath2(import.meta.url);
  return resolve4(cliDist, "..", "..");
}

// src/session.ts
import { readFileSync as readFileSync7, readdirSync as readdirSync3, existsSync as existsSync8 } from "fs";
import { resolve as resolve5, join as join7, basename as basename4 } from "path";

// src/clipboard.ts
import { spawnSync as spawnSync3 } from "child_process";
import { writeFileSync as writeFileSync4 } from "fs";
import { join as join5 } from "path";
import { tmpdir } from "os";
function copyToClipboard(text) {
  if (process.platform === "darwin") {
    const r = spawnSync3("pbcopy", { input: text });
    return r.status === 0 && !r.error;
  }
  for (const [cmd, args] of [
    ["xclip", ["-selection", "clipboard"]],
    ["xsel", ["--clipboard", "--input"]]
  ]) {
    const r = spawnSync3(cmd, args, { input: text });
    if (r.status === 0 && !r.error) return true;
  }
  if (process.platform === "win32") {
    const r = spawnSync3("clip", { input: text, shell: true });
    return r.status === 0 && !r.error;
  }
  return false;
}
function copyToClipboardOrFile(text, filename = "cai-prompt.md") {
  if (copyToClipboard(text)) {
    return { ok: true, fallbackPath: null };
  }
  try {
    const fallbackPath = join5(tmpdir(), filename);
    writeFileSync4(fallbackPath, text, "utf-8");
    return { ok: false, fallbackPath };
  } catch {
    return { ok: false, fallbackPath: null };
  }
}

// src/codex/index.ts
import { existsSync as existsSync7, mkdirSync as mkdirSync4, readdirSync as readdirSync2, readFileSync as readFileSync6, statSync, writeFileSync as writeFileSync5 } from "fs";
import { basename as basename3, dirname as dirname4, extname, join as join6, relative as relative2 } from "path";
import chalk4 from "chalk";
var SKIP_DIRS = /* @__PURE__ */ new Set([
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
  ".claude",
  "coverage",
  ".turbo",
  ".cache"
]);
var TS_EXTENSIONS = /* @__PURE__ */ new Set([".ts", ".tsx", ".js", ".jsx"]);
var CODE_EXTENSIONS = /* @__PURE__ */ new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs"]);
function walk(dir) {
  const results = [];
  let entries;
  try {
    entries = readdirSync2(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.isSymbolicLink()) continue;
    const full = join6(dir, entry.name);
    if (entry.isDirectory()) {
      for (const f of walk(full)) results.push(f);
    } else if (entry.isFile()) {
      if (entry.name.endsWith(".d.ts")) continue;
      if (entry.name.endsWith(".min.js")) continue;
      if (entry.name.endsWith(".map")) continue;
      const ext = extname(entry.name);
      if (CODE_EXTENSIONS.has(ext)) {
        results.push(full);
      }
    }
  }
  return results;
}
function resolveImportToFile(imp, fromRelPath, projectRoot, knownPaths) {
  const fromDir = dirname4(join6(projectRoot, fromRelPath));
  const base = join6(fromDir, imp);
  const rel = relative2(projectRoot, base);
  if (knownPaths.has(rel)) return rel;
  if (rel.endsWith(".js")) {
    const tsVariant = rel.slice(0, -3) + ".ts";
    if (knownPaths.has(tsVariant)) return tsVariant;
    const tsxVariant = rel.slice(0, -3) + ".tsx";
    if (knownPaths.has(tsxVariant)) return tsxVariant;
  }
  for (const suffix of [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.js"]) {
    const candidate = rel + suffix;
    if (knownPaths.has(candidate)) return candidate;
  }
  return null;
}
function buildReferenceCount(files, projectRoot) {
  const counts = /* @__PURE__ */ new Map();
  const knownPaths = /* @__PURE__ */ new Set();
  for (const f of files) {
    counts.set(f.relPath, 0);
    knownPaths.add(f.relPath);
  }
  for (const f of files) {
    for (const imp of f.imports) {
      if (!imp.startsWith(".")) continue;
      const resolved = resolveImportToFile(imp, f.relPath, projectRoot, knownPaths);
      if (resolved) {
        counts.set(resolved, (counts.get(resolved) ?? 0) + 1);
      }
    }
  }
  return counts;
}
function renderModules(files, projectRoot) {
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const refCounts = buildReferenceCount(files, projectRoot);
  const totalExports = files.reduce((sum, f) => sum + f.exports.length, 0);
  const lines = [
    `<!-- generated -->`,
    `# Code Map (${today})`,
    `# ${files.length} files \xB7 ${totalExports} exports`,
    ""
  ];
  const groups = /* @__PURE__ */ new Map();
  for (const f of files) {
    const dir = dirname4(f.relPath);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(f);
  }
  for (const groupFiles of groups.values()) {
    groupFiles.sort((a, b) => (refCounts.get(b.relPath) ?? 0) - (refCounts.get(a.relPath) ?? 0));
  }
  for (const [group, groupFiles] of groups) {
    lines.push(`## ${group}`);
    for (const f of groupFiles) {
      const fns = f.exports.filter((e) => e.kind === "fn" || e.kind === "class");
      const methods = f.exports.filter((e) => e.kind === "method");
      const types = f.exports.filter((e) => e.kind === "type");
      const refs = refCounts.get(f.relPath) ?? 0;
      if (fns.length === 0 && types.length === 0) continue;
      const fileName = basename3(f.relPath);
      const refTag = refs > 0 ? ` (${refs} refs)` : "";
      lines.push(`${fileName}${refTag}`);
      const MAX_FNS = 8;
      for (const ex of fns.slice(0, MAX_FNS)) {
        const marker = ex.kind === "class" ? "(c)" : "fn ";
        const ret = ex.returns ? ` -> ${ex.returns}` : "";
        lines.push(`  ${marker} ${ex.name}${ex.detail}${ret}`);
      }
      if (fns.length > MAX_FNS) lines.push(`  +${fns.length - MAX_FNS} more`);
      for (const m of methods.slice(0, 6)) {
        const ret = m.returns ? ` -> ${m.returns}` : "";
        lines.push(`    .${m.name}${m.detail}${ret}`);
      }
      if (methods.length > 6) lines.push(`    +${methods.length - 6} more methods`);
      if (types.length > 0) {
        for (const t of types.slice(0, 5)) {
          if (t.fields && t.fields.length > 0) {
            lines.push(`  type ${t.name} { ${t.fields.join("; ")} }`);
          } else {
            lines.push(`  type ${t.name}`);
          }
        }
        if (types.length > 5) lines.push(`  +${types.length - 5} more types`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}
function getScanDirs(projectRoot, explicit) {
  const dirs = (explicit ?? []).map((d) => join6(projectRoot, d));
  if (dirs.length === 0) {
    for (const candidate of ["src", "lib", "utils"]) {
      const full = join6(projectRoot, candidate);
      if (existsSync7(full)) dirs.push(full);
    }
  }
  return dirs;
}
async function collectModuleFiles(projectRoot, scanDirs, opts = {}) {
  const { useTreeSitter = false, requireFnOrClass = true } = opts;
  const allFiles = [];
  for (const dir of scanDirs) {
    for (const f of walk(dir)) allFiles.push(f);
  }
  let treeSitterExtract = null;
  if (useTreeSitter) {
    try {
      const ts = await import("./tree-sitter-BXDO3XWQ.js");
      treeSitterExtract = ts.extractExportsTreeSitter;
    } catch {
    }
  }
  const moduleFiles = [];
  for (const absPath of allFiles) {
    let content;
    try {
      content = readFileSync6(absPath, "utf-8");
    } catch {
      continue;
    }
    if (content.length > 1e6) continue;
    const ext = extname(absPath);
    let exports = null;
    if (treeSitterExtract) {
      try {
        exports = await treeSitterExtract(content, ext);
      } catch {
      }
    }
    if (!exports && TS_EXTENSIONS.has(ext)) {
      exports = extractExports(content);
    }
    if (!exports || exports.length === 0) continue;
    const imports = extractImports(content);
    if (requireFnOrClass && !exports.some((e) => e.kind === "fn" || e.kind === "class" || e.kind === "type")) {
      continue;
    }
    moduleFiles.push({
      relPath: relative2(projectRoot, absPath),
      exports,
      imports
    });
  }
  moduleFiles.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return moduleFiles;
}
async function runCodex(config, opts = {}) {
  const projectRoot = config.projectRoot;
  const scanDirs = getScanDirs(projectRoot, opts.scanDirs);
  const moduleFiles = await collectModuleFiles(projectRoot, scanDirs, { useTreeSitter: true });
  const content = renderModules(moduleFiles, projectRoot);
  const outputDir = join6(config.scaffoldRoot, "codex");
  mkdirSync4(outputDir, { recursive: true });
  const outputPath = join6(outputDir, "modules.md");
  let written = false;
  const existing = existsSync7(outputPath) ? readFileSync6(outputPath, "utf-8") : null;
  if (existing !== content) {
    writeFileSync5(outputPath, content, "utf-8");
    written = true;
  }
  const exportCount = moduleFiles.reduce((sum, f) => sum + f.exports.length, 0);
  return {
    outputPath,
    moduleCount: moduleFiles.length,
    exportCount,
    lines: content.split("\n").length,
    written
  };
}
function printCodexResult(result) {
  if (result.written) {
    console.log(
      chalk4.green("  \u2713") + ` ${chalk4.bold("modules.md")} written \u2014 ${result.moduleCount} modules \xB7 ${result.exportCount} exports \xB7 ${result.lines} lines`
    );
    console.log(chalk4.dim(`    ${result.outputPath}`));
  } else {
    console.log(
      chalk4.dim("  \u2500") + ` modules.md up to date (${result.moduleCount} modules \xB7 ${result.exportCount} exports)`
    );
  }
}
async function runRepoBrief(config) {
  const projectRoot = config.projectRoot;
  const scanDirs = getScanDirs(projectRoot);
  const moduleFiles = await collectModuleFiles(projectRoot, scanDirs, { requireFnOrClass: false });
  const refCounts = buildReferenceCount(moduleFiles, projectRoot);
  const knownPaths = new Set(moduleFiles.map((m) => m.relPath));
  const lines = [
    "<!-- generated -->",
    "# Repo Graph",
    ""
  ];
  const ranked = [...refCounts.entries()].filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]);
  if (ranked.length > 0) {
    lines.push("## Most Referenced");
    for (const [file, count] of ranked.slice(0, 15)) {
      lines.push(`${file}  (${count} refs)`);
    }
    lines.push("");
  }
  lines.push("## Import Graph");
  const edgesBySource = /* @__PURE__ */ new Map();
  for (const f of moduleFiles) {
    const targets = [];
    for (const imp of f.imports) {
      if (!imp.startsWith(".")) continue;
      const resolved = resolveImportToFile(imp, f.relPath, projectRoot, knownPaths);
      if (resolved) targets.push(resolved);
    }
    if (targets.length > 0) {
      edgesBySource.set(f.relPath, [...new Set(targets)]);
    }
  }
  const sortedSources = [...edgesBySource.entries()].sort((a, b) => (refCounts.get(b[0]) ?? 0) - (refCounts.get(a[0]) ?? 0));
  for (const [source, targets] of sortedSources.slice(0, 30)) {
    const shortTargets = targets.map((t) => basename3(t, extname(t))).slice(0, 5);
    const suffix = targets.length > 5 ? ` +${targets.length - 5}` : "";
    lines.push(`${source} -> ${shortTargets.join(", ")}${suffix}`);
  }
  if (sortedSources.length > 30) lines.push(`+${sortedSources.length - 30} more`);
  lines.push("");
  const content = lines.join("\n");
  const outputDir = join6(config.scaffoldRoot, "codex");
  mkdirSync4(outputDir, { recursive: true });
  const outputPath = join6(outputDir, "repo-brief.md");
  let written = false;
  const existing = existsSync7(outputPath) ? readFileSync6(outputPath, "utf-8") : null;
  if (existing !== content) {
    writeFileSync5(outputPath, content, "utf-8");
    written = true;
  }
  return { outputPath, lines: content.split("\n").length, written };
}
function printRepoBriefResult(result) {
  if (result.written) {
    console.log(
      chalk4.green("  \u2713") + ` ${chalk4.bold("repo-brief.md")} written \u2014 ${result.lines} lines`
    );
    console.log(chalk4.dim(`    ${result.outputPath}`));
  } else {
    console.log(
      chalk4.dim("  \u2500") + ` repo-brief.md up to date (${result.lines} lines)`
    );
  }
}
function isCodexStale(config) {
  const codexDir = join6(config.scaffoldRoot, "codex");
  const modulesPath = join6(codexDir, "modules.md");
  const briefPath = join6(codexDir, "repo-brief.md");
  if (!existsSync7(modulesPath) || !existsSync7(briefPath)) return true;
  const oldestCodex = Math.min(
    statSync(modulesPath).mtimeMs,
    statSync(briefPath).mtimeMs
  );
  for (const candidate of ["src", "lib", "utils"]) {
    const dir = join6(config.projectRoot, candidate);
    if (!existsSync7(dir)) continue;
    if (newestMtime(dir) > oldestCodex) return true;
  }
  return false;
}
function newestMtime(dir, depth = 0) {
  if (depth > 4) return 0;
  let newest = 0;
  let entries;
  try {
    entries = readdirSync2(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join6(dir, entry.name);
    try {
      const mtime = statSync(full).mtimeMs;
      if (mtime > newest) newest = mtime;
      if (entry.isDirectory()) {
        const sub = newestMtime(full, depth + 1);
        if (sub > newest) newest = sub;
      }
    } catch {
      continue;
    }
  }
  return newest;
}

// src/session.ts
var RELEVANCE_MAP = [
  { pattern: /package\.json|\.toml|\.lock|go\.mod|Cargo\.toml|pom\.xml|Gemfile/, contexts: ["stack.md", "decisions.md"] },
  { pattern: /\.env|config\.|settings\.|\.yaml|\.yml/, contexts: ["setup.md", "architecture.md"] },
  { pattern: /migration|schema|model|entity|prisma/, contexts: ["architecture.md", "conventions.md"] },
  { pattern: /test|spec|__tests__/, contexts: ["conventions.md"] },
  { pattern: /route|controller|handler|endpoint|api/, contexts: ["architecture.md", "conventions.md"] },
  { pattern: /auth|session|token|jwt|oauth/, contexts: ["architecture.md", "decisions.md"] },
  { pattern: /component|hook|page|layout|view/, contexts: ["conventions.md", "architecture.md"] },
  { pattern: /deploy|docker|ci|cd|workflow|action/, contexts: ["setup.md", "decisions.md"] },
  { pattern: /DECISION|ROUTER|AGENTS|CLAUDE/, contexts: ["decisions.md"] }
];
var FOCUS_MAP = [
  { keywords: /auth|login|jwt|oauth|token|session|permission|role/, contexts: ["architecture.md", "decisions.md"] },
  { keywords: /api|endpoint|route|rest|graphql|handler|controller/, contexts: ["architecture.md", "conventions.md"] },
  { keywords: /db|database|schema|migration|model|orm|prisma|sql/, contexts: ["architecture.md", "conventions.md"] },
  { keywords: /deploy|ci|cd|docker|k8s|kubernetes|infra|pipeline/, contexts: ["setup.md", "decisions.md"] },
  { keywords: /test|spec|coverage|unit|integration|e2e/, contexts: ["conventions.md"] },
  { keywords: /ui|component|frontend|design|style|css|layout|hook/, contexts: ["conventions.md", "architecture.md"] },
  { keywords: /refactor|cleanup|pattern|architecture|structure|module/, contexts: ["architecture.md", "conventions.md", "decisions.md"] },
  { keywords: /dep|dependency|package|upgrade|version|library/, contexts: ["stack.md", "decisions.md"] },
  { keywords: /perf|performance|cache|optim|speed|latency/, contexts: ["architecture.md", "decisions.md"] },
  { keywords: /config|setting|env|secret|key|feature.flag/, contexts: ["setup.md", "decisions.md"] }
];
var MAX_CONTEXT_FILES = 6;
function discoverContextFiles(scaffoldRoot) {
  const contextDir = join7(scaffoldRoot, "context");
  if (!existsSync8(contextDir)) return [];
  const entries = readdirSync3(contextDir).filter((f) => f.endsWith(".md"));
  return entries.map((filename) => {
    const absPath = join7(contextDir, filename);
    return {
      filename,
      absPath,
      frontmatter: parseFrontmatter(absPath)
    };
  });
}
function matchByTriggers(contextFiles, searchText) {
  const lower = searchText.toLowerCase();
  const matched = [];
  for (const { filename, frontmatter } of contextFiles) {
    if (!frontmatter) continue;
    const triggers = frontmatter.triggers;
    if (!Array.isArray(triggers)) continue;
    for (const trigger of triggers) {
      if (lower.includes(trigger.toLowerCase())) {
        matched.push(filename);
        break;
      }
    }
  }
  return matched;
}
function expandEdges(selectedFiles, contextFiles, searchText) {
  const lower = searchText.toLowerCase();
  const toAdd = [];
  for (const { filename, frontmatter } of contextFiles) {
    if (!selectedFiles.has(filename)) continue;
    if (!frontmatter?.edges) continue;
    for (const edge of frontmatter.edges) {
      const target = basename4(edge.target);
      if (selectedFiles.has(target)) continue;
      if (selectedFiles.size + toAdd.length >= MAX_CONTEXT_FILES) break;
      if (!edge.condition || lower.includes(edge.condition.toLowerCase().replace(/^when\s+/i, ""))) {
        toAdd.push(target);
      }
    }
  }
  for (const t of toAdd) selectedFiles.add(t);
}
async function runSession(config, opts = {}) {
  const git = getGit(config.projectRoot);
  const [status, log] = await Promise.all([
    git.status(),
    git.log({ maxCount: 5 })
  ]);
  const modifiedFiles = [
    ...status.modified,
    ...status.staged,
    ...status.not_added,
    ...status.created
  ].filter((f) => !f.startsWith(".cai/"));
  const recentCommits = log.all.map((c) => `${c.hash.slice(0, 7)} ${c.message}`);
  const contextSet = /* @__PURE__ */ new Set();
  const contextFiles = discoverContextFiles(config.scaffoldRoot);
  const searchParts = [];
  if (opts.focus) searchParts.push(opts.focus);
  searchParts.push(...modifiedFiles);
  const searchText = searchParts.join(" ");
  if (searchText) {
    const triggerMatches = matchByTriggers(contextFiles, searchText);
    for (const m of triggerMatches) {
      if (contextSet.size >= MAX_CONTEXT_FILES) break;
      contextSet.add(m);
    }
  }
  if (opts.focus) {
    const query = opts.focus.toLowerCase();
    for (const { keywords, contexts } of FOCUS_MAP) {
      if (keywords.test(query)) {
        contexts.forEach((c) => {
          if (contextSet.size < MAX_CONTEXT_FILES) contextSet.add(c);
        });
      }
    }
  }
  for (const file of modifiedFiles) {
    for (const { pattern, contexts } of RELEVANCE_MAP) {
      if (pattern.test(file)) {
        contexts.forEach((c) => {
          if (contextSet.size < MAX_CONTEXT_FILES) contextSet.add(c);
        });
      }
    }
  }
  if (contextSet.size > 0 && contextSet.size < MAX_CONTEXT_FILES) {
    expandEdges(contextSet, contextFiles, searchText);
  }
  const contextDir = join7(config.scaffoldRoot, "context");
  const loadedFiles = [];
  const contextSections = [];
  for (const filename of contextSet) {
    const filePath = join7(contextDir, filename);
    if (!existsSync8(filePath)) continue;
    const raw = readFileSync7(filePath, "utf-8");
    const stripped = stripFrontmatter(raw);
    const lines = stripped.split("\n").slice(0, 40).join("\n").trim();
    if (!lines) continue;
    loadedFiles.push(filename);
    contextSections.push(`### ${filename}
${lines}`);
  }
  let codexRefreshed = false;
  const codeMapSections = [];
  const codexDir = join7(config.scaffoldRoot, "codex");
  if (isCodexStale(config)) {
    try {
      await runCodex(config);
      await runRepoBrief(config);
      codexRefreshed = true;
    } catch {
    }
  }
  for (const codexFile of ["modules.md", "repo-brief.md"]) {
    const codexPath = join7(codexDir, codexFile);
    if (!existsSync8(codexPath)) continue;
    const raw = readFileSync7(codexPath, "utf-8");
    const stripped = raw.replace(/^<!--.*?-->\n*/, "");
    const trimmed = stripped.split("\n").slice(0, 40).join("\n").trim();
    if (trimmed) codeMapSections.push(`### ${codexFile}
${trimmed}`);
  }
  const projectName = getProjectName(config.projectRoot);
  const prompt = buildSessionPrompt({
    projectName,
    modifiedFiles,
    recentCommits,
    contextSections,
    codeMapSections,
    projectRoot: config.projectRoot,
    focus: opts.focus
  });
  const clip = opts.copy !== false ? copyToClipboardOrFile(prompt, "cai-session-prompt.md") : { ok: false, fallbackPath: null };
  return {
    prompt,
    copiedToClipboard: clip.ok,
    fallbackPath: clip.fallbackPath,
    contextFilesLoaded: loadedFiles,
    modifiedFiles,
    recentCommits,
    focus: opts.focus,
    codexRefreshed
  };
}
function buildSessionPrompt(opts) {
  const parts = [];
  parts.push(`# Session${opts.projectName ? ` \u2014 ${opts.projectName}` : ""}`);
  parts.push(`> This session context is ephemeral. After context compaction, only CLAUDE.md persists. Key rules belong there.`);
  if (opts.focus) {
    parts.push(`> Focus: ${opts.focus}`);
  }
  if (opts.modifiedFiles.length > 0) {
    const shown = opts.modifiedFiles.slice(0, 10);
    const overflow = opts.modifiedFiles.length - shown.length;
    const suffix = overflow > 0 ? `
- +${overflow} more` : "";
    parts.push(`## Active files
${shown.map((f) => `- ${f}`).join("\n")}${suffix}`);
  }
  if (opts.recentCommits.length > 0) {
    const shown = opts.recentCommits.slice(0, 3);
    parts.push(`## Recent commits
${shown.map((c) => `- ${c}`).join("\n")}`);
  }
  if (opts.contextSections.length > 0) {
    parts.push(`## Context
${opts.contextSections.join("\n")}`);
  }
  if (opts.codeMapSections && opts.codeMapSections.length > 0) {
    parts.push(`## Code Map
${opts.codeMapSections.join("\n")}`);
  }
  return parts.join("\n\n");
}
function printSessionResult(result) {
  console.log();
  console.log("cai session \u2014 context snapshot built");
  console.log();
  if (result.modifiedFiles.length > 0) {
    const shown = result.modifiedFiles.slice(0, 5);
    const overflow = result.modifiedFiles.length - shown.length;
    console.log(`  Active files: ${shown.join(", ")}${overflow > 0 ? ` +${overflow} more` : ""}`);
  } else {
    console.log("  Working tree clean \u2014 no modified files");
  }
  if (result.contextFilesLoaded.length > 0) {
    console.log(`  Context loaded: ${result.contextFilesLoaded.join(", ")}`);
    if (result.focus) {
      console.log(`  \u2139 Context was selected based on focus topic: "${result.focus}"`);
    } else {
      console.log("  \u2139 These files were selected because your modified files match known patterns");
      console.log("    (e.g. schema files \u2192 architecture.md, config files \u2192 setup.md).");
    }
  } else if (result.modifiedFiles.length > 0) {
    console.log("  Context loaded: none");
    if (result.focus) {
      console.log(`  \u2139 No context files matched focus topic "${result.focus}" \u2014 only base session info included.`);
    } else {
      console.log("  \u2139 No modified files matched known patterns \u2014 only base session info included.");
    }
  } else {
    console.log("  Context loaded: none (clean working tree)");
  }
  if (result.codexRefreshed) {
    console.log("  Code map: refreshed (modules.md + repo-brief.md)");
  }
  console.log(`  Prompt size: ~${Math.ceil(result.prompt.length / 4).toLocaleString()} tokens`);
  console.log();
  if (result.copiedToClipboard) {
    console.log("\u2714 Session prompt copied to clipboard");
    console.log("  \u2139 Paste into your AI tool to start with full project context.");
  } else if (result.fallbackPath) {
    console.log("\u26A0 Clipboard unavailable \u2014 prompt saved to:");
    console.log(`    ${result.fallbackPath}`);
    console.log("  \u2139 Open the file and paste its contents into your AI tool.");
  } else {
    console.log("\u26A0 Clipboard not available \u2014 run with --print to output the prompt directly.");
  }
  console.log();
  console.log("  \u2139 This prompt will be compacted away in long sessions (~83% context usage).");
  console.log("    Put critical rules in CLAUDE.md \u2014 it reloads after every compaction.");
  console.log();
}
function getProjectName(projectRoot) {
  try {
    const pkg = JSON.parse(readFileSync7(resolve5(projectRoot, "package.json"), "utf-8"));
    return pkg.name ?? null;
  } catch {
    try {
      const gomod = readFileSync7(resolve5(projectRoot, "go.mod"), "utf-8");
      return gomod.match(/^module\s+(\S+)/m)?.[1] ?? null;
    } catch {
      return null;
    }
  }
}

// src/pattern/capture.ts
import { readFileSync as readFileSync8, existsSync as existsSync9, mkdirSync as mkdirSync5 } from "fs";
import { join as join8 } from "path";
import chalk5 from "chalk";
async function runPatternCapture(config) {
  const git = getGit(config.projectRoot);
  let changedFiles = [];
  let diffStat = "";
  let diffContent = "";
  try {
    const diffFiles = await git.diff(["HEAD~1", "HEAD", "--name-only"]);
    changedFiles = diffFiles.split("\n").map((f) => f.trim()).filter(Boolean);
    diffStat = await git.diff(["HEAD~1", "HEAD", "--stat"]);
    diffContent = await git.diff(["HEAD~1", "HEAD", "--unified=3"]);
  } catch {
    try {
      const show = await git.show(["--name-only", "--format=", "HEAD"]);
      changedFiles = show.split("\n").map((f) => f.trim()).filter(Boolean);
      diffStat = await git.show(["--stat", "--format=", "HEAD"]);
      diffContent = await git.show(["--unified=3", "HEAD"]);
    } catch (err) {
      throw new Error(
        `Cannot read git history \u2014 ensure you are in a git repository with at least one commit.
${err.message}`
      );
    }
  }
  if (changedFiles.length === 0) {
    throw new Error("No changed files found in the last commit.");
  }
  const taskType = detectTaskType(changedFiles, diffStat);
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const filename = `suggested-${taskType}-${today}.md`;
  const patternsDir = join8(config.scaffoldRoot, "patterns");
  if (!existsSync9(patternsDir)) mkdirSync5(patternsDir, { recursive: true });
  const patternPath = join8(patternsDir, filename);
  const content = buildPatternDraft(taskType, changedFiles, diffStat, diffContent, today);
  writeIfChanged(patternPath, content);
  const indexPath = join8(patternsDir, "INDEX.md");
  if (existsSync9(indexPath)) {
    const indexContent = readFileSync8(indexPath, "utf-8");
    if (!indexContent.includes(filename)) {
      const entry = `| [${filename}](${filename}) | [DRAFT] Auto-captured: ${taskType} |
`;
      writeIfChanged(indexPath, indexContent.trimEnd() + "\n" + entry + "\n");
    }
  }
  return { taskType, patternPath, changedFiles };
}
function detectTaskType(files, diff) {
  const f = files.join(" ").toLowerCase();
  const d = diff.toLowerCase();
  if (/auth|login|logout|session|token|jwt|oauth|password/.test(f)) return "auth-flow";
  if (/route|controller|handler|endpoint|api/.test(f) && /async.*req.*res|router\.(get|post|put|delete|patch)|\[.*\].*\(req/.test(d)) return "api-endpoint";
  if (/model|schema|entity|migration|prisma/.test(f)) return "data-model";
  if (/test|spec|\.test\.|\.spec\./.test(f)) return "test-coverage";
  if (/config|\.env|settings|dockerfile|\.yaml|\.yml/.test(f)) return "config-change";
  const newFiles = files.filter((f2) => !f2.includes("test")).length;
  const diffLines = diff.split("\n");
  const additions = diffLines.filter((l) => l.startsWith("+")).length;
  const deletions = diffLines.filter((l) => l.startsWith("-")).length;
  if (deletions > additions * 2) return "refactor";
  if (newFiles >= 2) return "new-feature";
  return "general-change";
}
function buildPatternDraft(taskType, changedFiles, diffStat, diffContent, today) {
  const diffLines = diffContent.split("\n");
  const hunks = diffLines.filter((l) => l.startsWith("diff --git") || l.startsWith("@@")).slice(0, 10).join("\n");
  const fileList = changedFiles.slice(0, 10).map((f) => `- ${f}`).join("\n");
  return `---
name: ${taskType}
description: [TODO: one line describing when to use this pattern]
triggers:
  - "${taskType.replace(/-/g, " ")}"
last_updated: ${today}
---

# ${toTitle(taskType)}

> **DRAFT** \u2014 Auto-captured from commit. Review and complete before using.

## Context
[TODO: What context should be loaded before starting this task type?]

## Steps

The following files were changed in the captured commit:

${fileList}

Diff summary:
\`\`\`
${hunks}
\`\`\`

[TODO: Turn the above into numbered steps that describe the workflow]

## Gotchas
[TODO: What went wrong or could go wrong? Add from experience.]

## Verify
- [ ] [TODO: What to check after completing this task type]

## After This Task
- [ ] Update \`.cai/ROUTER.md\` "Current Project State" if significant
- [ ] Update any \`.cai/context/\` files that are now out of date
`;
}
function toTitle(s) {
  return s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function printPatternCaptureResult(result) {
  console.log();
  console.log(chalk5.bold("  cai pattern capture"));
  console.log();
  console.log(chalk5.dim(`  Task type detected: `) + chalk5.cyan(result.taskType));
  console.log(chalk5.dim(`  Files analyzed: ${result.changedFiles.length}`));
  console.log();
  console.log(chalk5.green("  \u2713 Draft pattern saved:"));
  console.log(chalk5.dim(`    ${result.patternPath}`));
  console.log();
  console.log(chalk5.dim("  Review the draft, fill in the TODOs, then run:"));
  console.log(chalk5.dim("    cai check   to verify the pattern is indexed correctly"));
  console.log();
}

// src/health.ts
import { existsSync as existsSync10, readFileSync as readFileSync9 } from "fs";
import { relative as relative3, join as join9 } from "path";
import chalk6 from "chalk";
import { globSync as globSync2 } from "glob";
function printTokenReport(config) {
  const scaffoldFiles = findScaffoldFiles(config.projectRoot, config.scaffoldRoot);
  if (scaffoldFiles.length === 0) {
    console.log("No scaffold files found.");
    return;
  }
  const rows = scaffoldFiles.map((absPath) => {
    const file = relative3(config.projectRoot, absPath);
    const tokens = estimateFileTokens(absPath);
    return { file, tokens, status: tokenStatus(tokens) };
  }).sort((a, b) => b.tokens - a.tokens);
  const total = rows.reduce((sum, r) => sum + r.tokens, 0);
  const totalStatus = total >= TOKEN_TOTAL_CRITICAL ? "critical" : total >= TOKEN_TOTAL_WARN ? "warn" : "ok";
  console.log();
  console.log("cai check --tokens \u2014 scaffold token costs");
  console.log();
  for (const row of rows) {
    const icon2 = row.status === "ok" ? "\u2714" : row.status === "large" ? "\u26A0" : "\u2716";
    const note = row.status === "huge" ? " \u2190 very large, trim or split this file" : row.status === "large" ? " \u2190 consider shortening" : "";
    console.log(`${icon2} ${row.file.padEnd(40)} ~${row.tokens.toLocaleString()} tokens${note}`);
  }
  console.log();
  const totalIcon = totalStatus === "ok" ? "\u2714" : totalStatus === "warn" ? "\u26A0" : "\u2716";
  const totalNote = totalStatus === "ok" ? "lean \u2014 AI reads this cheaply" : totalStatus === "warn" ? "getting large \u2014 consider trimming" : "too heavy \u2014 AI burns tokens on every session";
  console.log(`${totalIcon} Total: ~${total.toLocaleString()} tokens \u2014 ${totalNote}`);
  if (totalStatus !== "ok") {
    console.log("  \u2139 Use 'cai mcp' so AI can query context on-demand instead of loading everything.");
  }
  console.log();
}
var TOKEN_FILE_LARGE = 1500;
var TOKEN_FILE_HUGE = 3e3;
var TOKEN_TOTAL_WARN = 6e3;
var TOKEN_TOTAL_CRITICAL = 12e3;
function tokenStatus(tokens) {
  return tokens >= TOKEN_FILE_HUGE ? "huge" : tokens >= TOKEN_FILE_LARGE ? "large" : "ok";
}
var SOURCE_DIRS = ["src", "lib", "app", "packages", "internal"];
var SOURCE_EXT = "{ts,js,tsx,jsx,py,go,cs,java,rb,rs,kt,kts,swift,cpp,c,h,lua,ex,exs,scala,php,dart}";
var SOURCE_IGNORE = ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**", "**/bin/**", "**/obj/**", "**/target/**", "**/.gradle/**", "**/.venv/**", "**/venv/**"];
async function runHealth(config) {
  const { projectRoot, scaffoldRoot } = config;
  const scaffoldFiles = findScaffoldFiles(projectRoot, scaffoldRoot);
  const relPaths = scaffoldFiles.map((f) => relative3(projectRoot, f));
  const gitInfo = await batchFileGitInfo(relPaths, projectRoot);
  const { warnDays, errorDays, warnCommits, errorCommits } = DEFAULT_STALENESS;
  const files = scaffoldFiles.map((absPath, i) => {
    const file = relPaths[i];
    const info = gitInfo.get(file);
    const days = info?.days ?? null;
    const commits = info?.commits ?? null;
    const status = days !== null && days > errorDays || commits !== null && commits > errorCommits ? "stale" : days !== null && days > warnDays || commits !== null && commits > warnCommits ? "warn" : "fresh";
    const tokens = estimateFileTokens(absPath);
    return { file, daysSinceUpdate: days, commitsSinceUpdate: commits, status, tokens, tokenStatus: tokenStatus(tokens) };
  });
  const allClaims = scaffoldFiles.flatMap((f, i) => extractClaims(f, relPaths[i]));
  const claimedPaths = new Set(
    allClaims.filter((c) => c.kind === "path").map((c) => c.value.replace(/^\//, ""))
  );
  const sourceFiles = SOURCE_DIRS.flatMap(
    (dir) => globSync2(`${dir}/**/*.${SOURCE_EXT}`, { cwd: projectRoot, ignore: SOURCE_IGNORE })
  ).filter((f, i, arr) => arr.indexOf(f) === i);
  const uncovered = sourceFiles.filter((f) => !claimedPaths.has(f));
  const gaps = buildCoverageGaps(uncovered);
  const totalTokens = files.reduce((sum, f) => sum + f.tokens, 0);
  const tokenBudget = {
    total: totalTokens,
    status: totalTokens >= TOKEN_TOTAL_CRITICAL ? "critical" : totalTokens >= TOKEN_TOTAL_WARN ? "warn" : "ok",
    largestFiles: [...files].sort((a, b) => b.tokens - a.tokens).slice(0, 3).filter((f) => f.tokens >= TOKEN_FILE_LARGE).map((f) => ({ file: f.file, tokens: f.tokens }))
  };
  const claudeMdBudget = analyzeClaudeMdBudget(projectRoot);
  const stalePenalty = files.filter((f) => f.status === "stale").length * 10;
  const warnPenalty = files.filter((f) => f.status === "warn").length * 3;
  const gapPenalty = Math.min(30, gaps.reduce((sum, g) => sum + Math.min(10, g.uncoveredCount), 0));
  const overallScore = Math.max(0, 100 - stalePenalty - warnPenalty - gapPenalty);
  return { files, gaps, overallScore, tokenBudget, claudeMdBudget };
}
var CLAUDE_MD_MAX_LINES = 300;
var CLAUDE_MD_MAX_INSTRUCTIONS = 150;
function analyzeClaudeMdBudget(projectRoot) {
  const claudeMdPath = join9(projectRoot, "CLAUDE.md");
  if (!existsSync10(claudeMdPath)) return null;
  let content;
  try {
    content = readFileSync9(claudeMdPath, "utf-8");
  } catch {
    return null;
  }
  const lines = content.split("\n");
  const lineCount = lines.length;
  const instructions = lines.filter((l) => {
    const trimmed = l.trim();
    return /^[-*]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed);
  }).length;
  const status = lineCount > CLAUDE_MD_MAX_LINES || instructions > CLAUDE_MD_MAX_INSTRUCTIONS ? "critical" : lineCount > CLAUDE_MD_MAX_LINES * 0.7 || instructions > CLAUDE_MD_MAX_INSTRUCTIONS * 0.7 ? "warn" : "ok";
  return { lines: lineCount, instructions, status };
}
function buildCoverageGaps(uncovered) {
  const byDir = {};
  for (const f of uncovered) {
    const parts = f.split("/");
    const dir = parts.length > 2 ? parts.slice(0, 2).join("/") : parts[0];
    if (!byDir[dir]) byDir[dir] = [];
    byDir[dir].push(f);
  }
  return Object.entries(byDir).filter(([, files]) => files.length >= 3).sort((a, b) => b[1].length - a[1].length).slice(0, 8).map(([dir, files]) => ({
    directory: dir,
    uncoveredCount: files.length,
    examples: files.slice(0, 3),
    hint: hintForDir(dir)
  }));
}
function hintForDir(dir) {
  if (/route|controller|endpoint|api/i.test(dir)) return "Consider adding an API endpoint pattern";
  if (/model|schema|entity|migration/i.test(dir)) return "Consider documenting data models in architecture.md";
  if (/auth|session|token/i.test(dir)) return "Consider documenting the auth flow in decisions.md";
  if (/component|ui|view/i.test(dir)) return "Consider documenting component conventions";
  if (/service|provider/i.test(dir)) return "Consider documenting service layer in architecture.md";
  if (/test|spec/i.test(dir)) return "Test directory \u2014 low priority for context coverage";
  return "Consider adding context coverage for this directory";
}
function printHealth(report) {
  const scoreColor2 = report.overallScore >= 80 ? chalk6.green : report.overallScore >= 50 ? chalk6.yellow : chalk6.red;
  console.log();
  console.log(chalk6.bold("  cai health") + chalk6.dim(" \u2014 context quality dashboard"));
  console.log();
  console.log(`  Score: ${scoreColor2(chalk6.bold(`${report.overallScore}/100`))}  ${chalk6.dim(scoreLabel(report.overallScore))}`);
  console.log();
  const budgetColor = report.tokenBudget.status === "ok" ? chalk6.green : report.tokenBudget.status === "warn" ? chalk6.yellow : chalk6.red;
  const budgetIcon = report.tokenBudget.status === "ok" ? chalk6.green("\u2714") : report.tokenBudget.status === "warn" ? chalk6.yellow("\u26A0") : chalk6.red("\u2716");
  const budgetNote = report.tokenBudget.status === "ok" ? "lean \u2014 AI reads this cheaply" : report.tokenBudget.status === "warn" ? "getting large \u2014 consider trimming" : "too heavy \u2014 AI burns tokens on every session";
  console.log(chalk6.dim("  \u2500\u2500\u2500 Token budget \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
  console.log(`  ${budgetIcon} Total scaffold cost: ${budgetColor(`~${report.tokenBudget.total.toLocaleString()} tokens`)}  ${chalk6.dim(budgetNote)}`);
  if (report.tokenBudget.largestFiles.length > 0) {
    for (const f of report.tokenBudget.largestFiles) {
      const tIcon = f.tokens >= TOKEN_FILE_HUGE ? chalk6.red("\u2716") : chalk6.yellow("\u26A0");
      const tNote = f.tokens >= TOKEN_FILE_HUGE ? "very large \u2014 trim or split this file" : "large \u2014 consider shortening";
      console.log(`     ${tIcon} ${chalk6.cyan(f.file.padEnd(32))} ${chalk6.dim(`~${f.tokens.toLocaleString()} tokens \u2014 ${tNote}`)}`);
    }
  }
  if (report.tokenBudget.status !== "ok") {
    console.log(`     ${chalk6.cyan("\u2139")} ${chalk6.dim("Use ")}${chalk6.white("cai mcp")}${chalk6.dim(" so AI can query context on-demand instead of loading everything.")}`);
    console.log(`     ${chalk6.cyan("\u2139")} ${chalk6.dim("Use ")}${chalk6.white("mode: summary")}${chalk6.dim(" or ")}${chalk6.white("mode: headings")}${chalk6.dim(" in MCP before loading full files.")}`);
    console.log(`     ${chalk6.cyan("\u2139")} ${chalk6.dim('Add "Keep responses concise" to CLAUDE.md \u2014 output tokens cost 5x more than input.')}`);
  }
  console.log();
  if (report.claudeMdBudget) {
    const b = report.claudeMdBudget;
    const bIcon = b.status === "ok" ? chalk6.green("\u2714") : b.status === "warn" ? chalk6.yellow("\u26A0") : chalk6.red("\u2716");
    const bColor = b.status === "ok" ? chalk6.green : b.status === "warn" ? chalk6.yellow : chalk6.red;
    console.log(chalk6.dim("  \u2500\u2500\u2500 CLAUDE.md instruction budget \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
    console.log(`  ${bIcon} ${bColor(`${b.lines} lines`)}${chalk6.dim(` (max ~${CLAUDE_MD_MAX_LINES})`)}  ${bColor(`${b.instructions} instructions`)}${chalk6.dim(` (max ~${CLAUDE_MD_MAX_INSTRUCTIONS})`)}`);
    if (b.status !== "ok") {
      console.log(`     ${chalk6.cyan("\u2139")} ${chalk6.dim("Claude has ~150 instruction slots after its system prompt. Exceeding this dilutes compliance.")}`);
      console.log(`     ${chalk6.cyan("\u2139")} ${chalk6.dim("Move details to .cai/context/ files and keep CLAUDE.md under 300 lines.")}`);
    }
    console.log();
  }
  console.log(chalk6.dim("  \u2500\u2500\u2500 Context file freshness \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
  for (const f of report.files) {
    const sym = f.status === "fresh" ? chalk6.green("\u2714") : f.status === "warn" ? chalk6.yellow("\u26A0") : chalk6.red("\u2716");
    const age = formatAge(f.daysSinceUpdate, f.commitsSinceUpdate, f.status);
    const tHint = f.tokenStatus === "huge" ? chalk6.dim(` (~${f.tokens.toLocaleString()}t, trim recommended)`) : f.tokenStatus === "large" ? chalk6.dim(` (~${f.tokens.toLocaleString()}t)`) : "";
    console.log(`  ${sym} ${chalk6.cyan(f.file.padEnd(32))} ${chalk6.dim(age)}${tHint}`);
  }
  const meaningfulGaps = report.gaps.filter((g) => !/test|spec/i.test(g.directory));
  if (meaningfulGaps.length > 0) {
    console.log();
    console.log(chalk6.dim("  \u2500\u2500\u2500 Coverage gaps \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
    console.log(chalk6.dim("  These source directories have no scaffold references pointing to them."));
    console.log(chalk6.dim("  AI agents won't have context about this code."));
    console.log();
    for (const gap of meaningfulGaps) {
      console.log(
        `  ${chalk6.yellow("\u26A0")} ${chalk6.cyan(gap.directory)}` + chalk6.dim(` \u2014 ${gap.uncoveredCount} file${gap.uncoveredCount !== 1 ? "s" : ""} without context coverage`)
      );
      if (gap.examples.length > 0) {
        console.log(chalk6.dim(`     e.g. ${gap.examples.slice(0, 2).join(", ")}`));
      }
      console.log(`     ${chalk6.cyan("\u2139")} ${chalk6.dim(gap.hint)}`);
    }
  }
  const stale = report.files.filter((f) => f.status === "stale");
  const warn = report.files.filter((f) => f.status === "warn");
  if (stale.length > 0 || warn.length > 0) {
    console.log();
    console.log(chalk6.dim("  \u2500\u2500\u2500 Recommended actions \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
    for (const f of stale) {
      console.log(
        `  ${chalk6.red("\u2716")} ${chalk6.cyan(f.file)} ${chalk6.dim("is stale")}` + chalk6.dim(` \u2014 run `) + chalk6.white("cai sync") + chalk6.dim(" to update it with AI")
      );
    }
    for (const f of warn) {
      console.log(
        `  ${chalk6.yellow("\u26A0")} ${chalk6.cyan(f.file)} ${chalk6.dim("hasn't been updated in a while")}` + chalk6.dim(` \u2014 run `) + chalk6.white("cai check") + chalk6.dim(" to see if it's still accurate")
      );
    }
  }
  if (report.overallScore === 100) {
    console.log();
    console.log(`  ${chalk6.green("\u2714")} ${chalk6.green("Context is fresh, lean, and well-covered. Nothing to do.")}`);
  }
  console.log();
}
function scoreLabel(score) {
  if (score === 100) return "perfect \u2014 AI has everything it needs";
  if (score >= 80) return "good \u2014 minor drift only";
  if (score >= 50) return "needs attention \u2014 some files are behind";
  return "critical \u2014 scaffold is significantly out of date";
}
function formatAge(days, commits, status) {
  const parts = [];
  if (days !== null) {
    if (days === 0) parts.push("updated today");
    else if (days === 1) parts.push("updated yesterday");
    else parts.push(`last updated ${days} days ago`);
  }
  if (commits !== null && commits > 0) {
    parts.push(`${commits} commit${commits !== 1 ? "s" : ""} since last edit`);
  }
  if (parts.length === 0) return "no git history";
  return parts.join(" \xB7 ");
}

// src/flow.ts
import chalk7 from "chalk";
import { createInterface } from "readline";
function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve6) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve6(answer.trim().toLowerCase() !== "n");
    });
  });
}
function scoreColor(score) {
  return score >= 80 ? chalk7.green : score >= 50 ? chalk7.yellow : chalk7.red;
}
async function runGuidedFlow(config, opts = {}) {
  console.log();
  console.log(chalk7.dim("  Checking if your .cai/ docs are still in sync with your code..."));
  console.log();
  const report = await runDriftCheck(config, { verbose: opts.verbose });
  const errors = report.issues.filter((i) => i.severity === "error").length;
  const warnings = report.issues.filter((i) => i.severity === "warning").length;
  if (report.score === 100) {
    console.log(chalk7.green(`  \u2713 Score: 100/100 \u2014 scaffold is perfectly in sync.`));
    console.log();
    return;
  }
  console.log(`  ${chalk7.bold("Drift score:")} ${scoreColor(report.score)(`${report.score}/100`)}`);
  console.log();
  if (errors > 0) {
    console.log(chalk7.dim(`  Some scaffold files have fallen out of sync with the codebase.`));
    console.log(chalk7.dim(`  ${errors} error${errors !== 1 ? "s" : ""}${warnings > 0 ? ` + ${warnings} warning${warnings !== 1 ? "s" : ""}` : ""} detected across ${countAffectedFiles(report)} file${countAffectedFiles(report) !== 1 ? "s" : ""}.`));
  } else {
    console.log(chalk7.dim(`  ${warnings} warning${warnings !== 1 ? "s" : ""} \u2014 scaffold may be slightly behind the codebase.`));
  }
  console.log();
  reportConsole(report, { verbose: opts.verbose });
  if (errors === 0 && !opts.includeWarnings) {
    console.log(chalk7.dim("  Run cai sync --warnings to address warnings."));
    console.log();
    return;
  }
  const wantFix = await ask(
    `  ${chalk7.cyan("?")} Run safe auto-fixes first? ${chalk7.dim("[Y/n]")} `
  );
  let afterFixReport;
  if (wantFix) {
    console.log();
    const fixResult = await runAutoFix(config);
    printFixResult(fixResult);
    if (fixResult.remainingIssueCount === 0) {
      console.log(chalk7.green("  \u2713 All issues resolved by auto-fix."));
      console.log();
      return;
    }
    const afterFix = await runDriftCheck(config, { incremental: true });
    afterFixReport = afterFix;
    const stillErrors = afterFix.issues.filter((i) => i.severity === "error").length;
    if (stillErrors === 0 && !opts.includeWarnings) {
      console.log(chalk7.green("  \u2713 All errors resolved."));
      console.log();
      return;
    }
    console.log(chalk7.dim(`  ${afterFix.issues.length} issue${afterFix.issues.length !== 1 ? "s" : ""} remain that need AI help.`));
    console.log();
  }
  const wantSync = await ask(
    `  ${chalk7.cyan("?")} Let AI fix the rest? ${chalk7.dim("[Y/n]")} `
  );
  if (!wantSync) {
    console.log();
    console.log(chalk7.dim("  No problem. Run cai sync --export to get prompt files you can paste manually."));
    console.log(chalk7.dim("  Note: AI sync updates your .cai/ docs to reflect current code \u2014 it never modifies source files."));
    console.log();
    return;
  }
  console.log();
  await runSync(config, { includeWarnings: opts.includeWarnings, initialReport: afterFixReport });
}
async function runMenu(config) {
  const b = chalk7.bold;
  const dim = chalk7.dim;
  const cyan = chalk7.cyan;
  console.log();
  console.log(dim("  Checking current drift score..."));
  const report = await runDriftCheck(config);
  const errors = report.issues.filter((i) => i.severity === "error").length;
  const warnings = report.issues.filter((i) => i.severity === "warning").length;
  console.log();
  console.log(`  ${b("cai")} ${dim("\xB7 Coherence AI")}`);
  console.log();
  console.log(`  Drift score: ${scoreColor(report.score)(b(`${report.score}/100`))}  ${dim(`\xB7  ${errors} error${errors !== 1 ? "s" : ""}, ${warnings} warning${warnings !== 1 ? "s" : ""}`)}`);
  console.log();
  if (report.score === 100) {
    console.log(cyan("  \u2500\u2500\u2500 What do you want to do? \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
  } else {
    console.log(dim(`  ${errors > 0 ? "Scaffold has drifted \u2014 some files no longer match the codebase." : "Scaffold has minor drift \u2014 may be slightly behind."}`));
    console.log();
    console.log(cyan("  \u2500\u2500\u2500 What do you want to do? \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
  }
  console.log();
  console.log(`  ${cyan("1")}  ${b("Auto-fix everything")}   ${dim("\xB7 safe fixes + AI sync in one go")}`);
  console.log(`  ${cyan("2")}  ${b("Safe fixes only")}       ${dim("\xB7 deterministic repairs, no AI")}`);
  console.log(`  ${cyan("3")}  ${b("AI sync")}               ${dim("\xB7 let Claude fix remaining drift")}`);
  console.log(`  ${cyan("4")}  ${b("Export prompts")}        ${dim("\xB7 write .md files to paste manually")}`);
  console.log(`  ${cyan("5")}  ${b("Health report")}         ${dim("\xB7 freshness, coverage gaps, score")}`);
  console.log(`  ${cyan("6")}  ${b("View issues")}           ${dim("\xB7 full drift report")}`);
  console.log(`  ${cyan("7")}  ${b("Exit")}`);
  console.log();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const choice = await new Promise((resolve6) => {
    rl.question("  Choice [1-7]: ", (answer) => {
      rl.close();
      resolve6(answer.trim());
    });
  });
  console.log();
  switch (choice) {
    case "1":
      await runGuidedFlow(config);
      break;
    case "2": {
      const result = await runAutoFix(config);
      printFixResult(result);
      break;
    }
    case "3":
      await runSync(config, {});
      break;
    case "4":
      await runSync(config, { export: true });
      break;
    case "5": {
      const health = await runHealth(config);
      printHealth(health);
      break;
    }
    case "6":
      reportConsole(report, { verbose: true });
      break;
    case "7":
    default:
      console.log(dim("  Bye. Run cai anytime to come back."));
      console.log();
      break;
  }
}
function countAffectedFiles(report) {
  return new Set(report.issues.map((i) => i.file)).size;
}

// src/cli.ts
import { createRequire } from "module";
var program = new Command();
var _require = createRequire(import.meta.url);
var _pkg = _require("../package.json");
program.name("cai").description("CLI engine for CAI \xB7 Coherence AI \u2014 drift detection, pre-analysis, and targeted sync").version(_pkg.version);
program.command("check").description("Detect drift between scaffold files and codebase reality").option("--json", "Output full drift report as JSON").option("--quiet", "Single-line summary only").option("--verbose", "Print detailed drift diagnostics").option("--explain <query>", "Explain matching drift issues by code, file, or message").option("--only <checkers>", "Run only the listed checkers (comma-separated)").option("--skip <checkers>", "Skip the listed checkers (comma-separated)").option("--stale-days <days>", "Override staleness warning threshold in days", Number).option("--stale-commits <count>", "Override staleness warning threshold in commits", Number).option("--incremental", "Only check scaffold files that have uncommitted changes").option("--fast", "Skip slow checkers (staleness) for faster CI runs").option("--fix", "Run sync to fix any issues found").option("--tokens", "Show token cost per scaffold context file").action(async (opts) => {
  try {
    if (opts.explain && (opts.json || opts.quiet)) {
      throw new Error("--explain cannot be combined with --json or --quiet");
    }
    if (opts.tokens) {
      const config2 = findConfig();
      printTokenReport(config2);
      return;
    }
    const config = findConfig();
    const only = parseCheckerList(opts.only);
    const skip = parseCheckerList(opts.skip);
    const effectiveSkip = opts.fast ? [...skip ?? [], "staleness"] : skip;
    const { runDriftCheck: runDriftCheck2 } = await import("./drift-LESBRCLP.js");
    const report = await runDriftCheck2(config, {
      verbose: (opts.verbose || Boolean(opts.explain)) && !opts.json && !opts.quiet,
      staleDays: opts.staleDays,
      staleCommits: opts.staleCommits,
      only,
      skip: effectiveSkip,
      incremental: opts.incremental
    });
    const isNonInteractive = opts.json || opts.quiet || opts.explain || opts.fix;
    if (opts.json) {
      reportJSON(report);
    } else if (opts.quiet) {
      reportQuiet(report);
    } else if (opts.explain) {
      reportExplain(report, opts.explain);
    } else if (opts.fix) {
      reportConsole(report, { verbose: opts.verbose });
      const fixResult = await runAutoFix(config, { only, skip });
      printFixResult(fixResult);
      const postFixReport = await runDriftCheck2(config, { staleDays: opts.staleDays, staleCommits: opts.staleCommits, only, skip });
      if (postFixReport.issues.some((i) => i.severity === "error")) {
        const { runSync: runSync2 } = await import("./sync-SIWSYH7T.js");
        await runSync2(config, {});
      }
      return;
    } else {
      reportConsole(report, { verbose: opts.verbose });
      const hasIssues = report.issues.some((i) => i.severity === "error" || i.severity === "warning");
      if (hasIssues && process.stdout.isTTY) {
        await runGuidedFlow(config, { verbose: opts.verbose });
        return;
      }
    }
    const hasErrors = report.issues.some((i) => i.severity === "error");
    if (hasErrors && isNonInteractive) process.exit(1);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
});
program.command("init").description("Scan codebase and generate pre-analysis brief for AI").option("--json", "Output scanner brief as JSON").action(async (opts) => {
  try {
    const config = findConfig();
    const { runScan } = await import("./scanner-VNBY4CWI.js");
    const result = await runScan(config, { jsonOnly: opts.json });
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(result);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
});
program.command("setup [dir]").description("Bootstrap .cai scaffold and run first-time setup in one step").option("--force", "Replace an existing .cai directory").action((dir, opts) => {
  try {
    const result = runBootstrap({
      targetDir: dir,
      force: opts.force
    });
    runBootstrappedSetup(dir ?? process.cwd());
    result.setupRan = true;
    printBootstrapResult(result);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
});
program.command("bootstrap [dir]", { hidden: true }).description("Install a local .cai scaffold into the target project directory").option("--force", "Replace an existing .cai directory").option("--setup", "Run .cai/setup.sh immediately after bootstrapping").action((dir, opts) => {
  try {
    const result = runBootstrap({
      targetDir: dir,
      force: opts.force
    });
    if (opts.setup) {
      runBootstrappedSetup(dir ?? process.cwd());
      result.setupRan = true;
    }
    printBootstrapResult(result);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
});
program.command("doctor").description("Inspect scaffold, manifests, tool configs, and workspace topology").option("--json", "Output doctor report as JSON").action((opts) => {
  try {
    const config = findConfig();
    const report = runDoctor(config);
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printDoctor(report);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
});
program.command("update").description("Refresh CAI infrastructure inside the current project without overwriting project-specific scaffold content").option("--setup", "Run .cai/setup.sh after updating").action((opts) => {
  try {
    const config = findConfig();
    const result = runUpdate({
      scaffoldRoot: config.scaffoldRoot
    });
    if (opts.setup) {
      runBootstrappedSetup(config.projectRoot);
      result.setupRan = true;
    }
    printUpdateResult(result);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
});
program.command("fix").description("Auto-fix drifted scaffold docs (tool configs, pattern index, script docs)").option("--dry-run", "Show which safe fixes would be applied").option("--only <checkers>", "Fix only issues produced by the listed checkers").option("--skip <checkers>", "Skip issues produced by the listed checkers").action(async (opts) => {
  try {
    const config = findConfig();
    const result = await runAutoFix(config, {
      dryRun: opts.dryRun,
      only: parseCheckerList(opts.only),
      skip: parseCheckerList(opts.skip)
    });
    printFixResult(result, { dryRun: opts.dryRun });
    if (!opts.dryRun && result.remainingIssueCount > 0 && process.stdout.isTTY) {
      await runGuidedFlow(config);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
});
program.command("sync").description("Run drift check, then build targeted prompts for AI to fix flagged files").option("--dry-run", "Show what would be synced without executing").option("--warnings", "Include warning-only files (by default only errors are synced)").option("--export", "Write one prompt file per drifted file into .cai/sync-queue/").option("--format <fmt>", "Prompt format: markdown (default) or xml (recommended for Claude)").action(async (opts) => {
  try {
    const config = findConfig();
    const { runSync: runSync2 } = await import("./sync-SIWSYH7T.js");
    const format = opts.format === "xml" ? "xml" : "markdown";
    await runSync2(config, { dryRun: opts.dryRun, includeWarnings: opts.warnings, export: opts.export, format });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
});
var patternCmd = program.command("pattern").description("Manage pattern files");
patternCmd.command("add <name>").description("Create a new pattern file and add it to the index").action(async (name) => {
  try {
    const config = findConfig();
    const { runPatternAdd } = await import("./pattern-E3ZPPUGI.js");
    await runPatternAdd(config, name);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
});
patternCmd.command("capture").description("Analyze last commit and draft a pattern file automatically").action(async () => {
  try {
    const config = findConfig();
    const result = await runPatternCapture(config);
    printPatternCaptureResult(result);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
});
program.command("watch").description("Install post-commit hook for automatic drift checking").option("--uninstall", "Remove the post-commit hook").option("--auto-fix", "Auto-fix drift after each commit and refresh session context").option("--threshold <score>", "Auto-fix trigger threshold (default: 80)", Number).action(async (opts) => {
  try {
    const config = findConfig();
    const { manageHook } = await import("./watch-Q5CKRAM4.js");
    await manageHook(config, {
      uninstall: opts.uninstall,
      autoFix: opts.autoFix,
      threshold: opts.threshold
    });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
});
program.command("session").description("Generate focused session-start prompt from current git state").option("--print", "Print the prompt instead of copying to clipboard").option("--focus <topic>", "Select context files relevant to a specific topic (e.g. auth, api, deploy)").action(async (opts) => {
  try {
    const config = findConfig();
    const result = await runSession(config, { copy: !opts.print, focus: opts.focus });
    printSessionResult(result);
    if (opts.print) console.log(result.prompt);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
});
program.command("health").description("Context quality dashboard \u2014 freshness, coverage, recommendations").option("--json", "Output health report as JSON").action(async (opts) => {
  try {
    const config = findConfig();
    const report = await runHealth(config);
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printHealth(report);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
});
program.command("rules").description("Generate .claude/rules/ from scaffold context (path-scoped, lazy-loaded)").action(async () => {
  try {
    const config = findConfig();
    const { generateRules: generateRules2, printRulesResult } = await import("./rules-AGI5JN35.js");
    const result = generateRules2(config);
    printRulesResult(result);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
});
var mcpCmd = program.command("mcp").description("Start the CAI MCP server for live context queries from Claude");
mcpCmd.command("start").description("Start the MCP server (stdio transport \u2014 for use via MCP config)").action(async () => {
  try {
    const config = findConfig();
    const { startMcpServer } = await import("./server-IXLTEIGS.js");
    await startMcpServer(config);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
});
mcpCmd.command("install").description("Print the MCP config snippet to add to Claude Code or Claude Desktop").action(() => {
  try {
    const config = findConfig();
    console.log();
    console.log(chalk8.bold("  Add CAI as an MCP server in Claude Code:"));
    console.log();
    console.log(chalk8.dim("  In your project's .claude/settings.json (or ~/.claude/settings.json):"));
    console.log();
    console.log(chalk8.cyan(`  {
    "mcpServers": {
      "cai": {
        "command": "cai",
        "args": ["mcp", "start"],
        "cwd": "${config.projectRoot}"
      }
    }
  }`));
    console.log();
    console.log(chalk8.dim("  Or run in terminal: ") + chalk8.white("claude mcp add cai -- cai mcp start"));
    console.log();
    console.log(chalk8.dim("  Once installed, Claude can query your scaffold on-demand:"));
    console.log(chalk8.dim("  \xB7 list_scaffold \u2014 see all files with token costs"));
    console.log(chalk8.dim("  \xB7 search('auth') \u2014 find relevant sections without loading full files"));
    console.log(chalk8.dim("  \xB7 get_file('.cai/context/architecture.md') \u2014 targeted file load"));
    console.log(chalk8.dim("  \xB7 check_drift() \u2014 run drift check from within a Claude session"));
    console.log();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
});
mcpCmd.action(() => {
  try {
    console.log();
    console.log(chalk8.bold("  cai mcp") + chalk8.dim(" \u2014 live context queries for Claude"));
    console.log();
    console.log(`  ${chalk8.cyan("cai mcp start")}    Start the MCP server (used by Claude automatically)`);
    console.log(`  ${chalk8.cyan("cai mcp install")}  Show setup instructions`);
    console.log();
    console.log(chalk8.dim("  Quick setup: ") + chalk8.white(`claude mcp add cai -- cai mcp start`));
    console.log();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
});
program.command("sync-configs").description("Copy the primary tool config to all other tool config files").action(() => {
  try {
    const config = findConfig();
    const result = syncToolConfigs(config.projectRoot);
    if (!result.primary) {
      console.log("No tool config files found.");
      return;
    }
    console.log(`Primary config: ${result.primary}`);
    if (result.updated.length === 0) {
      console.log("No secondary tool config files needed syncing.");
      return;
    }
    console.log("Updated:");
    for (const file of result.updated) {
      console.log(`  ${file}`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
});
program.command("visualize").description("Launch interactive scaffold graph in the browser").action(() => {
  try {
    const config = findConfig();
    const script = join10(config.scaffoldRoot, "visualize.sh");
    if (!existsSync11(script)) {
      throw new Error(`visualize.sh not found at ${script}`);
    }
    runScript("bash", [script], config.projectRoot);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
});
program.command("menu").description("Interactive guided menu \u2014 check, fix, sync, health").action(async () => {
  try {
    const config = findConfig();
    await runMenu(config);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
});
program.command("codex").description("Generate .cai/codex/modules.md \u2014 compact export index for AI context").option("--scan <dirs>", "Comma-separated directories to scan (default: src,lib,utils)").action(async (opts) => {
  try {
    const config = findConfig();
    const scanDirs = opts.scan ? opts.scan.split(",").map((d) => d.trim()).filter(Boolean) : void 0;
    const result = await runCodex(config, { scanDirs });
    printCodexResult(result);
    const briefResult = await runRepoBrief(config);
    printRepoBriefResult(briefResult);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
});
program.command("help").description("Show all available commands").action(printHelp);
program.command("commands").description("Alias for help").action(printHelp);
program.configureHelp({ sortSubcommands: false, helpWidth: 80 });
program.helpCommand(false);
program.on("command:*", () => {
  console.error(chalk8.red(`
  Unknown command: ${program.args[0]}
`));
  printHelp();
  process.exit(1);
});
if (process.argv.length === 2) {
  printHelp();
} else {
  program.parse();
}
function runScript(cmd, args, cwd) {
  const result = spawnSync4(cmd, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== null && result.status !== 0 && result.status !== 130 && result.status !== 143) {
    throw new Error(`Process exited with code ${result.status}`);
  }
}
function printHelp() {
  const b = chalk8.bold;
  const dim = chalk8.dim;
  const cyan = chalk8.cyan;
  const w = 24;
  const row = (cmd, desc) => `  ${cyan(cmd.padEnd(w))}${dim(desc)}`;
  console.log();
  console.log(`  ${b("cai")} ${dim("\xB7 Coherence AI")}`);
  console.log();
  console.log(dim("  \u2500\u2500\u2500 Getting started \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
  console.log(row("cai setup", "Bootstrap scaffold + run first-time AI setup"));
  console.log();
  console.log(dim("  \u2500\u2500\u2500 Daily workflow \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
  console.log(row("cai session", "Smart session-start prompt from current git state"));
  console.log(row("cai session --focus <topic>", "Focus on a topic: auth, api, deploy, db, \u2026"));
  console.log(row("cai check", "Drift score \u2014 are scaffold files still accurate?"));
  console.log(row("cai check --fix", "Auto-fix safe issues, then sync remaining"));
  console.log(row("cai check --tokens", "Show token cost per scaffold context file"));
  console.log(row("cai fix", "Auto-fix drifted scaffold docs"));
  console.log(row("cai sync", "Fix drift \u2014 AI updates only what's broken"));
  console.log(row("cai sync --export", "Export prompts as .md files for manual AI paste"));
  console.log(row("cai sync --format xml", "Export as XML (recommended for Claude)"));
  console.log(row("cai menu", "Guided menu \u2014 check, fix, sync, health in one place"));
  console.log();
  console.log(dim("  \u2500\u2500\u2500 Insights \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
  console.log(row("cai health", "Context quality: freshness, coverage, recommendations"));
  console.log(row("cai visualize", "Open interactive scaffold graph in browser"));
  console.log(row("cai doctor", "Diagnose scaffold, configs, and workspace"));
  console.log(row("cai init", "Pre-scan codebase, build AI brief"));
  console.log(row("cai codex", "Generate code map (.cai/codex/modules.md + repo-brief.md)"));
  console.log();
  console.log(dim("  \u2500\u2500\u2500 Manage \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
  console.log(row("cai update", "Refresh CAI infrastructure, keep your content"));
  console.log(row("cai watch", "Auto-check drift after every commit"));
  console.log(row("cai watch --auto-fix", "Auto-fix drift + refresh session context on commit"));
  console.log(row("cai watch --uninstall", "Remove the post-commit hook"));
  console.log(row("cai pattern add <name>", "Create a new pattern file"));
  console.log(row("cai pattern capture", "Auto-draft pattern from last commit"));
  console.log(row("cai sync-configs", "Re-sync all tool config files"));
  console.log();
}
function parseCheckerList(input) {
  if (!input) return void 0;
  const values = input.split(",").map((value) => value.trim()).filter(Boolean);
  const invalid = values.filter(
    (value) => !AVAILABLE_DRIFT_CHECKERS.includes(value)
  );
  if (invalid.length > 0) {
    throw new Error(
      `Unknown checker(s): ${invalid.join(", ")}. Available: ${AVAILABLE_DRIFT_CHECKERS.join(", ")}`
    );
  }
  return values;
}
//# sourceMappingURL=cli.js.map