/**
 * Web AI Provider for ivLyrics
 * Browser-automation bridge for ChatGPT Web and Gemini Web.
 *
 * @author Ketchio-dev
 * @version 0.2.0
 */

(() => {
    'use strict';

    const ADDON_INFO = {
        id: 'freeaiprovider',
        name: 'Web AI Provider (ChatGPT + Gemini)',
        author: 'Ketchio-dev',
        description: {
            ko: 'ChatGPT와 Gemini 웹 로그인을 로컬 브리지로 자동화해 번역/발음을 제공합니다.',
            en: 'Provides translation and pronunciation by automating ChatGPT and Gemini web sessions through a local bridge.',
        },
        version: '0.2.0',
        supports: {
            translate: true,
            metadata: false,
            tmi: false,
        },
    };

    const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:19333';
    const PROVIDER_FALLBACKS = [
        { id: 'chatgpt', name: 'ChatGPT' },
        { id: 'gemini', name: 'Gemini' },
    ];

    const LANGUAGE_DATA = {
        ko: { name: 'Korean', native: '한국어', phoneticDesc: 'Korean Hangul pronunciation' },
        en: { name: 'English', native: 'English', phoneticDesc: 'Latin alphabet romanization' },
        'zh-CN': { name: 'Simplified Chinese', native: '简体中文', phoneticDesc: 'Simplified Chinese pronunciation' },
        'zh-TW': { name: 'Traditional Chinese', native: '繁體中文', phoneticDesc: 'Traditional Chinese pronunciation' },
        ja: { name: 'Japanese', native: '日本語', phoneticDesc: 'Japanese Katakana pronunciation' },
        hi: { name: 'Hindi', native: 'हिन्दी', phoneticDesc: 'Hindi Devanagari pronunciation' },
        es: { name: 'Spanish', native: 'Español', phoneticDesc: 'Spanish phonetic spelling' },
        fr: { name: 'French', native: 'Français', phoneticDesc: 'French phonetic spelling' },
        ar: { name: 'Arabic', native: 'العربية', phoneticDesc: 'Arabic script pronunciation' },
        fa: { name: 'Persian', native: 'فارسی', phoneticDesc: 'Persian script pronunciation' },
        de: { name: 'German', native: 'Deutsch', phoneticDesc: 'German phonetic spelling' },
        ru: { name: 'Russian', native: 'Русский', phoneticDesc: 'Russian Cyrillic pronunciation' },
        pt: { name: 'Portuguese', native: 'Português', phoneticDesc: 'Portuguese phonetic spelling' },
        bn: { name: 'Bengali', native: 'বাংলা', phoneticDesc: 'Bengali script pronunciation' },
        it: { name: 'Italian', native: 'Italiano', phoneticDesc: 'Italian phonetic spelling' },
        th: { name: 'Thai', native: 'ไทย', phoneticDesc: 'Thai script pronunciation' },
        vi: { name: 'Vietnamese', native: 'Tiếng Việt', phoneticDesc: 'Vietnamese phonetic spelling' },
        id: { name: 'Indonesian', native: 'Bahasa Indonesia', phoneticDesc: 'Indonesian phonetic spelling' },
    };

    function normalizeBridgeUrl(rawValue) {
        const value = String(rawValue || '').trim();
        if (!value) return DEFAULT_BRIDGE_URL;
        try {
            const url = new URL(value);
            if (!/^https?:$/.test(url.protocol)) return DEFAULT_BRIDGE_URL;
            url.pathname = '';
            url.search = '';
            url.hash = '';
            return url.origin;
        } catch {
            return DEFAULT_BRIDGE_URL;
        }
    }

    function getLocalizedText(textObj, lang) {
        if (typeof textObj === 'string') return textObj;
        return textObj?.[lang] || textObj?.en || Object.values(textObj || {})[0] || '';
    }

    function getSetting(key, defaultValue = null) {
        return window.AIAddonManager?.getAddonSetting(ADDON_INFO.id, key, defaultValue) ?? defaultValue;
    }

    function setSetting(key, value) {
        window.AIAddonManager?.setAddonSetting(ADDON_INFO.id, key, value);
    }

    function getBridgeUrl() {
        return normalizeBridgeUrl(getSetting('bridge-url', DEFAULT_BRIDGE_URL));
    }

    function getSelectedProvider() {
        return String(getSetting('provider', 'chatgpt') || 'chatgpt').trim().toLowerCase();
    }

    function getLangInfo(lang) {
        if (!lang) return LANGUAGE_DATA.en;
        const shortLang = String(lang).split('-')[0].toLowerCase();
        return LANGUAGE_DATA[lang] || LANGUAGE_DATA[shortLang] || LANGUAGE_DATA.en;
    }

    function buildTranslationPrompt(text, lang) {
        const langInfo = getLangInfo(lang);
        const lineCount = text.split('\n').length;

        return `You are a lyrics translator. Translate these ${lineCount} lines of song lyrics into ${langInfo.name} (${langInfo.native}).

RULES:
- Output EXACTLY ${lineCount} lines, one translation per line
- Keep empty lines as empty
- Keep symbols like [Chorus], (Yeah), and ♪ as-is
- Do NOT add numbering, quotes, notes, or explanations
- Do NOT use markdown or code blocks
- Return only the translated lines

INPUT:
${text}`;
    }

    function buildPhoneticPrompt(text, lang) {
        const langInfo = getLangInfo(lang);
        const lineCount = text.split('\n').length;

        return `Convert these ${lineCount} lines of lyrics into pronunciation for ${langInfo.name} speakers.

RULES:
- Output EXACTLY ${lineCount} lines, one pronunciation per line
- Keep empty lines as empty
- Keep symbols like [Chorus], (Yeah), and ♪ as-is
- Do NOT translate the meaning
- Do NOT add numbering, quotes, notes, or explanations
- Do NOT use markdown or code blocks
- Use ${langInfo.phoneticDesc}
- Return only the pronunciation lines

INPUT:
${text}`;
    }

    function parseTextLines(text, expectedLineCount) {
        const cleaned = String(text || '')
            .replace(/```[a-z]*\s*/gi, '')
            .replace(/```\s*/g, '')
            .trim();
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

    async function requestBridge(path, body) {
        const response = await fetch(`${getBridgeUrl()}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || `HTTP ${response.status}`);
        }
        return data;
    }

    async function getBridgeProviders() {
        try {
            const response = await fetch(`${getBridgeUrl()}/providers`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            return Array.isArray(data.providers) && data.providers.length > 0 ? data.providers : PROVIDER_FALLBACKS;
        } catch {
            return PROVIDER_FALLBACKS;
        }
    }

    async function generate(prompt) {
        const provider = getSelectedProvider();
        const data = await requestBridge('/generate', { provider, prompt });
        if (!data.text) {
            throw new Error('Empty response from bridge');
        }
        return data.text;
    }

    const FreeAIproviderAddon = {
        ...ADDON_INFO,

        getSettingsUI() {
            const React = Spicetify.React;
            const { useState, useEffect, useCallback } = React;

            return function FreeAIproviderSettings() {
                const [bridgeUrl, setBridgeUrl] = useState(getBridgeUrl());
                const [provider, setProvider] = useState(getSelectedProvider());
                const [availableProviders, setAvailableProviders] = useState(PROVIDER_FALLBACKS);
                const [status, setStatus] = useState('Checking bridge...');
                const [authStatus, setAuthStatus] = useState('');
                const [testStatus, setTestStatus] = useState('');
                const [loadingProviders, setLoadingProviders] = useState(false);

                const refreshProviders = useCallback(async () => {
                    setLoadingProviders(true);
                    try {
                        const providers = await getBridgeProviders();
                        setAvailableProviders(providers);
                    } finally {
                        setLoadingProviders(false);
                    }
                }, []);

                const refreshHealth = useCallback(async () => {
                    try {
                        const response = await fetch(`${bridgeUrl}/health`);
                        if (!response.ok) throw new Error(`HTTP ${response.status}`);
                        const data = await response.json();
                        const providerState = data.providers?.[provider];
                        if (providerState) {
                            setStatus(
                                `Running. Session saved: ${providerState.hasSavedSession ? 'yes' : 'no'} / Login window: ${providerState.authWindowOpen ? 'open' : 'closed'}`
                            );
                        } else {
                            setStatus('Running.');
                        }
                    } catch {
                        setStatus(`Bridge not reachable at ${bridgeUrl}`);
                    }
                }, [bridgeUrl, provider]);

                useEffect(() => {
                    refreshProviders();
                    refreshHealth();
                }, [refreshProviders, refreshHealth]);

                const handleBridgeUrlChange = (event) => {
                    const value = normalizeBridgeUrl(event.target.value);
                    setBridgeUrl(value);
                    setSetting('bridge-url', value);
                };

                const handleProviderChange = (event) => {
                    const value = event.target.value;
                    setProvider(value);
                    setSetting('provider', value);
                };

                const handleOpenLogin = async () => {
                    setAuthStatus('Opening login window...');
                    try {
                        await requestBridge('/auth/open', { provider });
                        setAuthStatus('Login window opened. Finish login in the browser, then click Save Session.');
                    } catch (error) {
                        setAuthStatus(`Failed: ${error.message}`);
                    } finally {
                        refreshHealth().catch(() => {});
                    }
                };

                const handleSaveSession = async () => {
                    setAuthStatus('Saving session...');
                    try {
                        await requestBridge('/auth/complete', { provider });
                        setAuthStatus('Session saved.');
                    } catch (error) {
                        setAuthStatus(`Failed: ${error.message}`);
                    } finally {
                        refreshHealth().catch(() => {});
                    }
                };

                const handleCancelLogin = async () => {
                    setAuthStatus('Closing login window...');
                    try {
                        await requestBridge('/auth/cancel', { provider });
                        setAuthStatus('Login window closed.');
                    } catch (error) {
                        setAuthStatus(`Failed: ${error.message}`);
                    } finally {
                        refreshHealth().catch(() => {});
                    }
                };

                const handleTest = async () => {
                    setTestStatus('Testing...');
                    try {
                        const result = await generate('Reply with OK only.');
                        setTestStatus(result ? `OK: ${result}` : 'Empty response');
                    } catch (error) {
                        setTestStatus(`Failed: ${error.message}`);
                    }
                };

                return React.createElement('div', { className: 'ai-addon-settings freeai-settings' },
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('label', null, 'Bridge URL'),
                        React.createElement('input', {
                            type: 'text',
                            value: bridgeUrl,
                            onChange: handleBridgeUrlChange,
                            placeholder: DEFAULT_BRIDGE_URL,
                        }),
                        React.createElement('small', null, 'Run the local bridge server first. Default: http://127.0.0.1:19333')
                    ),
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('label', null, 'Provider'),
                        React.createElement('div', { className: 'ai-addon-input-group' },
                            React.createElement('select', {
                                value: provider,
                                onChange: handleProviderChange,
                                disabled: loadingProviders,
                            },
                                availableProviders.map((item) => React.createElement('option', {
                                    key: item.id,
                                    value: item.id,
                                }, item.name || item.id))
                            ),
                            React.createElement('button', {
                                className: 'ai-addon-btn-secondary',
                                onClick: refreshProviders,
                            }, loadingProviders ? '...' : 'Refresh')
                        ),
                        React.createElement('small', null, status)
                    ),
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
                            React.createElement('button', {
                                className: 'ai-addon-btn-primary',
                                onClick: handleOpenLogin,
                            }, 'Open Login Window'),
                            React.createElement('button', {
                                className: 'ai-addon-btn-secondary',
                                onClick: handleSaveSession,
                            }, 'Save Session'),
                            React.createElement('button', {
                                className: 'ai-addon-btn-secondary',
                                onClick: handleCancelLogin,
                            }, 'Cancel Login')
                        ),
                        authStatus && React.createElement('small', null, authStatus)
                    ),
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('button', {
                            className: 'ai-addon-btn-primary',
                            onClick: handleTest,
                        }, 'Test Bridge'),
                        testStatus && React.createElement('small', null, testStatus)
                    ),
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('small', null, 'This addon is experimental. Web UI changes, captcha, or session expiry can break it at any time.')
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
            const rawResponse = await generate(prompt);
            const lines = parseTextLines(rawResponse, expectedLineCount);

            if (wantSmartPhonetic) {
                return { phonetic: lines };
            }
            return { translation: lines };
        },
    };

    const registerAddon = () => {
        if (window.AIAddonManager) {
            window.AIAddonManager.register(FreeAIproviderAddon);
        } else {
            setTimeout(registerAddon, 100);
        }
    };

    registerAddon();

    window.__ivLyricsDebugLog?.('[Web AI Provider] Module loaded');
})();
