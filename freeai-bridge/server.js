const express = require('express');
const cors = require('cors');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const PORT = Number(process.env.PORT || 19333);
const SERVICE_HEADLESS = process.env.FREEAI_SERVICE_HEADLESS === '1';
const BROWSER_CHANNEL = process.env.FREEAI_BROWSER_CHANNEL || '';
const RESPONSE_TIMEOUT_MS = Number(process.env.FREEAI_RESPONSE_TIMEOUT_MS || 120000);
const ROOT_DIR = __dirname;
const STATE_DIR = path.join(os.homedir(), '.freeai-bridge', 'state');
const OVERRIDE_PATH = path.join(ROOT_DIR, 'providers.local.json');
const ARTIFACTS_DIR = path.join(ROOT_DIR, '..', 'output', 'playwright');
const DEFAULT_VIEWPORT = { width: 1440, height: 960 };
const authSessions = new Map();
const providerRuntimes = new Map();
const providerLocks = new Map();

const BASE_PROVIDERS = Object.freeze({
    chatgpt: {
        id: 'chatgpt',
        name: 'ChatGPT',
        appUrl: 'https://chatgpt.com/',
        loginUrl: 'https://chatgpt.com/',
        composerSelectors: [
            '#prompt-textarea',
            'textarea',
            '[contenteditable="true"]',
            'div[role="textbox"]',
        ],
        submitSelectors: [
            'button[data-testid="send-button"]',
            'button[aria-label*="Send"]',
            'button[type="submit"]',
        ],
        responseSelectors: [
            '[data-message-author-role="assistant"]',
            'article [data-message-author-role="assistant"]',
        ],
        closePopupSelectors: [
            'button[aria-label*="Close"]',
            'button:has-text("Close")',
            'button:has-text("Dismiss")',
            'button:has-text("Got it")',
            'button:has-text("Maybe later")',
            'button:has-text("Stay logged out")',
        ],
        blockerPhrases: [
            'verify you are human',
            'complete the captcha',
            'log in',
            'sign up',
            'upgrade plan',
            'something went wrong',
        ],
    },
    gemini: {
        id: 'gemini',
        name: 'Gemini',
        appUrl: 'https://gemini.google.com/app',
        loginUrl: 'https://gemini.google.com/app',
        composerSelectors: [
            'rich-textarea div[contenteditable="true"]',
            'textarea',
            '[contenteditable="true"]',
            'div[role="textbox"]',
        ],
        submitSelectors: [
            'button[aria-label*="Send"]',
            'button[aria-label*="submit"]',
            'button[type="submit"]',
        ],
        responseSelectors: [
            'model-response',
            'message-content',
            '.response-container',
        ],
        closePopupSelectors: [
            'button[aria-label*="Close"]',
            'button:has-text("Close")',
            'button:has-text("Dismiss")',
            'button:has-text("Not now")',
            'button:has-text("Got it")',
        ],
        blockerPhrases: [
            'verify it’s you',
            'verify it is you',
            'try again later',
            'sign in',
            'upgrade',
            'unable to load',
        ],
    },
});

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function getProviderStatePath(providerId) {
    return path.join(STATE_DIR, `${providerId}.json`);
}

function getRuntimeArtifactPath(providerId, suffix) {
    ensureDir(ARTIFACTS_DIR);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(ARTIFACTS_DIR, `${providerId}-${stamp}-${suffix}.png`);
}

function loadOverrides() {
    try {
        if (!fs.existsSync(OVERRIDE_PATH)) return {};
        return JSON.parse(fs.readFileSync(OVERRIDE_PATH, 'utf8'));
    } catch (error) {
        console.warn('[freeai-bridge] Failed to load providers.local.json:', error.message);
        return {};
    }
}

function getProviders() {
    const overrides = loadOverrides();
    const providers = {};
    for (const [providerId, provider] of Object.entries(BASE_PROVIDERS)) {
        providers[providerId] = {
            ...provider,
            ...(overrides[providerId] || {}),
        };
    }
    return providers;
}

function getProvider(providerId) {
    const provider = getProviders()[providerId];
    if (!provider) {
        throw new Error(`Unknown provider: ${providerId}`);
    }
    return provider;
}

function buildLaunchOptions(headless) {
    return {
        headless,
        channel: BROWSER_CHANNEL || undefined,
        args: ['--disable-blink-features=AutomationControlled'],
    };
}

async function createContext({ storageStatePath, headless }) {
    const browser = await chromium.launch(buildLaunchOptions(headless));
    const context = await browser.newContext({
        storageState: fs.existsSync(storageStatePath) ? storageStatePath : undefined,
        viewport: DEFAULT_VIEWPORT,
    });
    return { browser, context };
}

function withProviderLock(providerId, task) {
    const previous = providerLocks.get(providerId) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => task());
    providerLocks.set(providerId, next.catch(() => {}));
    return next;
}

function getAllowedHosts(provider) {
    const urls = [provider.appUrl, provider.loginUrl].filter(Boolean);
    const hosts = new Set();
    for (const value of urls) {
        try {
            hosts.add(new URL(value).hostname);
        } catch {}
    }

    if (provider.id === 'gemini') {
        hosts.add('accounts.google.com');
        hosts.add('ogs.google.com');
    }
    return hosts;
}

function isAllowedUrl(url, provider, allowExternalAuth = false) {
    if (!url || url === 'about:blank') return true;
    try {
        const parsed = new URL(url);
        if (allowExternalAuth) return true;
        return getAllowedHosts(provider).has(parsed.hostname);
    } catch {
        return false;
    }
}

async function closeKnownPopups(page, provider) {
    for (const selector of provider.closePopupSelectors || []) {
        try {
            const locator = page.locator(selector).last();
            if (await locator.isVisible({ timeout: 300 })) {
                await locator.click({ timeout: 1500 });
                await page.waitForTimeout(250);
            }
        } catch {}
    }
}

async function readBodyText(page) {
    try {
        return (await page.locator('body').innerText()).trim();
    } catch {
        return '';
    }
}

async function detectBlockers(page, provider) {
    const bodyText = (await readBodyText(page)).toLowerCase();
    const blockerPhrases = provider.blockerPhrases || [];
    const knownCaptchas = [
        'captcha',
        'verify you are human',
        'verify it’s you',
        'verify it is you',
        'complete the security check',
    ];

    for (const phrase of [...blockerPhrases, ...knownCaptchas]) {
        if (bodyText.includes(String(phrase).toLowerCase())) {
            return phrase;
        }
    }

    try {
        if (await page.locator('iframe[src*="captcha"], iframe[title*="captcha"]').count() > 0) {
            return 'captcha iframe detected';
        }
    } catch {}

    return '';
}

async function captureFailureArtifacts(page, providerId, suffix) {
    if (!page || page.isClosed()) return '';
    try {
        const outputPath = getRuntimeArtifactPath(providerId, suffix);
        await page.screenshot({ path: outputPath, fullPage: true });
        return outputPath;
    } catch {
        return '';
    }
}

async function navigateReadyPage(page, url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1500);
}

async function attachRuntimeGuards(runtime, provider, allowExternalAuth = false) {
    const { context, page } = runtime;
    const guardedPages = new WeakSet();

    const guardPage = async (targetPage) => {
        if (!targetPage || guardedPages.has(targetPage)) return;
        guardedPages.add(targetPage);

        targetPage.on('dialog', async (dialog) => {
            try {
                await dialog.dismiss();
            } catch {}
        });

        targetPage.on('popup', async (popup) => {
            try {
                await popup.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
                if (!isAllowedUrl(popup.url(), provider, allowExternalAuth)) {
                    runtime.lastPopup = popup.url();
                    await popup.close().catch(() => {});
                }
            } catch {}
        });
    };

    context.on('page', async (targetPage) => {
        await guardPage(targetPage);
        try {
            await targetPage.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
            if (!isAllowedUrl(targetPage.url(), provider, allowExternalAuth)) {
                runtime.lastPopup = targetPage.url();
                if (targetPage !== runtime.page) {
                    await targetPage.close().catch(() => {});
                }
            }
        } catch {}
    });

    await guardPage(page);
}

async function waitForVisibleLocator(page, selectors, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        for (const selector of selectors) {
            const locator = page.locator(selector).last();
            try {
                await locator.waitFor({ state: 'visible', timeout: 700 });
                return locator;
            } catch {}
        }
        await page.waitForTimeout(250);
    }
    throw new Error(`No visible locator found for selectors: ${selectors.join(', ')}`);
}

async function clearComposer(page, locator) {
    await locator.click({ timeout: 5000 });
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+A`);
    await page.keyboard.press('Backspace');
}

async function fillComposer(page, locator, prompt) {
    const tagName = await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => '');
    if (tagName === 'textarea' || tagName === 'input') {
        await locator.fill(prompt);
        return;
    }

    await clearComposer(page, locator);
    await page.keyboard.insertText(prompt);
}

async function clickSubmit(page, provider) {
    for (const selector of provider.submitSelectors || []) {
        const locator = page.locator(selector).last();
        try {
            if (await locator.isVisible({ timeout: 500 })) {
                await locator.click({ timeout: 3000 });
                return;
            }
        } catch {}
    }

    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    try {
        await page.keyboard.press(`${modifier}+Enter`);
        return;
    } catch {}

    await page.keyboard.press('Enter');
}

async function readLatestAssistantText(page, provider) {
    let latestText = '';
    for (const selector of provider.responseSelectors || []) {
        try {
            const nodes = await page.locator(selector).evaluateAll((elements) =>
                elements.map((element) => (element.innerText || element.textContent || '').trim())
            );
            const filtered = nodes.filter((value) => value && value.length > 1);
            if (filtered.length > 0) {
                latestText = filtered[filtered.length - 1];
            }
        } catch {}
        if (latestText) break;
    }
    return latestText.trim();
}

function normalizeAssistantText(providerId, text) {
    let value = String(text || '').trim();
    if (!value) return '';

    if (providerId === 'gemini') {
        value = value.replace(/^gemini의 응답\s*/i, '').trim();
        value = value.replace(/^response from gemini\s*/i, '').trim();
    }

    return value;
}

async function waitForAssistantResponse(page, provider, timeoutMs = RESPONSE_TIMEOUT_MS) {
    const startedAt = Date.now();
    let latestText = '';
    let stableTicks = 0;

    while (Date.now() - startedAt < timeoutMs) {
        await closeKnownPopups(page, provider);

        const blocker = await detectBlockers(page, provider);
        if (blocker) {
            throw new Error(`Blocked by UI state: ${blocker}`);
        }

        const nextText = await readLatestAssistantText(page, provider);
        if (nextText && nextText !== latestText) {
            latestText = nextText;
            stableTicks = 0;
        } else if (nextText && nextText === latestText) {
            stableTicks += 1;
            if (stableTicks >= 3) {
                return latestText;
            }
        }

        await page.waitForTimeout(1200);
    }

    if (latestText) return latestText;
    throw new Error('Timed out while waiting for assistant response');
}

async function closeRuntime(providerId) {
    const runtime = providerRuntimes.get(providerId);
    if (!runtime) return;
    providerRuntimes.delete(providerId);
    try {
        await runtime.browser.close();
    } catch {}
}

async function ensureServiceRuntime(providerId) {
    const provider = getProvider(providerId);
    const existing = providerRuntimes.get(providerId);
    if (existing && !existing.page.isClosed()) {
        existing.lastUsedAt = new Date().toISOString();
        return existing;
    }

    const storageStatePath = getProviderStatePath(providerId);
    const { browser, context } = await createContext({
        storageStatePath,
        headless: SERVICE_HEADLESS,
    });
    const page = await context.newPage();
    const runtime = {
        providerId,
        mode: SERVICE_HEADLESS ? 'headless' : 'headed',
        browser,
        context,
        page,
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        lastPopup: '',
        lastError: '',
        lastArtifact: '',
    };

    await attachRuntimeGuards(runtime, provider, false);
    providerRuntimes.set(providerId, runtime);
    return runtime;
}

async function openAuthWindow(providerId) {
    ensureDir(STATE_DIR);
    const provider = getProvider(providerId);

    if (authSessions.has(providerId)) {
        return authSessions.get(providerId);
    }

    const storageStatePath = getProviderStatePath(providerId);
    const { browser, context } = await createContext({
        storageStatePath,
        headless: false,
    });
    const page = await context.newPage();
    const session = {
        providerId,
        browser,
        context,
        page,
        openedAt: new Date().toISOString(),
        lastPopup: '',
    };

    await attachRuntimeGuards(session, provider, true);
    await navigateReadyPage(page, provider.loginUrl || provider.appUrl);
    authSessions.set(providerId, session);
    return session;
}

async function completeAuth(providerId) {
    const session = authSessions.get(providerId);
    if (!session) {
        throw new Error(`No active auth session for ${providerId}`);
    }

    const storageStatePath = getProviderStatePath(providerId);
    ensureDir(path.dirname(storageStatePath));
    await session.context.storageState({ path: storageStatePath });
    await session.browser.close();
    authSessions.delete(providerId);
    await closeRuntime(providerId);
    return storageStatePath;
}

async function cancelAuth(providerId) {
    const session = authSessions.get(providerId);
    if (!session) return false;
    await session.browser.close();
    authSessions.delete(providerId);
    return true;
}

async function prepareRuntimeForPrompt(runtime, provider) {
    await navigateReadyPage(runtime.page, provider.appUrl);
    await closeKnownPopups(runtime.page, provider);
    const blocker = await detectBlockers(runtime.page, provider);
    if (blocker) {
        throw new Error(`Blocked before prompt submission: ${blocker}`);
    }
}

async function generateWithProvider(providerId, prompt) {
    return await withProviderLock(providerId, async () => {
        ensureDir(STATE_DIR);
        ensureDir(ARTIFACTS_DIR);

        const provider = getProvider(providerId);
        const runtime = await ensureServiceRuntime(providerId);
        runtime.lastUsedAt = new Date().toISOString();
        runtime.lastError = '';
        runtime.lastArtifact = '';

        try {
            await prepareRuntimeForPrompt(runtime, provider);
            const composer = await waitForVisibleLocator(runtime.page, provider.composerSelectors, 20000);
            await fillComposer(runtime.page, composer, prompt);
            await runtime.page.waitForTimeout(200);
            await clickSubmit(runtime.page, provider);
            const text = await waitForAssistantResponse(runtime.page, provider);
            await runtime.context.storageState({ path: getProviderStatePath(providerId) });
            return normalizeAssistantText(providerId, text);
        } catch (error) {
            runtime.lastError = error.message;
            runtime.lastArtifact = await captureFailureArtifacts(runtime.page, providerId, 'failure');
            await closeRuntime(providerId);
            const artifactMessage = runtime.lastArtifact ? ` Screenshot: ${runtime.lastArtifact}` : '';
            throw new Error(`${error.message}.${artifactMessage}`);
        }
    });
}

function getProviderPayload(providerId) {
    const provider = getProvider(providerId);
    const runtime = providerRuntimes.get(providerId);
    return {
        id: provider.id,
        name: provider.name,
        appUrl: provider.appUrl,
        hasSavedSession: fs.existsSync(getProviderStatePath(providerId)),
        authWindowOpen: authSessions.has(providerId),
        runtimeActive: !!runtime,
        runtimeMode: runtime?.mode || '',
        lastPopup: runtime?.lastPopup || '',
        lastError: runtime?.lastError || '',
        lastArtifact: runtime?.lastArtifact || '',
    };
}

async function shutdownAll() {
    for (const providerId of Array.from(authSessions.keys())) {
        await cancelAuth(providerId);
    }
    for (const providerId of Array.from(providerRuntimes.keys())) {
        await closeRuntime(providerId);
    }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => {
    const providers = {};
    for (const providerId of Object.keys(getProviders())) {
        providers[providerId] = getProviderPayload(providerId);
    }

    res.json({
        status: 'ok',
        port: PORT,
        serviceHeadless: SERVICE_HEADLESS,
        providers,
    });
});

app.get('/providers', (req, res) => {
    const providers = Object.keys(getProviders()).map(getProviderPayload);
    res.json({ providers });
});

app.post('/auth/open', async (req, res) => {
    const providerId = String(req.body?.provider || '').trim().toLowerCase();
    if (!providerId) {
        return res.status(400).json({ error: 'Missing provider' });
    }

    try {
        const session = await openAuthWindow(providerId);
        return res.json({
            success: true,
            provider: providerId,
            openedAt: session.openedAt,
            url: session.page.url(),
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post('/auth/complete', async (req, res) => {
    const providerId = String(req.body?.provider || '').trim().toLowerCase();
    if (!providerId) {
        return res.status(400).json({ error: 'Missing provider' });
    }

    try {
        const storageStatePath = await completeAuth(providerId);
        return res.json({
            success: true,
            provider: providerId,
            storageStatePath,
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post('/auth/cancel', async (req, res) => {
    const providerId = String(req.body?.provider || '').trim().toLowerCase();
    if (!providerId) {
        return res.status(400).json({ error: 'Missing provider' });
    }

    try {
        const cancelled = await cancelAuth(providerId);
        return res.json({
            success: true,
            provider: providerId,
            cancelled,
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post('/generate', async (req, res) => {
    const providerId = String(req.body?.provider || '').trim().toLowerCase();
    const prompt = String(req.body?.prompt || '').trim();
    if (!providerId || !prompt) {
        return res.status(400).json({ error: 'Missing provider or prompt' });
    }

    try {
        const text = await generateWithProvider(providerId, prompt);
        return res.json({
            success: true,
            provider: providerId,
            text,
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

const server = app.listen(PORT, '127.0.0.1', () => {
    ensureDir(STATE_DIR);
    ensureDir(ARTIFACTS_DIR);
    console.log(`[freeai-bridge] listening on http://127.0.0.1:${PORT}`);
    console.log(`[freeai-bridge] service mode: ${SERVICE_HEADLESS ? 'headless' : 'headed'}`);
});

async function gracefulShutdown(signal) {
    console.log(`[freeai-bridge] ${signal} received, shutting down`);
    server.close(async () => {
        await shutdownAll();
        process.exit(0);
    });
}

process.on('SIGINT', () => { gracefulShutdown('SIGINT').catch(() => process.exit(1)); });
process.on('SIGTERM', () => { gracefulShutdown('SIGTERM').catch(() => process.exit(1)); });
