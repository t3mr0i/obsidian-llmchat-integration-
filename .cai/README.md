<div align="center">

<img src="https://cdn.jsdelivr.net/npm/@temroi/cai@latest/mascot/cai-mascot.svg" alt="CAI" width="80">

# CAI

**The local-first harness for AI coding agents.**

Catches drift before Claude hallucinates. Verifies the agent's work after every stop. Learns the patterns you use over and over. Notices the corrections you give twice. Works with Claude Code, Cursor, Copilot, and OpenCode.

[![npm version](https://img.shields.io/npm/v/@temroi/cai.svg)](https://www.npmjs.com/package/@temroi/cai)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

---

## The problem most AI tools ignore

Your AI setup is **static**. You write `CLAUDE.md` once, the AI reads it on every request, and that's it. When the code changes, the docs drift. When you correct the AI, the correction is forgotten next session. When you do the same task five times, you write the prompt from scratch every time.

```
CLAUDE.md (3,800 tokens, loaded every request)
  "Run tests with: npm run test:unit"     <- script renamed to `npm test`
  "Auth uses Passport.js"                 <- migrated to Keycloak
  "Entry point: src/index.ts"             <- moved to src/server.ts
```

The file grows, nobody audits it, and the AI gets worse the more you add.

## What CAI does differently

CAI is a **harness** for your AI coding agent — the term [OpenAI uses](https://openai.com/index/harness-engineering/) for the layer of guides, sensors, and back-pressure that wraps a model and turns it into a usable engineer. Most setups give the model a CLAUDE.md and call it done. CAI gives the model four feedback loops that close themselves over time:

| Loop | Type | What it does | Command |
|---|---|---|---|
| **Code → Scaffold** | sensor (computational) | Detects drift between docs and reality in ms, no AI calls | `cai check` |
| **Agent → Build** | sensor (back-pressure) | Runs typecheck/build/drift after every agent stop, re-engages on failure | `cai verify` |
| **Scaffold → AI** | sensor (telemetry) | Tracks which docs Claude actually queries, weights drift accordingly | `cai stats` |
| **AI → You** | sensor (semantic) | Records your corrections, surfaces the ones you give over and over | `cai learn review` |
| **You → Code** | guide (generated) | Watches your commits, suggests patterns for the tasks you do repeatedly | `cai pattern recurring` |

Each loop has a history view so you can see if things are getting better: `cai check --history` shows the drift trend, `cai stats` shows query telemetry, `cai learn watch` lives-tails new corrections, `cai pattern library --history <name>` shows pattern versions.

Local-first by design. No accounts. No upload. Works offline. The whole harness lives in your repo and your home folder.

Plus a global pattern library (`~/.cai/`) so good patterns from one project show up in the next.

```bash
$ cai check
 Score: 65/100  ·  Hot-path weighted: 42/100

 error   path       src/index.ts does not exist
   history          renamed → src/server.ts in a3f8b2c (3 days ago) refactor: split server entry
 error   command    npm run test:unit — script not found in package.json
 warning dependency Passport.js not in package.json (found: keycloak-js)

$ cai fix
 Fixed 2 issues: synced tool configs, rebuilt pattern index
 1 issue requires AI review -> run: cai sync
```

No AI calls. No network. No tokens. Just file system + git checks, in milliseconds.

```bash
$ cai check
 Score: 65/100

 error   path       src/index.ts does not exist (now src/server.ts)
 error   command    npm run test:unit — script not found in package.json
 warning dependency Passport.js not in package.json (found: keycloak-js)

$ cai fix
 Fixed 2 issues: synced tool configs, rebuilt pattern index
 1 issue requires AI review -> run: cai sync
```

No AI calls. No network. No tokens. Just file system checks, in milliseconds.

<div align="center">
<img src="https://cdn.jsdelivr.net/npm/@temroi/cai@latest/screenshots/cai-check.jpg" alt="cai check output" width="600">
</div>

## What you actually get

CAI is not a tool that pays off on day one. It's a tool that pays off in week three, when the loops have collected enough data to be useful. Here's what happens then:

- **You don't write patterns from scratch.** `cai pattern recurring` looks at your last 50 commits, finds the task types you do over and over, and drafts pattern files with the actual recurring file paths already filled in. You add the steps; the boilerplate is done.
- **Patterns travel between projects.** `cai pattern share <name>` promotes a local pattern to your global library. In the next project, `cai pattern suggest` ranks library patterns by stack match and shared dependencies.
- **Claude stops making the same mistake twice.** Recording is enabled by default — `cai learn review` clusters the recurring corrections you give Claude ("you said 'no emojis' four times in two weeks, want to make it a CLAUDE.md rule?"). All local, run `cai learn forget` any time to wipe.
- **Drift reports tell you why, not just what.** When a path goes missing, `cai check` walks git history to find the commit that deleted or renamed it. Less detective work, more fixing.
- **Drift score reflects what matters.** Files Claude queries 50 times a week count more than files nobody reads. Fix the hot ones first.

None of this is automatic. CAI suggests, you decide. The day CAI starts writing patterns and rules without asking, it becomes another static tool that drifts from reality.

## Quick start

```bash
npm install -g @temroi/cai
cai setup
```

That's it. `cai setup` scans the project, writes the scaffold, registers the MCP server with Claude Code, and creates path-scoped rules. Template comments are stripped — they guide initial setup but cost ~2,500 tokens if left in place.

## What gets created

```
your-project/
├── CLAUDE.md                   <- navigation + essentials (~200 tokens)
├── .claude/
│   └── rules/
│       ├── frontend.md         <- loads only for src/components/**
│       ├── api.md              <- loads only for src/api/**
│       └── testing.md          <- loads only for test/**
└── .cai/
    ├── AGENTS.md               <- core project facts
    ├── context/
    │   ├── architecture.md     <- how components connect
    │   ├── stack.md            <- technologies, versions, libraries
    │   ├── conventions.md      <- naming, structure, patterns
    │   ├── decisions.md        <- architectural choice log
    │   └── setup.md            <- how to run locally
    ├── codex/
    │   ├── modules.md          <- export index per file (auto-generated)
    │   └── repo-brief.md       <- dependency graph (auto-generated)
    └── patterns/
        └── *.md                <- task guides with steps + gotchas
```

## Token cost

A monolithic `CLAUDE.md` costs 2,000–5,000 tokens on every request. Path-scoped rules cost 200–400 when the matching files are in play. Nothing otherwise. MCP queries run 50–200 tokens each.

## Drift detection

`cai check` compares the scaffold against the real codebase and outputs a score.

| Checker | What it catches |
|---|---|
| `path` | File paths that no longer exist |
| `command` | Scripts referencing removed npm/yarn/make targets |
| `dependency` | Libraries claimed in docs but absent from the manifest |
| `cross-file` | Same dependency, different versions across files |
| `staleness` | Docs not updated in 30+ days or 50+ commits |
| `tool-configs` | CLAUDE.md and .cursorrules out of sync |
| `index-sync` | Pattern index doesn't match actual pattern files |

Score is 100 minus deductions. `cai check --quiet` exits non-zero on any drift — drop it in CI and forget about it.

`cai fix` handles what it can without AI: re-syncing config files, rebuilding the pattern index, normalizing paths. `cai sync` takes the rest — builds a targeted prompt per drifted file, passes it to Claude or any model you have. Source files are not touched.

<div align="center">
<img src="https://cdn.jsdelivr.net/npm/@temroi/cai@latest/screenshots/cai-sync.jpg" alt="cai sync output" width="600">
</div>

## MCP server

Registered automatically during `cai setup`. Claude queries what it needs instead of loading full docs:

```
Claude: search("auth flow")
CAI:    context/architecture.md:42 — "Auth uses Keycloak OIDC..."
```

Tools: `cai_list_context`, `cai_get_context` (with headings/summary/section modes), `cai_search`, `cai_check_drift`. Projects with workspaces or npm scripts get additional tools automatically.

Manual registration: `claude mcp add cai -- cai mcp start`

## Hot-path awareness

Every MCP query is logged locally to `.cai/.cache/queries.jsonl` (gitignored). CAI uses this to learn which context files Claude actually reads — and weights drift accordingly.

```bash
$ cai stats
  Top tools
    cai_get_context              47
    cai_search                   12

  Hot files
    context/architecture.md      18 hits  ~7,200 tokens
    context/conventions.md        9 hits  ~3,400 tokens
    patterns/add-endpoint.md      6 hits  ~2,100 tokens
```

`cai check` adds a *Hot-path weighted score* alongside the raw drift score. A 5-point drift on a file Claude queries 50 times a week hurts more than a 5-point drift on a file nobody touches. `cai health` flags hot files with active drift as `⚠ drift` so you know what to fix first.

When a file goes missing, `cai check` shows *why* — it walks git history to find the commit that deleted or renamed it:

```
src/index.ts
  ✖ Referenced path does not exist: src/index.ts
     history        renamed → src/server.ts in a3f8b2c (3 days ago) refactor: split server entry
```

Opt out with `CAI_NO_TELEMETRY=1` if you don't want the local query log.

## Back-pressure: `cai verify`

The single biggest gap in most agent setups: nothing checks the agent's output before it declares "done". `cai verify` runs the cheap pre-commit checks — typecheck, build, drift — and refuses to lie about the result.

```bash
$ cai verify

  cai verify

  ✔ typecheck   npx tsc --noEmit                  (1.2s)
  ✔ build       npm run build                     (0.6s)
  ✔ drift       cai check --skip staleness        (0.3s)

  ✓ all checks passed  (2.1s total)
```

`cai setup` and `cai update` install it as a Claude Code Stop hook automatically — the agent re-engages itself whenever verification fails. If you upgraded an existing project from an older CAI version, run `cai update` once to pick up the new hook. Or install manually:

```bash
$ cai verify-install-hook
✓ cai verify Stop hook installed
  After every agent stop, Claude Code will run cai verify.
  If verification fails, the agent re-engages to fix the issue.
```

Auto-detects what your project actually has — no config file. Skips steps that don't apply (no tsconfig → no typecheck, no build script → no build). Hard 2-minute per-step timeout so a runaway script can't hang the hook. Truncates failure output before passing it back to the agent so context budget stays reasonable.

## Drift trends

Every `cai check` quietly appends its score to `.cai/.cache/drift-history.jsonl`. Run `cai check --history` to see whether things are getting better or worse:

```bash
$ cai check --history

  Drift score history — 17 runs

  current    72/100  ▲ +5
  best       88/100
  worst      54/100
  average    69/100

  trend      ▃▄▅▄▆▇▆▅▆▇▆▅▇▇▆▆▆▇  (last 30 runs)

  Recent runs
    2026-04-07 12:14   72/65    3E 4W
    2026-04-07 09:02   67       4E 5W
    2026-04-06 18:30   65       5E 4W
```

Same opt-out: `CAI_NO_TELEMETRY=1`.

## Session context as a Claude Code hook

`cai session --auto` is a hook-mode counterpart to `cai session`. Instead of generating a copy-to-clipboard prompt, it runs on every `UserPromptSubmit` and prepends a tiny context block (uncommitted files, recent commits, hot files, latest drift) to your message — automatically.

```bash
$ cai session-install-hook
✓ cai session --auto hook installed
  Each user prompt now gets a tiny context block.
```

Hard performance budget (<100ms) and bulletproof: if anything goes wrong (no scaffold, no git, broken cache), it silently emits an empty hook response and never blocks your prompt. Remove with `cai session-uninstall-hook`.

## Pattern library — your own patterns, across projects

Every time you write a good pattern in one project, you can promote it to a global library shared across all your repos:

```bash
$ cai pattern share add-endpoint
✓ Shared add-endpoint to library
  hash: a3f8b2c91d4e
  /Users/you/.cai

$ cd ../other-project
$ cai pattern suggest

  Suggested patterns for this project — 2 matches

  a3f8b2c91d4e  add-endpoint                  score 5
                Add a REST endpoint with validation
                → same stack (package.json)  ·  shared deps: express, zod  ·  recent (2d ago)

  Install one with: cai pattern install <hash|name>
```

Matching is heuristic: shared manifest type (Node/Python/Go/Rust), overlapping top-level dependencies, recency. Library lives at `~/.cai/` by default — override with `CAI_HOME`.

### Sync across devices

Point `CAI_HOME` at any folder your cloud provider syncs and the library follows you between machines:

```bash
# Dropbox
export CAI_HOME=~/Dropbox/.cai

# iCloud Drive
export CAI_HOME=~/Library/Mobile\ Documents/com~apple~CloudDocs/.cai

# Syncthing / Resilio / Git — any synced folder works
export CAI_HOME=~/Sync/.cai
```

Patterns are content-hashed, so two machines sharing the same pattern at the same time never collide. Run `cai pattern library --where` for the live setup snippet.

## Auto-pattern from commit history

You don't have to write patterns manually. `cai pattern recurring` walks the last 50 commits, classifies each one, and finds task types you do over and over. If you added 3+ API endpoints in the last month, that's a pattern worth capturing.

```bash
$ cai pattern recurring

  Recurring task types — 2 clusters

  api-endpoint         5×  last seen 2026-04-05
    recurring files: src/api/router.ts, src/api/types.ts
  data-model           3×  last seen 2026-04-03
    recurring files: prisma/schema.prisma, src/db/index.ts

  Run with --write to draft pattern files for each cluster.
```

`cai pattern recurring --write` creates draft pattern files with the actual recurring file paths and recent commit subjects already filled in. You review and refine — the AI starts from a real workflow, not a blank template.

## Learn from your corrections

Claude makes the same mistake twice? You shouldn't have to correct it twice. `cai learn` records your prompts (locally, never sent anywhere) and finds recurring corrections you've made.

**Recording is enabled by default** as part of `cai setup` — the `UserPromptSubmit` hook is wired up, the log file is created in `.cai/.cache/sessions.jsonl` (gitignored), and from your next Claude Code session everything is captured. Run `cai learn forget` any time to wipe it, or `cai learn disable` to stop recording without deleting history.

```bash
# After a week or two of normal Claude Code usage:
$ cai learn review

  Session review — last 14 days
  127 prompts · 18 look like corrections · 3 recurring

  Recurring corrections — consider adding these to CLAUDE.md:

  a3f8b2  4×  no emojis  [negation]
            → suggested rule: - no emojis
  c7e1d4  3×  stop adding comments to existing code  [negation]
            → suggested rule: - stop adding comments to existing code
  9b2f5a  2×  use the existing helper instead of duplicating  [reinstruct]
            → suggested rule: - use the existing helper instead of duplicating

  Apply one with: cai learn write-rule <id>

$ cai learn write-rule a3f8b2
✓ Added to CLAUDE.md
  rule: - no emojis
  cluster: 4× "no emojis"
```

`cai learn write-rule` appends the rule under a `<!-- cai:learn-start --> ... <!-- cai:learn-end -->` section in CLAUDE.md, so subsequent rules stack cleanly without duplicating headers.

**Per-stack filtering.** A "no comments" rule might be right for one Python project and wrong for the next Go project. `cai learn review --stack <type>` filters corrections to those given in projects with that manifest type. `--stack current` resolves to the current project's stack automatically.

Privacy:
- Enabled by default — but **everything stays local**. The log lives in `.cai/.cache/sessions.jsonl`, the directory is gitignored, nothing ever leaves your machine.
- `cai learn disable` stops recording while keeping the existing log.
- `cai learn forget` deletes the log irreversibly.
- `cai learn status` shows what's recorded right now.

If you don't want recording at all, run `cai learn disable && cai learn forget` once after `cai setup` and the cache is clean.

## Code map

`cai codex` generates a compact export index — every exported function, class, and type across your codebase. Uses tree-sitter when available (TypeScript, Python, Go, Rust), falls back to regex for JS/TS. Auto-refreshes when source files change.

## Session context

`cai session` reads the current git diff, selects the most relevant context files using frontmatter triggers and dependency edges, auto-refreshes the code map if stale, and copies a ready-to-paste prompt to the clipboard. One command, full context.

## Where rules belong

Not all rules should be path-scoped. Claude Code loads path-scoped rules only when it **reads** a matching file — not when creating or editing without reading first.

| Rule type | Where | Why |
|---|---|---|
| Hard constraints | `CLAUDE.md` | Always loaded, survives compaction |
| Key conventions | `CLAUDE.md` | Loaded on every request |
| File-specific patterns | `.claude/rules/` | Only loaded when relevant |
| Architecture docs | `.cai/context/` via MCP | Queried on-demand, cheapest option |
| Task guides | `.cai/patterns/` | Loaded as rules when matching |

Keep `CLAUDE.md` under 300 lines. Claude has ~150 instruction slots after its system prompt — exceeding this dilutes compliance.

## Works with

| Tool | Config |
|---|---|
| Claude Code | Path-scoped rules + MCP server + skills |
| Cursor | `.cursor/rules/cai.mdc` + `.cursorrules` |
| Windsurf | `.windsurfrules` |
| GitHub Copilot | `.github/copilot-instructions.md` + `.agent.md` |
| OpenCode | `AGENTS.md` |

`cai sync-configs` pushes changes to all of them.

## Language support

Manifest parsing covers Node.js, Python, Go, Rust, Java, and Ruby. Code map generation (tree-sitter) supports TypeScript, JavaScript, Python, Go, and Rust.

## All commands

| Command | |
|---|---|
| `cai setup` | Scaffold + MCP + path-scoped rules |
| `cai check` | Drift report with score |
| `cai check --quiet` | Exit code only — for CI |
| `cai fix` | Deterministic repairs |
| `cai fix --dry-run` | Preview repairs |
| `cai sync` | AI-assisted doc updates |
| `cai health` | Token budget, freshness, score, hot files |
| `cai stats` | MCP query telemetry — hot files and tools |
| `cai learn review` | Find recurring corrections in your recorded prompts (default: on) |
| `cai learn review --stack current` | Same, scoped to the current project's tech stack |
| `cai learn watch` | Live-tail new corrections as they happen |
| `cai learn write-rule <id>` | Append a recurring correction as a CLAUDE.md rule |
| `cai learn status` | Show recording state and current log size |
| `cai learn disable` | Stop recording (keeps existing log) |
| `cai learn forget` | Wipe all recorded prompts |
| `cai learn enable` | Re-enable recording after disable |
| `cai learn install-hook` | (Re)install the Claude Code UserPromptSubmit hook |
| `cai check --history` | Drift score trend over time with sparkline |
| `cai verify` | Run typecheck + build + drift (back-pressure for AI agents) |
| `cai verify-install-hook` | Install Stop hook so Claude Code re-engages on failure |
| `cai verify-uninstall-hook` | Remove the Stop hook |
| `cai session --auto` | Hook-mode session context for Claude Code |
| `cai session-install-hook` | Install the UserPromptSubmit hook for `cai session --auto` |
| `cai session-uninstall-hook` | Remove the UserPromptSubmit hook |
| `cai pattern share <name>` | Promote a pattern to your global library (versioned) |
| `cai pattern library` | List patterns in your global library |
| `cai pattern library --where` | Show library path and how to sync across devices |
| `cai pattern library --history <name>` | Show all versions of a specific pattern |
| `cai pattern suggest` | Suggest library patterns matching this project |
| `cai pattern install <hash|name>` | Install a library pattern locally |
| `cai pattern recurring` | Find recurring task types in commit history |
| `cai pattern recurring --write` | Draft pattern files for recurring tasks |
| `cai session` | Session prompt from git state |
| `cai codex` | Generate code map + dependency graph |
| `cai watch` | Post-commit drift hook |
| `cai watch --auto-fix` | Auto-fix after every commit |
| `cai pattern capture` | Draft a pattern from the last commit |
| `cai visualize` | Scaffold graph in the browser |
| `cai doctor` | Diagnose scaffold and manifests |
| `cai update` | Update CAI, keep your content |
| `cai menu` | Interactive guided menu |

## Updating

```bash
npm update -g @temroi/cai
cai update
```

`context/`, `patterns/`, and `AGENTS.md` are not touched.

## License

[MIT](LICENSE)
