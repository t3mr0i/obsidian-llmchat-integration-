---
name: agents
description: Always-loaded project anchor. Read this first. Contains project identity, non-negotiables, commands, and pointer to ROUTER.md for full context.
last_updated: 2026-04-03
---

# CAI — Coherence AI

## What This Is
A CLI and MCP server that keeps AI context files (.cai/ scaffold) in sync with the actual codebase — deterministic drift detection, path-scoped rule generation, and multi-tool config sync for Claude, Cursor, Copilot, and OpenCode.

## Non-Negotiables
- Drift detection must stay deterministic — no AI calls, no network, millisecond-level runtime.
- Never overwrite user content outside of `<!-- cai:start -->` / `<!-- cai:end -->` markers.
- All auto-fix operations must be idempotent — running twice produces the same result.
- Strict TypeScript (`strict: true`) — no `any` in core logic, no implicit coercion.
- Tests must pass before every release: `npm test` (vitest, 144+ tests).
- ESM only — no CommonJS fallbacks, no dual-build.
- Node >=20 required.

## Commands
- Build: `npm run build` (tsup)
- Dev: `npm run dev` (tsup --watch)
- Test: `npm test` (vitest run)
- Test watch: `npm run test:watch`
- Typecheck: `npm run typecheck` (tsc --noEmit)

## After Every Task
After completing any task: update `.cai/ROUTER.md` project state and any `.cai/` files that are now out of date. If no pattern existed for the task you just completed, create one in `.cai/patterns/`.

## Compact Instructions
Preserve across compaction:
- All items from Non-Negotiables above
- All items from Commands above
- The navigation pointer to `.cai/ROUTER.md`
- Any active task context or plan the user is working on

## AI Response Style
- Keep responses concise. Lead with the answer, not the reasoning.
- No trailing summaries of what was just done.
- No restating the user's question.
- Use short sentences. If it fits in one line, don't use three.
- Only add comments to code where the logic is non-obvious.

## Navigation
At the start of every session, read `.cai/ROUTER.md` before doing anything else.
For full project context, patterns, and task guidance — everything is there.
