# ivLyrics CLI Proxy Server

로컬 CLI AI 도구들 (Antigravity, Claude Code, Codex 등)을 ivLyrics에서 사용할 수 있게 해주는 프록시 서버입니다.

## 지원 CLI 도구

| Tool | Command | Description |
|------|---------|-------------|
| **Antigravity** | `antigravity` | Google AI Pro/Ultra 구독자용 Gemini CLI |
| **Claude Code** | `claude` | Anthropic Claude 구독자용 CLI |
| **Codex** | `codex` | OpenAI Codex CLI |
| **Gemini** | `gemini` | Google Gemini CLI |

## 설치

```bash
cd ~/.config/spicetify/CustomApps/ivLyrics/cli-proxy
npm install
```

## 실행

```bash
npm start
```

서버가 `http://localhost:19284`에서 시작됩니다.

## 사용법

1. 프록시 서버를 실행합니다
2. Spotify에서 ivLyrics 설정으로 이동
3. AI Providers에서 "CLI Proxy (Local)"를 활성화
4. 사용할 CLI 도구를 선택

## API Endpoints

### GET /health
서버 상태 및 사용 가능한 도구 확인

```bash
curl http://localhost:19284/health
```

### GET /tools
사용 가능한 CLI 도구 목록

```bash
curl http://localhost:19284/tools
```

### POST /generate
텍스트 생성 요청

```bash
curl -X POST http://localhost:19284/generate \
  -H "Content-Type: application/json" \
  -d '{"tool": "claude", "prompt": "Hello, world!"}'
```

### POST /v1/chat/completions
OpenAI API 호환 엔드포인트

```bash
curl -X POST http://localhost:19284/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PORT` | `19284` | 서버 포트 |

## 문제 해결

### "Tool not found" 오류
해당 CLI 도구가 설치되어 있고 PATH에 있는지 확인하세요.

```bash
# 예: Claude Code 설치 확인
claude --version

# 예: Antigravity 설치 확인
antigravity --version
```

### 서버 연결 실패
프록시 서버가 실행 중인지 확인하세요.

```bash
curl http://localhost:19284/health
```

## 새로운 CLI 도구 추가

`server.js`의 `CLI_TOOLS` 객체에 새 도구를 추가할 수 있습니다:

```javascript
CLI_TOOLS.myTool = {
    command: 'mytool',
    checkCommand: 'mytool --version',
    buildArgs: (prompt) => ['--prompt', prompt],
    parseOutput: (stdout) => stdout.trim()
};
```
