#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# cai update — rebuild local infrastructure metadata
# ─────────────────────────────────────────────────────────────

for arg in "$@"; do
  case "$arg" in
    --help|-h)
      echo "Usage: .cai/update.sh"
      echo ""
      echo "Rebuild the local CLI and refresh local infrastructure metadata."
      exit 0
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'
ROYAL='\033[38;2;25;68;241m'

info()  { printf "${BLUE}→${NC} %s\n" "$1"; }
ok()    { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}!${NC} %s\n" "$1"; }
header(){ printf "\n${BOLD}%s${NC}\n" "$1"; }

banner() {
  printf "\n"
  printf "${ROYAL} ██████╗  █████╗ ██╗${NC}\n"
  printf "${ROYAL}██╔════╝ ██╔══██╗██║${NC}\n"
  printf "${ROYAL}██║      ███████║██║${NC}\n"
  printf "${ROYAL}██║      ██╔══██║██║${NC}\n"
  printf "${ROYAL}╚██████╗ ██║  ██║██║${NC}\n"
  printf "${ROYAL} ╚═════╝ ╚═╝  ╚═╝╚═╝${NC}\n"
  printf "\n"
  printf "               ${BOLD}update${NC}\n"
}

banner
echo ""

if [ ! -f "$SCRIPT_DIR/ROUTER.md" ]; then
  echo "Error: cannot find ROUTER.md — are you sure this is a scaffold directory?"
  exit 1
fi

chmod +x "$SCRIPT_DIR/setup.sh" 2>/dev/null || true
chmod +x "$SCRIPT_DIR/update.sh" 2>/dev/null || true
chmod +x "$SCRIPT_DIR/sync.sh" 2>/dev/null || true
chmod +x "$SCRIPT_DIR/visualize.sh" 2>/dev/null || true

if ! command -v node >/dev/null 2>&1; then
  warn "Node.js not found — skipped CLI rebuild"
  exit 0
fi

header "Rebuilding local CLI"

if (cd "$SCRIPT_DIR" && npm install --silent && npm run build --silent); then
  ok "CLI engine rebuilt"
else
  warn "CLI rebuild failed"
  exit 1
fi

if [ -d "$SCRIPT_DIR/.git" ]; then
  git -C "$SCRIPT_DIR" rev-parse --short HEAD > "$SCRIPT_DIR/.cai-version" 2>/dev/null || true
else
  date -u +"%Y-%m-%dT%H:%M:%SZ" > "$SCRIPT_DIR/.cai-version"
fi

echo ""
info "No remote repository is configured by this script."
ok "Done. Local infrastructure metadata refreshed."
