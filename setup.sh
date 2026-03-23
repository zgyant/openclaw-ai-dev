#!/usr/bin/env bash
# setup.sh — one-command bootstrap for OpenClaw AI Dev Agent
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/zgyant/openclaw-ai-dev/main/setup.sh | bash
#
# What this script does:
#   1. Downloads install.json (config template) to your current directory
#   2. Downloads easy-install.sh to a temp location
#   3. Pauses so you can edit install.json with your API keys and settings
#   4. Waits for you to press Y, then runs the full installer
#
# Tip: re-run at any time — it skips re-downloading if install.json already exists.

set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/zgyant/openclaw-ai-dev/main"

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
warn()    { echo -e "${WARN}!${NC} $*"; }
err()     { echo -e "${ERROR}✗${NC} $*" >&2; }
hint()    { echo -e "${INFO}  $*${NC}"; }
section() { echo -e "\n${ACCENT}${BOLD}$*${NC}"; }

banner() {
    echo ""
    echo -e "${ACCENT}${BOLD}  🦞 OpenClaw — AI Dev Agent Installer${NC}"
    echo -e "${MUTED}  https://github.com/zgyant/openclaw-ai-dev${NC}"
    echo ""
}

# ── download helper (curl or wget) ───────────────────────────────────────────
download() {
    local url="$1" dest="$2"
    if command -v curl &>/dev/null; then
        curl -fsSL "$url" -o "$dest"
    elif command -v wget &>/dev/null; then
        wget -qO "$dest" "$url"
    else
        err "Neither curl nor wget found. Install one and try again."
        exit 1
    fi
}

banner

INSTALL_JSON="${PWD}/install.json"
EASY_INSTALL_TMP="$(mktemp /tmp/easy-install-XXXXXX.sh)"
EASY_INSTALL_SAVED="${PWD}/easy-install.sh"

# Clean up temp on exit (but keep the saved copy)
trap 'rm -f "$EASY_INSTALL_TMP"' EXIT

# ── Step 1: get install.json ──────────────────────────────────────────────────
section "Step 1/3  Config"

if [[ -f "$INSTALL_JSON" ]]; then
    ok "install.json already exists — using it"
    say "  ${INSTALL_JSON}"
else
    say "Downloading install.json template …"
    download "${REPO_RAW}/scripts/install.template.json" "$INSTALL_JSON"
    ok "Created: ${INSTALL_JSON}"
fi

# ── Step 2: get easy-install.sh ───────────────────────────────────────────────
section "Step 2/3  Installer"

say "Downloading easy-install.sh …"
download "${REPO_RAW}/scripts/easy-install.sh" "$EASY_INSTALL_TMP"
chmod +x "$EASY_INSTALL_TMP"

# Save a permanent copy next to install.json so the user can re-run later
cp "$EASY_INSTALL_TMP" "$EASY_INSTALL_SAVED"
chmod +x "$EASY_INSTALL_SAVED"
ok "Installer saved: ${EASY_INSTALL_SAVED}"

# ── Step 3: edit + confirm ────────────────────────────────────────────────────
section "Step 3/3  Configure & Run"

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
hint "  nano ${INSTALL_JSON}"
hint "  code ${INSTALL_JSON}     (VS Code)"
hint "  vim  ${INSTALL_JSON}"
echo ""
echo -e "${MUTED}─────────────────────────────────────────────────────────────${NC}"
echo ""

# Read Y/N from /dev/tty — works even when stdin is the curl pipe
if [[ -r /dev/tty && -w /dev/tty ]]; then
    while true; do
        printf "%b  Done editing? Press %bY%b to run the installer, %bN%b to cancel: %b" \
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
                hint "When you're ready, run the installer yourself:"
                hint "  bash ${EASY_INSTALL_SAVED}"
                echo ""
                exit 0
                ;;
            *)
                warn "Please enter Y (continue) or N (cancel)."
                ;;
        esac
    done
else
    # Headless / CI — no TTY available, proceed automatically
    warn "No TTY detected — proceeding automatically (CI/headless mode)."
    echo ""
fi

# ── Run the installer ─────────────────────────────────────────────────────────
# install.json is in $PWD; easy-install.sh searches $PWD first, so it will
# find it automatically without any extra arguments.
bash "$EASY_INSTALL_TMP"
