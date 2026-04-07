#!/usr/bin/env node
import {
  detectCorrections
} from "./chunk-ILOHIW4R.js";

// src/learn/watch.ts
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import chalk from "chalk";
var POLL_MS = 2e3;
async function watchLearnLog(opts) {
  const path = join(opts.projectRoot, ".cai", ".cache", "sessions.jsonl");
  const pollMs = opts.pollMs ?? POLL_MS;
  let processedLines = countLines(path);
  let iterations = 0;
  console.log(chalk.bold(`
  cai learn watch \u2014 listening for new corrections`));
  console.log(chalk.dim(`  ${path}`));
  console.log(chalk.dim(`  Press Ctrl-C to stop.
`));
  while (true) {
    if (opts.maxIterations !== void 0 && iterations >= opts.maxIterations) break;
    iterations++;
    if (existsSync(path)) {
      const allLines = readLines(path);
      if (allLines.length < processedLines) {
        processedLines = 0;
      }
      if (allLines.length > processedLines) {
        const newLines = allLines.slice(processedLines);
        const newEntries = parseEntries(newLines);
        const newCorrections = detectCorrections(newEntries);
        for (const c of newCorrections) {
          const time = new Date(c.ts).toISOString().split("T")[1].slice(0, 5);
          console.log(
            `  ${chalk.cyan(time)}  ${chalk.yellow("\u26A1 correction")}  ${chalk.dim(`[${c.signal}]`)}  ${c.prompt.slice(0, 80)}${c.prompt.length > 80 ? "\u2026" : ""}`
          );
          if (opts.onCorrection) {
            opts.onCorrection({ ts: c.ts, prompt: c.prompt });
          }
        }
        processedLines = allLines.length;
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
function countLines(path) {
  if (!existsSync(path)) return 0;
  try {
    return readFileSync(path, "utf8").split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}
function readLines(path) {
  try {
    return readFileSync(path, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}
function parseEntries(lines) {
  const entries = [];
  for (const line of lines) {
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
    }
  }
  return entries;
}
export {
  watchLearnLog
};
//# sourceMappingURL=watch-CIWADTR7.js.map