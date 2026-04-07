<div align="center">

<img src="https://cdn.jsdelivr.net/npm/@temroi/cai@latest/mascot/cai-mascot.svg" alt="CAI" width="80">

# CAI

**Your AI reads outdated docs and hallucinates. CAI catches that.**

Per-file context for Claude, Cursor, Copilot, and OpenCode — with drift detection that runs in milliseconds.

[![npm version](https://img.shields.io/npm/v/@temroi/cai.svg)](https://www.npmjs.com/package/@temroi/cai)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

---

## What happens without CAI

Your `CLAUDE.md` says "run `npm run test:unit`" — but that script was renamed two months ago. It says "auth uses Passport.js" — you migrated to Keycloak last sprint. The AI doesn't know. It hallucinates based on what the docs say, not what the code does.

```
CLAUDE.md (3,800 tokens, loaded every request)
  "Run tests with: npm run test:unit"     <- script renamed to `npm test`
  "Auth uses Passport.js"                 <- migrated to Keycloak
  "Entry point: src/index.ts"             <- moved to src/server.ts
```

The file grows, nobody audits it, and the AI gets worse the more you add.

## What CAI does

CAI keeps a `.cai/` scaffold — architecture, conventions, decisions, patterns — and routes each piece to the right tool at the right time. Path-scoped rules load only when the matching files are in play. An MCP server answers on-demand queries. And `cai check` catches drift before the AI ever sees it.

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
| `cai health` | Token budget, freshness, score |
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
