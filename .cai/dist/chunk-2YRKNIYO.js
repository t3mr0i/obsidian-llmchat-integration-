#!/usr/bin/env node
import {
  generateRules
} from "./chunk-KGHVTBGH.js";
import {
  writeIfChanged
} from "./chunk-TBA32Z4B.js";
import {
  getGitDiff,
  runDriftCheck
} from "./chunk-QSCBXJG5.js";

// src/sync/index.ts
import chalk from "chalk";
import { spawnSync } from "child_process";
import { createInterface } from "readline";
import { mkdirSync, readdirSync as readdirSync2, unlinkSync, existsSync as existsSync2 } from "fs";
import { join } from "path";

// src/sync/brief-builder.ts
import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve, dirname, basename } from "path";
import { globSync } from "glob";
async function buildCombinedBrief(targets, projectRoot, format = "markdown") {
  const sections = [];
  for (const target of targets) {
    sections.push(await buildFileSection(target, projectRoot, format));
  }
  if (format === "xml") {
    const docs = sections.map((s, i) => `  <document index="${i + 1}">
${s}
  </document>`).join("\n\n");
    return `<documents>
${docs}
</documents>

Fix all drift issues above. Only change what's broken. Use filesystem context to resolve missing paths. Apply fixes silently.`;
  }
  return `Fix the drift issues in these scaffold files. Rules:
1. Only change what's broken \u2014 do not rewrite correct sections.
2. When a path no longer exists, find the current path from the filesystem context and update the reference.
3. Apply fixes silently \u2014 do not explain what you changed.

${sections.map((s, i) => `\u2501\u2501\u2501 File ${i + 1}/${sections.length} \u2501\u2501\u2501

${s}`).join("\n\n")}`;
}
async function buildSyncBrief(target, projectRoot, format = "markdown") {
  const section = await buildFileSection(target, projectRoot, format);
  if (format === "xml") {
    return `<documents>
  <document index="1">
${section}
  </document>
</documents>

Fix the drift issues above. Only change what's broken. Use filesystem context to resolve missing paths. Apply fixes silently.`;
  }
  return `Fix the drift issues in this scaffold file. Only change what's broken. When a path no longer exists, use the filesystem context to find the current path. Apply fixes silently.

${section}`;
}
async function buildFileSection(target, projectRoot, format = "markdown") {
  const filePath = resolve(projectRoot, target.file);
  let fileContent;
  const MAX_FILE_CHARS = 8e3;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const stripped = raw.replace(/^---\n[\s\S]*?\n---\n*/, "");
    fileContent = stripped.length > MAX_FILE_CHARS ? stripped.slice(0, MAX_FILE_CHARS) + `

... (truncated \u2014 ${stripped.length - MAX_FILE_CHARS} more chars)` : stripped;
  } catch (err) {
    fileContent = `(file could not be read: ${err.message})`;
  }
  const issueList = target.issues.map((i) => `- [${i.severity}] ${i.code}: ${i.message}`).join("\n");
  const claimedPaths = target.issues.filter((i) => i.claim?.kind === "path").map((i) => i.claim.value);
  const diff = claimedPaths.length ? await getGitDiff(claimedPaths, projectRoot) : target.gitDiff ?? "";
  const MAX_DIFF_CHARS = 3e3;
  const diffTruncated = diff.length > MAX_DIFF_CHARS ? diff.slice(0, MAX_DIFF_CHARS) + `

... (truncated \u2014 ${diff.length - MAX_DIFF_CHARS} more chars)` : diff;
  const fileContext = buildFileContext(target, projectRoot);
  if (format === "xml") {
    const contextPart = fileContext ? `
    <filesystem_context>
${fileContext}
    </filesystem_context>` : "";
    const diffPart = diffTruncated ? `
    <git_diff><![CDATA[
${diffTruncated}
    ]]></git_diff>` : "";
    return `    <source>${target.file}</source>
    <issues><![CDATA[
${issueList}
    ]]></issues>
    <current_content><![CDATA[
${fileContent}
    ]]></current_content>${contextPart}${diffPart}`;
  }
  let section = `**File:** ${target.file}

**Issues found:**
${issueList}

**Current file content:**
\`\`\`markdown
${fileContent}
\`\`\``;
  if (fileContext) {
    section += `

**Filesystem context (what actually exists):**
${fileContext}`;
  }
  if (diffTruncated) {
    section += `

**Recent git changes in referenced paths:**
\`\`\`diff
${diffTruncated}
\`\`\``;
  }
  return section;
}
function buildFileContext(target, projectRoot) {
  const missingPaths = target.issues.filter((i) => i.code === "MISSING_PATH" && i.claim?.kind === "path").map((i) => i.claim.value);
  if (missingPaths.length === 0) return null;
  const sections = [];
  const listedDirs = /* @__PURE__ */ new Set();
  const extToSearch = /* @__PURE__ */ new Set();
  for (const missing of missingPaths) {
    const name = basename(missing);
    const ext = name.includes(".") ? name.split(".").pop() : null;
    if (ext) extToSearch.add(ext);
  }
  const extMatches = /* @__PURE__ */ new Map();
  for (const ext of extToSearch) {
    const matches = globSync(`**/*.${ext}`, {
      cwd: projectRoot,
      ignore: ["node_modules/**", ".cai/**", ".context-condensing/**", "dist/**", ".git/**"],
      maxDepth: 5
    });
    if (matches.length > 0) extMatches.set(ext, matches);
  }
  for (const missing of missingPaths) {
    const dir = missing.includes("/") ? dirname(missing) : ".";
    const dirKey = dir === "." ? "root" : dir;
    if (!listedDirs.has(dirKey)) {
      listedDirs.add(dirKey);
      const absDir = resolve(projectRoot, dir);
      if (existsSync(absDir)) {
        try {
          const files = readdirSync(absDir).filter((f) => !f.startsWith(".")).sort().slice(0, 30);
          const suffix = files.length === 30 ? " \u2026" : "";
          if (files.length > 0) {
            sections.push(`\`${dir}/\` contains: ${files.join(", ")}${suffix}`);
          }
        } catch {
        }
      }
    }
    const name = basename(missing);
    const ext = name.includes(".") ? name.split(".").pop() : null;
    if (ext && extMatches.has(ext)) {
      const matches = extMatches.get(ext);
      const shown = matches.slice(0, 15);
      const suffix = matches.length > 15 ? ` \u2026 and ${matches.length - 15} more` : "";
      sections.push(`All \`.${ext}\` files in project: ${shown.join(", ")}${suffix}`);
      extMatches.delete(ext);
    }
  }
  return sections.length > 0 ? sections.join("\n") : null;
}

// src/sync/index.ts
function askUser(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve2) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve2(answer.trim());
    });
  });
}
var CLAUDE_TIMEOUT_MS = 5 * 60 * 1e3;
function runClaudeInteractive(brief, cwd) {
  const result = spawnSync("claude", [brief], {
    cwd,
    stdio: "inherit",
    timeout: CLAUDE_TIMEOUT_MS
  });
  if (result.error) {
    const code = result.error.code;
    if (code === "ENOENT") {
      console.error(chalk.red("  claude CLI not found. Install it from https://claude.ai/code"));
    } else if (code === "ETIMEDOUT") {
      console.log(chalk.yellow(`  Claude session timed out after ${CLAUDE_TIMEOUT_MS / 6e4}min. Checking partial results...`));
      return true;
    } else {
      console.error(chalk.red(`  claude failed: ${result.error.message}`));
    }
    return false;
  }
  if (result.status === 130 || result.status === 143) return false;
  return result.status === 0 || result.status === null;
}
async function runSync(config, opts) {
  let cycle = 0;
  let mode = null;
  while (true) {
    cycle++;
    if (cycle === 1) {
      console.log(chalk.bold("Running drift check..."));
      console.log(chalk.dim("  CAI updates your .cai/ scaffold docs to match your code \u2014 source files are never changed."));
    } else {
      console.log(chalk.bold("\nRe-checking for remaining drift..."));
    }
    const report = cycle === 1 && opts.initialReport ? opts.initialReport : await runDriftCheck(config, { incremental: cycle > 1 });
    if (cycle === 1) console.log();
    if (report.issues.length === 0) {
      console.log(chalk.green("  \u2713 No drift detected \u2014 scaffold is in sync."));
      refreshRules(config);
      console.log();
      return;
    }
    const scoreColor = report.score >= 80 ? chalk.green : report.score >= 50 ? chalk.yellow : chalk.red;
    console.log(`  Drift score: ${scoreColor(`${report.score}/100`)}  ${chalk.dim(`(${report.issues.length} issues)`)}`);
    const relevantIssues = opts.includeWarnings ? report.issues : report.issues.filter((i) => {
      const fileHasError = report.issues.some(
        (other) => other.file === i.file && other.severity === "error"
      );
      return fileHasError;
    });
    if (relevantIssues.length === 0) {
      console.log();
      console.log(chalk.green("  \u2713 No errors \u2014 only warnings remain."));
      console.log(chalk.dim("  Run cai sync --warnings to include them."));
      refreshRules(config);
      console.log();
      return;
    }
    const targets = groupIntoTargets(relevantIssues);
    console.log();
    console.log(chalk.dim("  \u2500\u2500\u2500 Files to fix \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
    for (const target of targets) {
      const errors = target.issues.filter((i) => i.severity === "error").length;
      const warnings = target.issues.filter((i) => i.severity === "warning").length;
      const parts = [errors > 0 ? chalk.red(`${errors} error${errors !== 1 ? "s" : ""}`) : "", warnings > 0 ? chalk.yellow(`${warnings} warning${warnings !== 1 ? "s" : ""}`) : ""].filter(Boolean).join(", ");
      console.log(`  ${chalk.cyan(target.file.padEnd(40))} ${parts}`);
    }
    console.log();
    if (opts.dryRun) {
      console.log(
        chalk.dim("\n--dry-run: showing prompt without executing\n")
      );
      const brief2 = await buildCombinedBrief(targets, config.projectRoot, opts.format);
      console.log(brief2);
      console.log();
      return;
    }
    if (opts.export) {
      await exportSyncQueue(targets, config, opts.format);
      return;
    }
    if (mode === null) {
      console.log(chalk.dim("  \u2500\u2500\u2500 How should we fix these? \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
      console.log();
      console.log(`  ${chalk.cyan("1")}  ${chalk.bold("Interactive")}  ${chalk.dim("\u2014 Claude fixes everything, you watch (default)")}`);
      console.log(`  ${chalk.cyan("2")}  ${chalk.bold("Export")}       ${chalk.dim("\u2014 Write prompt files to .cai/sync-queue/ for manual paste")}`);
      console.log(`  ${chalk.cyan("3")}  ${chalk.bold("Exit")}         ${chalk.dim("\u2014 I'll handle it later")}`);
      console.log();
      const choice = await askUser("  Choice [1-3] (default: 1): ");
      const picked = choice || "1";
      switch (picked) {
        case "1":
          mode = "interactive";
          break;
        case "2":
          await exportSyncQueue(targets, config, opts.format);
          return;
        case "3":
          console.log();
          console.log(chalk.dim("  No problem \u2014 run cai sync anytime to pick this up."));
          console.log();
          return;
        default:
          console.log();
          console.log(chalk.dim("  No problem \u2014 run cai sync anytime to pick this up."));
          console.log();
          return;
      }
    }
    console.log();
    console.log(chalk.dim(`  Sending ${targets.length} file${targets.length !== 1 ? "s" : ""} to Claude \u2014 sit back while it fixes the drift...`));
    console.log();
    const brief = await buildCombinedBrief(targets, config.projectRoot, opts.format);
    const ok = runClaudeInteractive(brief, config.projectRoot);
    if (!ok) {
      console.log(chalk.red("  \u2717 Claude session did not complete."));
      console.log(chalk.dim("  Run cai sync again to retry, or cai sync --export to export prompts."));
      console.log();
      return;
    }
    const postReport = await runDriftCheck(config);
    const scoreDelta = postReport.score - report.score;
    const deltaStr = scoreDelta > 0 ? chalk.green(`+${scoreDelta}`) : scoreDelta === 0 ? chalk.yellow("+0") : chalk.red(`${scoreDelta}`);
    console.log();
    console.log(chalk.dim("  \u2500\u2500\u2500 Result \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
    console.log(`  Drift score: ${chalk.dim(`${report.score}`)} \u2192 ${chalk.bold(`${postReport.score}/100`)}  ${chalk.dim(`(${deltaStr})`)} `);
    console.log();
    const remainingErrors = postReport.issues.filter((i) => i.severity === "error").length;
    const remainingWarnings = postReport.issues.filter((i) => i.severity === "warning").length;
    if (postReport.score === 100) {
      console.log(chalk.green("  \u2713 Perfect score \u2014 everything is in sync."));
      console.log();
      return;
    }
    if (remainingErrors === 0 && !opts.includeWarnings) {
      if (remainingWarnings > 0) {
        console.log(chalk.green("  \u2713 All errors resolved."));
        console.log(chalk.dim(`  ${remainingWarnings} warning${remainingWarnings !== 1 ? "s" : ""} remain \u2014 run cai sync --warnings to address them.`));
      }
      console.log();
      return;
    }
    const remaining = opts.includeWarnings ? remainingErrors + remainingWarnings : remainingErrors;
    const answer = await askUser(`  ${remaining} issue${remaining !== 1 ? "s" : ""} still remain. Run another round? [Y/n] `);
    if (answer.toLowerCase() === "n") {
      console.log();
      console.log(chalk.dim("  Paused. Run cai sync anytime to continue."));
      console.log();
      return;
    }
    console.log();
  }
}
async function exportSyncQueue(targets, config, format = "markdown") {
  const queueDir = join(config.scaffoldRoot, "sync-queue");
  mkdirSync(queueDir, { recursive: true });
  if (existsSync2(queueDir)) {
    for (const f of readdirSync2(queueDir)) {
      if (f.endsWith(".md") || f.endsWith(".xml")) unlinkSync(join(queueDir, f));
    }
  }
  const written = [];
  const ext = format === "xml" ? "xml" : "md";
  for (const target of targets) {
    const brief = await buildSyncBrief(target, config.projectRoot, format);
    const slug = target.file.replace(/\//g, "-").replace(/\.md$/, "");
    const filename = `fix-${slug}.${ext}`;
    const filePath = join(queueDir, filename);
    writeIfChanged(filePath, brief);
    written.push(filename);
  }
  const rel = (p) => p.replace(config.projectRoot + "/", "");
  console.log();
  console.log(chalk.bold(`  cai sync --export`));
  console.log();
  console.log(chalk.green(`  \u2713 ${written.length} prompt file${written.length === 1 ? "" : "s"} written to ${rel(queueDir)}/`));
  console.log();
  for (const f of written) {
    console.log(chalk.cyan(`    ${rel(queueDir)}/${f}`));
  }
  console.log();
  console.log(chalk.dim("  Open each file, paste the contents into your AI tool,"));
  console.log(chalk.dim("  apply the changes, then run cai check to verify."));
  console.log();
}
function refreshRules(config) {
  try {
    const result = generateRules(config);
    if (result.written.length > 0) {
      console.log(chalk.dim(`  \u2713 ${result.written.length} path-scoped rules refreshed`));
    }
  } catch {
  }
}
function groupIntoTargets(issues) {
  const byFile = /* @__PURE__ */ new Map();
  for (const issue of issues) {
    if (!byFile.has(issue.file)) byFile.set(issue.file, []);
    byFile.get(issue.file).push(issue);
  }
  return Array.from(byFile.entries()).map(([file, issues2]) => ({
    file,
    issues: issues2,
    gitDiff: null
  }));
}

export {
  runSync
};
//# sourceMappingURL=chunk-2YRKNIYO.js.map