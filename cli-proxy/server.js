/**
 * ivLyrics CLI Proxy Server
 * CLI AI 도구들 (Claude Code, Codex, Gemini 등)을 HTTP API로 제공
 *
 * Claude: CLI spawn 방식 유지 (API 키 없이 SDK 전환 불가)
 * Codex:  CLI spawn 방식 유지 (OAuth 토큰 교환 절차가 독점적)
 * Gemini: Code Assist API 직접 호출 (OAuth 토큰 재사용, ~7x 속도 향상)
 *
 * 사용법:
 *   npm install
 *   npm start
 *
 * 기본 포트: 19284
 */

const express = require('express');
const cors = require('cors');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// GUI/서비스 환경에서 PATH가 제한될 수 있으므로 주요 사용자 바이너리 경로를 추가
function expandPath() {
    const home = os.homedir();
    const isWin = process.platform === 'win32';
    const extraDirs = isWin
        ? [
            path.join(home, '.local', 'bin'),
            path.join(home, '.cargo', 'bin'),
            path.join(process.env.APPDATA || '', 'npm'),
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs'),
        ]
        : [
            path.join(home, '.local', 'bin'),
            path.join(home, '.cargo', 'bin'),
            '/opt/homebrew/bin',
            '/usr/local/bin',
        ];
    const currentPath = process.env.PATH || '';
    const currentDirs = new Set(currentPath.split(path.delimiter));
    const missing = extraDirs.filter(d => d && !currentDirs.has(d) && fs.existsSync(d));
    if (missing.length > 0) {
        process.env.PATH = missing.join(path.delimiter) + path.delimiter + currentPath;
    }
}
expandPath();

// .env 파일 로드 (dotenv 없이 직접 파싱)
function loadEnv() {
    try {
        const envPath = path.join(__dirname, '.env');
        const lines = fs.readFileSync(envPath, 'utf8').split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx === -1) continue;
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
            if (!process.env[key]) process.env[key] = val;
        }
    } catch {}
}
loadEnv();

const app = express();
const PORT = process.env.PORT || 19284;

// ============================================
// Version & Auto-Update
// ============================================

const LOCAL_VERSION = '2.1.0';
const VERSION_CHECK_URL = 'https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main/version.json';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/Ketchio-dev/ivLyrics-AI-CLI-Provider/main';

let updateCache = { data: null, ts: 0 };
const UPDATE_CACHE_TTL_MS = 3600000; // 1 hour

function isNewerVersion(remote, local) {
    const r = (remote || '0.0.0').split('.').map(Number);
    const l = (local || '0.0.0').split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((r[i] || 0) > (l[i] || 0)) return true;
        if ((r[i] || 0) < (l[i] || 0)) return false;
    }
    return false;
}

function extractLocalAddonVersion(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        const content = fs.readFileSync(filePath, 'utf8');
        const match = content.match(/version:\s*['"]([^'"]+)['"]/);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

function getSpicetifyAddonDir() {
    const isWin = process.platform === 'win32';
    if (isWin) {
        return path.join(process.env.APPDATA || '', 'spicetify', 'CustomApps', 'ivLyrics');
    }
    return path.join(os.homedir(), '.config', 'spicetify', 'CustomApps', 'ivLyrics');
}

async function checkForUpdates(force = false) {
    const now = Date.now();
    if (!force && updateCache.data && (now - updateCache.ts) < UPDATE_CACHE_TTL_MS) {
        return updateCache.data;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(VERSION_CHECK_URL, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const remoteManifest = await response.json();
        const result = { proxy: null, addons: {} };

        // Check proxy version
        const remoteProxyVersion = remoteManifest?.proxy?.version;
        if (remoteProxyVersion && isNewerVersion(remoteProxyVersion, LOCAL_VERSION)) {
            result.proxy = {
                current: LOCAL_VERSION,
                latest: remoteProxyVersion,
                updateAvailable: true
            };
        }

        // Check addon versions
        const addonDir = getSpicetifyAddonDir();
        const addons = remoteManifest?.addons || {};
        for (const [filename, info] of Object.entries(addons)) {
            const localPath = path.join(addonDir, filename);
            const localVersion = extractLocalAddonVersion(localPath);
            const remoteVersion = info?.version;
            if (remoteVersion && localVersion && isNewerVersion(remoteVersion, localVersion)) {
                result.addons[filename] = {
                    current: localVersion,
                    latest: remoteVersion,
                    id: info.id || null,
                    updateAvailable: true
                };
            }
        }

        result.hasUpdates = !!(result.proxy || Object.keys(result.addons).length > 0);
        result.checkedAt = new Date().toISOString();

        updateCache = { data: result, ts: now };
        return result;
    } catch (e) {
        console.warn('[update] Failed to check for updates:', e.message);
        return { hasUpdates: false, error: e.message, checkedAt: new Date().toISOString() };
    }
}

// CORS 전면 허용 (서버는 127.0.0.1에만 바인딩하여 외부 접근 차단)
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ============================================
// Gemini SDK (Code Assist API)
// ============================================

// Gemini CLI OAuth 클라이언트 정보 (.env 또는 환경변수에서 읽음)
const GEMINI_OAUTH_CLIENT_ID = process.env.GEMINI_OAUTH_CLIENT_ID;
const GEMINI_OAUTH_CLIENT_SECRET = process.env.GEMINI_OAUTH_CLIENT_SECRET;
const CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com/v1internal';
const GEMINI_REASONING_OFF_CONFIG = Object.freeze({ thinkingConfig: { thinkingBudget: 0 } });
const CLAUDE_REASONING_OFF_SYSTEM_PROMPT =
    'Reasoning mode is disabled. Do not use extended thinking. ' +
    'Return concise final answers without chain-of-thought or step-by-step deliberation.';
const CLAUDE_SAFE_DEFAULT_MODEL = 'claude-sonnet-4-5';

let geminiAuth = null;       // OAuth2Client 캐시
let geminiProjectId = null;  // Code Assist 프로젝트 ID 캐시

function buildGeminiGenerateRequest(prompt, disableReasoning) {
    const request = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
    };
    if (disableReasoning) {
        request.generationConfig = GEMINI_REASONING_OFF_CONFIG;
    }
    return request;
}

function isGeminiThinkingConfigError(status, errorBody) {
    if (status !== 400 && status !== 422) return false;
    const text = String(errorBody || '').toLowerCase();
    return (
        text.includes('thinkingconfig') ||
        text.includes('thinking_budget') ||
        text.includes('thinkingbudget') ||
        text.includes('unknown field') && text.includes('thinking')
    );
}

function isBlockedClaudeModel(modelId) {
    const value = normalizeModelId(modelId).toLowerCase();
    return value.includes('haiku');
}

function resolveClaudeModel(modelId, fallbackModel = CLAUDE_SAFE_DEFAULT_MODEL) {
    const normalized = normalizeModelId(modelId);
    if (!normalized || isBlockedClaudeModel(normalized)) {
        return normalizeModelId(fallbackModel);
    }
    return normalized;
}

/**
 * Gemini OAuth 클라이언트 초기화 (토큰 자동 갱신)
 */
function initGeminiAuth() {
    const credsPath = path.join(os.homedir(), '.gemini', 'oauth_creds.json');
    if (!fs.existsSync(credsPath)) {
        throw new Error('Gemini OAuth credentials not found. Run `gemini` CLI first to authenticate.');
    }

    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    const { OAuth2Client } = require('google-auth-library');

    const oauth2Client = new OAuth2Client(
        GEMINI_OAUTH_CLIENT_ID,
        GEMINI_OAUTH_CLIENT_SECRET,
    );
    oauth2Client.setCredentials({
        access_token: creds.access_token,
        refresh_token: creds.refresh_token,
        token_type: creds.token_type || 'Bearer',
        expiry_date: creds.expiry_date,
    });

    // 토큰 갱신 시 파일에도 저장
    oauth2Client.on('tokens', (tokens) => {
        console.log('[gemini] Token refreshed automatically');
        const updated = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
        if (tokens.access_token) updated.access_token = tokens.access_token;
        if (tokens.refresh_token) updated.refresh_token = tokens.refresh_token;
        if (tokens.expiry_date) updated.expiry_date = tokens.expiry_date;
        fs.writeFileSync(credsPath, JSON.stringify(updated, null, 2));
    });

    return oauth2Client;
}

/**
 * Code Assist 프로젝트 ID 가져오기 (최초 1회, 이후 캐시)
 */
async function getGeminiProjectId(token) {
    if (geminiProjectId) return geminiProjectId;

    const response = await fetch(`${CODE_ASSIST_ENDPOINT}:loadCodeAssist`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            metadata: {
                ideType: 'IDE_UNSPECIFIED',
                platform: 'PLATFORM_UNSPECIFIED',
                pluginType: 'GEMINI',
            },
        }),
    });

    if (!response.ok) {
        throw new Error(`Code Assist loadCodeAssist failed: ${response.status}`);
    }

    const data = await response.json();
    geminiProjectId = data.cloudaicompanionProject;
    if (!geminiProjectId) {
        throw new Error('No project ID from Code Assist. Run `gemini` CLI to complete setup.');
    }
    console.log(`[gemini] Code Assist project: ${geminiProjectId}`);
    return geminiProjectId;
}

/**
 * Gemini 요청 직렬화 큐 (동시 요청 → rate limit 방지)
 */
const geminiQueue = [];
let geminiQueueRunning = false;

function enqueueGeminiRequest(fn) {
    return new Promise((resolve, reject) => {
        geminiQueue.push({ fn, resolve, reject });
        processGeminiQueue();
    });
}

async function processGeminiQueue() {
    if (geminiQueueRunning || geminiQueue.length === 0) return;
    geminiQueueRunning = true;

    while (geminiQueue.length > 0) {
        const { fn, resolve, reject } = geminiQueue.shift();
        try {
            const result = await fn();
            resolve(result);
        } catch (e) {
            reject(e);
        }
    }

    geminiQueueRunning = false;
}

/**
 * Gemini Code Assist API로 직접 호출 (rate limit 재시도 포함)
 */
async function geminiGenerateContent(prompt, model) {
    return enqueueGeminiRequest(() => geminiGenerateContentInner(prompt, model));
}

async function geminiGenerateContentInner(prompt, model) {
    if (!geminiAuth) {
        geminiAuth = initGeminiAuth();
    }

    const { token } = await geminiAuth.getAccessToken();
    const projectId = await getGeminiProjectId(token);
    const endpoint = `${CODE_ASSIST_ENDPOINT}:generateContent`;

    const MAX_RETRIES = 3;
    let lastError = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        let response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                project: projectId,
                request: buildGeminiGenerateRequest(prompt, true),
            }),
        });

        // Rate limit → wait and retry
        if (response.status === 429) {
            const retryAfter = parseInt(response.headers.get('retry-after') || '0', 10);
            const waitMs = Math.max(retryAfter * 1000, 2000 * (attempt + 1));
            console.warn(`[gemini] Rate limited (429), waiting ${waitMs}ms before retry ${attempt + 1}/${MAX_RETRIES}`);
            await new Promise(r => setTimeout(r, waitMs));
            continue;
        }

        if (!response.ok) {
            const errorBody = await response.text();
            if (isGeminiThinkingConfigError(response.status, errorBody)) {
                console.warn('[gemini] thinking disable config not supported for this request, retrying without it');
                response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model,
                        project: projectId,
                        request: buildGeminiGenerateRequest(prompt, false),
                    }),
                });

                if (response.status === 429) {
                    const waitMs = 2000 * (attempt + 1);
                    console.warn(`[gemini] Rate limited (429) on fallback, waiting ${waitMs}ms`);
                    await new Promise(r => setTimeout(r, waitMs));
                    continue;
                }

                if (!response.ok) {
                    const retryErrorBody = await response.text();
                    lastError = new Error(`Gemini API error ${response.status}: ${retryErrorBody}`);
                    continue;
                }
            } else {
                lastError = new Error(`Gemini API error ${response.status}: ${errorBody}`);
                continue;
            }
        }

        const data = await response.json();
        const text = data.response?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
            throw new Error('No text in Gemini response');
        }
        return text;
    }

    throw lastError || new Error('Gemini API: max retries exceeded');
}

// ============================================
// CLI Tool Configurations
// ============================================

const CLI_TOOLS = {
    // Anthropic Claude Code - CLI spawn (API 키 없이 SDK 전환 불가)
    claude: {
        mode: 'cli',
        command: 'claude',
        checkCommand: 'claude --version',
        defaultModel: CLAUDE_SAFE_DEFAULT_MODEL,
        buildArgs: (prompt, model, defaultModel) => {
            const requestedModel = normalizeModelId(model || defaultModel);
            const useModel = resolveClaudeModel(requestedModel, defaultModel);
            if (requestedModel && requestedModel !== useModel) {
                console.warn(`[claude] blocked model "${requestedModel}" requested; using "${useModel}" instead`);
            }
            const args = [
                '--print',
                '--dangerously-skip-permissions',
                '--append-system-prompt',
                CLAUDE_REASONING_OFF_SYSTEM_PROMPT,
                prompt
            ];
            if (useModel) args.unshift('--model', useModel);
            return args;
        },
        parseOutput: (stdout) => stdout.trim()
    },

    // Gemini - Code Assist API 직접 호출 (OAuth 토큰 재사용)
    gemini: {
        mode: 'sdk',
        command: 'gemini',
        checkCommand: null,
        defaultModel: 'gemini-2.5-flash',
        generate: async (prompt, model) => {
            return await geminiGenerateContent(prompt, model || 'gemini-2.5-flash');
        },
        checkAvailable: async () => {
            try {
                const credsPath = path.join(os.homedir(), '.gemini', 'oauth_creds.json');
                if (!fs.existsSync(credsPath)) {
                    return { available: false, error: 'Gemini OAuth credentials not found' };
                }
                if (!geminiAuth) {
                    geminiAuth = initGeminiAuth();
                }
                return { available: true };
            } catch (e) {
                return { available: false, error: e.message };
            }
        }
    },

    // OpenAI Codex - CLI spawn (OAuth 토큰 교환 절차가 독점적)
    codex: {
        mode: 'cli',
        command: 'codex',
        checkCommand: 'codex --version',
        defaultModel: '',
        buildArgs: (prompt, model, defaultModel) => {
            const useModel = model || defaultModel;
            const configArgs = [];
            if (useModel) {
                configArgs.push('--config', `model="${useModel}"`);
            }

            const forcedReasoningEffort = resolveCodexForcedReasoningEffort(useModel);
            if (forcedReasoningEffort) {
                configArgs.push('--config', `model_reasoning_effort="${forcedReasoningEffort}"`);
                console.log(
                    `[codex] forcing model_reasoning_effort="${forcedReasoningEffort}"` +
                    (useModel ? ` for ${useModel}` : '')
                );
            }

            return [...configArgs, 'exec', '--skip-git-repo-check', prompt];
        },
        parseOutput: (stdout) => stdout.trim()
    }
};

// ============================================
// Helper Functions
// ============================================

/**
 * 도구 사용 가능 여부 확인
 */
async function checkToolAvailable(toolId) {
    const tool = CLI_TOOLS[toolId];
    if (!tool) return { available: false, error: 'Unknown tool' };

    if (tool.mode === 'sdk' && tool.checkAvailable) {
        return await tool.checkAvailable();
    }

    try {
        execSync(tool.checkCommand, { stdio: 'pipe', timeout: 5000 });
        return { available: true };
    } catch (e) {
        return { available: false, error: `${tool.command} not found or not configured` };
    }
}

/**
 * 모델 ID 정규화
 */
function normalizeModelId(value) {
    if (typeof value !== 'string') return '';
    return value.trim();
}

function addModelToMap(map, id, source, name) {
    const normalizedId = normalizeModelId(id);
    if (!normalizedId) return;
    if (!map.has(normalizedId)) {
        map.set(normalizedId, {
            id: normalizedId,
            name: name || normalizedId,
            source
        });
    }
}

function readJsonFileSafe(filePath, fallback = null) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return fallback;
    }
}

function readCodexConfiguredModel() {
    try {
        const configPath = path.join(os.homedir(), '.codex', 'config.toml');
        if (!fs.existsSync(configPath)) return '';
        const config = fs.readFileSync(configPath, 'utf8');
        const match = config.match(/^model\s*=\s*"([^"]+)"/m);
        return normalizeModelId(match?.[1] || '');
    } catch {
        return '';
    }
}

function getCodexCachedModelMetadata(modelId) {
    const normalizedId = normalizeModelId(modelId);
    if (!normalizedId) return null;

    const cachePath = path.join(os.homedir(), '.codex', 'models_cache.json');
    const cache = readJsonFileSafe(cachePath, {});
    const cacheModels = Array.isArray(cache?.models) ? cache.models : [];

    return cacheModels.find(model => {
        const id = normalizeModelId(model?.slug || model?.id || model?.model);
        return id === normalizedId;
    }) || null;
}

function pickLowestReasoningEffort(supportedEfforts) {
    const normalizedSupported = Array.from(
        new Set(
            (Array.isArray(supportedEfforts) ? supportedEfforts : [])
                .map(effort => normalizeModelId(effort))
                .filter(Boolean)
        )
    );

    if (normalizedSupported.length === 0) {
        return '';
    }
    const supportedSet = new Set(normalizedSupported);
    const order = ['low', 'medium', 'high', 'xhigh'];

    for (const effort of order) {
        if (supportedSet.has(effort)) {
            return effort;
        }
    }

    return normalizedSupported[0];
}

function resolveCodexForcedReasoningEffort(modelId) {
    const selectedModel = normalizeModelId(modelId || readCodexConfiguredModel());
    if (!selectedModel) {
        return 'medium';
    }

    const modelMetadata = getCodexCachedModelMetadata(selectedModel);
    const supportedEfforts = (modelMetadata?.supported_reasoning_levels || [])
        .map(level => normalizeModelId(level?.effort))
        .filter(Boolean);

    // "off" is not supported by Codex CLI models; use the lowest supported effort.
    return pickLowestReasoningEffort(supportedEfforts) || 'medium';
}

function walkDirSafe(rootDir, result = [], maxFiles = 400) {
    if (!rootDir || result.length >= maxFiles) return result;
    let entries = [];
    try {
        entries = fs.readdirSync(rootDir, { withFileTypes: true });
    } catch {
        return result;
    }

    for (const entry of entries) {
        if (result.length >= maxFiles) break;
        const entryPath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
            walkDirSafe(entryPath, result, maxFiles);
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
            result.push(entryPath);
        }
    }
    return result;
}

function sortModels(models) {
    return models.sort((a, b) => a.id.localeCompare(b.id));
}

function discoverCodexModels() {
    const map = new Map();
    const cachePath = path.join(os.homedir(), '.codex', 'models_cache.json');
    const cache = readJsonFileSafe(cachePath, {});
    const cacheModels = Array.isArray(cache?.models) ? cache.models : [];

    for (const model of cacheModels) {
        if (model?.visibility && model.visibility !== 'list') continue;
        addModelToMap(
            map,
            model?.slug || model?.id || model?.model,
            'codex-cache',
            model?.display_name || model?.slug || model?.id
        );
    }

    const configuredModel = readCodexConfiguredModel();
    addModelToMap(map, configuredModel, 'codex-config');

    return {
        defaultModel: configuredModel || CLI_TOOLS.codex.defaultModel || '',
        models: sortModels(Array.from(map.values())),
        source: cacheModels.length > 0 ? 'codex-cache' : (configuredModel ? 'codex-config' : 'fallback')
    };
}

function discoverClaudeModels() {
    const map = new Map();
    const statsPath = path.join(os.homedir(), '.claude', 'stats-cache.json');
    const stats = readJsonFileSafe(statsPath, {});

    const modelUsage = stats?.modelUsage || {};
    for (const modelId of Object.keys(modelUsage)) {
        if (modelId.startsWith('claude-') && !isBlockedClaudeModel(modelId)) {
            addModelToMap(map, modelId, 'claude-stats');
        }
    }

    const monthlyUsage = stats?.monthlyUsage || {};
    for (const monthValue of Object.values(monthlyUsage)) {
        if (!monthValue || typeof monthValue !== 'object') continue;
        for (const candidate of Object.keys(monthValue)) {
            if (candidate.startsWith('claude-') && !isBlockedClaudeModel(candidate)) {
                addModelToMap(map, candidate, 'claude-stats');
            }
        }
    }

    // CLI aliases shown in Claude help
    addModelToMap(map, 'opus', 'claude-alias');
    addModelToMap(map, 'sonnet', 'claude-alias');
    addModelToMap(map, CLI_TOOLS.claude.defaultModel, 'proxy-default');

    return {
        defaultModel: CLI_TOOLS.claude.defaultModel || '',
        models: sortModels(Array.from(map.values())),
        source: map.size > 0 ? 'claude-stats' : 'fallback'
    };
}

function discoverGeminiModels() {
    const map = new Map();
    const geminiTmpDir = path.join(os.homedir(), '.gemini', 'tmp');
    const jsonFiles = walkDirSafe(geminiTmpDir, [], 600);

    for (const filePath of jsonFiles) {
        let text = '';
        try {
            text = fs.readFileSync(filePath, 'utf8');
        } catch {
            continue;
        }

        const modelRegex = /"model"\s*:\s*"([^"]+)"/g;
        let match;
        while ((match = modelRegex.exec(text)) !== null) {
            const modelId = normalizeModelId(match[1]);
            if (modelId.startsWith('gemini-')) {
                addModelToMap(map, modelId, 'gemini-history');
            }
        }
    }

    addModelToMap(map, CLI_TOOLS.gemini.defaultModel, 'proxy-default');

    return {
        defaultModel: CLI_TOOLS.gemini.defaultModel || '',
        models: sortModels(Array.from(map.values())),
        source: map.size > 1 ? 'gemini-history' : 'fallback'
    };
}

const MODEL_DISCOVERY_CACHE = new Map();
const MODEL_DISCOVERY_TTL_MS = 30000;

async function getModelsForTool(toolId, forceRefresh = false) {
    const cacheKey = toolId;
    const now = Date.now();
    const cached = MODEL_DISCOVERY_CACHE.get(cacheKey);
    if (!forceRefresh && cached && (now - cached.ts) < MODEL_DISCOVERY_TTL_MS) {
        return cached.value;
    }

    let discovered = { defaultModel: CLI_TOOLS[toolId]?.defaultModel || '', models: [], source: 'fallback' };
    if (toolId === 'codex') {
        discovered = discoverCodexModels();
    } else if (toolId === 'claude') {
        discovered = discoverClaudeModels();
    } else if (toolId === 'gemini') {
        discovered = discoverGeminiModels();
    }

    const status = await checkToolAvailable(toolId);
    const value = {
        tool: toolId,
        available: status.available,
        error: status.error || null,
        defaultModel: discovered.defaultModel || '',
        models: discovered.models,
        source: discovered.source,
        fetched_at: new Date().toISOString()
    };

    MODEL_DISCOVERY_CACHE.set(cacheKey, { ts: now, value });
    return value;
}

/**
 * 동시 CLI 프로세스 수 제한
 */
const MAX_CONCURRENT_CLI = 5;
let activeCLIProcesses = 0;

/**
 * CLI 도구 실행 (spawn 방식)
 */
function runCLI(toolId, prompt, model = '', timeout = 120000) {
    return new Promise((resolve, reject) => {
        const tool = CLI_TOOLS[toolId];
        if (!tool) {
            return reject(new Error(`Unknown tool: ${toolId}`));
        }

        if (activeCLIProcesses >= MAX_CONCURRENT_CLI) {
            return reject(new Error(`Too many concurrent requests (max ${MAX_CONCURRENT_CLI}). Please try again later.`));
        }
        activeCLIProcesses++;

        const args = tool.buildArgs(prompt, model, tool.defaultModel);
        const actualModel = model || tool.defaultModel || 'default';

        const promptPreview = prompt.length > 50 ? prompt.substring(0, 50) + '...' : prompt;
        const argsForLog = args.map(a => a === prompt ? `"${promptPreview}"` : a);
        console.log(`\n${'='.repeat(60)}`);
        console.log(`[${toolId}] CLI REQUEST`);
        console.log(`  Model: ${actualModel}`);
        console.log(`  Command: ${tool.command} ${argsForLog.join(' ')}`);
        console.log(`${'='.repeat(60)}`);

        const proc = spawn(tool.command, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd: os.tmpdir(),
            env: { ...process.env, NO_COLOR: '1' }
        });

        let stdout = '';
        let stderr = '';
        let settled = false;

        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                proc.kill('SIGKILL');
                reject(new Error(`Timeout after ${timeout}ms`));
            }
        }, timeout);

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            clearTimeout(timer);
            activeCLIProcesses--;
            if (settled) return;
            settled = true;
            if (code === 0) {
                const result = tool.parseOutput(stdout);
                console.log(`[${toolId}] SUCCESS - Response length: ${result.length} chars`);
                resolve(result);
            } else {
                console.log(`[${toolId}] FAILED - Exit code: ${code}`);
                reject(new Error(stderr || `Process exited with code ${code}`));
            }
        });

        proc.on('error', (err) => {
            clearTimeout(timer);
            activeCLIProcesses--;
            if (settled) return;
            settled = true;
            reject(new Error(`Failed to start ${tool.command}: ${err.message}`));
        });
    });
}

/**
 * SDK 도구 실행
 */
async function runSDK(toolId, prompt, model = '', timeout = 120000) {
    const tool = CLI_TOOLS[toolId];
    if (!tool) {
        throw new Error(`Unknown tool: ${toolId}`);
    }

    const actualModel = model || tool.defaultModel || 'default';
    const promptPreview = prompt.length > 50 ? prompt.substring(0, 50) + '...' : prompt;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[${toolId}] SDK REQUEST`);
    console.log(`  Model: ${actualModel}`);
    console.log(`  Prompt: "${promptPreview}"`);
    console.log(`${'='.repeat(60)}`);

    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
    );

    const result = await Promise.race([
        tool.generate(prompt, model || tool.defaultModel),
        timeoutPromise,
    ]);

    console.log(`[${toolId}] SUCCESS - Response length: ${result.length} chars`);
    return result;
}

/**
 * 통합 실행 함수 (mode에 따라 CLI 또는 SDK 선택)
 */
async function runTool(toolId, prompt, model = '', timeout = 120000) {
    const tool = CLI_TOOLS[toolId];
    if (!tool) {
        throw new Error(`Unknown tool: ${toolId}`);
    }

    if (tool.mode === 'sdk') {
        return await runSDK(toolId, prompt, model, timeout);
    } else {
        return await runCLI(toolId, prompt, model, timeout);
    }
}

// ============================================
// SSE Streaming Functions
// ============================================

/**
 * SSE 헤더 설정
 */
function setupSSE(res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
}

/**
 * SSE 청크 전송
 */
function sendSSEChunk(res, chunk) {
    if (!res.writableEnded && res.writable) {
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
    }
}

/**
 * SSE 에러 전송
 */
function sendSSEError(res, message) {
    if (!res.writableEnded && res.writable) {
        res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    }
}

/**
 * SSE 종료 신호 전송
 */
function sendSSEDone(res) {
    if (!res.writableEnded) {
        res.write('data: [DONE]\n\n');
        res.end();
    }
}

/**
 * CLI 도구 SSE 스트리밍 실행
 */
function runCLIStream(toolId, prompt, model, timeout, res) {
    const tool = CLI_TOOLS[toolId];
    if (!tool) {
        sendSSEError(res, `Unknown tool: ${toolId}`);
        sendSSEDone(res);
        return;
    }

    if (activeCLIProcesses >= MAX_CONCURRENT_CLI) {
        sendSSEError(res, `Too many concurrent requests (max ${MAX_CONCURRENT_CLI}). Please try again later.`);
        sendSSEDone(res);
        return;
    }
    activeCLIProcesses++;

    const args = tool.buildArgs(prompt, model, tool.defaultModel);
    const actualModel = model || tool.defaultModel || 'default';

    const promptPreview = prompt.length > 50 ? prompt.substring(0, 50) + '...' : prompt;
    const argsForLog = args.map(a => a === prompt ? `"${promptPreview}"` : a);
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[${toolId}] CLI STREAM REQUEST`);
    console.log(`  Model: ${actualModel}`);
    console.log(`  Command: ${tool.command} ${argsForLog.join(' ')}`);
    console.log(`${'='.repeat(60)}`);

    const proc = spawn(tool.command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: os.tmpdir(),
        env: { ...process.env, NO_COLOR: '1' }
    });

    let stderr = '';
    let settled = false;
    let totalLength = 0;

    const timer = setTimeout(() => {
        if (!settled) {
            settled = true;
            proc.kill('SIGKILL');
            sendSSEError(res, `Timeout after ${timeout}ms`);
            sendSSEDone(res);
        }
    }, timeout);

    // Client disconnect → kill process
    res.on('close', () => {
        if (!settled) {
            settled = true;
            clearTimeout(timer);
            proc.kill('SIGKILL');
            // activeCLIProcesses는 proc.on('close')에서 감소됨
        }
    });

    proc.stdout.on('data', (data) => {
        if (settled) return;
        const text = data.toString();
        totalLength += text.length;
        sendSSEChunk(res, text);
    });

    proc.stderr.on('data', (data) => {
        stderr += data.toString();
    });

    proc.on('close', (code) => {
        clearTimeout(timer);
        activeCLIProcesses--;
        if (settled) return;
        settled = true;
        if (code !== 0) {
            console.log(`[${toolId}] STREAM FAILED - Exit code: ${code}`);
            sendSSEError(res, stderr || `Process exited with code ${code}`);
        } else {
            console.log(`[${toolId}] STREAM SUCCESS - Total: ${totalLength} chars`);
        }
        sendSSEDone(res);
    });

    proc.on('error', (err) => {
        clearTimeout(timer);
        activeCLIProcesses--;
        if (settled) return;
        settled = true;
        sendSSEError(res, `Failed to start ${tool.command}: ${err.message}`);
        sendSSEDone(res);
    });
}

/**
 * SDK 도구 SSE 스트리밍 (SDK는 스트리밍 미지원 → 단일 chunk)
 */
async function runSDKStream(toolId, prompt, model, timeout, res) {
    try {
        const result = await runSDK(toolId, prompt, model, timeout);
        sendSSEChunk(res, result);
        sendSSEDone(res);
    } catch (e) {
        sendSSEError(res, e.message);
        sendSSEDone(res);
    }
}

/**
 * 통합 스트리밍 디스패처
 */
function runToolStream(toolId, prompt, model, timeout, res) {
    const tool = CLI_TOOLS[toolId];
    if (!tool) {
        sendSSEError(res, `Unknown tool: ${toolId}`);
        sendSSEDone(res);
        return;
    }

    if (tool.mode === 'sdk') {
        runSDKStream(toolId, prompt, model, timeout, res);
    } else {
        runCLIStream(toolId, prompt, model, timeout, res);
    }
}

// ============================================
// API Endpoints
// ============================================

/**
 * 헬스 체크 & 사용 가능한 도구 목록
 */
app.get('/health', async (req, res) => {
    const toolIds = Object.keys(CLI_TOOLS);
    const results = await Promise.allSettled(
        toolIds.map(toolId => checkToolAvailable(toolId))
    );

    const tools = {};
    toolIds.forEach((toolId, i) => {
        const status = results[i].status === 'fulfilled'
            ? results[i].value
            : { available: false, error: results[i].reason?.message || 'Check failed' };
        tools[toolId] = { ...status, mode: CLI_TOOLS[toolId].mode };
    });

    const updateInfo = updateCache.data || {};
    res.json({
        status: 'ok',
        version: LOCAL_VERSION,
        tools,
        updateAvailable: updateInfo.hasUpdates || false,
        latestVersion: updateInfo.proxy?.latest || LOCAL_VERSION
    });
});

/**
 * 사용 가능한 도구 목록
 */
app.get('/tools', async (req, res) => {
    const tools = [];
    for (const toolId of Object.keys(CLI_TOOLS)) {
        const status = await checkToolAvailable(toolId);
        tools.push({
            id: toolId,
            name: CLI_TOOLS[toolId].command,
            mode: CLI_TOOLS[toolId].mode,
            defaultModel: CLI_TOOLS[toolId].defaultModel,
            available: status.available,
            error: status.error
        });
    }
    res.json({ tools });
});

/**
 * 도구별 모델 목록 조회 (실시간/로컬 캐시 기반)
 * - /models?tool=codex
 * - /models?tool=claude
 * - /models?tool=gemini
 * - /models (all)
 */
app.get('/models', async (req, res) => {
    const toolQuery = (req.query.tool || '').toString().trim();
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';

    try {
        if (toolQuery) {
            if (!CLI_TOOLS[toolQuery]) {
                return res.status(400).json({ error: `Unknown tool: ${toolQuery}` });
            }
            const payload = await getModelsForTool(toolQuery, forceRefresh);
            return res.json(payload);
        }

        const all = {};
        for (const toolId of Object.keys(CLI_TOOLS)) {
            all[toolId] = await getModelsForTool(toolId, forceRefresh);
        }

        return res.json({
            tools: all,
            fetched_at: new Date().toISOString()
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

/**
 * 특정 도구로 프롬프트 실행
 */
app.post('/generate', async (req, res) => {
    const { tool, model, prompt, timeout, stream } = req.body;
    const streamEnabled = stream === true || stream === 'true' || req.query.stream === 'true';

    if (!tool || !prompt) {
        return res.status(400).json({ error: 'Missing tool or prompt' });
    }

    const toolStatus = await checkToolAvailable(tool);
    if (!toolStatus.available) {
        return res.status(400).json({ error: toolStatus.error });
    }

    const effectiveTimeout = timeout || 120000;

    if (streamEnabled) {
        console.log(`[API] Stream request - tool: ${tool}, mode: ${CLI_TOOLS[tool]?.mode}, model: ${model || 'default'}, prompt length: ${prompt.length}`);
        setupSSE(res);
        runToolStream(tool, prompt, model || '', effectiveTimeout, res);
        return;
    }

    try {
        console.log(`[API] Generate request - tool: ${tool}, mode: ${CLI_TOOLS[tool]?.mode}, model: ${model || 'default'}, prompt length: ${prompt.length}`);
        const startTime = Date.now();
        const result = await runTool(tool, prompt, model || '', effectiveTimeout);
        const elapsed = Date.now() - startTime;
        console.log(`[API] Completed in ${elapsed}ms`);
        res.json({
            success: true,
            result,
            tool,
            mode: CLI_TOOLS[tool]?.mode,
            model: model || CLI_TOOLS[tool]?.defaultModel || 'default',
            elapsed_ms: elapsed
        });
    } catch (e) {
        console.error(`[API] Error:`, e.message);
        res.status(500).json({ error: e.message });
    }
});

/**
 * 업데이트 확인
 */
app.get('/updates', async (req, res) => {
    const force = req.query.force === '1' || req.query.force === 'true';
    try {
        const result = await checkForUpdates(force);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * 파일 업데이트 실행
 */
app.post('/update', async (req, res) => {
    const { target } = req.body;
    if (!target) {
        return res.status(400).json({ error: 'Missing target (addons, proxy, all, or filename)' });
    }

    // 허용된 target만 수락 (path traversal 방지)
    const ALLOWED_TARGETS = new Set([
        'addons', 'proxy', 'all',
        'Addon_AI_CLI_ClaudeCode.js',
        'Addon_AI_CLI_CodexCLI.js',
        'Addon_AI_CLI_GeminiCLI.js'
    ]);
    if (!ALLOWED_TARGETS.has(target)) {
        return res.status(400).json({ error: `Invalid target: ${target}` });
    }

    try {
        const results = [];

        const downloadFile = async (remotePath, localPath, label) => {
            // Path traversal 방지: 파일명에 경로 구분자나 .. 포함 시 차단
            const basename = path.basename(localPath);
            const resolvedDir = path.resolve(path.dirname(localPath));
            const resolvedFull = path.resolve(localPath);
            if (resolvedFull !== path.join(resolvedDir, basename)) {
                throw new Error(`Invalid path detected: ${label}`);
            }

            const url = `${GITHUB_RAW_BASE}/${encodeURI(remotePath)}`;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) {
                throw new Error(`Failed to download ${label}: HTTP ${response.status}`);
            }
            const content = await response.text();
            const dir = path.dirname(localPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(localPath, content, 'utf8');
            return { file: label, status: 'updated' };
        };

        const addonDir = getSpicetifyAddonDir();
        const addonFiles = [
            'Addon_AI_CLI_ClaudeCode.js',
            'Addon_AI_CLI_CodexCLI.js',
            'Addon_AI_CLI_GeminiCLI.js'
        ];

        if (target === 'addons' || target === 'all') {
            for (const filename of addonFiles) {
                const localPath = path.join(addonDir, filename);
                if (fs.existsSync(localPath)) {
                    const result = await downloadFile(filename, localPath, filename);
                    results.push(result);
                }
            }
        }

        let needsRestart = false;

        if (target === 'proxy' || target === 'all') {
            const serverLocalPath = path.join(__dirname, 'server.js');
            const pkgLocalPath = path.join(__dirname, 'package.json');
            const result = await downloadFile('cli-proxy/server.js', serverLocalPath, 'server.js');
            results.push(result);
            try {
                const pkgResult = await downloadFile('cli-proxy/package.json', pkgLocalPath, 'package.json');
                results.push(pkgResult);
            } catch {}
            needsRestart = true;
            results.push({ file: 'proxy', status: 'updated', note: 'Server will restart automatically' });
        }

        // Single file target
        if (addonFiles.includes(target)) {
            const localPath = path.join(addonDir, target);
            const result = await downloadFile(target, localPath, target);
            results.push(result);
        }

        if (results.length === 0) {
            return res.status(400).json({ error: `Unknown target: ${target}` });
        }

        // Invalidate cache
        updateCache = { data: null, ts: 0 };

        res.json({ success: true, results });

        // Auto-restart after proxy update
        if (needsRestart) {
            console.log('[update] Proxy updated. Restarting server in 1 second...');
            setTimeout(() => {
                const { execSync } = require('child_process');
                const serverPath = path.join(__dirname, 'server.js');
                const child = spawn(process.execPath, [serverPath], {
                    stdio: 'ignore',
                    detached: true,
                    env: { ...process.env },
                    cwd: __dirname,
                });
                child.unref();
                process.exit(0);
            }, 1000);
        }
    } catch (e) {
        console.error('[update] Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

/**
 * OpenAI API 호환 엔드포인트
 */
app.post('/v1/chat/completions', async (req, res) => {
    const { model, messages } = req.body;

    const tool = model?.split('/')[0] || 'claude';
    const lastUserMessage = messages?.filter(m => m.role === 'user').pop();
    const prompt = lastUserMessage?.content || '';

    if (!prompt) {
        return res.status(400).json({ error: 'No prompt provided' });
    }

    try {
        const result = await runTool(tool, prompt);

        res.json({
            id: `cli-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: tool,
            choices: [{
                index: 0,
                message: {
                    role: 'assistant',
                    content: result
                },
                finish_reason: 'stop'
            }],
            usage: {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0
            }
        });
    } catch (e) {
        res.status(500).json({ error: { message: e.message } });
    }
});

// ============================================
// Start Server
// ============================================

app.listen(PORT, '127.0.0.1', () => {
    console.log(`\n🚀 ivLyrics CLI Proxy Server v${LOCAL_VERSION}`);
    console.log(`   Running on http://127.0.0.1:${PORT} (localhost only)`);
    console.log(`\n📋 Available endpoints:`);
    console.log(`   GET  /health   - Check server status and available tools`);
    console.log(`   GET  /tools    - List available CLI tools`);
    console.log(`   GET  /models   - List available models per tool`);
    console.log(`   POST /generate - Generate text (supports ?stream=true for SSE)`);
    console.log(`   GET  /updates  - Check for available updates`);
    console.log(`   POST /update   - Download and apply updates`);
    console.log(`   POST /v1/chat/completions - OpenAI-compatible endpoint`);
    console.log(`\n🔧 Checking available tools...`);

    Promise.allSettled(
        Object.keys(CLI_TOOLS).map(async (toolId) => {
            const tool = CLI_TOOLS[toolId];
            const status = await checkToolAvailable(toolId);
            const icon = status.available ? '✓' : '✗';
            const modeTag = tool.mode === 'sdk' ? '[SDK]' : '[CLI]';
            console.log(`   ${icon} ${toolId} ${modeTag}: ${status.available ? 'available' : status.error} (default: ${tool.defaultModel || 'auto'})`);
        })
    ).then(() => {
        console.log('');
    });

    // Async update check on startup
    checkForUpdates().then((result) => {
        if (result.hasUpdates) {
            console.log('📦 Updates available:');
            if (result.proxy) {
                console.log(`   Proxy: ${result.proxy.current} → ${result.proxy.latest}`);
            }
            for (const [filename, info] of Object.entries(result.addons || {})) {
                console.log(`   ${filename}: ${info.current} → ${info.latest}`);
            }
            console.log('   Run GET /updates for details\n');
        }
    }).catch(() => {});
});
