#!/usr/bin/env node
import {
  writeIfChanged
} from "./chunk-TBA32Z4B.js";
import {
  findScaffoldFiles,
  mergeWithMarkers
} from "./chunk-QSCBXJG5.js";

// src/rules.ts
import { existsSync, mkdirSync, readFileSync } from "fs";
import { join, relative } from "path";
import chalk from "chalk";
function getRuleMappings(projectRoot) {
  const mappings = [
    {
      source: "context/setup.md",
      target: "setup.md",
      description: "Dev environment setup, commands, prerequisites, and common issues.",
      paths: ["docker-compose*", "Dockerfile*", ".env*", "*.config.*", "scripts/**", "infrastructure/**", "deploy/**", ".github/**"]
    },
    {
      source: "context/architecture.md",
      target: "architecture.md",
      description: "System architecture, component relationships, and data flow.",
      paths: ["src/**", "lib/**", "app/**", "packages/**"]
    },
    {
      source: "context/conventions.md",
      target: "conventions.md",
      description: "Code conventions: naming, structure, patterns, and verification checklist.",
      paths: ["src/**", "lib/**", "app/**", "packages/**"]
    },
    {
      source: "context/stack.md",
      target: "stack.md",
      description: "Technology stack, library choices, and version constraints.",
      paths: ["package.json", "tsconfig.json", "*.config.*"]
    },
    {
      source: "context/decisions.md",
      target: "decisions.md",
      description: "Key architectural decisions with reasoning and alternatives considered.",
      paths: ["src/**", "lib/**", "app/**", "packages/**", "docs/**", "*.md"]
    }
  ];
  const dirs = ["src", "lib", "app", "packages", "apps", "internal", "server", "client"];
  const presentDirs = dirs.filter((d) => existsSync(join(projectRoot, d)));
  if (presentDirs.length > 0) {
    const globbed = presentDirs.map((d) => `${d}/**`);
    for (const m of mappings) {
      if (!m.global && m.paths.some((p) => p.startsWith("src/"))) {
        m.paths = globbed;
      }
    }
  }
  return mappings;
}
function generateRules(config) {
  const { projectRoot, scaffoldRoot } = config;
  const rulesDir = join(projectRoot, ".claude", "rules");
  mkdirSync(rulesDir, { recursive: true });
  const mappings = getRuleMappings(projectRoot);
  const written = [];
  const skipped = [];
  for (const mapping of mappings) {
    const sourcePath = join(scaffoldRoot, mapping.source);
    if (!existsSync(sourcePath)) {
      skipped.push(mapping.source);
      continue;
    }
    const content = readFileSync(sourcePath, "utf8");
    const stripped = content.replace(/^---[\s\S]*?---\n*/, "").trim();
    if (!stripped) {
      skipped.push(mapping.source);
      continue;
    }
    let ruleContent;
    if (mapping.global) {
      ruleContent = `# ${mapping.target.replace(".md", "")} (auto-generated \u2014 edit .cai/${mapping.source})

${stripped}
`;
    } else {
      const globsYaml = mapping.paths.map((p) => `  - "${p}"`).join("\n");
      ruleContent = `---
description: "${mapping.description}"
globs:
${globsYaml}
---

# ${mapping.target.replace(".md", "")} (auto-generated \u2014 edit .cai/${mapping.source})

${stripped}
`;
    }
    const targetPath = join(rulesDir, mapping.target);
    const existing = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : null;
    const merged = mergeWithMarkers(existing, ruleContent);
    writeIfChanged(targetPath, merged);
    written.push(mapping.target);
  }
  const patternsDir = join(scaffoldRoot, "patterns");
  if (existsSync(patternsDir)) {
    const scaffoldFiles = findScaffoldFiles(projectRoot, scaffoldRoot);
    const patternFiles = scaffoldFiles.filter((f) => f.includes("/patterns/") && !f.endsWith("INDEX.md") && !f.endsWith("README.md"));
    for (const f of patternFiles) {
      const rel = relative(scaffoldRoot, f);
      const raw = readFileSync(f, "utf8");
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
      let globsYaml = null;
      if (fmMatch) {
        const globsLine = fmMatch[1].match(/^(?:globs|paths):\s*\n((?:\s+-[^\n]*\n?)*)/m);
        if (globsLine) {
          globsYaml = globsLine[0].replace(/^paths:/, "globs:").trimEnd();
        }
      }
      const body = raw.replace(/^---[\s\S]*?---\n*/, "").trim();
      if (!body) continue;
      const targetName = rel.replace(/\//g, "-");
      let ruleContent;
      if (globsYaml) {
        ruleContent = `---
${globsYaml}
---

# ${rel} (auto-generated \u2014 edit .cai/${rel})

${body}
`;
      } else {
        ruleContent = `# ${rel} (auto-generated \u2014 edit .cai/${rel})

${body}
`;
      }
      const targetPath = join(rulesDir, targetName);
      const existing = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : null;
      const merged = mergeWithMarkers(existing, ruleContent);
      writeIfChanged(targetPath, merged);
      written.push(targetName);
    }
  }
  return { rulesDir, written, skipped };
}
function printRulesResult(result) {
  console.log();
  console.log(`  ${chalk.bold("cai rules")} ${chalk.dim("\xB7 path-scoped rules for Claude Code")}`);
  console.log();
  if (result.written.length === 0) {
    console.log(chalk.dim("  No scaffold context files found to generate rules from."));
    console.log(chalk.dim("  Run cai setup first."));
    console.log();
    return;
  }
  for (const file of result.written) {
    console.log(`  ${chalk.green("\u2713")} .claude/rules/${chalk.cyan(file)}`);
  }
  console.log();
  console.log(chalk.dim(`  ${result.written.length} rules generated \u2014 Claude loads them only when touching matching files.`));
  console.log(chalk.dim("  These are regenerated from .cai/ on every cai sync. Edit the source, not the rules."));
  console.log();
}

export {
  generateRules,
  printRulesResult
};
//# sourceMappingURL=chunk-KGHVTBGH.js.map