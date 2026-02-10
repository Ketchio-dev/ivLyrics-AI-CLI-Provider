#!/usr/bin/env bash
# install.sh - macOS/Linux installer for ivLyrics AI CLI Provider addons
# Compatible with bash 3.2+ (macOS default)

set -euo pipefail

REPO_BASE="https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main"
SPICETIFY_CONFIG="$HOME/.config/spicetify"
IVLYRICS_APP="$SPICETIFY_CONFIG/CustomApps/ivLyrics"
IVLYRICS_DATA="$SPICETIFY_CONFIG/ivLyrics"
CLI_PROXY_DIR="$SPICETIFY_CONFIG/cli-proxy"
MANIFEST="$IVLYRICS_APP/manifest.json"
ADDON_SOURCES="$IVLYRICS_DATA/addon_sources.json"

ADDONS="Addon_AI_CLI_ClaudeCode.js Addon_AI_CLI_CodexCLI.js Addon_AI_CLI_GeminiCLI.js"
ADDON_LABELS="Claude Code;Codex CLI;Gemini CLI"
PROXY_FILES="server.js package.json spotify-with-proxy.sh .env.example"

# ── helpers ──────────────────────────────────────────────────────────────────

info()  { printf '\033[1;34m[INFO]\033[0m  %s\n' "$1"; }
ok()    { printf '\033[1;32m[OK]\033[0m    %s\n' "$1"; }
warn()  { printf '\033[1;33m[WARN]\033[0m  %s\n' "$1"; }
err()   { printf '\033[1;31m[ERROR]\033[0m %s\n' "$1" >&2; }

# ── pre-flight checks ───────────────────────────────────────────────────────

preflight() {
    if ! command -v curl >/dev/null 2>&1; then
        err "curl is required but not found."; exit 1
    fi
    if ! command -v spicetify >/dev/null 2>&1; then
        warn "spicetify not found in PATH. 'spicetify apply' will be skipped."
        HAS_SPICETIFY=0
    else
        HAS_SPICETIFY=1
    fi
    if [ ! -d "$IVLYRICS_APP" ]; then
        err "ivLyrics not found at $IVLYRICS_APP"
        err "Please install ivLyrics first: https://github.com/ivLis-STUDIO/ivLyrics"
        exit 1
    fi
    if [ ! -f "$MANIFEST" ]; then
        err "manifest.json not found at $MANIFEST"
        exit 1
    fi
}

# ── addon_sources.json ───────────────────────────────────────────────────────
# Simple flat JSON: { "file.js": "url", ... }
# Manipulated with grep/sed instead of declare -A for bash 3.2 compat.

ensure_addon_sources() {
    mkdir -p "$IVLYRICS_DATA"
    if [ ! -f "$ADDON_SOURCES" ]; then
        printf '{\n}\n' > "$ADDON_SOURCES"
    fi
}

update_addon_source() {
    local filename="$1"
    local url="$2"
    ensure_addon_sources

    # Use awk to upsert key in JSON object (portable across macOS/GNU awk)
    local tmp="${ADDON_SOURCES}.tmp"
    awk -v key="$filename" -v val="$url" '
    BEGIN { found=0; n=0 }
    /"[^"]*"[[:space:]]*:[[:space:]]*"[^"]*"/ {
        # strip to extract key: first quoted string
        s = $0
        gsub(/^[^"]*"/, "", s); gsub(/".*$/, "", s); k = s
        # extract value: second quoted string after colon
        s = $0; sub(/^[^:]*:[[:space:]]*"/, "", s); gsub(/".*$/, "", s); v = s
        if (k == key) { v = val; found = 1 }
        keys[n] = k; vals[n] = v; n++
        next
    }
    END {
        if (!found) { keys[n] = key; vals[n] = val; n++ }
        print "{"
        for (i = 0; i < n; i++) {
            printf "    \"%s\": \"%s\"", keys[i], vals[i]
            if (i < n - 1) printf ","
            printf "\n"
        }
        print "}"
    }
    ' "$ADDON_SOURCES" > "$tmp"
    mv "$tmp" "$ADDON_SOURCES"
}

# ── manifest.json ────────────────────────────────────────────────────────────

add_manifest_entry() {
    local entry="$1"

    if grep -q "\"$entry\"" "$MANIFEST"; then
        info "\"$entry\" already in manifest.json, skipping."
        return
    fi

    # Insert entry after the "subfiles_extension": [ line
    # Using awk for cross-platform compatibility (sed -a differs between macOS/GNU)
    local tmp="${MANIFEST}.tmp"
    awk -v new_entry="$entry" '
        /"subfiles_extension"[[:space:]]*:[[:space:]]*\[/ {
            print
            printf "        \"%s\",\n", new_entry
            next
        }
        { print }
    ' "$MANIFEST" > "$tmp"
    mv "$tmp" "$MANIFEST"
    ok "Registered \"$entry\" in manifest.json"
}

# ── install single addon ────────────────────────────────────────────────────

install_addon() {
    local url="$1"
    local filename
    filename=$(basename "$url")

    if [ "${filename%.js}" = "$filename" ]; then
        err "URL must point to a .js file: $url"
        return 1
    fi

    local dest="$IVLYRICS_APP/$filename"

    info "Downloading $filename ..."
    if ! curl -fsSL "$url" -o "$dest"; then
        err "Failed to download $filename"
        return 1
    fi
    ok "Downloaded → $dest"

    update_addon_source "$filename" "$url"
    ok "Updated addon_sources.json"

    add_manifest_entry "$filename"
}

# ── selection menu ───────────────────────────────────────────────────────────

show_menu() {
    echo ""
    echo "╔══════════════════════════════════════════════╗"
    echo "║   ivLyrics AI CLI Provider - Addon Installer ║"
    echo "╚══════════════════════════════════════════════╝"
    echo ""
    echo "Available addons:"
    echo ""

    local i=1
    local IFS_BAK="$IFS"
    IFS=";"
    for label in $ADDON_LABELS; do
        printf "  %d) %s\n" "$i" "$label"
        i=$((i + 1))
    done
    IFS="$IFS_BAK"

    echo "  a) Install all"
    echo "  q) Quit"
    echo ""
    printf "Select addons to install (e.g. 1 3, a for all): "
    read -r selection

    if [ "$selection" = "q" ] || [ "$selection" = "Q" ]; then
        echo "Cancelled."; exit 0
    fi

    if [ "$selection" = "a" ] || [ "$selection" = "A" ]; then
        install_all
        return
    fi

    local addon_list
    addon_list=$(echo "$ADDONS" | tr ' ' '\n')

    for num in $selection; do
        local addon
        addon=$(echo "$addon_list" | sed -n "${num}p")
        if [ -z "$addon" ]; then
            warn "Invalid selection: $num"
            continue
        fi
        install_addon "$REPO_BASE/$addon"
    done
}

# ── install all ──────────────────────────────────────────────────────────────

install_all() {
    for addon in $ADDONS; do
        install_addon "$REPO_BASE/$addon"
    done
}

# ── proxy server install ────────────────────────────────────────────────────

install_proxy() {
    if [ -f "$CLI_PROXY_DIR/server.js" ] && [ -f "$CLI_PROXY_DIR/package.json" ]; then
        info "Proxy server already installed at $CLI_PROXY_DIR"
        printf "  Reinstall / update? (y/N): "
        read -r reinstall
        case "$reinstall" in
            y|Y|yes|YES) ;;
            *) info "Skipping proxy server install."; return 0 ;;
        esac
    fi

    if ! command -v node >/dev/null 2>&1; then
        err "Node.js is required but not found."
        err "Install from: https://nodejs.org/"
        return 1
    fi

    if ! command -v npm >/dev/null 2>&1; then
        err "npm is required but not found."
        return 1
    fi

    mkdir -p "$CLI_PROXY_DIR"

    info "Downloading proxy server files..."
    for file in $PROXY_FILES; do
        if ! curl -fsSL "$REPO_BASE/cli-proxy/$file" -o "$CLI_PROXY_DIR/$file"; then
            err "Failed to download $file"
            return 1
        fi
    done
    chmod +x "$CLI_PROXY_DIR/spotify-with-proxy.sh"
    ok "Downloaded proxy server → $CLI_PROXY_DIR"

    info "Installing dependencies (npm install)..."
    if (cd "$CLI_PROXY_DIR" && npm install --silent); then
        ok "Dependencies installed"
    else
        err "npm install failed"
        return 1
    fi

    echo ""
    ok "Proxy server installed!"
    echo ""
    info "To start the server:"
    echo "  cd $CLI_PROXY_DIR && npm start"
    echo ""
    info "To auto-start with Spotify (macOS):"
    echo "  $CLI_PROXY_DIR/spotify-with-proxy.sh"
}

ask_install_proxy() {
    echo ""
    echo "────────────────────────────────────────"
    info "Proxy server is required for addons to work."
    if [ -f "$CLI_PROXY_DIR/server.js" ]; then
        info "(Proxy server is already installed at $CLI_PROXY_DIR)"
    fi
    printf "  Install proxy server? (Y/n): "
    read -r answer
    case "$answer" in
        n|N|no|NO) info "Skipping proxy server. You can install it later manually." ;;
        *) install_proxy ;;
    esac
}

# ── main ─────────────────────────────────────────────────────────────────────

main() {
    preflight

    if [ $# -eq 0 ]; then
        show_menu
    elif [ "$1" = "--all" ] || [ "$1" = "-a" ]; then
        install_all
    elif [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
        echo "Usage: bash install.sh [OPTIONS]"
        echo ""
        echo "Options:"
        echo "  (no args)       Interactive selection menu"
        echo "  --all, -a       Install all addons"
        echo "  --proxy-only    Install proxy server only (skip addons)"
        echo "  --help, -h      Show this help"
        echo "  <URL>           Install addon from URL"
        exit 0
    elif [ "$1" = "--proxy-only" ]; then
        install_proxy
        echo ""
        ok "Installation complete!"
        exit 0
    else
        # treat each argument as a URL
        for url in "$@"; do
            install_addon "$url"
        done
    fi

    echo ""
    if [ "$HAS_SPICETIFY" -eq 1 ]; then
        info "Running spicetify apply ..."
        if spicetify apply; then
            ok "spicetify apply completed!"
        else
            warn "spicetify apply failed. You may need to run it manually."
        fi
    else
        warn "Run 'spicetify apply' manually to activate the addons."
    fi

    # stdin이 터미널일 때만 프록시 서버 설치를 물어봄 (파이프 실행 시 스킵)
    if [ -t 0 ]; then
        ask_install_proxy
    else
        echo ""
        info "Proxy server was not installed (non-interactive mode)."
        info "To install manually: cd ~/.config/spicetify/cli-proxy && npm install"
    fi

    echo ""
    ok "Installation complete!"
}

main "$@"
