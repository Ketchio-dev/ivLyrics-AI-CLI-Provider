#!/bin/bash

# ============================================
# ivLyrics CLI Proxy - Spotify Wrapper
# Spotify와 함께 proxy 서버를 자동으로 시작/종료
#
# 사용법:
#   chmod +x spotify-with-proxy.sh
#   ./spotify-with-proxy.sh
#
# alias 등록 (zshrc/bashrc):
#   alias spotify="~/.config/spicetify/cli-proxy/spotify-with-proxy.sh"
# ============================================

CLI_PROXY_DIR="$HOME/.config/spicetify/cli-proxy"
PROXY_PID_FILE="$CLI_PROXY_DIR/.proxy.pid"
PORT=19284
POLL_INTERVAL=3

# --- Colors ---
C_CYAN="\033[36m"
C_GREEN="\033[32m"
C_YELLOW="\033[33m"
C_RED="\033[31m"
C_MUTED="\033[90m"
C_RESET="\033[0m"

log() { echo -e "${C_CYAN}[ivLyrics Proxy]${C_RESET} $1"; }
log_ok() { echo -e "${C_GREEN}[ivLyrics Proxy]${C_RESET} $1"; }
log_warn() { echo -e "${C_YELLOW}[ivLyrics Proxy]${C_RESET} $1"; }
log_err() { echo -e "${C_RED}[ivLyrics Proxy]${C_RESET} $1"; }

# ============================================
# Proxy 서버 상태 확인
# ============================================

is_proxy_running() {
    # PID 파일 확인
    if [ -f "$PROXY_PID_FILE" ]; then
        local pid
        pid=$(cat "$PROXY_PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
    fi
    # 포트 확인
    if lsof -i :"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
        return 0
    fi
    return 1
}

# ============================================
# Proxy 서버 시작
# ============================================

start_proxy() {
    if is_proxy_running; then
        log_ok "Proxy 서버가 이미 실행 중입니다 (port $PORT)"
        return 0
    fi

    if [ ! -f "$CLI_PROXY_DIR/server.js" ]; then
        log_err "server.js를 찾을 수 없습니다: $CLI_PROXY_DIR/server.js"
        return 1
    fi

    if [ ! -d "$CLI_PROXY_DIR/node_modules" ]; then
        log "의존성 설치 중..."
        (cd "$CLI_PROXY_DIR" && npm install --silent) || {
            log_err "npm install 실패"
            return 1
        }
    fi

    log "Proxy 서버 시작 중..."
    (cd "$CLI_PROXY_DIR" && node server.js >>"$CLI_PROXY_DIR/proxy.log" 2>&1) &
    echo $! > "$PROXY_PID_FILE"

    # 서버 준비 대기
    for i in $(seq 1 10); do
        if curl -s "http://localhost:$PORT/health" >/dev/null 2>&1; then
            log_ok "Proxy 서버 시작됨 (port $PORT, PID: $(cat "$PROXY_PID_FILE"))"
            return 0
        fi
        sleep 0.5
    done

    log_warn "Proxy 서버가 아직 준비되지 않았을 수 있습니다"
}

# ============================================
# Proxy 서버 종료
# ============================================

stop_proxy() {
    if [ -f "$PROXY_PID_FILE" ]; then
        local pid
        pid=$(cat "$PROXY_PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            log "Proxy 서버 종료 중 (PID: $pid)..."
            kill "$pid" 2>/dev/null
            # 정상 종료 대기 (최대 3초)
            for i in $(seq 1 6); do
                if ! kill -0 "$pid" 2>/dev/null; then
                    break
                fi
                sleep 0.5
            done
            # 아직 살아있으면 강제 종료
            if kill -0 "$pid" 2>/dev/null; then
                kill -9 "$pid" 2>/dev/null
            fi
            log_ok "Proxy 서버 종료됨"
        fi
        rm -f "$PROXY_PID_FILE"
    fi
}

# ============================================
# Spotify 종료 감지 후 정리
# ============================================

wait_for_spotify_exit() {
    # Spotify가 시작될 때까지 잠시 대기
    sleep 3

    if ! pgrep -x "Spotify" >/dev/null 2>&1; then
        log_warn "Spotify 프로세스를 찾을 수 없습니다"
        sleep 5
        if ! pgrep -x "Spotify" >/dev/null 2>&1; then
            log_err "Spotify가 시작되지 않은 것 같습니다"
            return
        fi
    fi

    log "Spotify 실행 감지됨. 종료를 대기합니다..."
    while pgrep -x "Spotify" >/dev/null 2>&1; do
        sleep "$POLL_INTERVAL"
    done

    log "Spotify가 종료되었습니다"
}

# ============================================
# 시그널 처리
# ============================================

cleanup() {
    stop_proxy
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# ============================================
# 메인
# ============================================

echo ""
log "========================================="
log "  ivLyrics CLI Proxy + Spotify Launcher"
log "========================================="
echo ""

# 1. Proxy 서버 시작
start_proxy
if [ $? -ne 0 ]; then
    log_err "Proxy 서버 시작 실패. Spotify만 실행합니다."
fi

# 2. Spotify 실행
log "Spotify 시작 중..."
open -a Spotify

# 3. Spotify 종료 대기
wait_for_spotify_exit

# cleanup은 EXIT trap에서 자동 호출됨
