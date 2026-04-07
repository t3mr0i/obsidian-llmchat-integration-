#!/usr/bin/env node
import {
  runDriftCheck
} from "./chunk-QSCBXJG5.js";
import {
  scanProjectModel
} from "./chunk-S2JQZXY2.js";
import "./chunk-XAVW3U2U.js";
import "./chunk-WX2YGCKP.js";

// src/verify.ts
import { existsSync } from "fs";
import { spawnSync } from "child_process";
import { join } from "path";
import chalk from "chalk";
var DEFAULT_TIMEOUT_MS = 12e4;
async function runVerify(config, opts = {}) {
  const start = Date.now();
  const steps = [];
  const project = scanProjectModel(config.projectRoot);
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const typecheckStep = await runTypecheck(config.projectRoot, project, timeout);
  if (typecheckStep) steps.push(typecheckStep);
  if (steps.some((s) => s.status === "failed")) {
    return finalize(steps, start);
  }
  const buildStep = await runBuild(config.projectRoot, project, timeout);
  if (buildStep) steps.push(buildStep);
  if (steps.some((s) => s.status === "failed")) {
    return finalize(steps, start);
  }
  if (!opts.skipDrift) {
    const driftStep = await runDriftStep(config);
    steps.push(driftStep);
  }
  return finalize(steps, start);
}
function finalize(steps, startMs) {
  return {
    passed: steps.every((s) => s.status !== "failed"),
    steps,
    totalDurationMs: Date.now() - startMs
  };
}
async function runTypecheck(projectRoot, project, timeoutMs) {
  if (project.rootManifest?.type !== "package.json") return null;
  if (!existsSync(join(projectRoot, "tsconfig.json"))) return null;
  const scripts = project.rootManifest.scripts ?? {};
  if (scripts.typecheck) {
    return runShell("typecheck", "npm run typecheck", projectRoot, timeoutMs);
  }
  if (scripts["type-check"]) {
    return runShell("typecheck", "npm run type-check", projectRoot, timeoutMs);
  }
  return runShell("typecheck", "npx tsc --noEmit", projectRoot, timeoutMs);
}
async function runBuild(projectRoot, project, timeoutMs) {
  if (project.rootManifest?.type !== "package.json") return null;
  const scripts = project.rootManifest.scripts ?? {};
  if (!scripts.build) return null;
  return runShell("build", "npm run build", projectRoot, timeoutMs);
}
async function runDriftStep(config) {
  const stepStart = Date.now();
  try {
    const report = await runDriftCheck(config, { skip: ["staleness"] });
    const errors = report.issues.filter((i) => i.severity === "error").length;
    const status = errors > 0 ? "failed" : "passed";
    const summary = errors > 0 ? `${errors} error${errors !== 1 ? "s" : ""} (score ${report.score}/100)` : `clean (score ${report.score}/100)`;
    return {
      name: "drift",
      command: "cai check --skip staleness",
      status,
      durationMs: Date.now() - stepStart,
      output: summary
    };
  } catch (err) {
    return {
      name: "drift",
      command: "cai check --skip staleness",
      status: "failed",
      durationMs: Date.now() - stepStart,
      output: err.message
    };
  }
}
function runShell(name, command, cwd, timeoutMs) {
  const stepStart = Date.now();
  const parts = command.split(/\s+/);
  const result = spawnSync(parts[0], parts.slice(1), {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 4 * 1024 * 1024
  });
  if (result.error) {
    const code = result.error.code;
    if (code === "ENOENT") {
      return {
        name,
        command,
        status: "skipped",
        durationMs: Date.now() - stepStart,
        reason: `${parts[0]} not found in PATH`
      };
    }
    return {
      name,
      command,
      status: "failed",
      durationMs: Date.now() - stepStart,
      output: result.error.message
    };
  }
  const combined = ((result.stdout ?? "") + "\n" + (result.stderr ?? "")).trim();
  if (result.status === 0) {
    return {
      name,
      command,
      status: "passed",
      durationMs: Date.now() - stepStart
    };
  }
  return {
    name,
    command,
    status: "failed",
    durationMs: Date.now() - stepStart,
    output: truncate(combined, 4e3)
  };
}
function truncate(text, maxChars) {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + `
\u2026 (truncated, ${text.length - maxChars} more chars)`;
}
function printVerifyResult(result) {
  console.log();
  console.log(chalk.bold("  cai verify"));
  console.log();
  for (const step of result.steps) {
    const icon = step.status === "passed" ? chalk.green("\u2714") : step.status === "failed" ? chalk.red("\u2716") : chalk.dim("\u25CB");
    const duration = chalk.dim(`(${(step.durationMs / 1e3).toFixed(1)}s)`);
    console.log(`  ${icon} ${chalk.bold(step.name.padEnd(10))}  ${chalk.dim(step.command)}  ${duration}`);
    if (step.status === "skipped" && step.reason) {
      console.log(`            ${chalk.dim(step.reason)}`);
    }
    if (step.status === "passed" && step.output) {
      console.log(`            ${chalk.dim(step.output)}`);
    }
    if (step.status === "failed" && step.output) {
      const lines = step.output.split("\n").slice(0, 12);
      for (const line of lines) {
        console.log(`            ${chalk.dim(line)}`);
      }
      if (step.output.split("\n").length > 12) {
        console.log(`            ${chalk.dim("\u2026")}`);
      }
    }
  }
  console.log();
  if (result.passed) {
    console.log(`  ${chalk.green("\u2713 all checks passed")}  ${chalk.dim(`(${(result.totalDurationMs / 1e3).toFixed(1)}s total)`)}`);
  } else {
    const failed = result.steps.filter((s) => s.status === "failed").map((s) => s.name).join(", ");
    console.log(`  ${chalk.red("\u2716 failed:")} ${chalk.bold(failed)}  ${chalk.dim(`(${(result.totalDurationMs / 1e3).toFixed(1)}s total)`)}`);
  }
  console.log();
}
export {
  printVerifyResult,
  runVerify
};
//# sourceMappingURL=verify-HNFYNJZZ.js.map