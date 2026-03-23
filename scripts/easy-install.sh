#!/usr/bin/env bash
# easy-install.sh — one-command OpenClaw setup for everyday use.
#
# Usage:
#   bash scripts/easy-install.sh              # guided interactive setup
#   bash scripts/easy-install.sh --dry-run    # preview only, no changes
#   bash scripts/easy-install.sh --no-agent   # skip dev-agent configuration
#   bash scripts/easy-install.sh --no-channels  # skip channel setup
#   bash scripts/easy-install.sh --no-plugins   # skip plugin install/enable
#   bash scripts/easy-install.sh --verbose
#   bash scripts/easy-install.sh --help
#
# Reads install.json from the current directory (or the scripts/ directory).
# If install.json does not exist, copies install.template.json and asks you
# to fill it in.
#
# Full setup order:
#   1. git clone + pnpm install + pnpm ui:build + pnpm build  (source builds)
#      OR  pnpm add -g / npm install -g  (package installs)
#   2. pnpm openclaw onboard --install-daemon  (with flags auto-built from JSON)
#   3. openclaw channels add  for each enabled channel
#   4. openclaw plugins install / enable  for each listed plugin
#   5. Configure the AI Dev Agent
#   6. Print dev-loop command: pnpm gateway:watch

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_SH="${SCRIPT_DIR}/install.sh"
TEMPLATE_JSON="${SCRIPT_DIR}/install.template.json"

# Search for install.json: CWD first, then script dir
CONFIG_JSON=""
for _candidate in "${PWD}/install.json" "${SCRIPT_DIR}/install.json"; do
    if [[ -f "$_candidate" ]]; then
        CONFIG_JSON="$_candidate"
        break
    fi
done

# ── colors (matches install.sh palette) ──────────────────────────────────────
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
section() { echo -e "\n${ACCENT}${BOLD}$*${NC}"; }
hint()    { echo -e "${INFO}  $*${NC}"; }

# ── progress bar ──────────────────────────────────────────────────────────────
# Usage: progress_bar <current_step> <total_steps> <label>
#   e.g. progress_bar 2 5 "Running onboard"
# Renders a fixed-width bar like:
#   [████████░░░░░░░░░░░░]  2/5  Running onboard
_PB_WIDTH=20
progress_bar() {
    local current="$1"
    local total="$2"
    local label="${3:-}"
    # Don't draw when output is not a terminal (CI, pipe, etc.)
    [[ -t 1 ]] || return 0
    local filled=$(( current * _PB_WIDTH / total ))
    local empty=$(( _PB_WIDTH - filled ))
    local bar=""
    local i
    for (( i=0; i<filled; i++ )); do bar+="█"; done
    for (( i=0; i<empty;  i++ )); do bar+="░"; done
    printf "\r${ACCENT}[%s]${NC}  %s/%s  %s%-*s" \
        "$bar" "$current" "$total" "${BOLD}" 30 "$label${NC}"
    # Move to next line only when complete
    if [[ "$current" -ge "$total" ]]; then
        echo ""
    fi
}

# Total install steps: build, onboard, channels, plugins, dev-agent
_PB_TOTAL=5
_PB_STEP=0

pb_step() {
    local label="$1"
    (( _PB_STEP++ )) || true
    progress_bar "$_PB_STEP" "$_PB_TOTAL" "$label"
}

banner() {
    echo ""
    echo -e "${ACCENT}${BOLD}  🦞 OpenClaw Easy Setup${NC}"
    echo -e "${MUTED}  Guided installer — reads install.json, no flag memorization required.${NC}"
    echo ""
}

print_help() {
    cat <<EOF
easy-install.sh — guided OpenClaw setup

Usage:
  bash scripts/easy-install.sh [options]

Options:
  --dry-run        Preview what would happen; make no changes
  --no-build       Skip pnpm install / ui:build / build (source installs)
  --no-agent       Skip dev-agent configuration
  --no-channels    Skip messaging channel setup
  --no-plugins     Skip plugin install/enable
  --verbose        Print detailed output
  --help           Show this message

Config files (in scripts/ or current directory):
  install.json           Your configuration (created from template if missing)
  install.template.json  Template with all fields and inline documentation

Full setup flow:
  1. Build from source  (pnpm install + pnpm ui:build + pnpm build)
     OR install package  (pnpm add -g / npm install -g)
  2. pnpm openclaw onboard --install-daemon  (flags auto-built from install.json)
  3. openclaw channels add  for each enabled channel
  4. openclaw plugins install / enable  for each listed plugin
  5. Write dev-agent config to ~/.openclaw/dev-agent-instances.json
  6. Print dev-loop command: pnpm gateway:watch
EOF
}

# ── flags ─────────────────────────────────────────────────────────────────────
DRY_RUN=0
NO_BUILD=0
NO_AGENT=0
NO_CHANNELS=0
NO_PLUGINS=0
VERBOSE=0
HELP=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run)      DRY_RUN=1;      shift ;;
        --no-build)     NO_BUILD=1;     shift ;;
        --no-agent)     NO_AGENT=1;     shift ;;
        --no-channels)  NO_CHANNELS=1;  shift ;;
        --no-plugins)   NO_PLUGINS=1;   shift ;;
        --verbose)      VERBOSE=1;      shift ;;
        --help|-h)      HELP=1;         shift ;;
        *) shift ;;
    esac
done

if [[ "$HELP" == "1" ]]; then
    print_help
    exit 0
fi

# ── JSON reading helpers ──────────────────────────────────────────────────────
# Requires node (present before install on most systems) with python3 fallback.
json_get() {
    local file="$1"
    local dotkey="$2"
    local default="${3:-}"

    if command -v node &>/dev/null; then
        node -e "
try {
  const o = JSON.parse(require('fs').readFileSync('${file}', 'utf8'));
  const keys = '${dotkey}'.split('.');
  let v = o;
  for (const k of keys) { v = (v && typeof v === 'object') ? v[k] : undefined; }
  if (v !== undefined && v !== null && v !== '') process.stdout.write(String(v));
} catch(e) {}
" 2>/dev/null && return 0
    fi

    if command -v python3 &>/dev/null; then
        python3 -c "
import json, sys
try:
    with open('${file}') as f:
        o = json.load(f)
    v = o
    for k in '${dotkey}'.split('.'):
        v = v.get(k) if isinstance(v, dict) else None
    if v is not None and v != '':
        print(v, end='')
except:
    pass
" 2>/dev/null && return 0
    fi

    echo "$default"
}

# Returns 0 (true) if a JSON boolean/truthy field is true/1/"true"
json_bool() {
    local val
    val="$(json_get "$1" "$2" "false")"
    [[ "$val" == "true" || "$val" == "1" ]]
}

# Returns a bash array populated from a JSON string array field
# Usage: readarray -t MY_ARR < <(json_array "$file" "plugins.install")
json_array() {
    local file="$1"
    local dotkey="$2"

    if command -v node &>/dev/null; then
        node -e "
try {
  const o = JSON.parse(require('fs').readFileSync('${file}', 'utf8'));
  const keys = '${dotkey}'.split('.');
  let v = o;
  for (const k of keys) { v = (v && typeof v === 'object') ? v[k] : undefined; }
  if (Array.isArray(v)) v.forEach(x => { if (x && !String(x).startsWith('_')) console.log(x); });
} catch(e) {}
" 2>/dev/null
    elif command -v python3 &>/dev/null; then
        python3 -c "
import json
try:
    with open('${file}') as f:
        o = json.load(f)
    v = o
    for k in '${dotkey}'.split('.'):
        v = v.get(k) if isinstance(v, dict) else None
    if isinstance(v, list):
        for x in v:
            if x and not str(x).startswith('_'):
                print(x)
except:
    pass
" 2>/dev/null
    fi
}

# ── interactive prompt helpers ────────────────────────────────────────────────
is_tty() { [[ -r /dev/tty && -w /dev/tty ]]; }

ask() {
    local prompt="$1"
    local default="${2:-}"
    local answer=""
    is_tty || { echo "$default"; return 0; }
    if [[ -n "$default" ]]; then
        printf "%b  %s [%s]: %b" "${INFO}" "$prompt" "$default" "${NC}" > /dev/tty
    else
        printf "%b  %s: %b" "${INFO}" "$prompt" "${NC}" > /dev/tty
    fi
    read -r answer < /dev/tty || true
    echo "${answer:-$default}"
}

ask_secret() {
    local prompt="$1"
    local answer=""
    is_tty || { echo ""; return 0; }
    printf "%b  %s: %b" "${INFO}" "$prompt" "${NC}" > /dev/tty
    read -rs answer < /dev/tty || true
    echo "" > /dev/tty
    echo "$answer"
}

ask_yn() {
    local prompt="$1"
    local default="${2:-n}"
    local answer
    answer="$(ask "$prompt (y/n)" "$default")"
    [[ "${answer,,}" == "y" || "${answer,,}" == "yes" ]]
}

# Generate a random 32-char token
generate_token() {
    if command -v node &>/dev/null; then
        node -e "process.stdout.write(require('crypto').randomBytes(16).toString('hex'))" 2>/dev/null && return
    fi
    if command -v python3 &>/dev/null; then
        python3 -c "import secrets; print(secrets.token_hex(16), end='')" 2>/dev/null && return
    fi
    # last resort
    tr -dc 'a-zA-Z0-9' < /dev/urandom 2>/dev/null | head -c 32 || echo "changeme-set-a-real-token"
}

# ── ensure install.json exists ────────────────────────────────────────────────
if [[ -z "$CONFIG_JSON" ]]; then
    if [[ ! -f "$TEMPLATE_JSON" ]]; then
        banner
        err "Template not found: ${TEMPLATE_JSON}"
        err "Expected install.template.json alongside this script."
        exit 1
    fi

    DEFAULT_CONFIG_PATH="${SCRIPT_DIR}/install.json"
    banner

    warn "No install.json found."
    echo ""
    hint "Copying template → ${DEFAULT_CONFIG_PATH}"
    hint ""
    hint "Open that file and fill in at minimum:"
    hint "  • ai_provider.auth_choice  — e.g. openai-api-key"
    hint "  • ai_provider.api_key      — your LLM API key"
    hint ""
    hint "Then re-run:  bash scripts/easy-install.sh"
    echo ""

    if [[ "$DRY_RUN" == "1" ]]; then
        say "[dry-run] Would copy template → ${DEFAULT_CONFIG_PATH}"
        exit 0
    fi

    cp "$TEMPLATE_JSON" "$DEFAULT_CONFIG_PATH"
    ok "Template copied to: ${DEFAULT_CONFIG_PATH}"
    echo ""
    echo -e "${WARN}${BOLD}  Next steps:${NC}"
    echo -e "${WARN}  1.${NC} Open ${INFO}${DEFAULT_CONFIG_PATH}${NC}"
    echo -e "${WARN}  2.${NC} Set ${INFO}ai_provider.auth_choice${NC} and ${INFO}ai_provider.api_key${NC}"
    echo -e "${WARN}  3.${NC} Enable any channels you want (telegram, discord, etc.)"
    echo -e "${WARN}  4.${NC} Optionally enable the dev agent and fill in Jira + Bitbucket"
    echo -e "${WARN}  5.${NC} Run this script again"
    echo ""
    exit 0
fi

banner
say "Config : ${CONFIG_JSON}"

# ── read all sections from JSON ───────────────────────────────────────────────

# install
INSTALL_METHOD="$(json_get "$CONFIG_JSON" "install.method" "source")"
INSTALL_VERSION="$(json_get "$CONFIG_JSON" "install.version" "latest")"
INSTALL_BETA="$(json_get "$CONFIG_JSON" "install.beta" "false")"

# onboard
ONBOARD_FLOW="$(json_get "$CONFIG_JSON" "onboard.flow" "quickstart")"
ONBOARD_SKIP_SKILLS="$(json_get "$CONFIG_JSON" "onboard.skip_skills" "true")"
ONBOARD_SKIP_SEARCH="$(json_get "$CONFIG_JSON" "onboard.skip_search" "true")"
ONBOARD_SKIP_HEALTH="$(json_get "$CONFIG_JSON" "onboard.skip_health" "false")"
ONBOARD_SKIP_UI="$(json_get "$CONFIG_JSON" "onboard.skip_ui" "true")"
ONBOARD_INSTALL_DAEMON="$(json_get "$CONFIG_JSON" "onboard.install_daemon" "true")"
GW_PORT="$(json_get "$CONFIG_JSON" "onboard.gateway.port" "19000")"
GW_BIND="$(json_get "$CONFIG_JSON" "onboard.gateway.bind" "loopback")"
GW_AUTH_MODE="$(json_get "$CONFIG_JSON" "onboard.gateway.auth_mode" "token")"
GW_TOKEN="$(json_get "$CONFIG_JSON" "onboard.gateway.token" "")"
GW_PASSWORD="$(json_get "$CONFIG_JSON" "onboard.gateway.password" "")"

# ai_provider
PROVIDER_AUTH_CHOICE="$(json_get "$CONFIG_JSON" "ai_provider.auth_choice" "")"
PROVIDER_API_KEY="$(json_get "$CONFIG_JSON" "ai_provider.api_key" "")"
PROVIDER_MODEL="$(json_get "$CONFIG_JSON" "ai_provider.model" "")"
OLLAMA_BASE_URL="$(json_get "$CONFIG_JSON" "ai_provider.ollama_base_url" "http://localhost:11434")"
CUSTOM_BASE_URL="$(json_get "$CONFIG_JSON" "ai_provider.custom_base_url" "")"
CUSTOM_PROVIDER_ID="$(json_get "$CONFIG_JSON" "ai_provider.custom_provider_id" "")"
CUSTOM_MODEL_ID="$(json_get "$CONFIG_JSON" "ai_provider.custom_model_id" "")"
CUSTOM_COMPAT="$(json_get "$CONFIG_JSON" "ai_provider.custom_compatibility" "openai")"

# channels
TG_ENABLED="$(json_get "$CONFIG_JSON" "channels.telegram.enabled" "false")"
TG_TOKEN="$(json_get "$CONFIG_JSON" "channels.telegram.bot_token" "")"
TG_DM_POLICY="$(json_get "$CONFIG_JSON" "channels.telegram.dm_policy" "pairing")"

DC_ENABLED="$(json_get "$CONFIG_JSON" "channels.discord.enabled" "false")"
DC_TOKEN="$(json_get "$CONFIG_JSON" "channels.discord.bot_token" "")"
DC_DM_POLICY="$(json_get "$CONFIG_JSON" "channels.discord.dm_policy" "pairing")"

SL_ENABLED="$(json_get "$CONFIG_JSON" "channels.slack.enabled" "false")"
SL_BOT_TOKEN="$(json_get "$CONFIG_JSON" "channels.slack.bot_token" "")"
SL_APP_TOKEN="$(json_get "$CONFIG_JSON" "channels.slack.app_token" "")"

SG_ENABLED="$(json_get "$CONFIG_JSON" "channels.signal.enabled" "false")"
SG_NUMBER="$(json_get "$CONFIG_JSON" "channels.signal.number" "")"
SG_HTTP_URL="$(json_get "$CONFIG_JSON" "channels.signal.http_url" "http://localhost:8080")"

MX_ENABLED="$(json_get "$CONFIG_JSON" "channels.matrix.enabled" "false")"
MX_HOMESERVER="$(json_get "$CONFIG_JSON" "channels.matrix.homeserver" "")"
MX_USER_ID="$(json_get "$CONFIG_JSON" "channels.matrix.user_id" "")"
MX_ACCESS_TOKEN="$(json_get "$CONFIG_JSON" "channels.matrix.access_token" "")"

# plugins
readarray -t PLUGINS_INSTALL < <(json_array "$CONFIG_JSON" "plugins.install")
readarray -t PLUGINS_ENABLE  < <(json_array "$CONFIG_JSON" "plugins.enable")

# dev_agent
AGENT_ENABLED="$(json_get "$CONFIG_JSON" "dev_agent.enabled" "false")"
AGENT_NAME="$(json_get "$CONFIG_JSON" "dev_agent.name" "My Dev Agent")"
AGENT_POLL_MS="$(json_get "$CONFIG_JSON" "dev_agent.poll_interval_ms" "300000")"
AGENT_BEHAVIOR_MD="$(json_get "$CONFIG_JSON" "dev_agent.behavior_md" "")"
JIRA_HOST="$(json_get "$CONFIG_JSON" "dev_agent.jira.host" "")"
JIRA_EMAIL="$(json_get "$CONFIG_JSON" "dev_agent.jira.email" "")"
JIRA_TOKEN="$(json_get "$CONFIG_JSON" "dev_agent.jira.api_token" "")"
JIRA_PROJECT="$(json_get "$CONFIG_JSON" "dev_agent.jira.project_key" "")"
JIRA_MAX_TICKETS="$(json_get "$CONFIG_JSON" "dev_agent.jira.max_tickets" "1")"
BB_USERNAME="$(json_get "$CONFIG_JSON" "dev_agent.bitbucket.username" "")"
BB_APP_PASSWORD="$(json_get "$CONFIG_JSON" "dev_agent.bitbucket.app_password" "")"
BB_WORKSPACE="$(json_get "$CONFIG_JSON" "dev_agent.bitbucket.workspace" "")"
BB_REPO="$(json_get "$CONFIG_JSON" "dev_agent.bitbucket.repo" "")"
BB_BASE_URL="$(json_get "$CONFIG_JSON" "dev_agent.bitbucket.base_url" "")"
GIT_DEFAULT_BRANCH="$(json_get "$CONFIG_JSON" "dev_agent.git.default_branch" "main")"

# ── auth_choice normalization: accept friendly aliases ────────────────────────
normalize_auth_choice() {
    local c="${1,,}"  # lowercase
    case "$c" in
        openai)                echo "openai-api-key" ;;
        anthropic|claude)      echo "setup-token" ;;
        gemini|google)         echo "gemini-api-key" ;;
        mistral)               echo "mistral-api-key" ;;
        openrouter)            echo "openrouter-api-key" ;;
        xai|grok)              echo "xai-api-key" ;;
        copilot|github-copilot) echo "github-copilot" ;;
        ollama)                echo "skip" ;;   # configured via config set post-onboard
        custom)                echo "custom-api-key" ;;
        kilocode)              echo "kilocode-api-key" ;;
        opencode|opencode-zen) echo "opencode-zen" ;;
        *)                     echo "$1" ;;  # pass through as-is
    esac
}

PROVIDER_AUTH_CHOICE="$(normalize_auth_choice "${PROVIDER_AUTH_CHOICE:-openai-api-key}")"

# ── interactive gap-fill: required fields ─────────────────────────────────────
section "Step 1/4  AI provider"

if [[ -z "$PROVIDER_API_KEY" && "$PROVIDER_AUTH_CHOICE" != "skip" && \
      "$PROVIDER_AUTH_CHOICE" != "github-copilot" && "$PROVIDER_AUTH_CHOICE" != "opencode-zen" ]]; then
    PROVIDER_API_KEY="$(ask_secret "API key for ${PROVIDER_AUTH_CHOICE} (input hidden)")"
fi

say "auth_choice : ${PROVIDER_AUTH_CHOICE}"
[[ -n "$PROVIDER_API_KEY" ]] && say "api_key     : <set>"
[[ -n "$PROVIDER_MODEL"   ]] && say "model       : ${PROVIDER_MODEL}"

if [[ -z "$GW_TOKEN" && "$GW_AUTH_MODE" == "token" ]]; then
    GW_TOKEN="$(generate_token)"
    warn "No gateway token found in config — generated one for this session:"
    echo ""
    echo -e "  ${WARN}${BOLD}GATEWAY TOKEN: ${GW_TOKEN}${NC}"
    echo ""
    hint "Save this! You'll need it to connect clients to your gateway."
    echo ""
fi

# dev-agent gap-fill
if [[ "$NO_AGENT" == "0" && ("$AGENT_ENABLED" == "true" || "$AGENT_ENABLED" == "1") ]]; then
    section "Step 2/4  Dev Agent"
    say "Agent: ${AGENT_NAME}"
    [[ -z "$JIRA_HOST"      ]] && JIRA_HOST="$(ask "Jira host (e.g. https://yourorg.atlassian.net)")"
    [[ -z "$JIRA_EMAIL"     ]] && JIRA_EMAIL="$(ask "Jira account email")"
    [[ -z "$JIRA_TOKEN"     ]] && JIRA_TOKEN="$(ask_secret "Jira API token (hidden)")"
    [[ -z "$BB_USERNAME"    ]] && BB_USERNAME="$(ask "Bitbucket username")"
    [[ -z "$BB_APP_PASSWORD" ]] && BB_APP_PASSWORD="$(ask_secret "Bitbucket app password (hidden)")"
    [[ -z "$BB_WORKSPACE"   ]] && BB_WORKSPACE="$(ask "Bitbucket workspace slug")"
    [[ -z "$BB_REPO"        ]] && BB_REPO="$(ask "Bitbucket repository slug")"
fi

# ── show plan ─────────────────────────────────────────────────────────────────
section "Step 3/4  Plan"
if [[ "$INSTALL_METHOD" == "source" || "$INSTALL_METHOD" == "git" ]]; then
    say "Install method : source build (pnpm install + ui:build + build)"
else
    say "Install method : ${INSTALL_METHOD} (global package)"
    say "Version        : ${INSTALL_VERSION}"
    [[ "$INSTALL_BETA" == "true" ]] && say "Channel        : beta"
fi
say "Onboard flow   : ${ONBOARD_FLOW}"
say "Gateway port   : ${GW_PORT}  bind=${GW_BIND}  auth=${GW_AUTH_MODE}"
[[ "$ONBOARD_INSTALL_DAEMON" == "true" ]] && say "Daemon install : yes"
say "AI provider    : ${PROVIDER_AUTH_CHOICE}"
[[ -n "$PROVIDER_MODEL" ]] && say "Model          : ${PROVIDER_MODEL}"

ENABLED_CHANNELS=()
[[ "$TG_ENABLED" == "true" ]] && ENABLED_CHANNELS+=("telegram")
[[ "$DC_ENABLED" == "true" ]] && ENABLED_CHANNELS+=("discord")
[[ "$SL_ENABLED" == "true" ]] && ENABLED_CHANNELS+=("slack")
[[ "$SG_ENABLED" == "true" ]] && ENABLED_CHANNELS+=("signal")
[[ "$MX_ENABLED" == "true" ]] && ENABLED_CHANNELS+=("matrix")

if [[ ${#ENABLED_CHANNELS[@]} -gt 0 && "$NO_CHANNELS" == "0" ]]; then
    say "Channels       : ${ENABLED_CHANNELS[*]}"
else
    say "Channels       : (none enabled)"
fi

if [[ ${#PLUGINS_INSTALL[@]} -gt 0 && "$NO_PLUGINS" == "0" ]]; then
    say "Plugins install: ${PLUGINS_INSTALL[*]}"
fi
if [[ ${#PLUGINS_ENABLE[@]} -gt 0 && "$NO_PLUGINS" == "0" ]]; then
    say "Plugins enable : ${PLUGINS_ENABLE[*]}"
fi

if [[ "$NO_AGENT" == "0" && ("$AGENT_ENABLED" == "true" || "$AGENT_ENABLED" == "1") ]]; then
    say "Dev agent      : enabled (${AGENT_NAME})"
    say "Jira host      : ${JIRA_HOST:-<not set>}"
    say "Bitbucket repo : ${BB_WORKSPACE:-?}/${BB_REPO:-?}"
else
    say "Dev agent      : disabled"
fi

echo ""

if [[ "$DRY_RUN" == "1" ]]; then
    ok "[dry-run] Plan printed above. No changes made."
    exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
section "Step 4/4  Installing"
# ─────────────────────────────────────────────────────────────────────────────

# ── PART A: build / install openclaw ─────────────────────────────────────────

# Detect the repo root: we may be running from inside the cloned repo already
# (setup.sh cd'd into it before calling us), or the user ran us directly.
REPO_ROOT=""
_candidate_dir="$(cd "${SCRIPT_DIR}/.." 2>/dev/null && pwd || true)"
if [[ -f "${_candidate_dir}/package.json" ]] && \
   grep -q '"name"[[:space:]]*:[[:space:]]*"openclaw"' "${_candidate_dir}/package.json" 2>/dev/null; then
    REPO_ROOT="$_candidate_dir"
fi
# Also check one level up from CWD
if [[ -z "$REPO_ROOT" && -f "${PWD}/package.json" ]] && \
   grep -q '"name"[[:space:]]*:[[:space:]]*"openclaw"' "${PWD}/package.json" 2>/dev/null; then
    REPO_ROOT="$PWD"
fi

build_from_source() {
    if [[ -z "$REPO_ROOT" ]]; then
        err "Cannot find openclaw repo root. Make sure you are running this script from inside the cloned repository."
        exit 1
    fi

    if [[ "$NO_BUILD" == "1" ]]; then
        say "Skipping build (--no-build)"
        return 0
    fi

    say "Building from source in: ${REPO_ROOT}"
    cd "$REPO_ROOT"

    # Ensure pnpm
    if ! command -v pnpm &>/dev/null; then
        warn "pnpm not found — installing via npm …"
        npm install -g pnpm@10 2>/dev/null || {
            err "Could not install pnpm. Install it manually: https://pnpm.io/installation"
            exit 1
        }
        hash -r 2>/dev/null || true
    fi

    say "pnpm install …  (this may take a minute)"
    pnpm install --frozen-lockfile --ignore-scripts=false

    say "pnpm ui:build …  (installs UI deps + runs Vite build, may take a minute)"
    pnpm ui:build

    say "pnpm build …  (TypeScript compile + bundle)"
    pnpm build

    ok "Source build complete"
}

install_openclaw_package() {
    # source / git path
    if [[ "$INSTALL_METHOD" == "source" || "$INSTALL_METHOD" == "git" ]]; then
        build_from_source
        return 0
    fi

    # pnpm or npm global install
    local spec="openclaw"
    if [[ "$INSTALL_VERSION" == "main" ]]; then
        spec="github:openclaw/openclaw#main"
    elif [[ "$INSTALL_VERSION" != "latest" ]]; then
        spec="openclaw@${INSTALL_VERSION}"
    fi
    [[ "$INSTALL_BETA" == "true" ]] && spec="openclaw@beta"

    say "Installing ${spec} globally via ${INSTALL_METHOD} …"

    if [[ "$INSTALL_METHOD" == "pnpm" ]]; then
        if ! command -v pnpm &>/dev/null; then
            warn "pnpm not found — installing via npm"
            npm install -g pnpm@10 2>/dev/null || true
            hash -r 2>/dev/null || true
        fi
        if command -v pnpm &>/dev/null; then
            pnpm add -g "$spec"
        else
            warn "pnpm still not available; falling back to npm"
            npm install -g --no-fund --no-audit "$spec"
        fi
    else
        # npm
        npm install -g --no-fund --no-audit "$spec"
    fi
    hash -r 2>/dev/null || true
    ok "openclaw package installed"
}

pb_step "Installing openclaw"
if ! install_openclaw_package; then
    err "openclaw install failed"
    exit 1
fi

# ── resolve openclaw binary ───────────────────────────────────────────────────
OPENCLAW_BIN=""
hash -r 2>/dev/null || true

for _attempt in 1 2; do
    if command -v openclaw &>/dev/null; then
        OPENCLAW_BIN="$(command -v openclaw)"
        break
    fi
    # For source builds, prefer the local repo's pnpm-managed binary or openclaw.mjs
    if [[ -n "$REPO_ROOT" ]]; then
        _local_bin="${REPO_ROOT}/node_modules/.bin/openclaw"
        _local_mjs="${REPO_ROOT}/openclaw.mjs"
        if [[ -x "$_local_bin" ]]; then
            OPENCLAW_BIN="$_local_bin"
            break
        elif [[ -f "$_local_mjs" ]]; then
            # Wrap in a small shim so the rest of the script calls it uniformly
            OPENCLAW_BIN="node ${_local_mjs}"
            break
        fi
    fi
    # Try common global bin dirs
    for _dir in \
        "$(pnpm bin -g 2>/dev/null || true)" \
        "$(npm bin -g 2>/dev/null || true)" \
        "$HOME/.local/bin" \
        "/usr/local/bin" \
        "$HOME/.npm-global/bin"; do
        if [[ -n "$_dir" && -x "${_dir}/openclaw" ]]; then
            OPENCLAW_BIN="${_dir}/openclaw"
            export PATH="${_dir}:${PATH}"
            hash -r 2>/dev/null || true
            break 2
        fi
    done
done

if [[ -z "$OPENCLAW_BIN" ]]; then
    warn "openclaw binary not found on PATH after install."
    warn "Open a new terminal (so PATH refreshes), then re-run this script."
    exit 1
fi

ok "openclaw binary: ${OPENCLAW_BIN}"

# ── PART B: openclaw onboard --install-daemon ────────────────────────────────
run_onboard() {
    say "Running openclaw onboard …"

    # For source builds run through pnpm so the locally-built binary is used.
    # For package installs use the resolved binary directly.
    local -a cmd
    if [[ ("$INSTALL_METHOD" == "source" || "$INSTALL_METHOD" == "git") && -n "$REPO_ROOT" ]]; then
        cd "$REPO_ROOT"
        cmd=(pnpm openclaw onboard --non-interactive --accept-risk)
    else
        cmd=($OPENCLAW_BIN onboard --non-interactive --accept-risk)
    fi

    # flow + mode
    cmd+=(--flow "$ONBOARD_FLOW" --mode local)

    # gateway
    cmd+=(--gateway-port "$GW_PORT")
    cmd+=(--gateway-bind "$GW_BIND")
    cmd+=(--gateway-auth "$GW_AUTH_MODE")

    if [[ "$GW_AUTH_MODE" == "token" && -n "$GW_TOKEN" ]]; then
        cmd+=(--gateway-token "$GW_TOKEN")
    elif [[ "$GW_AUTH_MODE" == "password" && -n "$GW_PASSWORD" ]]; then
        cmd+=(--gateway-password "$GW_PASSWORD")
    fi

    # daemon — always install for source builds; honour JSON for package builds
    if [[ "$ONBOARD_INSTALL_DAEMON" == "true" ]]; then
        cmd+=(--install-daemon --daemon-runtime node)
    else
        cmd+=(--no-install-daemon)
    fi

    # AI provider auth
    cmd+=(--auth-choice "$PROVIDER_AUTH_CHOICE")

    case "$PROVIDER_AUTH_CHOICE" in
        openai-api-key)
            [[ -n "$PROVIDER_API_KEY" ]] && cmd+=(--openai-api-key "$PROVIDER_API_KEY") ;;
        setup-token)  # Anthropic
            [[ -n "$PROVIDER_API_KEY" ]] && cmd+=(--anthropic-api-key "$PROVIDER_API_KEY") ;;
        gemini-api-key)
            [[ -n "$PROVIDER_API_KEY" ]] && cmd+=(--gemini-api-key "$PROVIDER_API_KEY") ;;
        mistral-api-key)
            [[ -n "$PROVIDER_API_KEY" ]] && cmd+=(--mistral-api-key "$PROVIDER_API_KEY") ;;
        openrouter-api-key)
            [[ -n "$PROVIDER_API_KEY" ]] && cmd+=(--openrouter-api-key "$PROVIDER_API_KEY") ;;
        xai-api-key)
            [[ -n "$PROVIDER_API_KEY" ]] && cmd+=(--xai-api-key "$PROVIDER_API_KEY") ;;
        kilocode-api-key)
            [[ -n "$PROVIDER_API_KEY" ]] && cmd+=(--kilocode-api-key "$PROVIDER_API_KEY") ;;
        opencode-zen)
            [[ -n "$PROVIDER_API_KEY" ]] && cmd+=(--opencode-zen-api-key "$PROVIDER_API_KEY") ;;
        custom-api-key)
            [[ -n "$CUSTOM_BASE_URL"   ]] && cmd+=(--custom-base-url "$CUSTOM_BASE_URL")
            [[ -n "$PROVIDER_API_KEY"  ]] && cmd+=(--custom-api-key "$PROVIDER_API_KEY")
            [[ -n "$CUSTOM_PROVIDER_ID" ]] && cmd+=(--custom-provider-id "$CUSTOM_PROVIDER_ID")
            [[ -n "$CUSTOM_MODEL_ID"   ]] && cmd+=(--custom-model-id "$CUSTOM_MODEL_ID")
            cmd+=(--custom-compatibility "$CUSTOM_COMPAT") ;;
    esac

    # model override
    [[ -n "$PROVIDER_MODEL" ]] && cmd+=(--default-model "$PROVIDER_MODEL")

    # skip flags
    [[ "$ONBOARD_SKIP_SKILLS" == "true" ]] && cmd+=(--skip-skills)
    [[ "$ONBOARD_SKIP_SEARCH" == "true" ]] && cmd+=(--skip-search)
    [[ "$ONBOARD_SKIP_HEALTH" == "true" ]] && cmd+=(--skip-health)
    [[ "$ONBOARD_SKIP_UI"     == "true" ]] && cmd+=(--skip-ui)

    # channels are set up separately below; always skip in onboard
    cmd+=(--skip-channels)

    # Print the command so the user can see / replay it
    echo ""
    say "Command: ${cmd[*]}"
    echo ""

    if [[ "$VERBOSE" == "1" ]]; then
        "${cmd[@]}"
    else
        "${cmd[@]}" 2>&1 | (grep -vE '^\s*$' || true)
    fi

    ok "Onboarding complete"

    # Post-onboard: Ollama base URL (cannot be set via onboard flags)
    if [[ "${PROVIDER_AUTH_CHOICE}" == "skip" && -n "$OLLAMA_BASE_URL" ]]; then
        $OPENCLAW_BIN config set models.providers.ollama.baseUrl "$OLLAMA_BASE_URL" 2>/dev/null \
            && ok "ollama.baseUrl = ${OLLAMA_BASE_URL}" \
            || warn "Could not set ollama baseUrl; run: openclaw config set models.providers.ollama.baseUrl ${OLLAMA_BASE_URL}"
    fi
}

pb_step "Running onboard"
run_onboard

# ── PART C: add channels ──────────────────────────────────────────────────────

# Helper: run openclaw via pnpm (source) or directly (package)
run_openclaw() {
    if [[ ("$INSTALL_METHOD" == "source" || "$INSTALL_METHOD" == "git") && -n "$REPO_ROOT" ]]; then
        (cd "$REPO_ROOT" && pnpm openclaw "$@")
    else
        $OPENCLAW_BIN "$@"
    fi
}

setup_channels() {
    if [[ "$NO_CHANNELS" == "1" ]]; then
        say "Skipping channels (--no-channels)"
        return 0
    fi
    if [[ ${#ENABLED_CHANNELS[@]} -eq 0 ]]; then
        say "No channels enabled in config — skipping"
        return 0
    fi

    section "Configuring channels"

    if [[ "$TG_ENABLED" == "true" ]]; then
        if [[ -z "$TG_TOKEN" ]]; then
            TG_TOKEN="$(ask_secret "Telegram bot token (from @BotFather)")"
        fi
        if [[ -n "$TG_TOKEN" ]]; then
            run_openclaw channels add --channel telegram --token "$TG_TOKEN" \
                && ok "Telegram channel added" \
                || warn "Telegram channel add failed; run: openclaw channels add --channel telegram --token <token>"
        else
            warn "Telegram bot token not provided — skipping"
        fi
    fi

    if [[ "$DC_ENABLED" == "true" ]]; then
        if [[ -z "$DC_TOKEN" ]]; then
            DC_TOKEN="$(ask_secret "Discord bot token")"
        fi
        if [[ -n "$DC_TOKEN" ]]; then
            run_openclaw channels add --channel discord --token "$DC_TOKEN" \
                && ok "Discord channel added" \
                || warn "Discord channel add failed; run: openclaw channels add --channel discord --token <token>"
        else
            warn "Discord bot token not provided — skipping"
        fi
    fi

    if [[ "$SL_ENABLED" == "true" ]]; then
        if [[ -z "$SL_BOT_TOKEN" ]]; then
            SL_BOT_TOKEN="$(ask_secret "Slack bot token (xoxb-...)")"
        fi
        if [[ -z "$SL_APP_TOKEN" ]]; then
            SL_APP_TOKEN="$(ask_secret "Slack app token (xapp-...)")"
        fi
        if [[ -n "$SL_BOT_TOKEN" && -n "$SL_APP_TOKEN" ]]; then
            run_openclaw channels add --channel slack \
                --bot-token "$SL_BOT_TOKEN" --app-token "$SL_APP_TOKEN" \
                && ok "Slack channel added" \
                || warn "Slack channel add failed"
        else
            warn "Slack tokens not provided — skipping"
        fi
    fi

    if [[ "$SG_ENABLED" == "true" ]]; then
        if [[ -z "$SG_NUMBER" ]]; then
            SG_NUMBER="$(ask "Signal phone number (e.g. +12025551234)")"
        fi
        if [[ -n "$SG_NUMBER" ]]; then
            run_openclaw channels add --channel signal \
                --signal-number "$SG_NUMBER" --http-url "$SG_HTTP_URL" \
                && ok "Signal channel added" \
                || warn "Signal channel add failed"
        else
            warn "Signal number not provided — skipping"
        fi
    fi

    if [[ "$MX_ENABLED" == "true" ]]; then
        if [[ -z "$MX_HOMESERVER" ]]; then
            MX_HOMESERVER="$(ask "Matrix homeserver URL")"
        fi
        if [[ -z "$MX_USER_ID" ]]; then
            MX_USER_ID="$(ask "Matrix user ID (e.g. @bot:matrix.org)")"
        fi
        if [[ -z "$MX_ACCESS_TOKEN" ]]; then
            MX_ACCESS_TOKEN="$(ask_secret "Matrix access token")"
        fi
        if [[ -n "$MX_HOMESERVER" && -n "$MX_USER_ID" && -n "$MX_ACCESS_TOKEN" ]]; then
            run_openclaw channels add --channel matrix \
                --homeserver "$MX_HOMESERVER" \
                --user-id    "$MX_USER_ID" \
                --access-token "$MX_ACCESS_TOKEN" \
                && ok "Matrix channel added" \
                || warn "Matrix channel add failed"
        else
            warn "Matrix credentials incomplete — skipping"
        fi
    fi
}

pb_step "Configuring channels"
setup_channels

# ── PART D: install and enable plugins ───────────────────────────────────────
setup_plugins() {
    if [[ "$NO_PLUGINS" == "1" ]]; then
        say "Skipping plugins (--no-plugins)"
        return 0
    fi

    local did_anything=0

    if [[ ${#PLUGINS_INSTALL[@]} -gt 0 ]]; then
        section "Installing plugins"
        for spec in "${PLUGINS_INSTALL[@]}"; do
            [[ -z "$spec" ]] && continue
            say "Installing plugin: ${spec}"
            if run_openclaw plugins install "$spec"; then
                ok "Plugin installed: ${spec}"
            else
                warn "Plugin install failed: ${spec} — run manually: openclaw plugins install ${spec}"
            fi
            did_anything=1
        done
    fi

    if [[ ${#PLUGINS_ENABLE[@]} -gt 0 ]]; then
        section "Enabling plugins"
        for pid in "${PLUGINS_ENABLE[@]}"; do
            [[ -z "$pid" ]] && continue
            say "Enabling plugin: ${pid}"
            if run_openclaw plugins enable "$pid"; then
                ok "Plugin enabled: ${pid}"
            else
                warn "Plugin enable failed: ${pid} — run manually: openclaw plugins enable ${pid}"
            fi
            did_anything=1
        done
    fi

    if [[ "$did_anything" == "0" ]]; then
        say "No plugins listed in config — skipping"
    fi
}

pb_step "Installing/enabling plugins"
setup_plugins

# ── PART E: configure dev agent ──────────────────────────────────────────────
setup_dev_agent() {
    if [[ "$NO_AGENT" == "1" ]]; then
        say "Skipping dev agent (--no-agent)"
        return 0
    fi
    if [[ "$AGENT_ENABLED" != "true" && "$AGENT_ENABLED" != "1" ]]; then
        say "Dev agent disabled in config — skipping"
        return 0
    fi

    section "Configuring Dev Agent"

    local instances_file="${HOME}/.openclaw/dev-agent-instances.json"
    mkdir -p "$(dirname "$instances_file")"

    local agent_id now_ms
    agent_id="$(node -e "process.stdout.write(Math.random().toString(36).slice(2,10))" 2>/dev/null \
        || python3 -c "import random,string; print(''.join(random.choices(string.ascii_lowercase+string.digits,k=8)),end='')" 2>/dev/null \
        || echo "agent01")"
    now_ms="$(node -e "process.stdout.write(String(Date.now()))" 2>/dev/null \
        || python3 -c "import time; print(int(time.time()*1000),end='')" 2>/dev/null \
        || echo "0")"

    local bb_base_url_eff="${BB_BASE_URL:-https://api.bitbucket.org/2.0}"
    local behavior_eff="${AGENT_BEHAVIOR_MD:-# Agent Behavior\n\nFollow the project coding conventions and always write tests for new code.}"
    local workflow_def
    workflow_def="$(cat <<'MD'
# Jira Ticket Workflow

1. Move ticket to In Progress
2. Read the description carefully; post a Jira comment and skip if ambiguous
3. Create a feature branch: feature/<TICKET-KEY>-short-description
4. Implement the change following project coding conventions
5. Write or update unit tests
6. Run tests: pnpm test
7. Open a PR against the default branch
8. Move ticket to In Review
MD
)"

    # Export for the node heredoc
    export AGENT_ID="$agent_id"
    export AGENT_NAME AGENT_POLL_MS NOW_MS="$now_ms"
    export JIRA_HOST JIRA_EMAIL JIRA_TOKEN JIRA_PROJECT JIRA_MAX_TICKETS
    export BB_USERNAME BB_APP_PASSWORD BB_WORKSPACE BB_REPO BB_BASE_URL_EFF="$bb_base_url_eff"
    export GIT_DEFAULT_BRANCH BEHAVIOR_EFF="$behavior_eff" WORKFLOW_DEF="$workflow_def"

    local agent_json
    agent_json="$(node - 2>/dev/null <<'NODEJS_EOF'
const entry = {
  id: process.env.AGENT_ID,
  name: process.env.AGENT_NAME,
  status: 'stopped',
  createdAtMs: Number(process.env.NOW_MS) || 0,
  params: {
    pollIntervalMs: Number(process.env.AGENT_POLL_MS) || 300000,
    behaviorMd: process.env.BEHAVIOR_EFF,
    jiraWorkflowMd: process.env.WORKFLOW_DEF,
    jira: {
      host:       process.env.JIRA_HOST,
      email:      process.env.JIRA_EMAIL,
      apiToken:   process.env.JIRA_TOKEN,
      projectKey: process.env.JIRA_PROJECT,
      maxTickets: Number(process.env.JIRA_MAX_TICKETS) || 1
    },
    bitbucket: {
      username:    process.env.BB_USERNAME,
      appPassword: process.env.BB_APP_PASSWORD,
      workspace:   process.env.BB_WORKSPACE,
      repo:        process.env.BB_REPO,
      baseUrl:     process.env.BB_BASE_URL_EFF
    },
    git: { defaultBranch: process.env.GIT_DEFAULT_BRANCH || 'main' }
  }
};
process.stdout.write(JSON.stringify(entry, null, 2));
NODEJS_EOF
)" || true

    if [[ -z "$agent_json" ]]; then
        warn "Could not generate dev-agent config (node unavailable). Create the agent manually in the web UI."
        return 0
    fi

    # Merge into existing instances file or create fresh
    local merged
    if [[ -f "$instances_file" ]]; then
        merged="$(node - <<<"$agent_json" 2>/dev/null <<'NODEJS_EOF'
const fs = require('fs');
try {
  const existing = JSON.parse(fs.readFileSync(process.env.INSTANCES_FILE, 'utf8'));
  const arr = Array.isArray(existing) ? existing : [];
  const newEntry = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  const idx = arr.findIndex(x => x.id === newEntry.id);
  if (idx >= 0) arr[idx] = newEntry; else arr.push(newEntry);
  process.stdout.write(JSON.stringify(arr, null, 2));
} catch(e) { process.exit(1); }
NODEJS_EOF
)" || merged=""

        if [[ -z "$merged" ]]; then
            # Safe fallback: append as a new entry using python
            merged="$(python3 - <<<"$agent_json" 2>/dev/null <<PYEOF || true
import json, sys
existing = json.load(open("$instances_file"))
arr = existing if isinstance(existing, list) else []
new_entry = json.loads(sys.stdin.read())
arr.append(new_entry)
print(json.dumps(arr, indent=2))
PYEOF
)"
        fi
    else
        merged="$(node -e "process.stdout.write(JSON.stringify([JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))],null,2))" <<<"$agent_json" 2>/dev/null || true)"
    fi

    if [[ -n "$merged" ]]; then
        printf '%s\n' "$merged" > "$instances_file"
        chmod 600 "$instances_file"
        ok "Dev agent '${AGENT_NAME}' written to ${instances_file}"
        hint "Start it: open the OpenClaw web UI → Dev Agents, then click Start"
    else
        warn "Could not write dev-agent config. Create it manually via the web UI."
    fi
}

export INSTANCES_FILE="${HOME}/.openclaw/dev-agent-instances.json"
pb_step "Configuring dev agent"
setup_dev_agent

# ─────────────────────────────────────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${SUCCESS}${BOLD}  🦞 OpenClaw is ready!${NC}"
echo ""

if [[ "$GW_AUTH_MODE" == "token" && -n "$GW_TOKEN" ]]; then
    echo -e "${WARN}${BOLD}  Your gateway token (save this):${NC}"
    echo -e "  ${BOLD}${GW_TOKEN}${NC}"
    echo ""
fi

echo -e "${ACCENT}${BOLD}  Useful commands:${NC}"
echo ""

if [[ ("$INSTALL_METHOD" == "source" || "$INSTALL_METHOD" == "git") && -n "$REPO_ROOT" ]]; then
    _cd_hint="cd ${REPO_ROOT}"
    echo -e "  ${BOLD}${_cd_hint}${NC}"
    echo ""
    say "Dev loop (auto-reload on source/config changes):"
    echo -e "  ${BOLD}pnpm gateway:watch${NC}"
    echo ""
    say "Other dev commands:"
    echo -e "  ${INFO}pnpm dev${NC}                      # run node without watching"
    echo -e "  ${INFO}pnpm gateway:dev${NC}              # gateway only, skip channels"
    echo -e "  ${INFO}pnpm gateway:dev:reset${NC}        # gateway + reset state"
else
    say "Start gateway  :  openclaw gateway run"
fi

say "Check status   :  openclaw channels status --probe"
say "Web UI         :  openclaw dashboard"
say "Docs           :  https://docs.openclaw.ai"
echo ""


