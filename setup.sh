#!/usr/bin/env bash
# setup.sh — one-command bootstrap for OpenClaw AI Dev Agent
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/zgyant/openclaw-ai-dev/main/setup.sh | bash
#
# What this script does:
#   1. Clones https://github.com/zgyant/openclaw-ai-dev (or updates it if already present)
#   2. Runs pnpm install, pnpm ui:build, pnpm build inside the repo
#   3. Creates install.json from the template if it doesn't exist yet
#   4. Pauses so you can fill in your API keys and settings
#   5. Waits for Y, then runs easy-install.sh which feeds the JSON into
#      `pnpm openclaw onboard --install-daemon` and configures channels/plugins/dev-agent
#   6. Prints the dev-loop command: pnpm gateway:watch
#
# Tip: re-run at any time — git pull + rebuild are skipped when nothing changed.

set -euo pipefail

REPO_URL="https://github.com/zgyant/openclaw-ai-dev.git"
REPO_DIR="${PWD}/openclaw-ai-dev"

# ── colors ───────────────────────────────────────────────────────────────────
BOLD='\033[1m'
ACCENT='\033[38;2;255;77;77m'
INFO='\033[38;2;136;146;176m'
SUCCESS='\033[38;2;0;229;204m'
WARN='\033[38;2;255;176;32m'
ERROR='\033[38;2;230;57;70m'
MUTED='\033[38;2;90;100;128m'
NC='\033[0m'

say()     { echo -e "${MUTED}·${NC} $*"; }
ok()      { echo -e "${SUCCESS}✓${NC} $*"; }
warn()    { echo -e "${WARN}!${NC} $*" >&2; }
err()     { echo -e "${ERROR}✗${NC} $*" >&2; }
hint()    { echo -e "${INFO}  $*${NC}"; }
section() { echo -e "\n${ACCENT}${BOLD}$*${NC}"; }

banner() {
    echo ""
    echo -e "${ACCENT}${BOLD}  🦞 OpenClaw — AI Dev Agent Installer${NC}"
    echo -e "${MUTED}  https://github.com/zgyant/openclaw-ai-dev${NC}"
    echo ""
}

# ── TTY helpers ───────────────────────────────────────────────────────────────
is_tty() { [[ -r /dev/tty && -w /dev/tty ]]; }

confirm_yn() {
    # $1 = prompt, $2 = default (y|n)
    local prompt="$1" default="${2:-n}"
    if is_tty; then
        while true; do
            printf "%b  %s (y/n) [%s]: %b" "${INFO}" "$prompt" "$default" "${NC}" >/dev/tty
            read -r _a </dev/tty || _a=""
            _a="${_a:-$default}"
            case "${_a,,}" in
                y|yes) return 0 ;;
                n|no)  return 1 ;;
                *)     warn "Please enter Y or N." ;;
            esac
        done
    else
        [[ "${default,,}" == "y" ]]
    fi
}

banner

# ── Step 1: clone or update ───────────────────────────────────────────────────
section "Step 1/4  Source"

if [[ -d "${REPO_DIR}/.git" ]]; then
    ok "Repo already exists — pulling latest …"
    git -C "$REPO_DIR" pull --ff-only
else
    say "Cloning ${REPO_URL} …"
    git clone "$REPO_URL" "$REPO_DIR"
    ok "Cloned to: ${REPO_DIR}"
fi

cd "$REPO_DIR"

# ── Step 2: build ─────────────────────────────────────────────────────────────
section "Step 2/4  Build"

# Ensure pnpm is available
if ! command -v pnpm &>/dev/null; then
    warn "pnpm not found — installing via npm …"
    npm install -g pnpm@10 2>/dev/null || {
        err "Could not install pnpm. Install it manually: https://pnpm.io/installation"
        exit 1
    }
    hash -r 2>/dev/null || true
fi

say "pnpm install …"
pnpm install --frozen-lockfile

say "pnpm ui:build  (auto-installs UI deps on first run) …"
pnpm ui:build

say "pnpm build …"
pnpm build

ok "Build complete"

# ── Step 3: config ────────────────────────────────────────────────────────────
section "Step 3/4  Configure"

INSTALL_JSON="${REPO_DIR}/install.json"
TEMPLATE_JSON="${REPO_DIR}/scripts/install.template.json"

if [[ -f "$INSTALL_JSON" ]]; then
    ok "install.json already exists — using it"
    say "  ${INSTALL_JSON}"
else
    if [[ ! -f "$TEMPLATE_JSON" ]]; then
        err "Template not found: ${TEMPLATE_JSON}"
        exit 1
    fi
    cp "$TEMPLATE_JSON" "$INSTALL_JSON"
    ok "Created: ${INSTALL_JSON}"
fi

echo ""
echo -e "${WARN}${BOLD}  Open install.json and fill in your details before continuing.${NC}"
echo ""
echo -e "  File:  ${INFO}${BOLD}${INSTALL_JSON}${NC}"
echo ""
hint "At minimum you need:"
hint "  • ai_provider.auth_choice  — e.g. \"openai-api-key\", \"anthropic\", \"gemini-api-key\""
hint "  • ai_provider.api_key      — your LLM API key"
echo ""
hint "Optional: enable channels (telegram, discord, slack…), plugins, dev_agent"
echo ""
hint "Edit now:"
hint "  nano  ${INSTALL_JSON}"
hint "  code  ${INSTALL_JSON}   (VS Code)"
hint "  vim   ${INSTALL_JSON}"
echo ""
echo -e "${MUTED}─────────────────────────────────────────────────────────────${NC}"
echo ""

if is_tty; then
    while true; do
        printf "%b  Done editing? Press %bY%b to continue, %bN%b to cancel: %b" \
            "$INFO" "$BOLD" "$INFO" "$BOLD" "$INFO" "$NC" >/dev/tty
        read -r _ans </dev/tty || _ans=""
        case "${_ans,,}" in
            y|yes)
                echo ""
                break
                ;;
            n|no|q|quit|"")
                echo ""
                say "Cancelled."
                echo ""
                hint "When you're ready, re-run:"
                hint "  cd ${REPO_DIR} && bash scripts/easy-install.sh"
                echo ""
                exit 0
                ;;
            *)
                warn "Please enter Y (continue) or N (cancel)."
                ;;
        esac
    done
else
    warn "No TTY detected — proceeding automatically (CI/headless mode)."
    echo ""
fi

# ── Step 4: install + onboard + dev-loop ──────────────────────────────────────
section "Step 4/4  Install & Onboard"

bash "${REPO_DIR}/scripts/easy-install.sh"

# ── Post-install: dev-loop hint ───────────────────────────────────────────────
echo ""
echo -e "${ACCENT}${BOLD}  Dev loop (auto-reload on source/config changes):${NC}"
echo ""
echo -e "  ${BOLD}cd ${REPO_DIR}${NC}"
echo -e "  ${BOLD}pnpm gateway:watch${NC}"
echo ""
hint "Other useful commands:"
hint "  pnpm dev                   # run the node without file watching"
hint "  pnpm gateway:dev           # gateway only, skip channels"
hint "  pnpm gateway:dev:reset     # gateway + reset state"
hint "  openclaw channels status --probe"
hint "  openclaw dashboard"
echo ""
