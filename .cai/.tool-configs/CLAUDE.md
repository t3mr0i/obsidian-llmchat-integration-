---
name: agents
description: Always-loaded project anchor. Contains project identity, non-negotiables, key conventions, commands, and navigation pointer. This file survives context compaction — put critical rules here.
last_updated: [YYYY-MM-DD]
---

# [Project Name]

## What This Is
<!-- One sentence. What does this project do?
     Not a tagline — a factual description.
     Example: "A REST API for managing inventory across multiple warehouse locations."

     IMPORTANT: Research shows that generic architecture descriptions in context files
     actually WORSEN AI performance by 3% while increasing costs by 20%.
     Only include details the AI cannot infer from reading the code:
     - Custom build commands, non-standard tooling
     - Project-specific conventions that differ from language defaults
     - Hard constraints (security, compliance, deployment targets)
     DO NOT include: folder structure, dependency lists, or architecture overviews.
     The AI can read those from the code itself. -->

## Non-Negotiables
<!-- Hard rules you must never violate. Not preferences — rules.
     If broken, they cause real damage to the codebase.
     3-5 items. More than 5 means the list has not been prioritised.
     Use imperative language ("Never...", "Always...", "Do not...").
     Example:
     - Never write database queries outside of the repository layer.
     - Never commit secrets or API keys.
     - Always handle errors explicitly — no silent failures. -->

## Key Conventions
<!-- 2-4 rules that apply to ALL code in this project.
     These duplicate the most critical items from .cai/context/conventions.md.
     Why here: path-scoped rules only load when reading matching files.
     Rules here load on every request and survive context compaction.
     Example:
     - Use snake_case for functions, PascalCase for classes.
     - All public functions must have JSDoc comments.
     - Errors must be typed — never throw raw strings. -->

## Commands
<!-- Exact commands to work on this project. No placeholders.
     Example:
     - Dev: `npm run dev`
     - Test: `npm test`
     - Build: `npm run build` -->

## After Every Task
After completing any task: update `.cai/ROUTER.md` project state and any `.cai/` context files that are now out of date. If no pattern existed for this task type, create one in `.cai/patterns/`.

## Compact Instructions
Preserve across compaction: all Non-Negotiables, all Key Conventions, all Commands, and the navigation pointer to `.cai/ROUTER.md`.

## Navigation
Read `.cai/ROUTER.md` at the start of every session before doing anything else.
