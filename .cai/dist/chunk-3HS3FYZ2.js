#!/usr/bin/env node
import {
  writeIfChanged
} from "./chunk-TBA32Z4B.js";

// src/pattern/index.ts
import { join } from "path";
import { existsSync, appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import chalk from "chalk";
var INDEX_HEADER = `# Pattern Index

Lookup table for all pattern files in this directory. Check here before starting any task \u2014 if a pattern exists, follow it.

<!-- This file is populated during setup (Pass 2) and updated whenever patterns are added.
     Each row maps a pattern file (or section) to its trigger \u2014 when should the agent load it?

     Format \u2014 simple (one task per file):
     | [filename.md](filename.md) | One-line description of when to use this pattern |

     Format \u2014 anchored (multi-section file, one row per task):
     | [filename.md#task-first-task](filename.md#task-first-task) | When doing the first task |
     | [filename.md#task-second-task](filename.md#task-second-task) | When doing the second task |

     Example (from a Flask API project):
     | [add-api-client.md](add-api-client.md) | Adding a new external service integration |
     | [debug-pipeline.md](debug-pipeline.md) | Diagnosing failures in the request pipeline |
     | [crud-operations.md#task-add-endpoint](crud-operations.md#task-add-endpoint) | Adding a new API route with validation |
     | [crud-operations.md#task-add-model](crud-operations.md#task-add-model) | Adding a new database model |

     Keep this table sorted alphabetically. One row per task (not per file).
     If you create a new pattern, add it here. If you delete one, remove it. -->

| Pattern | Use when |
|---------|----------|
`;
async function runPatternAdd(config, name) {
  if (!/^[a-z0-9-]+$/i.test(name)) {
    throw new Error(`Invalid pattern name '${name}'. Use only letters, numbers, and hyphens.`);
  }
  const patternsDir = join(config.scaffoldRoot, "patterns");
  const patternPath = join(patternsDir, `${name}.md`);
  const indexPath = join(patternsDir, "INDEX.md");
  if (existsSync(patternPath)) {
    throw new Error(`Pattern '${name}' already exists at ${patternPath}`);
  }
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const template = `---
name: ${name}
description: [one line \u2014 what this pattern covers and when to use it]
triggers:
  - "[keyword that should trigger loading this file]"
edges:
  - target: "context/conventions.md"
    condition: "when verifying this task"
last_updated: ${today}
---

# ${name}

## Context
[What to load or know before starting this task type]

## Steps
[The workflow \u2014 what to do, in what order]

## Gotchas
[The things that go wrong. What to watch out for.]

## Verify
[Checklist to run after completing this task type]

## Debug
[What to check when this task type breaks]

## Update Scaffold
- [ ] Update \`ROUTER.md\` "Current Project State" if what's working/not built has changed
- [ ] Update any \`context/\` files that are now out of date
- [ ] If this is a new task type without a pattern, create one in \`patterns/\` and add to \`INDEX.md\`
`;
  mkdirSync(patternsDir, { recursive: true });
  writeFileSync(patternPath, template, "utf8");
  if (existsSync(indexPath)) {
    const currentIndex = readFileSync(indexPath, "utf8");
    const newlinePrefix = currentIndex.length === 0 || currentIndex.endsWith("\n") ? "" : "\n";
    const entry = `${newlinePrefix}| [${name}.md](${name}.md) | [description] |
`;
    appendFileSync(indexPath, entry, "utf8");
  }
  console.log(chalk.green(`\u2713 Created pattern ${name}.md`));
  console.log(chalk.dim(`  Added entry to patterns/INDEX.md`));
  console.log(chalk.yellow(`! Remember to edit patterns/INDEX.md and replace [description] with a real use case.`));
}
function rebuildPatternIndex(config) {
  const patternsDir = join(config.scaffoldRoot, "patterns");
  const indexPath = join(patternsDir, "INDEX.md");
  mkdirSync(patternsDir, { recursive: true });
  const entries = existsSync(patternsDir) ? readdirSync(patternsDir).filter((file) => file.endsWith(".md") && file !== "INDEX.md" && file !== "README.md").map((file) => `| [${file}](${file}) | [description] |`).sort((a, b) => a.localeCompare(b)) : [];
  const content = `${INDEX_HEADER}${entries.length ? `${entries.join("\n")}
` : ""}`;
  writeIfChanged(indexPath, content);
  return {
    file: "patterns/INDEX.md",
    entries
  };
}

export {
  runPatternAdd,
  rebuildPatternIndex
};
//# sourceMappingURL=chunk-3HS3FYZ2.js.map