#!/usr/bin/env bash
# install.sh - macOS/Linux installer for ivLyrics AI CLI Provider addons/proxy
# Compatible with bash 3.2+ (macOS default)

set -euo pipefail

REPO_BASE="https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main"
SPICETIFY_CONFIG="$HOME/.config/spicetify"
IVLYRICS_APP="$SPICETIFY_CONFIG/CustomApps/ivLyrics"
IVLYRICS_DATA="$SPICETIFY_CONFIG/ivLyrics"
MANIFEST="$IVLYRICS_APP/manifest.json"
ADDON_SOURCES="$IVLYRICS_DATA/addon_sources.json"
CLI_PROXY_DIR="$SPICETIFY_CONFIG/cli-proxy"

ADDONS="Addon_AI_CLI_Provider.js"
ADDON_LABELS="AI CLI Provider (Claude + Gemini + Codex)"
PROXY_FILES="server.js package.json README.md spotify-with-proxy.sh spotify-with-proxy.ps1"
NO_NPM_INSTALL=0
NO_APPLY=0
DID_ADDON_INSTALL=0

# ── helpers ──────────────────────────────────────────────────────────────────

info()  { printf '\033[1;34m[INFO]\033[0m  %s\n' "$1"; }
ok()    { printf '\033[1;32m[OK]\033[0m    %s\n' "$1"; }
warn()  { printf '\033[1;33m[WARN]\033[0m  %s\n' "$1"; }
err()   { printf '\033[1;31m[ERROR]\033[0m %s\n' "$1" >&2; }

# ── pre-flight checks ───────────────────────────────────────────────────────

preflight() {
    if ! command -v curl >/dev/null 2>&1; then
        err "curl is required but not found."
        exit 1
    fi

    if ! command -v npm >/dev/null 2>&1; then
        warn "npm not found in PATH. Proxy dependencies will not be installed automatically."
        HAS_NPM=0
    else
        HAS_NPM=1
    fi

    if ! command -v spicetify >/dev/null 2>&1; then
        warn "spicetify not found in PATH. 'spicetify apply' will be skipped."
        HAS_SPICETIFY=0
    else
        HAS_SPICETIFY=1
    fi

    if command -v node >/dev/null 2>&1; then
        local node_ver
        node_ver=$(node --version 2>/dev/null | sed 's/^v//')
        local node_major
        node_major=$(echo "$node_ver" | cut -d. -f1)
        if [ -n "$node_major" ] && [ "$node_major" -lt 18 ] 2>/dev/null; then
            warn "Node.js v${node_ver} detected. v18+ is required for the CLI proxy."
        fi
    fi
}

ensure_ivlyrics_ready() {
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

    ensure_ivlyrics_ready

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
    DID_ADDON_INSTALL=1
}

install_proxy() {
    info "Installing proxy files to $CLI_PROXY_DIR ..."
    mkdir -p "$CLI_PROXY_DIR"

    for rel in $PROXY_FILES; do
        local dest="$CLI_PROXY_DIR/$rel"
        mkdir -p "$(dirname "$dest")"
        info "Downloading cli-proxy/$rel ..."
        if ! curl -fsSL "$REPO_BASE/cli-proxy/$rel" -o "$dest"; then
            err "Failed to download cli-proxy/$rel"
            return 1
        fi
    done

    chmod +x "$CLI_PROXY_DIR/spotify-with-proxy.sh" 2>/dev/null || true
    ok "Proxy files installed."

    if [ "$NO_NPM_INSTALL" -eq 1 ]; then
        warn "Skipped npm install (--no-npm-install)."
        return 0
    fi

    if [ "$HAS_NPM" -eq 1 ]; then
        info "Running npm install in $CLI_PROXY_DIR ..."
        if (cd "$CLI_PROXY_DIR" && npm install); then
            ok "Proxy dependencies installed."
        else
            warn "npm install failed. Run manually: cd \"$CLI_PROXY_DIR\" && npm install"
        fi
    else
        warn "Run manually after installing Node.js: cd \"$CLI_PROXY_DIR\" && npm install"
    fi
}

proxy_ready() {
    [ -f "$CLI_PROXY_DIR/package.json" ] && [ -f "$CLI_PROXY_DIR/server.js" ]
}

ensure_proxy_ready() {
    if ! proxy_ready; then
        info "cli-proxy not found. Installing..."
        install_proxy
        return
    fi

    if [ "$NO_NPM_INSTALL" -eq 1 ]; then
        warn "Skipped npm install (--no-npm-install)."
        return
    fi

    if [ -d "$CLI_PROXY_DIR/node_modules" ]; then
        return
    fi

    if [ "$HAS_NPM" -eq 1 ]; then
        info "Installing proxy dependencies ..."
        if (cd "$CLI_PROXY_DIR" && npm install); then
            ok "Proxy dependencies installed."
        else
            warn "npm install failed. Run manually: cd \"$CLI_PROXY_DIR\" && npm install"
        fi
    else
        warn "Run manually after installing Node.js: cd \"$CLI_PROXY_DIR\" && npm install"
    fi
}

start_proxy() {
    if ! proxy_ready; then
        err "cli-proxy not found at $CLI_PROXY_DIR"
        err "Run with --proxy first, or use --start-proxy only to auto-install."
        exit 1
    fi

    if [ "$HAS_NPM" -ne 1 ]; then
        err "npm not found in PATH. Install Node.js and retry."
        exit 1
    fi

    info "Starting proxy server ..."
    (cd "$CLI_PROXY_DIR" && npm start)
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
    echo "  p) Install proxy only"
    echo "  f) Full install (all addons + proxy)"
    echo "  q) Quit"
    echo ""
    printf "Select action (e.g. 1 3, a, p, f): "
    read -r selection

    if [ "$selection" = "q" ] || [ "$selection" = "Q" ]; then
        echo "Cancelled."
        exit 0
    fi

    if [ "$selection" = "a" ] || [ "$selection" = "A" ]; then
        install_all
        return
    fi
    if [ "$selection" = "p" ] || [ "$selection" = "P" ]; then
        install_proxy
        return
    fi
    if [ "$selection" = "f" ] || [ "$selection" = "F" ]; then
        install_all
        install_proxy
        return
    fi

    local addon_list
    addon_list=$(echo "$ADDONS" | tr ' ' '\n')

    for num in $selection; do
        # Validate: must be a positive integer in range 1
        case "$num" in
            [1]) ;;
            *)
                warn "Invalid selection: $num (enter 1)"
                continue
                ;;
        esac
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

# ── main ─────────────────────────────────────────────────────────────────────

main() {
    preflight
    local arg_count="$#"
    local install_addons_flag=0
    local install_proxy_flag=0
    local start_proxy_flag=0
    local custom_urls=""

    while [ $# -gt 0 ]; do
        case "$1" in
            --all|-a)
                install_addons_flag=1
                ;;
            --proxy|-p)
                install_proxy_flag=1
                ;;
            --full|-f)
                install_addons_flag=1
                install_proxy_flag=1
                ;;
            --start-proxy|--start|-s)
                start_proxy_flag=1
                ;;
            --no-npm-install)
                NO_NPM_INSTALL=1
                ;;
            --no-apply)
                NO_APPLY=1
                ;;
            --help|-h)
                echo "Usage: bash install.sh [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  (no args)           Interactive selection menu"
                echo "  --all, -a           Install all addons"
                echo "  --proxy, -p         Install proxy only"
                echo "  --full, -f          Install all addons + proxy"
                echo "  --start-proxy, -s   Start proxy (auto-install if missing)"
                echo "  --no-npm-install    Skip npm install in proxy directory"
                echo "  --no-apply          Skip spicetify apply"
                echo "  --help, -h          Show this help"
                echo "  <URL>               Install addon from URL"
                exit 0
                ;;
            *)
                custom_urls="$custom_urls
$1"
                ;;
        esac
        shift
    done

    if [ "$arg_count" -eq 0 ]; then
        show_menu
    else
        if [ "$install_addons_flag" -eq 1 ]; then
            install_all
        fi
        if [ "$install_proxy_flag" -eq 1 ]; then
            install_proxy
        fi
        if [ "$start_proxy_flag" -eq 1 ] && [ "$install_proxy_flag" -eq 0 ]; then
            ensure_proxy_ready
        fi
        if [ -n "$custom_urls" ]; then
            local IFS_BAK="$IFS"
            IFS=$'\n'
            for url in $custom_urls; do
                [ -z "$url" ] && continue
                install_addon "$url"
            done
            IFS="$IFS_BAK"
        fi
        if [ "$install_addons_flag" -eq 0 ] && [ "$install_proxy_flag" -eq 0 ] && [ -z "$custom_urls" ]; then
            show_menu
        fi
    fi

    if [ "$NO_APPLY" -eq 0 ] && [ "$DID_ADDON_INSTALL" -eq 1 ]; then
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
    fi

    if [ "$start_proxy_flag" -eq 1 ]; then
        start_proxy
    fi

    echo ""
    ok "Installation complete!"
}

main "$@"
