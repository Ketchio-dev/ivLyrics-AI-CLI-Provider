# FreeAI Bridge

Local bridge server for `Addon_AI_FreeAIprovider.js`.

This package automates AI web UIs through Playwright and exposes a small local HTTP API for ivLyrics.

Supported providers in the default config:

- ChatGPT
- Gemini

## Install

```bash
cd freeai-bridge
npm install
npx playwright install chromium
```

## Run

```bash
cd freeai-bridge
npm start
```

Background mode:

```bash
cd freeai-bridge
npm run start:bg
```

Stop background mode:

```bash
cd freeai-bridge
npm run stop:bg
```

Default URL:

```text
http://127.0.0.1:19333
```

Defaults:

- Login windows always open in a visible browser.
- Service runtime is headed by default for compatibility.
- Set `FREEAI_SERVICE_HEADLESS=1` if you want hidden background automation.

## Login flow

1. Start the bridge.
2. In ivLyrics `FreeAIprovider` settings, choose a provider.
3. Click `Open Login Window`.
4. Log in manually in the opened browser.
5. Click `Save Session`.

The session is saved under:

```text
~/.freeai-bridge/state
```

Failure screenshots are saved under:

```text
output/playwright
```

## Local selector overrides

Web UIs change often. If a provider stops working, create:

```text
freeai-bridge/providers.local.json
```

Its structure matches `providers.example.json`. Any values in `providers.local.json` override the built-in defaults.

## API

- `GET /health`
- `GET /providers`
- `POST /auth/open`
- `POST /auth/complete`
- `POST /auth/cancel`
- `POST /generate`

## Runtime behavior

- Keeps one persistent browser runtime per provider.
- Serializes requests per provider to avoid overlapping prompts in the same chat UI.
- Automatically dismisses common dialogs and closes unexpected popups.
- Detects common blockers such as captcha, forced login, and upgrade walls.
- Captures a screenshot when a request fails during browser automation.

Example:

```bash
curl -sS http://127.0.0.1:19333/health
```

```bash
curl -sS http://127.0.0.1:19333/generate \
  -H 'Content-Type: application/json' \
  -d '{"provider":"chatgpt","prompt":"Translate hello to Korean. Reply with the translation only."}'
```
