# Setup — Populate This Scaffold

This file contains the prompts to populate the scaffold. It is NOT the dev environment setup — for that, see `context/setup.md` after population.

This scaffold is currently empty. Follow the steps below to populate it for your project.

## Recommended: Use setup.sh

```bash
.cai/setup.sh
```

The script handles everything automatically:
1. Detects your project state (existing codebase, fresh project, or partial)
2. Asks which AI tool you use and copies the right config file
3. Pre-scans your codebase with `cai init` to build a structured brief (~5-8k tokens vs ~50k from AI exploration)
4. Builds and runs the population prompt — or prints it for manual paste

If you want to populate manually instead, use the prompts below.

## Detecting Your State

**Existing codebase?** Follow Option A.
**Fresh project, nothing built yet?** Follow Option B.
**Partially built?** Follow Option A — the agent will flag empty slots it cannot fill yet.

---

## Option A — Existing Codebase

Paste the following prompt into your agent:

---

**SETUP PROMPT — copy everything between the lines:**

```
Populate the AI context scaffold for this repository. Scaffold files are in the repository root.

<constraints>
- Every file path you write must be one you verified by reading it — broken paths corrupt cross-references for downstream agents
- Write only content derived from what you actually read — no generic examples, invented structures, or assumed conventions
- Write each file completely — partial output causes downstream agents to lose context they depend on
- Unresolved slots: write [TO DETERMINE] and state what is needed in one line — a flag is more useful than a wrong answer
- No system-injected text (timestamps, session info, reminders) in any scaffold file
</constraints>

Read these files in order before doing anything else:
1. ROUTER.md
2. context/architecture.md — annotation comments define what belongs there
3. context/stack.md
4. context/conventions.md
5. context/decisions.md
6. context/setup.md

Then explore the codebase:
- Identify the main entry point(s) and read them
- Read the top-level folder structure
- Read 2–3 representative files from each major layer
- Read any README or existing documentation

Before writing any context/ file, briefly list what you found in the codebase that maps to
its slots. Then write the file based on that.

Fill context/ files in this order: architecture.md → stack.md → conventions.md → decisions.md → setup.md
Follow annotation length guidance strictly. Use actual names, paths, and commands from this codebase.

Domain files: if a domain is too deep to summarize in a few lines of architecture.md without
losing substance, create context/<domain>.md with YAML frontmatter: name, description,
triggers, edges, last_updated. Only for domains with genuine depth.

Update ROUTER.md: fill Current Project State; add routing rows for any domain files created.
Update AGENTS.md: project name, one-line description, non-negotiables, commands.

Read patterns/README.md. Generate 3–5 patterns:
- 1–2 for the most frequently repeated developer task
- 1–2 for integrations with non-obvious failure modes
- 1 debug pattern for the most common failure boundary

For each pattern: quote the relevant code excerpt first to anchor it, then write the pattern.
Name files after the task (e.g., add-endpoint.md).

Update patterns/INDEX.md: one row per pattern file. Multi-section patterns: one row per
task section with anchor links (see INDEX.md annotation for format).

For every file in context/ and patterns/ — including files you did not write — verify the
edges array in YAML frontmatter is present and complete.
Edge format: { path: "relative/path.md", condition: "when to follow this edge" }
- Every context/ file: minimum 2 outgoing edges
- Every pattern file: minimum 1 edge to its relevant context file
- Bidirectional: if A → B, B → A must also exist
- Relative paths only

Report when done:
- Each file written or updated — one line per file stating what changed
- Any [TO DETERMINE] slots and what would resolve them
- Any patterns where you could not verify a file path from code you read
```

---

## Option B — Fresh Project

Paste the following prompt into your agent:

---

**SETUP PROMPT — copy everything between the lines:**

```
Populate the AI context scaffold for a project that has not been built yet.
Scaffold files are in the repository root.

<constraints>
- Ask questions one at a time — wait for my answer before continuing. Never batch questions.
- Write only content derived from my answers — flag anything unresolved rather than guessing
- Unresolved slots: write [TO BE DETERMINED] and state in one line what must be decided first
- No system-injected text in any scaffold file
</constraints>

Read these files before starting:
1. ROUTER.md
2. All files in context/ — annotation comments define what belongs in each

Ask me these questions one at a time:

1. What does this project do? (one sentence — factual description, not a tagline)
2. What must never happen in this codebase? (hard rules, not preferences)
3. What is the tech stack? (language, framework, database, key libraries)
4. Why this stack and not alternatives?
5. How do the major pieces connect? Walk through a typical request or action end to end.
6. Which patterns must be enforced from day one?
7. What are you deliberately not building or using?

After I have answered all seven questions, briefly summarize your understanding of the project
in 3–4 lines before writing anything. I will confirm or correct before you proceed.

Then fill context/ files in this order: architecture.md → stack.md → conventions.md → decisions.md → setup.md

Domain files: create context/<domain>.md for any domain too deep for architecture.md.
Mark all unknowns: [TO BE DETERMINED — populate after first implementation].

Update ROUTER.md: current state = "new project". Add rows for any domain files.
Update AGENTS.md: project name, description, non-negotiables, commands.

Read patterns/README.md. Generate 2–3 patterns for the most obvious first tasks for this stack.
Mark unverifiable details: [VERIFY AFTER FIRST IMPLEMENTATION].
Update patterns/INDEX.md with one row per pattern file.

For every file in context/ and patterns/: verify the edges array is complete.
- Every context/ file: minimum 2 outgoing edges
- Every pattern file: minimum 1 edge to its relevant context file
- Bidirectional: if A → B, add B → A
- Relative paths only

No system-injected text in any scaffold file.
```

---

## After Setup

**Verify** by starting a fresh session and asking your agent:
"Read `.cai/ROUTER.md` and tell me what you now know about this project."

A well-populated scaffold should give the agent enough to:
- Describe the architecture without looking at code
- Name the non-negotiable conventions
- Know which files to load for any given task type
- Know which patterns exist for common task types

## Keeping It Fresh

Once the scaffold is populated, use these to keep it aligned with your codebase:

- **`cai check`** — detect drift (zero tokens, zero AI)
- **`.cai/sync.sh`** — interactive drift check + targeted or full resync
- **`cai watch`** — auto drift score after every commit
