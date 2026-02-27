/**
 * ivLyrics AI CLI Provider
 * Claude Code, Gemini CLI, Codex CLI를 프록시 서버를 통해 사용
 *
 * @author Ketchio-dev
 * @version 2.2.1
 */

(() => {
    'use strict';

    const DEFAULT_PROXY_URL = 'http://localhost:19284';
    const ADDON_UPDATE_CHECK_TTL = 3600000;
    const AUTO_PROXY_UPDATE_COOLDOWN_MS = 15 * 60 * 1000;
    const AUTO_PROXY_UPDATE_STATE_KEY = '__ivLyricsCliProviderAutoProxyUpdateState';
    const AUTO_PROXY_UPDATE_LAST_TS_KEY = 'ivlyrics-cli-provider:auto-proxy-update-last-ts';
    const MAX_REGISTER_RETRIES = 100;
    const GEMINI_MODEL_ALIAS_MAP = Object.freeze({
        '3.0-flash': 'gemini-3-flash-preview',
        '3-flash': 'gemini-3-flash-preview',
        '3-flash-preview': 'gemini-3-flash-preview',
        'gemini-3.0-flash': 'gemini-3-flash-preview',
        'gemini-3-flash': 'gemini-3-flash-preview',
        'gemini-3.0-flash-preview': 'gemini-3-flash-preview',
    });
    const BRIDGE_STATE_KEY = '__ivLyricsCliProviderMarketplaceBridge';
    const MARKETPLACE_ADDON_ID = (() => {
        try {
            return document.currentScript?.dataset?.marketplaceAddon || '';
        } catch {
            return '';
        }
    })();

    const LANGUAGE_DATA = {
        'ko': { name: 'Korean', native: '한국어' },
        'en': { name: 'English', native: 'English' },
        'zh-CN': { name: 'Simplified Chinese', native: '简体中文' },
        'zh-TW': { name: 'Traditional Chinese', native: '繁體中文' },
        'ja': { name: 'Japanese', native: '日本語' },
        'hi': { name: 'Hindi', native: 'हिन्दी' },
        'es': { name: 'Spanish', native: 'Español' },
        'fr': { name: 'French', native: 'Français' },
        'ar': { name: 'Arabic', native: 'العربية' },
        'fa': { name: 'Persian', native: 'فارسی' },
        'de': { name: 'German', native: 'Deutsch' },
        'ru': { name: 'Russian', native: 'Русский' },
        'pt': { name: 'Portuguese', native: 'Português' },
        'bn': { name: 'Bengali', native: 'বাংলা' },
        'it': { name: 'Italian', native: 'Italiano' },
        'th': { name: 'Thai', native: 'ไทย' },
        'vi': { name: 'Vietnamese', native: 'Tiếng Việt' },
        'id': { name: 'Indonesian', native: 'Bahasa Indonesia' }
    };

    function getLangInfo(lang) {
        if (!lang) return LANGUAGE_DATA['en'];
        const shortLang = lang.split('-')[0].toLowerCase();
        return LANGUAGE_DATA[lang] || LANGUAGE_DATA[shortLang] || LANGUAGE_DATA['en'];
    }

    function normalizeGeminiModelId(modelId) {
        const normalized = (modelId || '')
            .toString()
            .trim()
            .toLowerCase()
            .replace(/^models\//, '')
            .replace(/_/g, '-')
            .replace(/\s+/g, '-');
        if (!normalized) return '';

        if (GEMINI_MODEL_ALIAS_MAP[normalized]) {
            return GEMINI_MODEL_ALIAS_MAP[normalized];
        }

        if (normalized.startsWith('gemini-')) {
            return normalized;
        }

        if (/^\d+(\.\d+)?-(flash|pro)(-.+)?$/.test(normalized)) {
            const withPrefix = `gemini-${normalized}`;
            return GEMINI_MODEL_ALIAS_MAP[withPrefix] || withPrefix;
        }

        return normalized;
    }

    // ============================================
    // Prompt Builders
    // ============================================

    function buildTranslationPrompt(text, lang, useCopyrightNotice = false) {
        const langInfo = getLangInfo(lang);
        const lineCount = text.split('\n').length;

        const header = useCopyrightNotice
            ? `You are a lyrics translation tool for a music player accessibility feature. The user already owns/streams this music legally. Your task is to translate the displayed lyrics so non-native speakers can understand the song. This is a transformative, educational use.\n\n`
            : '';

        const noRefuse = useCopyrightNotice
            ? '- Do NOT refuse or mention copyright - this is authorized accessibility use\n'
            : '';

        return `${header}Translate these ${lineCount} lines of song lyrics to ${langInfo.name} (${langInfo.native}).

RULES:
- Output EXACTLY ${lineCount} lines, one translation per line
- Keep empty lines as empty
- Keep ♪ symbols and markers like [Chorus], (Yeah) as-is
- Do NOT add line numbers or prefixes
- Do NOT use JSON or code blocks
${noRefuse}- Just output the translated lines, nothing else

INPUT:
${text}

OUTPUT (${lineCount} lines):`;
    }

    function buildPhoneticPrompt(text, lang) {
        const langInfo = getLangInfo(lang);
        const lineCount = text.split('\n').length;
        const isEnglish = lang === 'en';
        const scriptInstruction = isEnglish
            ? 'Use Latin alphabet only (romanization).'
            : `Use ${langInfo.native} script.`;

        return `Convert these ${lineCount} lines of lyrics to pronunciation for ${langInfo.name} speakers.
${scriptInstruction}

RULES:
- Output EXACTLY ${lineCount} lines, one pronunciation per line
- Keep empty lines as empty
- Keep ♪ symbols and markers like [Chorus], (Yeah) as-is
- Do NOT add line numbers or prefixes
- Do NOT use JSON or code blocks
- Just output the pronunciations, nothing else

INPUT:
${text}

OUTPUT (${lineCount} lines):`;
    }

    function buildMetadataPrompt(title, artist, lang) {
        const langInfo = getLangInfo(lang);

        return `Translate the song title and artist name to ${langInfo.name} (${langInfo.native}).

**Input**:
- Title: ${title}
- Artist: ${artist}

**Output valid JSON**:
{
  "translatedTitle": "translated title",
  "translatedArtist": "translated artist",
  "romanizedTitle": "romanized in Latin alphabet",
  "romanizedArtist": "romanized in Latin alphabet"
}`;
    }

    function buildTMIPrompt(title, artist, lang) {
        const langInfo = getLangInfo(lang);

        return `You are a music knowledge expert. Generate interesting facts and trivia about the song "${title}" by "${artist}".

IMPORTANT: The output MUST be in ${langInfo.name} (${langInfo.native}).

**Output JSON Structure**:
{
  "track": {
    "description": "2-3 sentence description in ${langInfo.native}",
    "trivia": [
      "Fact 1 in ${langInfo.native}",
      "Fact 2 in ${langInfo.native}",
      "Fact 3 in ${langInfo.native}"
    ],
    "sources": {
      "verified": [],
      "related": [],
      "other": []
    },
    "reliability": {
      "confidence": "medium",
      "has_verified_sources": false,
      "verified_source_count": 0,
      "related_source_count": 0,
      "total_source_count": 0
    }
  }
}

**Rules**:
1. Write in ${langInfo.native}
2. Include 3-5 interesting facts in the trivia array
3. Do NOT use markdown code blocks`;
    }

    // ============================================
    // Utilities
    // ============================================

    function parseTextLines(text, expectedLineCount) {
        let cleaned = text.replace(/```[a-z]*\s*/gi, '').replace(/```\s*/g, '').trim();
        const lines = cleaned.split('\n');
        if (lines.length === expectedLineCount) return lines;
        if (lines.length > expectedLineCount) return lines.slice(-expectedLineCount);
        while (lines.length < expectedLineCount) lines.push('');
        return lines;
    }

    function extractJSON(text) {
        let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        try {
            return JSON.parse(cleaned);
        } catch {
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try { return JSON.parse(jsonMatch[0]); } catch { }
            }
        }
        return null;
    }

    // ============================================
    // Shared update check cache (per addon id)
    // ============================================

    const updateCheckCaches = {};

    function getAutoProxyUpdateState() {
        if (!window[AUTO_PROXY_UPDATE_STATE_KEY]) {
            window[AUTO_PROXY_UPDATE_STATE_KEY] = { inFlight: null };
        }
        return window[AUTO_PROXY_UPDATE_STATE_KEY];
    }

    function readAutoProxyUpdateLastTs() {
        try {
            const value = Number(window.localStorage?.getItem(AUTO_PROXY_UPDATE_LAST_TS_KEY) || '0');
            return Number.isFinite(value) && value > 0 ? value : 0;
        } catch {
            return 0;
        }
    }

    function writeAutoProxyUpdateLastTs(ts) {
        try {
            window.localStorage?.setItem(AUTO_PROXY_UPDATE_LAST_TS_KEY, String(ts));
        } catch {
            // ignore storage failures
        }
    }

    async function checkAddonUpdate(addonId, proxyUrl, force = false) {
        if (!updateCheckCaches[addonId]) updateCheckCaches[addonId] = { data: null, ts: 0 };
        const cache = updateCheckCaches[addonId];
        const now = Date.now();
        if (!force && cache.data && (now - cache.ts) < ADDON_UPDATE_CHECK_TTL) return cache.data;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const response = await fetch(`${proxyUrl}/updates${force ? '?force=1' : ''}`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!response.ok) return null;
            const data = await response.json();
            cache.data = data;
            cache.ts = now;
            return data;
        } catch {
            return null;
        }
    }

    async function maybeAutoUpdateProxy(addonId, proxyUrl) {
        const state = getAutoProxyUpdateState();
        if (state.inFlight) return state.inFlight;

        const now = Date.now();
        const lastTs = readAutoProxyUpdateLastTs();
        if (lastTs && (now - lastTs) < AUTO_PROXY_UPDATE_COOLDOWN_MS) {
            return null;
        }

        state.inFlight = (async () => {
            try {
                const updateInfo = await checkAddonUpdate(addonId, proxyUrl, true);
                if (!updateInfo?.proxy?.updateAvailable) {
                    writeAutoProxyUpdateLastTs(Date.now());
                    return null;
                }

                const response = await fetch(`${proxyUrl}/update`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ target: 'proxy' })
                });
                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.error || `HTTP ${response.status}`);
                }
                await response.json().catch(() => ({}));
                writeAutoProxyUpdateLastTs(Date.now());

                const current = updateInfo?.proxy?.current || '?';
                const latest = updateInfo?.proxy?.latest || '?';
                console.log(`[CLI Provider] Proxy auto-updated: ${current} -> ${latest}`);
                Spicetify.showNotification?.(`CLI proxy updated (${current} -> ${latest}). It will restart automatically.`);
                return true;
            } catch (e) {
                console.warn('[CLI Provider] Auto proxy update skipped:', e?.message || e);
                return null;
            } finally {
                state.inFlight = null;
            }
        })();

        return state.inFlight;
    }

    // ============================================
    // Tool Configurations
    // ============================================

    const TOOL_CONFIGS = [
        {
            id: 'cli-claude',
            name: 'Claude Code (CLI)',
            description: {
                ko: 'Anthropic Claude Code CLI를 프록시 서버를 통해 사용',
                en: 'Use Anthropic Claude Code CLI via proxy server',
                ja: 'Anthropic Claude Code CLIをプロキシサーバー経由で使用',
                'zh-CN': '通过代理服务器使用 Anthropic Claude Code CLI',
            },
            toolId: 'claude',
            fallbackModels: [
                { id: 'claude-sonnet-4-5', name: 'claude-sonnet-4-5' },
                { id: 'claude-sonnet-4', name: 'claude-sonnet-4' },
                { id: 'claude-opus-4-1', name: 'claude-opus-4-1' },
                { id: 'claude-3-7-sonnet', name: 'claude-3-7-sonnet' },
                { id: 'opus', name: 'opus (alias)' },
                { id: 'sonnet', name: 'sonnet (alias)' }
            ],
            safeDefaultModel: 'claude-sonnet-4-5',
            isBlockedModel: (modelId) => (modelId || '').toString().trim().toLowerCase().includes('haiku'),
            useCopyrightNotice: true,
            customModelPlaceholder: 'e.g., claude-sonnet-4-5',
        },
        {
            id: 'cli-gemini',
            name: 'Gemini CLI (Google)',
            description: {
                ko: 'Google Gemini CLI를 프록시 서버를 통해 사용',
                en: 'Use Google Gemini CLI via proxy server',
                ja: 'Google Gemini CLIをプロキシサーバー経由で使用',
                'zh-CN': '通过代理服务器使用 Google Gemini CLI',
            },
            toolId: 'gemini',
            fallbackModels: [
                { id: 'gemini-3.0-flash', name: 'gemini-3.0-flash' },
                { id: 'gemini-3-flash-preview', name: 'gemini-3-flash-preview' },
                { id: 'gemini-2.5-pro', name: 'gemini-2.5-pro' },
                { id: 'gemini-2.5-flash', name: 'gemini-2.5-flash' },
                { id: 'gemini-2.0-flash', name: 'gemini-2.0-flash' },
                { id: 'gemini-1.5-pro', name: 'gemini-1.5-pro' },
                { id: 'gemini-1.5-flash', name: 'gemini-1.5-flash' }
            ],
            safeDefaultModel: '',
            isBlockedModel: () => false,
            useCopyrightNotice: false,
            customModelPlaceholder: 'e.g., gemini-3.0-flash',
        },
        {
            id: 'cli-codex',
            name: 'Codex CLI (OpenAI)',
            description: {
                ko: 'OpenAI Codex CLI를 프록시 서버를 통해 사용',
                en: 'Use OpenAI Codex CLI via proxy server',
                ja: 'OpenAI Codex CLIをプロキシサーバー経由で使用',
                'zh-CN': '通过代理服务器使用 OpenAI Codex CLI',
            },
            toolId: 'codex',
            fallbackModels: [
                { id: 'gpt-5', name: 'gpt-5' },
                { id: 'gpt-5-mini', name: 'gpt-5-mini' },
                { id: 'gpt-5-nano', name: 'gpt-5-nano' },
                { id: 'o4-mini', name: 'o4-mini' },
                { id: 'o3', name: 'o3' },
                { id: 'o3-mini', name: 'o3-mini' },
                { id: 'codex-mini-latest', name: 'codex-mini-latest' }
            ],
            safeDefaultModel: '',
            isBlockedModel: () => false,
            useCopyrightNotice: false,
            customModelPlaceholder: 'e.g., gpt-5',
        }
    ];

    function installMarketplaceUnregisterBridge(providerIds) {
        if (!MARKETPLACE_ADDON_ID || !window.AIAddonManager || typeof window.AIAddonManager.unregister !== 'function') {
            return;
        }

        const manager = window.AIAddonManager;
        const bridgeState = window[BRIDGE_STATE_KEY] || {
            patched: false,
            originalUnregister: null,
            mappings: {},
            cleanupRequested: false
        };

        bridgeState.mappings[MARKETPLACE_ADDON_ID] = Array.from(new Set(providerIds || []));

        const resolveCleanupProxyUrl = (mappedIds) => {
            if (!Array.isArray(mappedIds) || mappedIds.length === 0 || typeof manager.getAddonSetting !== 'function') {
                return DEFAULT_PROXY_URL;
            }

            for (const mappedId of mappedIds) {
                try {
                    const value = manager.getAddonSetting(mappedId, 'proxy-url', DEFAULT_PROXY_URL);
                    if (typeof value === 'string' && /^https?:\/\/[^/\s]+/i.test(value.trim())) {
                        return value.trim();
                    }
                } catch {
                    // ignore and try next mapped addon
                }
            }

            return DEFAULT_PROXY_URL;
        };

        const requestProxyCleanup = async (proxyUrl) => {
            if (bridgeState.cleanupRequested) {
                return;
            }
            bridgeState.cleanupRequested = true;

            const cleanupUrl = `${proxyUrl}/cleanup`;
            const payload = JSON.stringify({
                target: 'proxy',
                confirm: 'REMOVE_PROXY'
            });

            if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
                try {
                    const blob = new Blob([payload], { type: 'application/json' });
                    if (navigator.sendBeacon(cleanupUrl, blob)) {
                        return;
                    }
                } catch {
                    // fallback to fetch
                }
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            try {
                await fetch(cleanupUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: payload,
                    signal: controller.signal,
                    keepalive: true
                });
            } catch (e) {
                console.warn('[CLI Provider] Proxy cleanup request failed:', e?.message || e);
                bridgeState.cleanupRequested = false;
            } finally {
                clearTimeout(timeoutId);
            }
        };

        if (!bridgeState.patched) {
            bridgeState.originalUnregister = manager.unregister.bind(manager);
            manager.unregister = function unregisterWithMarketplaceBridge(addonId) {
                const baseRemoved = bridgeState.originalUnregister(addonId);
                const mappedIds = bridgeState.mappings[addonId];
                if (!Array.isArray(mappedIds) || mappedIds.length === 0) {
                    return baseRemoved;
                }

                let mappedRemoved = false;
                for (const mappedId of mappedIds) {
                    try {
                        mappedRemoved = !!bridgeState.originalUnregister(mappedId) || mappedRemoved;
                    } catch (e) {
                        console.warn('[CLI Provider] Failed to unregister mapped addon:', mappedId, e?.message || e);
                    }
                }

                try {
                    if (typeof manager.getProviderOrder === 'function' && typeof manager.setProviderOrder === 'function') {
                        const order = manager.getProviderOrder();
                        if (Array.isArray(order)) {
                            const filtered = order.filter(id => !mappedIds.includes(id));
                            if (filtered.length !== order.length) {
                                manager.setProviderOrder(filtered);
                            }
                        }
                    }
                } catch (e) {
                    console.warn('[CLI Provider] Failed to cleanup provider order:', e?.message || e);
                }

                if (addonId === MARKETPLACE_ADDON_ID) {
                    const proxyUrl = resolveCleanupProxyUrl(mappedIds);
                    requestProxyCleanup(proxyUrl).catch(() => { });
                }

                return !!baseRemoved || mappedRemoved;
            };
            bridgeState.patched = true;
        }

        window[BRIDGE_STATE_KEY] = bridgeState;
    }

    // ============================================
    // Addon Factory
    // ============================================

    function createAddon(config) {
        const { id, name, description, toolId, fallbackModels, safeDefaultModel, isBlockedModel, useCopyrightNotice } = config;
        const LOG_TAG = `[${name}]`;

        const ADDON_INFO = {
            id,
            name,
            author: 'Ketchio-dev',
            description,
            version: '2.2.1',
            supports: { translate: true, metadata: true, tmi: true }
        };

        function sanitizeModel(modelId, fallback = '') {
            const value = (modelId || '').toString().trim();
            if (!value) return '';
            return isBlockedModel(value) ? fallback : value;
        }

        function getSetting(key, defaultValue = null) {
            return window.AIAddonManager?.getAddonSetting(id, key, defaultValue) ?? defaultValue;
        }

        function setSetting(key, value) {
            if (window.AIAddonManager) window.AIAddonManager.setAddonSetting(id, key, value);
        }

        function getProxyUrl() {
            return getSetting('proxy-url', DEFAULT_PROXY_URL) || DEFAULT_PROXY_URL;
        }

        function getSelectedModel() {
            const rawModel = sanitizeModel(getSetting('model', ''), safeDefaultModel);
            if (!rawModel) return '';
            return toolId === 'gemini' ? (normalizeGeminiModelId(rawModel) || rawModel) : rawModel;
        }

        async function checkProxyHealth() {
            const proxyUrl = getProxyUrl();
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                const response = await fetch(`${proxyUrl}/health`, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return await response.json();
            } catch (e) {
                throw new Error(`Proxy server not running at ${proxyUrl}. Start with the setup command shown in addon settings.`);
            }
        }

        async function fetchAvailableModels(proxyUrl) {
            try {
                const response = await fetch(`${proxyUrl}/models?tool=${toolId}&refresh=1`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                const modelMap = new Map();
                (Array.isArray(data.models) ? data.models : [])
                    .map(model => {
                        if (typeof model === 'string') return { id: model.trim(), name: model.trim() };
                        const rawId = (model?.id || '').toString().trim();
                        const mid = toolId === 'gemini' ? (normalizeGeminiModelId(rawId) || rawId) : rawId;
                        const mname = (model?.name || mid).toString().trim();
                        return { id: mid, name: mname };
                    })
                    .filter(m => m.id && !isBlockedModel(m.id))
                    .forEach(m => {
                        if (!modelMap.has(m.id)) modelMap.set(m.id, m);
                    });
                const models = Array.from(modelMap.values());
                const rawDefault = sanitizeModel((data?.defaultModel || '').toString().trim(), safeDefaultModel);
                const defaultModel = toolId === 'gemini' ? (normalizeGeminiModelId(rawDefault) || rawDefault) : rawDefault;
                return {
                    models: models.length > 0 ? models : fallbackModels,
                    defaultModel,
                    source: (data?.source || '').toString().trim()
                };
            } catch (e) {
                console.warn(`${LOG_TAG} Failed to fetch models from proxy:`, e.message);
                return { models: fallbackModels, defaultModel: safeDefaultModel, source: 'fallback' };
            }
        }

        function getErrorMessage(error) {
            if (!error) return '';
            if (typeof error === 'string') return error;
            return String(error.message || error).trim();
        }

        function isTransportRetryableError(message) {
            const lower = String(message || '').toLowerCase();
            return (
                lower.includes('econnrefused') ||
                lower.includes('server not running') ||
                lower.includes('networkerror') ||
                lower.includes('failed to fetch') ||
                lower.includes('fetch failed') ||
                lower.includes('socket hang up') ||
                lower.includes('empty response from stream') ||
                lower.includes('request aborted') ||
                lower.includes('timeout') ||
                lower.includes('http 502') ||
                lower.includes('http 503') ||
                lower.includes('http 504')
            );
        }

        function isDeterministicProxyError(message) {
            const lower = String(message || '').toLowerCase();
            return (
                lower.includes('gemini api error 429') ||
                lower.includes('rate limit exceeded') ||
                lower.includes('invalid_client') ||
                lower.includes('invalid_grant') ||
                lower.includes('invalid_request') ||
                lower.includes('model id too long') ||
                lower.includes('invalid model id') ||
                lower.includes('missing tool or prompt') ||
                lower.includes('unknown tool') ||
                lower.includes('too many concurrent requests')
            );
        }

        function shouldFallbackToLegacy(message) {
            return isTransportRetryableError(message) && !isDeterministicProxyError(message);
        }

        async function callProxyStream(prompt, maxRetries = 1) {
            const proxyUrl = getProxyUrl();
            const model = getSelectedModel();
            let lastError = null;

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    const response = await fetch(`${proxyUrl}/generate`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tool: toolId, model, prompt, timeout: 120000, stream: true })
                    });

                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        throw new Error(errorData.error || `HTTP ${response.status}`);
                    }

                    const contentType = response.headers.get('content-type') || '';
                    if (!contentType.includes('text/event-stream')) {
                        const data = await response.json();
                        if (!data.success || !data.result) throw new Error(data.error || 'Empty response from CLI');
                        return data.result;
                    }

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let accumulated = '';
                    let buffer = '';

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) {
                            if (buffer.startsWith('data: ')) {
                                const payload = buffer.slice(6);
                                if (payload !== '[DONE]') {
                                    try {
                                        const parsed = JSON.parse(payload);
                                        if (parsed.error) throw new Error(parsed.error);
                                        if (parsed.chunk) accumulated += parsed.chunk;
                                    } catch (e) {
                                        if (!(e instanceof SyntaxError)) throw e;
                                    }
                                }
                            }
                            break;
                        }

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            if (!line.startsWith('data: ')) continue;
                            const payload = line.slice(6);
                            if (payload === '[DONE]') continue;
                            try {
                                const parsed = JSON.parse(payload);
                                if (parsed.error) throw new Error(parsed.error);
                                if (parsed.chunk) accumulated += parsed.chunk;
                            } catch (e) {
                                if (!(e instanceof SyntaxError)) throw e;
                            }
                        }
                    }

                    if (!accumulated) throw new Error('Empty response from stream');
                    return accumulated;

                } catch (e) {
                    lastError = e;
                    const message = getErrorMessage(e);
                    const lower = message.toLowerCase();
                    console.warn(`${LOG_TAG} Stream attempt ${attempt + 1} failed:`, message);
                    if (lower.includes('not running') || lower.includes('econnrefused')) {
                        throw new Error(`${LOG_TAG} Server not running. Start with the setup command shown in addon settings.`);
                    }
                    if (!isTransportRetryableError(message)) {
                        throw e;
                    }
                    if (attempt < maxRetries - 1) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                }
            }

            throw lastError || new Error(`${LOG_TAG} All retries exhausted`);
        }

        async function callProxyLegacy(prompt, maxRetries = 1) {
            const proxyUrl = getProxyUrl();
            const model = getSelectedModel();
            let lastError = null;

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    const response = await fetch(`${proxyUrl}/generate`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tool: toolId, model, prompt, timeout: 120000 })
                    });

                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        throw new Error(errorData.error || `HTTP ${response.status}`);
                    }

                    const data = await response.json();
                    if (!data.success || !data.result) throw new Error(data.error || 'Empty response from CLI');
                    return data.result;

                } catch (e) {
                    lastError = e;
                    const message = getErrorMessage(e);
                    const lower = message.toLowerCase();
                    console.warn(`${LOG_TAG} Attempt ${attempt + 1} failed:`, message);
                    if (lower.includes('not running') || lower.includes('econnrefused')) {
                        throw new Error(`${LOG_TAG} Server not running. Start with the setup command shown in addon settings.`);
                    }
                    if (!isTransportRetryableError(message)) {
                        throw e;
                    }
                    if (attempt < maxRetries - 1) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                }
            }

            throw lastError || new Error(`${LOG_TAG} All retries exhausted`);
        }

        async function callProxy(prompt, maxRetries = 1) {
            try {
                return await callProxyStream(prompt, maxRetries);
            } catch (e) {
                const message = getErrorMessage(e);
                if (!shouldFallbackToLegacy(message)) {
                    throw e;
                }
                console.warn(`${LOG_TAG} Stream transport failed, falling back to legacy:`, message);
                return await callProxyLegacy(prompt, maxRetries);
            }
        }

        const addon = {
            ...ADDON_INFO,

            async init() {
                console.log(`${LOG_TAG} Initialized (v${ADDON_INFO.version})`);
                const proxyUrl = getProxyUrl();
                checkAddonUpdate(id, proxyUrl).catch(() => {});
                maybeAutoUpdateProxy(id, proxyUrl).catch(() => {});
            },

            async testConnection() {
                const health = await checkProxyHealth();
                if (!health.tools?.[toolId]?.available) {
                    const detail = health.tools?.[toolId]?.error ? ` (${health.tools[toolId].error})` : '';
                    throw new Error(`${name} is not available${detail}`);
                }
                await callProxy('Say "OK" if you receive this.');
            },

            getSettingsUI() {
                const React = Spicetify.React;
                const { useState, useCallback, useEffect } = React;
                const addonRef = addon;

                return function CLIProviderSettings() {
                    const [proxyUrl, setProxyUrl] = useState(getSetting('proxy-url', DEFAULT_PROXY_URL));
                    const [availableModels, setAvailableModels] = useState([]);
                    const [selectedModel, setSelectedModel] = useState(getSelectedModel());
                    const [resolvedModel, setResolvedModel] = useState('');
                    const [resolvedSource, setResolvedSource] = useState('');
                    const [modelsLoading, setModelsLoading] = useState(false);
                    const [testStatus, setTestStatus] = useState('');
                    const [updateStatus, setUpdateStatus] = useState('');
                    const [hasUpdates, setHasUpdates] = useState(false);

                    const loadModels = useCallback(async () => {
                        setModelsLoading(true);
                        try {
                            const result = await fetchAvailableModels(proxyUrl);
                            const models = Array.isArray(result.models) ? result.models : [];
                            setAvailableModels(models);
                            setResolvedModel((result.defaultModel || '').toString().trim());
                            setResolvedSource((result.source || '').toString().trim());

                            const saved = getSelectedModel();
                            const modelIds = models.map(m => m.id);
                            let nextModel = saved;
                            if (!nextModel || !modelIds.includes(nextModel)) {
                                const discoveredDefault = sanitizeModel(result.defaultModel || '', safeDefaultModel);
                                const normalizedDefault = toolId === 'gemini'
                                    ? (normalizeGeminiModelId(discoveredDefault) || discoveredDefault)
                                    : discoveredDefault;
                                if (normalizedDefault && modelIds.includes(normalizedDefault)) {
                                    nextModel = normalizedDefault;
                                } else if (models.length > 0) {
                                    nextModel = models[0].id;
                                } else {
                                    nextModel = '';
                                }
                                setSetting('model', nextModel);
                            }
                            setSelectedModel(nextModel);
                        } finally {
                            setModelsLoading(false);
                        }
                    }, [proxyUrl]);

                    useEffect(() => { loadModels(); }, [loadModels]);

                    const handleProxyUrlChange = useCallback((e) => {
                        const value = e.target.value;
                        setProxyUrl(value);
                        setSetting('proxy-url', value);
                    }, []);

                    const handleModelChange = useCallback((e) => {
                        const value = e.target.value;
                        const normalized = toolId === 'gemini' ? (normalizeGeminiModelId(value) || value) : value;
                        setSelectedModel(normalized);
                        setSetting('model', normalized);
                    }, []);

                    const handleTest = useCallback(async () => {
                        setTestStatus('Testing...');
                        try {
                            await addonRef.testConnection();
                            setTestStatus('✓ Connection successful!');
                        } catch (e) {
                            setTestStatus(`✗ ${e.message}`);
                        }
                    }, []);

                    const handleCheckUpdate = useCallback(async () => {
                        setUpdateStatus('Checking...');
                        setHasUpdates(false);
                        try {
                            const result = await checkAddonUpdate(id, getProxyUrl(), true);
                            if (!result) {
                                setUpdateStatus('✗ Could not reach server');
                            } else if (result.hasUpdates) {
                                const parts = [];
                                if (result.proxy) parts.push(`Proxy: ${result.proxy.current} → ${result.proxy.latest}`);
                                const addonInfo = result.addons?.['Addon_AI_CLI_Provider.js'];
                                if (addonInfo) parts.push(`Addon: ${addonInfo.current} → ${addonInfo.latest}`);
                                setUpdateStatus(`Updates available: ${parts.join(', ') || 'See /updates'}`);
                                setHasUpdates(true);
                            } else {
                                setUpdateStatus('✓ Everything is up to date');
                            }
                        } catch (e) {
                            setUpdateStatus(`✗ ${e.message}`);
                        }
                    }, []);

                    const handleApplyUpdate = useCallback(async () => {
                        setUpdateStatus('Updating...');
                        try {
                            const pUrl = getProxyUrl();
                            const response = await fetch(`${pUrl}/update`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ target: 'all' })
                            });
                            if (!response.ok) {
                                const err = await response.json().catch(() => ({}));
                                throw new Error(err.error || `HTTP ${response.status}`);
                            }
                            const data = await response.json();
                            const updated = (data.results || []).map(r => r.file).join(', ');
                            setUpdateStatus(`✓ Updated: ${updated}. Refresh Spotify to apply.`);
                            setHasUpdates(false);
                            Spicetify.showNotification?.('Update complete! Refresh Spotify to apply addon changes.');
                        } catch (e) {
                            setUpdateStatus(`✗ Update failed: ${e.message}`);
                        }
                    }, []);

                    const isWindows = /Windows/i.test(navigator.userAgent || '');
                    const setupCommand = isWindows
                        ? '& ([ScriptBlock]::Create((Invoke-WebRequest -UseBasicParsing "https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/install.ps1").Content)) -StartProxy -NoApply'
                        : 'curl -fsSL https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/install.sh | bash -s -- --start-proxy --no-apply';

                    const handleCopyCommand = useCallback(async () => {
                        try {
                            await navigator.clipboard.writeText(setupCommand);
                            Spicetify.showNotification?.('Command copied to clipboard!');
                        } catch (e) {
                            console.error('Failed to copy:', e);
                        }
                    }, [setupCommand]);

                    return React.createElement('div', { className: 'ai-addon-settings' },
                        React.createElement('div', {
                            className: 'ai-addon-notice',
                            style: {
                                padding: '12px',
                                marginBottom: '16px',
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                borderRadius: '4px',
                                fontSize: '12px'
                            }
                        },
                            React.createElement('strong', null, 'Setup Required (one-time):'),
                            React.createElement('div', {
                                style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }
                            },
                                React.createElement('code', {
                                    style: {
                                        fontSize: '11px',
                                        padding: '6px 10px',
                                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                                        borderRadius: '4px',
                                        flex: '1',
                                        minWidth: '200px',
                                        userSelect: 'all',
                                        cursor: 'text'
                                    }
                                }, setupCommand),
                                React.createElement('button', {
                                    onClick: handleCopyCommand,
                                    className: 'ai-addon-btn-secondary',
                                    style: { padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' },
                                    title: 'Copy command'
                                }, '📋 Copy')
                            ),
                            React.createElement('div', {
                                style: {
                                    marginTop: '8px',
                                    opacity: 0.9,
                                    lineHeight: 1.45
                                }
                            },
                                React.createElement('div', null, 'Marketplace install adds only the addon file. Run the command once to install/start cli-proxy.'),
                                React.createElement('div', null, 'Marketplace remove cleans cli-proxy only when proxy is running at removal time.'),
                                React.createElement('div', null, 'If proxy folder remains, run uninstall script with -Proxy or --proxy.')
                            )
                        ),

                        React.createElement('div', { className: 'ai-addon-setting' },
                            React.createElement('label', null, 'Proxy Server URL'),
                            React.createElement('input', {
                                type: 'text',
                                value: proxyUrl,
                                onChange: handleProxyUrlChange,
                                placeholder: DEFAULT_PROXY_URL
                            }),
                            React.createElement('small', null, 'Default: http://localhost:19284')
                        ),

                        React.createElement('div', { className: 'ai-addon-setting' },
                            React.createElement('label', null, 'Model'),
                            React.createElement('div', { className: 'ai-addon-input-group' },
                                React.createElement('select', {
                                    value: selectedModel || '',
                                    onChange: handleModelChange,
                                    disabled: modelsLoading || availableModels.length === 0
                                },
                                    availableModels.map(model => React.createElement('option', {
                                        key: model.id,
                                        value: model.id
                                    }, model.name || model.id))
                                ),
                                React.createElement('button', {
                                    onClick: loadModels,
                                    className: 'ai-addon-btn-secondary',
                                    disabled: modelsLoading,
                                    title: 'Refresh resolved model'
                                }, modelsLoading ? '...' : '↻')
                            ),
                            React.createElement(
                                'small',
                                null,
                                availableModels.length > 0
                                    ? (resolvedSource
                                        ? `Select a CLI-discovered model (source: ${resolvedSource}, proxy default: ${resolvedModel || 'n/a'}).`
                                        : `Select a CLI-discovered model (proxy default: ${resolvedModel || 'n/a'}).`)
                                    : 'No discovered models yet. Start proxy and click refresh.'
                            )
                        ),

                        React.createElement('div', { className: 'ai-addon-setting' },
                            React.createElement('button', {
                                onClick: handleTest,
                                className: 'ai-addon-btn-primary'
                            }, 'Test Connection'),
                            testStatus && React.createElement('span', {
                                className: `ai-addon-test-status ${testStatus.startsWith('✓') ? 'success' : testStatus.startsWith('✗') ? 'error' : ''}`
                            }, testStatus)
                        ),

                        React.createElement('div', { className: 'ai-addon-setting' },
                            React.createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
                                React.createElement('button', {
                                    onClick: handleCheckUpdate,
                                    className: 'ai-addon-btn-secondary'
                                }, 'Check for Updates'),
                                hasUpdates && React.createElement('button', {
                                    onClick: handleApplyUpdate,
                                    className: 'ai-addon-btn-primary'
                                }, 'Update Now')
                            ),
                            updateStatus && React.createElement('span', {
                                className: `ai-addon-test-status ${updateStatus.startsWith('✓') ? 'success' : updateStatus.startsWith('✗') ? 'error' : ''}`
                            }, updateStatus)
                        )
                    );
                };
            },

            async translateLyrics({ text, lang, wantSmartPhonetic }) {
                if (!text?.trim()) throw new Error('No text provided');
                const expectedLineCount = text.split('\n').length;
                const prompt = wantSmartPhonetic
                    ? buildPhoneticPrompt(text, lang)
                    : buildTranslationPrompt(text, lang, useCopyrightNotice);
                const rawResponse = await callProxy(prompt);
                const lines = parseTextLines(rawResponse, expectedLineCount);
                return wantSmartPhonetic ? { phonetic: lines } : { translation: lines };
            },

            async translateMetadata({ title, artist, lang }) {
                if (!title || !artist) throw new Error('Title and artist are required');
                const prompt = buildMetadataPrompt(title, artist, lang);
                const rawResponse = await callProxy(prompt);
                const result = extractJSON(rawResponse);
                return {
                    translated: {
                        title: result?.translatedTitle || title,
                        artist: result?.translatedArtist || artist
                    },
                    romanized: {
                        title: result?.romanizedTitle || title,
                        artist: result?.romanizedArtist || artist
                    }
                };
            },

            async generateTMI({ title, artist, lang }) {
                if (!title || !artist) throw new Error('Title and artist are required');
                const prompt = buildTMIPrompt(title, artist, lang);
                const rawResponse = await callProxy(prompt);
                return extractJSON(rawResponse);
            }
        };

        return addon;
    }

    // ============================================
    // Register all addons
    // ============================================

    const addons = TOOL_CONFIGS.map(createAddon);
    const addonIds = addons.map(addon => addon.id);

    let registerAttempts = 0;
    const registerAddons = () => {
        if (window.AIAddonManager) {
            installMarketplaceUnregisterBridge(addonIds);
            addons.forEach(addon => window.AIAddonManager.register(addon));
            console.log('[CLI Provider] All addons registered');
        } else if (++registerAttempts < MAX_REGISTER_RETRIES) {
            setTimeout(registerAddons, 100);
        } else {
            console.error('[CLI Provider] AIAddonManager not found after max retries');
        }
    };

    registerAddons();
    console.log('[CLI Provider] Module loaded');
})();
