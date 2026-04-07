#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# cai sync — detect drift and build targeted prompts to fix it
# ─────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Parse flags
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --help|-h)
      echo "Usage: .cai/sync.sh [--dry-run]"
      echo ""
      echo "Interactive sync — detect drift and fix it with targeted or full resync."
      echo ""
      echo "Options:"
      echo "  --dry-run   Show what needs fixing without executing"
      echo "  --help      Show this help"
      exit 0
      ;;
  esac
done

# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'
ROYAL='\033[38;2;25;68;241m'

info()  { printf "${BLUE}→${NC} %s\n" "$1"; }
ok()    { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}!${NC} %s\n" "$1"; }
err()   { printf "${RED}✗${NC} %s\n" "$1"; }
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
  printf "               ${BOLD}sync${NC}\n"
}

# ─────────────────────────────────────────────────────────────
# Resolve cai CLI
# ─────────────────────────────────────────────────────────────

CONTEXT_CMD=""
if command -v cai &>/dev/null; then
  CONTEXT_CMD="cai"
elif [ -f "$SCRIPT_DIR/dist/cli.js" ]; then
  CONTEXT_CMD="node $SCRIPT_DIR/dist/cli.js"
elif command -v node &>/dev/null && [ -f "$SCRIPT_DIR/package.json" ]; then
  info "Building cai CLI engine..."
  if (cd "$SCRIPT_DIR" && npm install --silent 2>/dev/null && npm run build --silent 2>/dev/null); then
    ok "CLI engine built"
    CONTEXT_CMD="node $SCRIPT_DIR/dist/cli.js"
  else
    warn "CLI build failed"
  fi
fi

# ─────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────

banner
echo ""

if [ "$DRY_RUN" -eq 1 ]; then
  warn "DRY RUN — will show what needs fixing without executing"
  echo ""
fi

# ─────────────────────────────────────────────────────────────
# Step 1 — Drift detection
# ─────────────────────────────────────────────────────────────

if [ -n "$CONTEXT_CMD" ]; then
  header "Running drift detection..."
  echo ""

  # Get the quiet summary first
  cd "$PROJECT_DIR"
  DRIFT_QUIET=$($CONTEXT_CMD check --quiet 2>&1) || true
  info "$DRIFT_QUIET"
  echo ""

  # Check if there are actual issues
  DRIFT_JSON=$($CONTEXT_CMD check --json 2>&1) || true
  ISSUE_COUNT=$(echo "$DRIFT_JSON" | grep -c '"code"' 2>/dev/null || echo "0")

  if [ "$ISSUE_COUNT" -eq 0 ]; then
    ok "No drift detected. Scaffold is in sync with codebase."
    echo ""
    exit 0
  fi

  # Show full report
  $CONTEXT_CMD check 2>&1 || true
  echo ""

  # ─────────────────────────────────────────────────────────────
  # Step 2 — Targeted sync
  # ─────────────────────────────────────────────────────────────

  if [ "$DRY_RUN" -eq 1 ]; then
    header "Targeted fix prompts (dry run)..."
    echo ""
    $CONTEXT_CMD sync --dry-run 2>&1 || true
    echo ""
    ok "Done (dry run). Run without --dry-run to execute."
    exit 0
  fi

  header "How do you want to fix the drift?"
  echo ""
  echo "  1) Targeted sync — AI fixes only the flagged files (recommended)"
  echo "  2) Full resync — AI re-reads everything and updates all scaffold files"
  echo "  3) Show me the prompts — I'll paste them manually"
  echo "  4) Exit — I'll fix it myself"
  echo ""
  printf "Choice [1-4] (default: 1): "
  read -r sync_choice
  sync_choice="${sync_choice:-1}"

  case "$sync_choice" in
    1)
      header "Running targeted sync..."
      echo ""
      $CONTEXT_CMD sync 2>&1 || true
      ;;
    2)
      # Full resync — use the SYNC.md prompt
      header "Running full resync..."
      echo ""
      SYNC_PROMPT='Resync the AI context scaffold in .cai/. The codebase has changed since the scaffold was last populated.

<constraints>
- Read the full file before editing it — update only the sections that actually changed
- Write each file completely when making changes — truncation causes downstream agents to lose context
- YAML frontmatter fields (edges, triggers, name, description): add or remove individual entries — replacing the entire array loses data
- Decisions are append-only — old decisions get a superseded marker, never deleted
</constraints>

Read all .cai/context/ files. For each file, note the last_updated date.
Use git log since each file'"'"'s last_updated date to identify what changed in the codebase.

For each .cai/context/ file that needs updating:
1. State in one line what you found changed (before editing)
2. Update only the affected sections
3. Set last_updated to today'"'"'s date

decisions.md rule: insert new decisions above the existing list. For changed decisions, mark
the old entry "Superseded by [new title]" — do not delete it.

Update .cai/ROUTER.md Current Project State after all context/ files are done.

Report:
- Each file updated — one line stating what specifically changed
- Any decisions superseded
- Any slots that could not be updated with confidence'

      if command -v claude &>/dev/null; then
        claude -p "$SYNC_PROMPT" > /dev/null 2>&1 &
        CLAUDE_PID=$!
        spin $CLAUDE_PID "Running full resync (this may take a few minutes)..."
        wait $CLAUDE_PID 2>/dev/null
        ok "Full resync complete."
        echo ""
        header "Verification"
        $CONTEXT_CMD check 2>&1 || true
      else
        echo ""
        echo "─────────────────── COPY BELOW THIS LINE ───────────────────"
        echo ""
        echo "$SYNC_PROMPT"
        echo ""
        echo "─────────────────── COPY ABOVE THIS LINE ───────────────────"
        echo ""
        info "Paste the prompt above into your AI tool."
      fi
      ;;
    3)
      header "Targeted fix prompts..."
      echo ""
      $CONTEXT_CMD sync --dry-run 2>&1 || true
      echo ""
      ok "Copy the prompts above and paste into your AI tool."
      ;;
    4)
      ok "Exiting. Run cai check anytime to re-check."
      ;;
    *)
      warn "Unknown choice, exiting."
      ;;
  esac

else
  # ─────────────────────────────────────────────────────────────
  # Fallback — no cai CLI available, use SYNC.md prompt
  # ─────────────────────────────────────────────────────────────

  warn "cai CLI not available — falling back to full resync prompt"
  echo ""
  info "To get targeted sync, build the CLI first:"
  echo "  cd $SCRIPT_DIR && npm install && npm run build"
  echo ""

  header "Full resync prompt"
  echo ""
  info "Paste the following into your AI tool:"
  echo ""
  echo "─────────────────── COPY BELOW THIS LINE ───────────────────"
  echo ""
  cat <<'PROMPT'
Resync the AI context scaffold in .cai/. The codebase has changed since the scaffold was last populated.

<constraints>
- Read the full file before editing it — update only the sections that actually changed
- Write each file completely when making changes — truncation causes downstream agents to lose context
- YAML frontmatter fields (edges, triggers, name, description): add or remove individual entries — replacing the entire array loses data
- Decisions are append-only — old decisions get a superseded marker, never deleted
</constraints>

Read all .cai/context/ files. For each file, note the last_updated date.
Use git log since each file's last_updated date to identify what changed in the codebase.

For each .cai/context/ file that needs updating:
1. State in one line what you found changed (before editing)
2. Update only the affected sections
3. Set last_updated to today's date

decisions.md rule: insert new decisions above the existing list. For changed decisions, mark
the old entry "Superseded by [new title]" — do not delete it.

Update .cai/ROUTER.md Current Project State after all context/ files are done.

Report:
- Each file updated — one line stating what specifically changed
- Any decisions superseded
- Any slots that could not be updated with confidence
PROMPT
  echo ""
  echo "─────────────────── COPY ABOVE THIS LINE ───────────────────"
  echo ""
fi

echo ""
ok "Done."
