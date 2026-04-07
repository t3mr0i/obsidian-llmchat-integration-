#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# cai setup — detect project state, copy tool config, populate scaffold
# ─────────────────────────────────────────────────────────────

# Parse flags
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --help|-h)
      echo "Usage: .cai/setup.sh [--dry-run]"
      echo ""
      echo "First-time setup — detect project state, copy tool config, populate scaffold."
      echo ""
      echo "Options:"
      echo "  --dry-run   Show what would happen without making changes"
      echo "  --help      Show this help"
      exit 0
      ;;
  esac
done

# Resolve the directory where this script (and the scaffold files) live.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The target project root is the current working directory.
PROJECT_DIR="$(pwd)"

# Don't run inside the cai repo itself.
if [ "$SCRIPT_DIR" = "$PROJECT_DIR" ]; then
  echo "Error: run this script from your project root, not from inside the cai repo."
  echo ""
  echo "Usage:"
  echo "  cd /path/to/your/project"
  echo "  .cai/setup.sh"
  exit 1
fi

# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color
# Royal blue #1944F1 = RGB(25, 68, 241)
ROYAL='\033[38;2;25;68;241m'

info()  { printf "${BLUE}→${NC} %s\n" "$1"; }
ok()    { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}!${NC} %s\n" "$1"; }
header(){ printf "\n${BOLD}%s${NC}\n" "$1"; }

# Spinner for background tasks
spin() {
  local pid=$1 msg=$2
  local frames=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
  local i=0
  while kill -0 "$pid" 2>/dev/null; do
    printf "\r  ${BLUE}${frames[$i]}${NC} %s" "$msg"
    i=$(( (i + 1) % ${#frames[@]} ))
    sleep 0.1
  done
  printf "\r\033[2K"  # clear the spinner line
}

banner() {
  printf "\n"
  printf "${ROYAL} ██████╗  █████╗ ██╗${NC}\n"
  printf "${ROYAL}██╔════╝ ██╔══██╗██║${NC}\n"
  printf "${ROYAL}██║      ███████║██║${NC}\n"
  printf "${ROYAL}██║      ██╔══██║██║${NC}\n"
  printf "${ROYAL}╚██████╗ ██║  ██║██║${NC}\n"
  printf "${ROYAL} ╚═════╝ ╚═╝  ╚═╝╚═╝${NC}\n"
  printf "\n"
  printf "               ${BOLD}persistent ai project memory${NC}\n"
}

# Copy a file safely. If the destination exists, merge CAI sections into it
# instead of overwriting — the user's existing content is preserved.
safe_copy() {
  local src="$1" dest="$2"
  if [ "$DRY_RUN" -eq 1 ]; then
    if [ -f "$dest" ]; then
      warn "(dry run) Would merge CAI sections into $dest"
    else
      ok "(dry run) Would copy $dest"
    fi
    return 0
  fi
  if [ -f "$dest" ]; then
    # Merge: append CAI-specific sections that don't already exist
    merge_cai_sections "$src" "$dest"
    return 0
  fi
  cp "$src" "$dest"
  ok "Copied $dest"
}

# Merge CAI sections into an existing file without losing user content.
# Appends sections from the source that are not already present in the destination.
merge_cai_sections() {
  local src="$1" dest="$2"
  local added=0

  # Extract section headers from the CAI template (## headings)
  while IFS= read -r heading; do
    # Check if this section already exists in the user's file
    if ! grep -qF "$heading" "$dest" 2>/dev/null; then
      # Extract the full section (from heading to next ## or EOF)
      local section
      section=$(awk -v h="$heading" '
        BEGIN { found=0 }
        $0 == h { found=1 }
        found && /^## / && $0 != h { found=0 }
        found { print }
      ' "$src")
      if [ -n "$section" ]; then
        printf "\n%s\n" "$section" >> "$dest"
        added=$((added + 1))
      fi
    fi
  done < <(grep '^## ' "$src")

  if [ "$added" -gt 0 ]; then
    ok "Merged $added CAI section(s) into $dest (existing content preserved)"
  else
    ok "$dest already has all CAI sections — no changes needed"
  fi
}

# ─────────────────────────────────────────────────────────────
# Banner
# ─────────────────────────────────────────────────────────────

banner
echo ""
if [ "$DRY_RUN" -eq 1 ]; then
  warn "DRY RUN — no files will be created or modified"
  echo ""
fi

# ─────────────────────────────────────────────────────────────
# Step 1 — Build CLI engine (if Node available)
# ─────────────────────────────────────────────────────────────

CONTEXT_CMD=""

# Detect package manager
detect_pkg_manager() {
  if command -v pnpm &>/dev/null; then echo "pnpm"
  elif command -v yarn &>/dev/null; then echo "yarn"
  elif command -v npm &>/dev/null; then echo "npm"
  else echo ""
  fi
}

# Check for global cai command first
if command -v cai &>/dev/null; then
  CONTEXT_CMD="cai"
  ok "cai CLI found"
elif command -v node &>/dev/null; then
  if [ -f "$SCRIPT_DIR/dist/cli.js" ]; then
    CONTEXT_CMD="node $SCRIPT_DIR/dist/cli.js"
    ok "CLI engine ready"
  elif [ -f "$SCRIPT_DIR/package.json" ]; then
    PKG_MGR="$(detect_pkg_manager)"
    if [ -z "$PKG_MGR" ]; then
      warn "No package manager found — CLI features unavailable"
    else
      info "Building cai CLI engine (first-time setup)..."
      BUILD_LOG=$(cd "$SCRIPT_DIR" && $PKG_MGR install 2>&1) || {
        warn "$PKG_MGR install failed — continuing without CLI"
        warn "Run manually: cd .cai && $PKG_MGR install && $PKG_MGR run build"
      }
      if [ -d "$SCRIPT_DIR/node_modules" ]; then
        BUILD_LOG=$(cd "$SCRIPT_DIR" && $PKG_MGR run build 2>&1) || {
          warn "$PKG_MGR build failed — continuing without CLI"
          warn "Run manually: cd .cai && $PKG_MGR run build"
        }
      fi
      if [ -f "$SCRIPT_DIR/dist/cli.js" ]; then
        CONTEXT_CMD="node $SCRIPT_DIR/dist/cli.js"
        ok "CLI engine built — drift detection, pre-analysis, and targeted sync ready"
      fi
    fi
  fi
else
  warn "Node.js not found — CLI features unavailable (setup still works)"
fi

echo ""

# ─────────────────────────────────────────────────────────────
# Step 2 — Detect project state
# ─────────────────────────────────────────────────────────────

detect_state() {
  local source_file_count scaffold_populated

  # Count source files (not config/docs)
  source_file_count=$(find "$PROJECT_DIR" -maxdepth 4 \
    -type f \( \
      -name "*.py" -o -name "*.js" -o -name "*.ts" -o -name "*.tsx" \
      -o -name "*.jsx" -o -name "*.go" -o -name "*.rs" -o -name "*.java" \
      -o -name "*.kt" -o -name "*.swift" -o -name "*.rb" -o -name "*.php" \
      -o -name "*.c" -o -name "*.cpp" -o -name "*.cs" -o -name "*.ex" \
      -o -name "*.exs" -o -name "*.zig" -o -name "*.lua" -o -name "*.dart" \
      -o -name "*.scala" -o -name "*.clj" -o -name "*.erl" -o -name "*.hs" \
      -o -name "*.ml" -o -name "*.vue" -o -name "*.svelte" \
    \) \
    ! -path "*/node_modules/*" \
    ! -path "*/.cai/*" \
    ! -path "*/vendor/*" \
    ! -path "*/.git/*" \
    2>/dev/null | wc -l | tr -d ' ')

  # Check if scaffold is already partially populated (annotation comments replaced)
  scaffold_populated=0
  if [ -f "$PROJECT_DIR/.cai/AGENTS.md" ]; then
    if ! grep -q '\[Project Name\]' "$PROJECT_DIR/.cai/AGENTS.md" 2>/dev/null; then
      scaffold_populated=1
    fi
  fi

  if [ "$scaffold_populated" -eq 1 ] && [ "$source_file_count" -gt 0 ]; then
    echo "partial"
  elif [ "$source_file_count" -gt 3 ]; then
    echo "existing"
  else
    echo "fresh"
  fi
}

PROJECT_STATE=$(detect_state)

case "$PROJECT_STATE" in
  existing)
    info "Detected: existing codebase with source files"
    info "Mode: populate scaffold from code"
    ;;
  fresh)
    info "Detected: fresh project (no source files yet)"
    info "Mode: populate scaffold from intent"
    ;;
  partial)
    info "Detected: existing codebase with partially populated scaffold"
    info "Mode: will populate empty slots, skip what's already filled"
    ;;
esac

echo ""

# ─────────────────────────────────────────────────────────────
# Step 3 — Tool config selection (copy to project root)
# ─────────────────────────────────────────────────────────────

header "Which AI tool do you use?"
echo ""
echo "  1) Claude Code"
echo "  2) Cursor"
echo "  3) Windsurf"
echo "  4) GitHub Copilot"
echo "  5) Multiple (select next)"
echo "  6) None / other (skip)"
echo ""
printf "Choice [1-6] (default: 1): "
read -r tool_choice
tool_choice="${tool_choice:-1}"

SELECTED_CLAUDE=0

copy_tool_config() {
  case "$1" in
    1)
      safe_copy "$SCRIPT_DIR/.tool-configs/CLAUDE.md" "$PROJECT_DIR/CLAUDE.md"
      SELECTED_CLAUDE=1
      ;;
    2)
      safe_copy "$SCRIPT_DIR/.tool-configs/.cursorrules" "$PROJECT_DIR/.cursorrules"
      ;;
    3)
      safe_copy "$SCRIPT_DIR/.tool-configs/.windsurfrules" "$PROJECT_DIR/.windsurfrules"
      ;;
    4)
      [ "$DRY_RUN" -eq 0 ] && mkdir -p "$PROJECT_DIR/.github"
      safe_copy "$SCRIPT_DIR/.tool-configs/copilot-instructions.md" "$PROJECT_DIR/.github/copilot-instructions.md"
      ;;
  esac
}

case "$tool_choice" in
  1|2|3|4)
    copy_tool_config "$tool_choice"
    ;;
  5)
    echo ""
    printf "Enter tool numbers separated by spaces (e.g. 1 2 4): "
    read -r multi_choices
    for choice in $multi_choices; do
      copy_tool_config "$choice"
    done
    ;;
  6|"")
    info "Skipped tool config — AGENTS.md in .cai/ works with any tool that can read files"
    ;;
  *)
    warn "Unknown choice, skipping tool config"
    ;;
esac

echo ""

# ─────────────────────────────────────────────────────────────
# Step 4 — Pre-analyze codebase (if CLI available)
# ─────────────────────────────────────────────────────────────

SCANNER_BRIEF=""
if [ "$PROJECT_STATE" != "fresh" ] && [ -n "$CONTEXT_CMD" ]; then
  # Run scanner in background with spinner
  (cd "$PROJECT_DIR" && $CONTEXT_CMD init --json 2>&1 > /tmp/cai_scanner_$$.json) &
  SCANNER_PID=$!
  spin $SCANNER_PID "Scanning codebase..."
  wait $SCANNER_PID 2>/dev/null && SCANNER_BRIEF=$(cat /tmp/cai_scanner_$$.json) || SCANNER_BRIEF=""
  rm -f /tmp/cai_scanner_$$.json
  # If the output looks like an error (not JSON), clear it
  if [ -n "$SCANNER_BRIEF" ] && ! echo "$SCANNER_BRIEF" | head -1 | grep -q '^{'; then
    warn "Scanner error: $(echo "$SCANNER_BRIEF" | head -1)"
    SCANNER_BRIEF=""
  fi

  if [ -n "$SCANNER_BRIEF" ]; then
    ok "Pre-analysis complete — AI will reason from brief instead of exploring (~5-8k tokens vs ~50k)"
  else
    warn "Scanner failed — AI will explore the filesystem directly"
  fi
elif [ "$PROJECT_STATE" != "fresh" ]; then
  warn "No CLI — AI will explore the filesystem directly"
fi

# ─────────────────────────────────────────────────────────────
# Step 5 — Build the setup prompt
# ─────────────────────────────────────────────────────────────

if [ "$PROJECT_STATE" = "fresh" ]; then
  SETUP_PROMPT='Populate the AI context scaffold for a project that has not been built yet.
The scaffold lives in the .cai/ directory.

<constraints>
- Ask questions one at a time — wait for my answer before continuing. Never batch questions.
- Write only content derived from my answers — flag anything unresolved rather than guessing
- Unresolved slots: write [TO BE DETERMINED] and state in one line what must be decided first
- No system-injected text in any scaffold file
</constraints>

Read these files before starting:
1. .cai/ROUTER.md
2. All files in .cai/context/ — annotation comments define what belongs in each

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

Then fill .cai/context/ files in this order: architecture.md → stack.md → conventions.md → decisions.md → setup.md

Domain files: create .cai/context/<domain>.md for any domain too deep for architecture.md.
Mark all unknowns: [TO BE DETERMINED — populate after first implementation].

Update .cai/ROUTER.md: current state = "new project". Add rows for any domain files.
Update .cai/AGENTS.md: project name, description, non-negotiables, commands.

Read .cai/patterns/README.md. Generate 2–3 patterns for the most obvious first tasks for this stack.
Mark unverifiable details: [VERIFY AFTER FIRST IMPLEMENTATION].
Update .cai/patterns/INDEX.md with one row per pattern file.

For every file in .cai/context/ and .cai/patterns/: verify the edges array is complete.
- Every context/ file: minimum 2 outgoing edges
- Every pattern file: minimum 1 edge to its relevant context file
- Bidirectional: if A → B, add B → A
- Relative paths only

No system-injected text in any scaffold file.'
else
  if [ -n "$SCANNER_BRIEF" ]; then
    # Brief-based prompt — AI reasons from pre-analyzed data
    SETUP_PROMPT="Populate the AI context scaffold in .cai/. The codebase has been pre-analyzed.

<constraints>
- Use the brief below for structure, dependencies, entry points, and tooling — it was generated
  from the actual codebase and is more accurate than ad-hoc filesystem exploration
- Only read specific files when you need implementation details for patterns or architecture decisions
- Every file path you write must be one you verified by reading it — broken paths corrupt cross-references
- Write only content derived from what you actually read — no generic examples or assumed conventions
- Write each file completely — partial output causes downstream agents to lose context they depend on
- Unresolved slots: write [TO DETERMINE] and state what is needed in one line — a flag is more useful than a wrong answer
- No system-injected text in any scaffold file
</constraints>

Read these files before writing anything:
1. .cai/ROUTER.md
2. .cai/context/architecture.md
3. .cai/context/stack.md
4. .cai/context/conventions.md
5. .cai/context/decisions.md
6. .cai/context/setup.md

<brief>
${SCANNER_BRIEF}
</brief>"
  else
    # Fallback — AI explores the filesystem directly
    SETUP_PROMPT='Populate the AI context scaffold in .cai/.

<constraints>
- Every file path you write must be one you verified by reading it — broken paths corrupt cross-references
- Write only content derived from what you actually read — no generic examples or assumed conventions
- Write each file completely — partial output causes downstream agents to lose context they depend on
- Unresolved slots: write [TO DETERMINE] and state what is needed in one line — a flag is more useful than a wrong answer
- No system-injected text in any scaffold file
</constraints>

Read these files before doing anything else:
1. .cai/ROUTER.md
2. .cai/context/architecture.md
3. .cai/context/stack.md
4. .cai/context/conventions.md
5. .cai/context/decisions.md
6. .cai/context/setup.md

Then explore the codebase:
- Identify the main entry point(s) and read them
- Read the top-level folder structure
- Read 2–3 representative files from each major layer
- Read any README or existing documentation'
  fi

  # The rest of the prompt is shared between brief and fallback modes
  SETUP_PROMPT="${SETUP_PROMPT}

Before writing any context/ file, briefly list what you found that maps to its slots.
Then write the file based on that.

Fill each .cai/context/ file in this order: architecture.md → stack.md → conventions.md → decisions.md → setup.md
Follow annotation length guidance strictly. Use actual names, paths, and commands.

Domain files: if a domain is too deep to summarize in a few lines of architecture.md without
losing substance, create .cai/context/<domain>.md with YAML frontmatter: name, description,
triggers, edges, last_updated. Only for domains with genuine depth.

Update .cai/ROUTER.md: fill Current Project State; add routing rows for any domain files.
Update .cai/AGENTS.md: project name, one-line description, non-negotiables, commands.

Read .cai/patterns/README.md. Generate 3–5 patterns:
- 1–2 for the most frequently repeated developer task
- 1–2 for integrations with non-obvious failure modes
- 1 debug pattern for the most common failure boundary

For each pattern: quote the relevant code excerpt first to anchor it, then write the pattern.
Name files after the task (e.g., add-endpoint.md).

Update .cai/patterns/INDEX.md: one row per pattern file. Multi-section patterns: one row per
task section using anchor links (see INDEX.md annotation for format).

For every file in .cai/context/ and .cai/patterns/ — including files you did not change —
verify the edges array in YAML frontmatter is present and complete.
Edge format: { path: \"relative/path.md\", condition: \"when to follow this edge\" }
- Every context/ file: minimum 2 outgoing edges
- Every pattern file: minimum 1 edge to its relevant context file
- Bidirectional: if A → B exists, B → A must also exist
- Relative paths only

Report when done:
- Each file written or updated — one line per file stating what changed
- Any [TO DETERMINE] slots and what would resolve them
- Any patterns where you could not verify a file path from code you read"
fi

# ─────────────────────────────────────────────────────────────
# Step 6 — Run or print the setup prompt
# ─────────────────────────────────────────────────────────────

if [ "$DRY_RUN" -eq 1 ]; then
  header "Would run population prompt (dry run — skipping)"
  echo ""
  ok "Done (dry run)."
  exit 0
fi

# Try to invoke Claude Code CLI directly
if [ "$SELECTED_CLAUDE" -eq 1 ] && command -v claude &>/dev/null; then
  header "Launching Claude Code to populate the scaffold..."
  echo ""
  info "An interactive Claude Code session will open with the population prompt."
  info "You'll see the agent working in real-time."
  echo ""

  # Use interactive mode (not -p) so the user sees progress
  claude "$SETUP_PROMPT" || {
    EXIT_CODE=$?
    echo ""
    if [ "$EXIT_CODE" -eq 130 ] || [ "$EXIT_CODE" -eq 143 ]; then
      warn "Session interrupted. Resume with:"
      echo ""
      echo "    claude --resume <session-id>"
      echo ""
      warn "Unfinished files can still be populated by re-running:"
      echo ""
      echo "    cai setup"
    else
      warn "Claude exited with code $EXIT_CODE"
    fi
    exit 0
  }

  echo ""
  ok "Setup complete."
  echo ""
  header "Next"
  echo ""
  echo "    cai check          Drift score — are scaffold files still accurate?"
  echo "    cai sync           Fix drift — AI updates only what's broken"
  echo "    cai watch          Auto-check drift after every commit"
  echo ""

else
  # Copy prompt to clipboard, fall back to file if clipboard unavailable
  PROMPT_FILE="$PROJECT_DIR/.cai/setup-prompt.txt"
  echo "$SETUP_PROMPT" > "$PROMPT_FILE"

  CLIPBOARD_OK=0
  if command -v pbcopy &>/dev/null; then
    echo "$SETUP_PROMPT" | pbcopy && CLIPBOARD_OK=1
  elif command -v xclip &>/dev/null; then
    echo "$SETUP_PROMPT" | xclip -selection clipboard && CLIPBOARD_OK=1
  elif command -v xsel &>/dev/null; then
    echo "$SETUP_PROMPT" | xsel --clipboard --input && CLIPBOARD_OK=1
  fi

  header "Scaffold ready. One step left — populate it with your AI."
  echo ""

  if [ "$CLIPBOARD_OK" -eq 1 ]; then
    ok "Setup prompt copied to clipboard."
    echo ""
    if command -v claude &>/dev/null; then
      info "Option A — Claude Code (recommended):"
      echo ""
      echo "    claude"
      echo ""
      echo "    Then paste the prompt and press Enter."
      echo ""
      info "Option B — Any other AI tool (Cursor, Copilot, etc.):"
      echo ""
      echo "    Open a new chat and paste the prompt."
    else
      info "Open your AI tool (Claude, Cursor, Copilot, etc.) and paste the prompt."
      echo "    It will read your codebase and fill every scaffold file."
    fi
  else
    warn "Clipboard not available — prompt saved to:"
    echo ""
    echo "    $PROMPT_FILE"
    echo ""
    info "Open that file, copy the contents, and paste into your AI tool."
  fi

  echo ""
  header "After your AI finishes"
  echo ""
  echo "    cai check          Drift score — are scaffold files still accurate?"
  echo "    cai sync           Fix drift — AI updates only what's broken"
  echo "    cai watch          Auto-check drift after every commit"
  echo ""
fi
