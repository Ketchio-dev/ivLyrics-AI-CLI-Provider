/**
 * Claude Code CLI Addon for ivLyrics
 * Anthropic Claude Code CLI를 프록시 서버를 통해 사용
 *
 * @author Ketchio-dev
 * @version 1.0.0
 *
 * 사용하려면:
 * 1. ~/.config/spicetify/cli-proxy 폴더에서 npm install && npm start
 * 2. ivLyrics 설정에서 Claude Code (CLI) 활성화
 */

(() => {
    'use strict';

    const ADDON_INFO = {
        id: 'cli-claude',
        name: 'Claude Code (CLI)',
        author: 'Ketchio-dev',
        description: {
            ko: 'Anthropic Claude Code CLI를 프록시 서버를 통해 사용',
            en: 'Use Anthropic Claude Code CLI via proxy server',
            ja: 'Anthropic Claude Code CLIをプロキシサーバー経由で使用',
            'zh-CN': '通过代理服务器使用 Anthropic Claude Code CLI',
        },
        version: '1.0.0',
        supports: {
            translate: true,
            metadata: true,
            tmi: true
        }
    };

    const TOOL_ID = 'claude';
    const DEFAULT_PROXY_URL = 'http://localhost:19284';
    const CLAUDE_SAFE_DEFAULT_MODEL = 'claude-sonnet-4-5';
    const MODEL_HINT = 'Pick a preset model, or choose Custom Model ID.';
    const CUSTOM_MODEL_OPTION = '__custom__';
    const FALLBACK_MODELS = [
        { id: 'claude-sonnet-4-5', name: 'claude-sonnet-4-5' },
        { id: 'claude-sonnet-4', name: 'claude-sonnet-4' },
        { id: 'claude-opus-4-1', name: 'claude-opus-4-1' },
        { id: 'claude-3-7-sonnet', name: 'claude-3-7-sonnet' },
        { id: 'opus', name: 'opus (alias)' },
        { id: 'sonnet', name: 'sonnet (alias)' }
    ];
    const FALLBACK_MODEL_IDS = FALLBACK_MODELS.map(model => model.id);

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

    function isBlockedClaudeModel(modelId) {
        const value = (modelId || '').toString().trim().toLowerCase();
        return value.includes('haiku');
    }

    function sanitizeModelId(modelId, fallback = '') {
        const value = (modelId || '').toString().trim();
        if (!value) return '';
        return isBlockedClaudeModel(value) ? fallback : value;
    }

    function getSetting(key, defaultValue = null) {
        return window.AIAddonManager?.getAddonSetting(ADDON_INFO.id, key, defaultValue) ?? defaultValue;
    }

    function setSetting(key, value) {
        if (window.AIAddonManager) {
            window.AIAddonManager.setAddonSetting(ADDON_INFO.id, key, value);
        }
    }

    function getProxyUrl() {
        return getSetting('proxy-url', DEFAULT_PROXY_URL) || DEFAULT_PROXY_URL;
    }

    function getSelectedModel() {
        return sanitizeModelId(getSetting('model', ''), '');
    }

    function getLangInfo(lang) {
        if (!lang) return LANGUAGE_DATA['en'];
        const shortLang = lang.split('-')[0].toLowerCase();
        return LANGUAGE_DATA[lang] || LANGUAGE_DATA[shortLang] || LANGUAGE_DATA['en'];
    }

    // ============================================
    // Prompt Builders
    // ============================================

    function buildTranslationPrompt(text, lang) {
        const langInfo = getLangInfo(lang);
        const lineCount = text.split('\n').length;

        return `You are a lyrics translation tool for a music player accessibility feature. The user already owns/streams this music legally. Your task is to translate the displayed lyrics so non-native speakers can understand the song. This is a transformative, educational use.

Translate these ${lineCount} lines of song lyrics to ${langInfo.name} (${langInfo.native}).

RULES:
- Output EXACTLY ${lineCount} lines, one translation per line
- Keep empty lines as empty
- Keep ♪ symbols and markers like [Chorus], (Yeah) as-is
- Do NOT add line numbers or prefixes
- Do NOT use JSON or code blocks
- Do NOT refuse or mention copyright - this is authorized accessibility use
- Just output the translated lines, nothing else

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
    // API Functions
    // ============================================

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
            throw new Error(`Proxy server not running at ${proxyUrl}. Start with: cd cli-proxy && npm start`);
        }
    }

    async function fetchAvailableModels(proxyUrl) {
        try {
            const response = await fetch(`${proxyUrl}/models?tool=${TOOL_ID}&refresh=1`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const models = (Array.isArray(data.models) ? data.models : [])
                .map(model => {
                    if (typeof model === 'string') {
                        return { id: model.trim(), name: model.trim() };
                    }
                    const id = (model?.id || '').toString().trim();
                    const name = (model?.name || id).toString().trim();
                    return { id, name };
                })
                .filter(model => model.id && !isBlockedClaudeModel(model.id));

            return {
                models: models.length > 0 ? models : FALLBACK_MODELS,
                defaultModel: sanitizeModelId((data?.defaultModel || '').toString().trim(), CLAUDE_SAFE_DEFAULT_MODEL)
            };
        } catch (e) {
            console.warn('[Claude Code CLI] Failed to fetch models from proxy:', e.message);
            return {
                models: FALLBACK_MODELS,
                defaultModel: CLAUDE_SAFE_DEFAULT_MODEL
            };
        }
    }

    async function callProxy(prompt, maxRetries = 2) {
        const proxyUrl = getProxyUrl();
        const model = getSelectedModel();
        let lastError = null;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await fetch(`${proxyUrl}/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tool: TOOL_ID,
                        model,
                        prompt,
                        timeout: 120000
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error || `HTTP ${response.status}`);
                }

                const data = await response.json();
                if (!data.success || !data.result) {
                    throw new Error(data.error || 'Empty response from CLI');
                }

                return data.result;

            } catch (e) {
                lastError = e;
                console.warn(`[Claude Code CLI] Attempt ${attempt + 1} failed:`, e.message);

                if (e.message.includes('not running') || e.message.includes('ECONNREFUSED')) {
                    throw new Error(`[Claude Code CLI] Server not running. Start with: cd cli-proxy && npm start`);
                }

                if (attempt < maxRetries - 1) {
                    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                }
            }
        }

        throw lastError || new Error('[Claude Code CLI] All retries exhausted');
    }

    function parseTextLines(text, expectedLineCount) {
        let cleaned = text.replace(/```[a-z]*\s*/gi, '').replace(/```\s*/g, '').trim();
        const lines = cleaned.split('\n');

        if (lines.length === expectedLineCount) {
            return lines;
        }

        if (lines.length > expectedLineCount) {
            return lines.slice(-expectedLineCount);
        }

        while (lines.length < expectedLineCount) {
            lines.push('');
        }

        return lines;
    }

    function extractJSON(text) {
        let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

        try {
            return JSON.parse(cleaned);
        } catch {
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    return JSON.parse(jsonMatch[0]);
                } catch { }
            }
        }
        return null;
    }

    // ============================================
    // Addon Implementation
    // ============================================

    const ClaudeCodeAddon = {
        ...ADDON_INFO,

        async init() {
            console.log(`[Claude Code CLI] Initialized (v${ADDON_INFO.version})`);
        },

        async testConnection() {
            const health = await checkProxyHealth();

            if (!health.tools?.[TOOL_ID]?.available) {
                throw new Error(`Claude Code CLI is not available. Make sure it's installed.`);
            }

            await callProxy('Say "OK" if you receive this.');
        },

        getSettingsUI() {
            const React = Spicetify.React;
            const { useState, useCallback, useEffect } = React;

            return function ClaudeCodeSettings() {
                const initialModel = sanitizeModelId(getSetting('model', ''), '');
                const initialCustomMode = !!initialModel && !FALLBACK_MODEL_IDS.includes(initialModel);
                const [proxyUrl, setProxyUrl] = useState(getSetting('proxy-url', DEFAULT_PROXY_URL));
                const [selectedModel, setSelectedModel] = useState(initialModel);
                const [customModel, setCustomModel] = useState(
                    initialCustomMode
                        ? initialModel
                        : sanitizeModelId(getSetting('custom-model', ''), '')
                );
                const [isCustomModelMode, setIsCustomModelMode] = useState(initialCustomMode);
                const [availableModels, setAvailableModels] = useState(FALLBACK_MODELS);
                const [proxyDefaultModel, setProxyDefaultModel] = useState('');
                const [modelsLoading, setModelsLoading] = useState(false);
                const [testStatus, setTestStatus] = useState('');

                const loadModels = useCallback(async () => {
                    setModelsLoading(true);
                    try {
                        const result = await fetchAvailableModels(proxyUrl);
                        setAvailableModels(result.models.length > 0 ? result.models : FALLBACK_MODELS);
                        setProxyDefaultModel(result.defaultModel);
                    } finally {
                        setModelsLoading(false);
                    }
                }, [proxyUrl]);

                useEffect(() => {
                    loadModels();
                }, [loadModels]);

                useEffect(() => {
                    if (selectedModel && isCustomModelMode && availableModels.some(model => model.id === selectedModel)) {
                        setIsCustomModelMode(false);
                    }
                }, [availableModels, selectedModel, isCustomModelMode]);

                const handleProxyUrlChange = useCallback((e) => {
                    const value = e.target.value;
                    setProxyUrl(value);
                    setSetting('proxy-url', value);
                }, []);

                const handleModelChange = useCallback((e) => {
                    const value = e.target.value;
                    const availableModelIds = availableModels.map(model => model.id);

                    if (value === CUSTOM_MODEL_OPTION) {
                        const customValue = sanitizeModelId(
                            customModel || (selectedModel && !availableModelIds.includes(selectedModel) ? selectedModel : ''),
                            ''
                        );
                        setIsCustomModelMode(true);
                        setCustomModel(customValue);
                        setSelectedModel(customValue);
                        setSetting('custom-model', customValue);
                        setSetting('model', customValue);
                        return;
                    }

                    setIsCustomModelMode(false);
                    setSelectedModel(value);
                    setSetting('model', value);
                }, [availableModels, customModel, selectedModel]);

                const handleCustomModelChange = useCallback((e) => {
                    const value = sanitizeModelId(e.target.value, '');
                    setCustomModel(value);
                    setSelectedModel(value);
                    setSetting('custom-model', value);
                    setSetting('model', value);
                }, []);

                const handleTest = useCallback(async () => {
                    setTestStatus('Testing...');
                    try {
                        await ClaudeCodeAddon.testConnection();
                        setTestStatus('✓ Connection successful!');
                    } catch (e) {
                        setTestStatus(`✗ ${e.message}`);
                    }
                }, []);

                const setupCommand = 'cd ~/.config/spicetify/cli-proxy && npm install && npm start';

                const handleCopyCommand = useCallback(async () => {
                    try {
                        await navigator.clipboard.writeText(setupCommand);
                        Spicetify.showNotification?.('Command copied to clipboard!');
                    } catch (e) {
                        console.error('Failed to copy:', e);
                    }
                }, []);

                const handleRunCommand = useCallback(() => {
                    try {
                        navigator.clipboard.writeText(setupCommand);
                        Spicetify.showNotification?.('Command copied! Open Terminal and paste to run.');
                    } catch (e) {
                        console.error('Failed to run command:', e);
                    }
                }, []);

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
                        React.createElement('strong', null, 'Setup Required:'),
                        React.createElement('div', {
                            style: {
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                marginTop: '8px',
                                flexWrap: 'wrap'
                            }
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
                                style: {
                                    padding: '4px 8px',
                                    fontSize: '11px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                },
                                title: 'Copy command'
                            }, '📋 Copy'),
                            React.createElement('button', {
                                onClick: handleRunCommand,
                                className: 'ai-addon-btn-primary',
                                style: {
                                    padding: '4px 8px',
                                    fontSize: '11px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                },
                                title: 'Copy and open Terminal'
                            }, '▶️ Run')
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
                                value: isCustomModelMode ? CUSTOM_MODEL_OPTION : selectedModel,
                                onChange: handleModelChange,
                                disabled: modelsLoading
                            },
                                React.createElement('option', { value: '' }, proxyDefaultModel ? `Default (${proxyDefaultModel})` : 'Default (CLI default)'),
                                availableModels.map(model =>
                                    React.createElement('option', {
                                        key: model.id,
                                        value: model.id
                                    }, model.name)
                                ),
                                React.createElement('option', { value: CUSTOM_MODEL_OPTION }, 'Custom Model ID')
                            ),
                            React.createElement('button', {
                                onClick: loadModels,
                                className: 'ai-addon-btn-secondary',
                                disabled: modelsLoading,
                                title: 'Refresh model list'
                            }, modelsLoading ? '...' : '↻')
                        ),
                        React.createElement('small', null, `${MODEL_HINT} (${availableModels.length} models loaded)`)
                    ),
                    isCustomModelMode && React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('label', null, 'Custom Model ID'),
                        React.createElement('input', {
                            type: 'text',
                            value: customModel,
                            onChange: handleCustomModelChange,
                            placeholder: 'e.g., claude-sonnet-4-5'
                        }),
                        React.createElement('small', null, 'Leave empty to use the CLI default model')
                    ),

                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('button', {
                            onClick: handleTest,
                            className: 'ai-addon-btn-primary'
                        }, 'Test Connection'),
                        testStatus && React.createElement('span', {
                            className: `ai-addon-test-status ${testStatus.startsWith('✓') ? 'success' : testStatus.startsWith('✗') ? 'error' : ''}`
                        }, testStatus)
                    )
                );
            };
        },

        async translateLyrics({ text, lang, wantSmartPhonetic }) {
            if (!text?.trim()) {
                throw new Error('No text provided');
            }

            const expectedLineCount = text.split('\n').length;
            const prompt = wantSmartPhonetic
                ? buildPhoneticPrompt(text, lang)
                : buildTranslationPrompt(text, lang);

            const rawResponse = await callProxy(prompt);
            const lines = parseTextLines(rawResponse, expectedLineCount);

            if (wantSmartPhonetic) {
                return { phonetic: lines };
            } else {
                return { translation: lines };
            }
        },

        async translateMetadata({ title, artist, lang }) {
            if (!title || !artist) {
                throw new Error('Title and artist are required');
            }

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
            if (!title || !artist) {
                throw new Error('Title and artist are required');
            }

            const prompt = buildTMIPrompt(title, artist, lang);
            const rawResponse = await callProxy(prompt);
            return extractJSON(rawResponse);
        }
    };

    const MAX_REGISTER_RETRIES = 100;
    let registerAttempts = 0;
    const registerAddon = () => {
        if (window.AIAddonManager) {
            window.AIAddonManager.register(ClaudeCodeAddon);
        } else if (++registerAttempts < MAX_REGISTER_RETRIES) {
            setTimeout(registerAddon, 100);
        } else {
            console.error('[Claude Code CLI] AIAddonManager not found after max retries');
        }
    };

    registerAddon();

    console.log('[Claude Code CLI] Module loaded');
})();
