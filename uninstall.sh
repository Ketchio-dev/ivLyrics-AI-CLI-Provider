#!/usr/bin/env bash
# uninstall.sh - macOS/Linux uninstaller for ivLyrics AI CLI Provider addons/proxy
# Compatible with bash 3.2+ (macOS default)

set -euo pipefail

SPICETIFY_CONFIG=""
IVLYRICS_APP=""
IVLYRICS_ROOT=""
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
    local candidates
    candidates=$(get_spicetify_candidates)

    local first=""
    local d
    local IFS_BAK="$IFS"
    IFS=$'\n'
    for d in $candidates; do
        [ -n "$d" ] || continue
        if [ -z "$first" ]; then
            first="$d"
        fi
        if [ -d "$d/CustomApps/ivLyrics" ]; then
            IFS="$IFS_BAK"
            printf '%s\n' "$d"
            return 0
        fi
    done

    for d in $candidates; do
        [ -n "$d" ] || continue
        if [ -d "$d" ]; then
            IFS="$IFS_BAK"
            printf '%s\n' "$d"
            return 0
        fi
    done
    IFS="$IFS_BAK"

    if [ -n "$first" ]; then
        printf '%s\n' "$first"
    else
        printf '%s\n' "$HOME/.config/spicetify"
    fi
}

get_spicetify_candidates() {
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
    local seen=""
    local IFS_BAK="$IFS"
    IFS=$'\n'
    for d in $candidates; do
        [ -n "$d" ] || continue
        case "$seen" in
            *"|$d|"*) continue ;;
        esac
        seen="${seen}|${d}|"
        printf '%s\n' "$d"
    done
    IFS="$IFS_BAK"
}

resolve_ivlyrics_app_dir() {
    local default_root="$1"
    local candidates
    candidates=$(get_spicetify_candidates)

    local d
    local IFS_BAK="$IFS"
    IFS=$'\n'
    for d in $candidates; do
        [ -n "$d" ] || continue
        if [ -f "$d/CustomApps/ivLyrics/manifest.json" ]; then
            IFS="$IFS_BAK"
            printf '%s\n' "$d/CustomApps/ivLyrics"
            return 0
        fi
        if [ -d "$d/CustomApps/ivLyrics" ]; then
            IFS="$IFS_BAK"
            printf '%s\n' "$d/CustomApps/ivLyrics"
            return 0
        fi
    done
    IFS="$IFS_BAK"

    printf '%s\n' "$default_root/CustomApps/ivLyrics"
}

collect_proxy_dirs() {
    local primary_root="$1"
    local candidates
    candidates=$(get_spicetify_candidates)

    local roots="$primary_root
$candidates"
    local d
    local seen_roots=""
    local seen_dirs=""
    local found=0
    local IFS_BAK="$IFS"
    IFS=$'\n'
    for d in $roots; do
        [ -n "$d" ] || continue
        case "$seen_roots" in
            *"|$d|"*) continue ;;
        esac
        seen_roots="${seen_roots}|${d}|"
        local p="$d/cli-proxy"
        if [ -d "$p" ]; then
            case "$seen_dirs" in
                *"|$p|"*) ;;
                *)
                    printf '%s\n' "$p"
                    seen_dirs="${seen_dirs}|${p}|"
                    found=1
                    ;;
            esac
        fi
    done
    IFS="$IFS_BAK"

    if [ "$found" -eq 0 ]; then
        printf '%s\n' "$primary_root/cli-proxy"
    fi
}

collect_ivlyrics_apps() {
    local primary_root="$1"
    local candidates
    candidates=$(get_spicetify_candidates)

    local roots="$primary_root
$candidates"
    local d
    local seen_roots=""
    local seen_apps=""
    local found=0
    local IFS_BAK="$IFS"
    IFS=$'\n'
    for d in $roots; do
        [ -n "$d" ] || continue
        case "$seen_roots" in
            *"|$d|"*) continue ;;
        esac
        seen_roots="${seen_roots}|${d}|"
        local app="$d/CustomApps/ivLyrics"
        if [ -d "$app" ]; then
            case "$seen_apps" in
                *"|$app|"*) ;;
                *)
                    printf '%s\n' "$app"
                    seen_apps="${seen_apps}|${app}|"
                    found=1
                    ;;
            esac
        fi
    done
    IFS="$IFS_BAK"

    if [ "$found" -eq 0 ]; then
        printf '%s\n' "$primary_root/CustomApps/ivLyrics"
    fi
}

refresh_paths() {
    SPICETIFY_CONFIG=$(resolve_spicetify_config)
    IVLYRICS_APP=$(resolve_ivlyrics_app_dir "$SPICETIFY_CONFIG")
    IVLYRICS_ROOT=$(dirname "$(dirname "$IVLYRICS_APP")")
    [ -n "$IVLYRICS_ROOT" ] || IVLYRICS_ROOT="$SPICETIFY_CONFIG"
    IVLYRICS_DATA="$IVLYRICS_ROOT/ivLyrics"
    MANIFEST="$IVLYRICS_APP/manifest.json"
    ADDON_SOURCES="$IVLYRICS_DATA/addon_sources.json"
    CLI_PROXY_DIR="$IVLYRICS_ROOT/cli-proxy"
}

preflight() {
    if command -v spicetify >/dev/null 2>&1; then
        HAS_SPICETIFY=1
    else
        warn "spicetify not found in PATH. 'spicetify apply' will be skipped."
    fi
}

remove_manifest_entry() {
    local manifest_path="$1"
    local entry="$2"
    [ -f "$manifest_path" ] || return 0

    local tmp="${manifest_path}.tmp"
    awk -v target="$entry" '
    {
        line=$0
        key=line
        gsub(/[[:space:]]/, "", key)
        if (key == "\"" target "\"," || key == "\"" target "\"") next
        print line
    }
    ' "$manifest_path" > "$tmp"
    mv "$tmp" "$manifest_path"
}

remove_addon_source() {
    local sources_path="$1"
    local filename="$2"
    [ -f "$sources_path" ] || return 0

    local tmp="${sources_path}.tmp"
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
    ' "$sources_path" > "$tmp"
    mv "$tmp" "$sources_path"
}

remove_addon() {
    local app_dir="$1"
    local filename="$2"
    local path="$app_dir/$filename"
    local root
    root=$(dirname "$(dirname "$app_dir")")
    local manifest_path="$app_dir/manifest.json"
    local sources_path="$root/ivLyrics/addon_sources.json"

    if [ -f "$path" ]; then
        rm -f "$path"
        ok "Deleted addon file: $path"
    else
        info "Addon file not found, skipping: $path"
    fi

    remove_manifest_entry "$manifest_path" "$filename"
    remove_addon_source "$sources_path" "$filename"
    ok "Removed references for $filename ($app_dir)"
}

remove_all_addons() {
    local apps
    apps=$(collect_ivlyrics_apps "$IVLYRICS_ROOT")

    local app
    local addon
    local IFS_BAK="$IFS"
    IFS=$'\n'
    for app in $apps; do
        [ -n "$app" ] || continue
        for addon in $ADDONS; do
            remove_addon "$app" "$addon"
        done
    done
    IFS="$IFS_BAK"
}

stop_proxy_processes_for_dir() {
    local dir="$1"
    [ -d "$dir" ] || return 0

    local pids=""
    pids=$(ps ax -o pid= -o command= 2>/dev/null | awk -v target="$dir" '
    BEGIN {
        t=tolower(target)
    }
    {
        line=tolower($0)
        if (index(line, t) && (index(line, "server.js") || index(line, "npm start") || index(line, "cli-proxy"))) {
            print $1
        }
    }' || true)

    local stopped=0
    local pid
    for pid in $pids; do
        [ -n "$pid" ] || continue
        if kill "$pid" 2>/dev/null; then
            stopped=$((stopped + 1))
        fi
    done

    if [ "$stopped" -gt 0 ]; then
        info "Stopped $stopped proxy process(es) for: $dir"
        sleep 1
    fi
}

remove_proxy() {
    local dirs
    dirs=$(collect_proxy_dirs "$IVLYRICS_ROOT")

    local d
    local IFS_BAK="$IFS"
    IFS=$'\n'
    for d in $dirs; do
        [ -n "$d" ] || continue
        if [ ! -d "$d" ]; then
            info "Proxy directory not found, skipping: $d"
            continue
        fi

        stop_proxy_processes_for_dir "$d"
        rm -rf "$d"
        ok "Deleted proxy directory: $d"
    done
    IFS="$IFS_BAK"
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
    info "Resolved ivLyrics app: $IVLYRICS_APP"
    info "Resolved proxy dir: $CLI_PROXY_DIR"
    info "Discovered ivLyrics app dirs: $(collect_ivlyrics_apps "$IVLYRICS_ROOT" | tr '\n' ',' | sed 's/,$//')"
    info "Discovered proxy dirs: $(collect_proxy_dirs "$IVLYRICS_ROOT" | tr '\n' ',' | sed 's/,$//')"

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
