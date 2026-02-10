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

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (curl, server-to-server, etc.)
        if (!origin) return callback(null, true);
        // Allow only localhost/127.0.0.1 origins (any port)
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
            return callback(null, true);
        }
        callback(new Error('CORS not allowed from this origin'));
    }
}));
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
 * Gemini Code Assist API로 직접 호출
 */
async function geminiGenerateContent(prompt, model) {
    if (!geminiAuth) {
        geminiAuth = initGeminiAuth();
    }

    const { token } = await geminiAuth.getAccessToken();
    const projectId = await getGeminiProjectId(token);
    const endpoint = `${CODE_ASSIST_ENDPOINT}:generateContent`;
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
        }
        if (!response.ok) {
            const retryErrorBody = await response.text();
            throw new Error(`Gemini API error ${response.status}: ${retryErrorBody}`);
        }
    }

    const data = await response.json();
    const text = data.response?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
        throw new Error('No text in Gemini response');
    }
    return text;
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
 * CLI 도구 실행 (spawn 방식)
 */
function runCLI(toolId, prompt, model = '', timeout = 120000) {
    return new Promise((resolve, reject) => {
        const tool = CLI_TOOLS[toolId];
        if (!tool) {
            return reject(new Error(`Unknown tool: ${toolId}`));
        }

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

    res.json({
        status: 'ok',
        version: '2.0.0',
        tools
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
    const { tool, model, prompt, timeout } = req.body;

    if (!tool || !prompt) {
        return res.status(400).json({ error: 'Missing tool or prompt' });
    }

    const toolStatus = await checkToolAvailable(tool);
    if (!toolStatus.available) {
        return res.status(400).json({ error: toolStatus.error });
    }

    try {
        console.log(`[API] Generate request - tool: ${tool}, mode: ${CLI_TOOLS[tool]?.mode}, model: ${model || 'default'}, prompt length: ${prompt.length}`);
        const startTime = Date.now();
        const result = await runTool(tool, prompt, model || '', timeout || 120000);
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

app.listen(PORT, () => {
    console.log(`\n🚀 ivLyrics CLI Proxy Server v2.0.0`);
    console.log(`   Running on http://localhost:${PORT}`);
    console.log(`\n📋 Available endpoints:`);
    console.log(`   GET  /health   - Check server status and available tools`);
    console.log(`   GET  /tools    - List available CLI tools`);
    console.log(`   GET  /models   - List available models per tool`);
    console.log(`   POST /generate - Generate text with a CLI tool`);
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
        console.log(`\n`);
    });
});
