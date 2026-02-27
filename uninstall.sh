#!/usr/bin/env bash
# uninstall.sh - macOS/Linux uninstaller for ivLyrics AI CLI Provider addons/proxy
# Compatible with bash 3.2+ (macOS default)

set -euo pipefail

SPICETIFY_CONFIG=""
IVLYRICS_APP=""
IVLYRICS_DATA=""
MANIFEST=""
ADDON_SOURCES=""
CLI_PROXY_DIR=""

ADDONS="Addon_AI_CLI_Provider.js Addon_AI_CLI_ClaudeCode.js Addon_AI_CLI_CodexCLI.js Addon_AI_CLI_GeminiCLI.js"

info()  { printf '\033[1;34m[INFO]\033[0m  %s\n' "$1"; }
ok()    { printf '\033[1;32m[OK]\033[0m    %s\n' "$1"; }
warn()  { printf '\033[1;33m[WARN]\033[0m  %s\n' "$1"; }

HAS_SPICETIFY=0

resolve_spicetify_config() {
    local cfg=""
    local from_cmd=""

    if command -v spicetify >/dev/null 2>&1; then
        cfg=$(spicetify -c 2>/dev/null || true)
        if [ -n "$cfg" ]; then
            from_cmd=$(dirname "$cfg")
        fi
    fi

    local candidates=""
    if [ -n "$from_cmd" ]; then
        candidates="$from_cmd"
    fi
    candidates="$candidates
$HOME/.config/spicetify
$HOME/.spicetify"

    local d
    local IFS_BAK="$IFS"
    IFS=$'\n'
    for d in $candidates; do
        [ -n "$d" ] || continue
        if [ -d "$d" ]; then
            IFS="$IFS_BAK"
            printf '%s\n' "$d"
            return 0
        fi
    done
    IFS="$IFS_BAK"

    if [ -n "$from_cmd" ]; then
        printf '%s\n' "$from_cmd"
    else
        printf '%s\n' "$HOME/.config/spicetify"
    fi
}

refresh_paths() {
    SPICETIFY_CONFIG=$(resolve_spicetify_config)
    IVLYRICS_APP="$SPICETIFY_CONFIG/CustomApps/ivLyrics"
    IVLYRICS_DATA="$SPICETIFY_CONFIG/ivLyrics"
    MANIFEST="$IVLYRICS_APP/manifest.json"
    ADDON_SOURCES="$IVLYRICS_DATA/addon_sources.json"
    CLI_PROXY_DIR="$SPICETIFY_CONFIG/cli-proxy"
}

preflight() {
    if command -v spicetify >/dev/null 2>&1; then
        HAS_SPICETIFY=1
    else
        warn "spicetify not found in PATH. 'spicetify apply' will be skipped."
    fi
}

remove_manifest_entry() {
    local entry="$1"
    [ -f "$MANIFEST" ] || return 0

    local tmp="${MANIFEST}.tmp"
    awk -v target="$entry" '
    {
        line=$0
        key=line
        gsub(/[[:space:]]/, "", key)
        if (key == "\"" target "\"," || key == "\"" target "\"") next
        print line
    }
    ' "$MANIFEST" > "$tmp"
    mv "$tmp" "$MANIFEST"
}

remove_addon_source() {
    local filename="$1"
    [ -f "$ADDON_SOURCES" ] || return 0

    local tmp="${ADDON_SOURCES}.tmp"
    awk -v key="$filename" '
    BEGIN { n=0 }
    /"[^"]*"[[:space:]]*:[[:space:]]*"[^"]*"/ {
        s = $0
        gsub(/^[^"]*"/, "", s); gsub(/".*$/, "", s); k = s
        s = $0; sub(/^[^:]*:[[:space:]]*"/, "", s); gsub(/".*$/, "", s); v = s
        if (k == key) next
        keys[n] = k; vals[n] = v; n++
        next
    }
    END {
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

remove_addon() {
    local filename="$1"
    local path="$IVLYRICS_APP/$filename"

    if [ -f "$path" ]; then
        rm -f "$path"
        ok "Deleted addon file: $path"
    else
        info "Addon file not found, skipping: $path"
    fi

    remove_manifest_entry "$filename"
    remove_addon_source "$filename"
    ok "Removed references for $filename"
}

remove_all_addons() {
    for addon in $ADDONS; do
        remove_addon "$addon"
    done
}

remove_proxy() {
    if [ ! -d "$CLI_PROXY_DIR" ]; then
        info "Proxy directory not found, skipping: $CLI_PROXY_DIR"
        return 0
    fi
    rm -rf "$CLI_PROXY_DIR"
    ok "Deleted proxy directory: $CLI_PROXY_DIR"
}

show_menu() {
    echo ""
    echo "╔══════════════════════════════════════════════╗"
    echo "║    ivLyrics AI CLI Provider - Uninstaller    ║"
    echo "╚══════════════════════════════════════════════╝"
    echo ""
    echo "  a) Remove addons only"
    echo "  p) Remove proxy only"
    echo "  f) Full uninstall (addons + proxy)"
    echo "  q) Quit"
    echo ""
    printf "Select action (a, p, f, q): "
    read -r selection

    case "$selection" in
        q|Q)
            echo "Cancelled."; exit 0
            ;;
        a|A)
            remove_all_addons
            ;;
        p|P)
            remove_proxy
            ;;
        f|F)
            remove_all_addons
            remove_proxy
            ;;
        *)
            warn "Invalid selection: $selection"
            exit 1
            ;;
    esac
}

main() {
    preflight
    refresh_paths
    info "Using Spicetify config: $SPICETIFY_CONFIG"

    local arg_count="$#"
    local remove_addons_flag=0
    local remove_proxy_flag=0

    while [ $# -gt 0 ]; do
        case "$1" in
            --addons|-a)
                remove_addons_flag=1
                ;;
            --proxy|-p)
                remove_proxy_flag=1
                ;;
            --full|-f)
                remove_addons_flag=1
                remove_proxy_flag=1
                ;;
            --help|-h)
                echo "Usage: bash uninstall.sh [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  (no args)        Interactive menu"
                echo "  --addons, -a     Remove addons only"
                echo "  --proxy, -p      Remove proxy only"
                echo "  --full, -f       Remove addons + proxy"
                echo "  --help, -h       Show this help"
                exit 0
                ;;
            *)
                warn "Unknown option: $1"
                exit 1
                ;;
        esac
        shift
    done

    if [ "$arg_count" -eq 0 ]; then
        show_menu
    else
        if [ "$remove_addons_flag" -eq 1 ]; then
            remove_all_addons
        fi
        if [ "$remove_proxy_flag" -eq 1 ]; then
            remove_proxy
        fi
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
        warn "Run 'spicetify apply' manually to apply uninstall changes."
    fi

    echo ""
    ok "Uninstall complete!"
}

main "$@"
