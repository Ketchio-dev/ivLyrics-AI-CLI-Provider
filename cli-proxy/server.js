/**
 * ivLyrics CLI Proxy Server
 * CLI AI 도구들 (Claude Code, Codex, Gemini 등)을 HTTP API로 제공
 *
 * Claude: CLI spawn 방식 유지 (API 키 없이 SDK 전환 불가)
 * Codex:  CLI spawn 방식 유지 (OAuth 토큰 교환 절차가 독점적)
 * Gemini: CLI spawn 방식 고정
 *
 * 사용법:
 *   npm install
 *   npm start
 *
 * 기본 포트: 19284
 */

const express = require('express');
const cors = require('cors');
const { spawn, spawnSync, execSync } = require('child_process');
const crypto = require('crypto');
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

const app = express();
const PORT = process.env.PORT || 19284;

// ============================================
// Constants
// ============================================

const DEFAULT_TIMEOUT_MS = 120000;        // Default CLI process timeout
const TOOL_CHECK_TIMEOUT_MS = 15000;      // Tool availability check timeout (async spawn)
const TOOL_CACHE_TTL_MS = 300000;         // Tool availability cache lifetime (5 minutes)
const RATE_LIMIT_WINDOW_MS = 60000;       // Rate limit window (1 minute)
const RATE_LIMIT_MAX_REQUESTS = 120;      // Max /generate requests per window
const UPDATE_CACHE_MAX_SIZE = 1048576;    // 1MB — skip cache if result is larger
const MAX_STREAM_BUFFER_SIZE = 5 * 1024 * 1024; // 5MB — safety cap for streaming JSON buffers
const RATE_LIMIT_MAX_CLIENTS = 1000;      // Max tracked client buckets for rate limiting
const ADMIN_ACTION_HEADER = 'x-ivlyrics-action';

// ============================================
// File Logger (rotation at 5MB, keeps 1 backup)
// ============================================

const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'server.log');
const LOG_PREV_FILE = path.join(LOG_DIR, 'server.1.log');
const LOG_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

function writeLog(level, args) {
    const timestamp = new Date().toISOString();
    const message = args.map(a => (a instanceof Error ? a.stack || a.message : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    const line = `[${timestamp}] [${level}] ${message}\n`;
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
        try {
            if (fs.statSync(LOG_FILE).size > LOG_MAX_SIZE_BYTES) {
                if (fs.existsSync(LOG_PREV_FILE)) fs.unlinkSync(LOG_PREV_FILE);
                fs.renameSync(LOG_FILE, LOG_PREV_FILE);
            }
        } catch { /* log file not yet created */ }
        fs.appendFileSync(LOG_FILE, line);
    } catch { /* logging failure must not crash the server */ }
}

const _consoleLog = console.log.bind(console);
const _consoleWarn = console.warn.bind(console);
const _consoleError = console.error.bind(console);
console.log = (...args) => { _consoleLog(...args); writeLog('INFO', args); };
console.warn = (...args) => { _consoleWarn(...args); writeLog('WARN', args); };
console.error = (...args) => { _consoleError(...args); writeLog('ERROR', args); };

// ============================================
// Version & Auto-Update
// ============================================

const LOCAL_VERSION = '3.1.4';
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

function getSpicetifyConfigDir() {
    if (process.platform !== 'win32') {
        return path.join(os.homedir(), '.config', 'spicetify');
    }

    const winLocalAppDataDir = process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'spicetify')
        : '';
    const winAppDataDir = process.env.APPDATA
        ? path.join(process.env.APPDATA, 'spicetify')
        : '';
    const winUserConfigDir = path.join(os.homedir(), '.config', 'spicetify');
    const winDotSpicetifyDir = path.join(os.homedir(), '.spicetify');
    const candidates = [winLocalAppDataDir, winAppDataDir, winUserConfigDir, winDotSpicetifyDir].filter(Boolean);

    for (const candidate of candidates) {
        const ivLyricsPath = path.join(candidate, 'CustomApps', 'ivLyrics');
        if (fs.existsSync(ivLyricsPath)) return candidate;
    }

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return winLocalAppDataDir || winAppDataDir || winUserConfigDir;
}

function getSpicetifyAddonDir() {
    return path.join(getSpicetifyConfigDir(), 'CustomApps', 'ivLyrics');
}

function hashSha256Hex(contentBuffer) {
    return crypto.createHash('sha256').update(contentBuffer).digest('hex');
}

function normalizeIntegrityHash(value) {
    const raw = normalizeModelId(value).toLowerCase();
    if (!raw) return '';
    const normalized = raw
        .replace(/^sha256[-:]/, '')
        .trim();
    if (!/^[a-f0-9]{64}$/.test(normalized)) return '';
    return normalized;
}

function hashesEqual(expectedHash, actualHash) {
    const expected = Buffer.from(expectedHash, 'hex');
    const actual = Buffer.from(actualHash, 'hex');
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
}

async function fetchVersionManifest(timeoutMs = 10000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(VERSION_CHECK_URL, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } finally {
        clearTimeout(timeoutId);
    }
}

async function fetchIntegrityMap() {
    const manifest = await fetchVersionManifest();
    const integrity = manifest?.integrity;
    if (!integrity || typeof integrity !== 'object' || Array.isArray(integrity)) {
        throw new Error('Integrity manifest missing from version.json');
    }
    return integrity;
}

async function checkForUpdates(force = false) {
    const now = Date.now();
    if (!force && updateCache.data && (now - updateCache.ts) < UPDATE_CACHE_TTL_MS) {
        return updateCache.data;
    }

    try {
        const remoteManifest = await fetchVersionManifest();
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

        const resultSize = JSON.stringify(result).length;
        if (resultSize < UPDATE_CACHE_MAX_SIZE) {
            updateCache = { data: result, ts: now };
        } else {
            console.warn(`[update] Result too large (${resultSize} bytes), skipping cache`);
        }
        return result;
    } catch (e) {
        console.warn('[update] Failed to check for updates:', e.message);
        return { hasUpdates: false, error: e.message, checkedAt: new Date().toISOString() };
    }
}

// 서버는 127.0.0.1에만 바인딩되므로 외부 접근이 물리적으로 불가능
// Spicetify 앱의 다양한 origin 형태를 모두 수용하기 위해 origin 제한 없음

function parseOrigin(originHeader) {
    try {
        return new URL(String(originHeader || '').trim());
    } catch {
        return null;
    }
}

function isTrustedOrigin(originHeader) {
    if (!originHeader || originHeader === 'null') return false;
    const parsed = parseOrigin(originHeader);
    if (!parsed) return false;
    if (parsed.protocol === 'spicetify:') return true;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

    const host = normalizeModelId(parsed.hostname).toLowerCase();
    if (!host) return false;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    if (host === 'open.spotify.com' || host === 'xpui.app.spotify.com') return true;
    if (host.endsWith('.spotify.com')) return true;
    return false;
}

function isTrustedAdminOrigin(originHeader) {
    if (!originHeader || originHeader === 'null') return false;
    const parsed = parseOrigin(originHeader);
    if (!parsed) return false;
    if (parsed.protocol === 'spicetify:') return true;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

    const host = normalizeModelId(parsed.hostname).toLowerCase();
    if (!host) return false;
    if (host === 'open.spotify.com' || host === 'xpui.app.spotify.com') return true;
    if (host.endsWith('.spotify.com')) return true;
    return false;
}

const corsOptions = {
    origin: (origin, callback) => {
        if (!origin || isTrustedOrigin(origin)) {
            return callback(null, true);
        }
        return callback(null, false);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', ADMIN_ACTION_HEADER],
};

function requireAdminRequestGuard(req, res, next) {
    const origin = normalizeModelId(req.headers.origin || '');
    const secFetchSite = normalizeModelId(req.headers['sec-fetch-site'] || '').toLowerCase();
    if (origin && !isTrustedAdminOrigin(origin)) {
        return res.status(403).json({ error: 'Untrusted origin for admin endpoint' });
    }
    if (!origin && secFetchSite === 'cross-site') {
        return res.status(403).json({ error: 'Cross-site browser requests are not allowed for admin endpoints' });
    }

    const contentType = normalizeModelId(req.headers['content-type'] || '').toLowerCase();
    if (!contentType.includes('application/json')) {
        return res.status(415).json({ error: 'Content-Type must be application/json' });
    }

    if (origin) {
        const expectedAction = req.path === '/cleanup' ? 'cleanup' : 'update';
        const receivedAction = resolveAdminActionToken(req.headers[ADMIN_ACTION_HEADER], req.body?.action);
        if (receivedAction && receivedAction !== expectedAction) {
            return res.status(400).json({ error: `Missing or invalid ${ADMIN_ACTION_HEADER} header` });
        }
    }

    return next();
}

function resolveAdminActionToken(headerValue, bodyActionValue) {
    const headerAction = normalizeModelId(headerValue || '').toLowerCase();
    if (headerAction) return headerAction;
    return normalizeModelId(bodyActionValue || '').toLowerCase();
}

// Chromium Private Network Access (PNA) 지원
// Spotify(Chromium)가 로컬 서버(127.0.0.1)에 접근할 때 PNA preflight 필요
app.use((req, res, next) => {
    if (req.headers['access-control-request-private-network']) {
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    next();
});
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// Rate limiter state for /generate endpoint
const rateLimitBuckets = new Map();
let isShuttingDown = false;

function getClientKey(req) {
    const remoteAddress = normalizeModelId(req.socket?.remoteAddress || req.ip || '');
    return remoteAddress || 'local';
}

function checkRateLimit(req) {
    const clientKey = getClientKey(req);
    const now = Date.now();
    let bucket = rateLimitBuckets.get(clientKey);

    if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
        bucket = { windowStart: now, count: 0 };
    }

    if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) {
        rateLimitBuckets.set(clientKey, bucket);
        return false;
    }

    bucket.count += 1;
    rateLimitBuckets.set(clientKey, bucket);

    if (rateLimitBuckets.size > RATE_LIMIT_MAX_CLIENTS) {
        for (const [key, value] of rateLimitBuckets) {
            if (now - value.windowStart > RATE_LIMIT_WINDOW_MS) {
                rateLimitBuckets.delete(key);
            }
        }
        if (rateLimitBuckets.size > RATE_LIMIT_MAX_CLIENTS) {
            const oldestKey = rateLimitBuckets.keys().next().value;
            if (oldestKey) rateLimitBuckets.delete(oldestKey);
        }
    }

    return true;
}

// ============================================
// Gemini model normalization
// ============================================

const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';
const GEMINI_MODEL_ALIAS_MAP = Object.freeze({
    '3.0-flash': 'gemini-3-flash-preview',
    '3-flash': 'gemini-3-flash-preview',
    '3-flash-preview': 'gemini-3-flash-preview',
    'gemini-3.0-flash': 'gemini-3-flash-preview',
    'gemini-3-flash': 'gemini-3-flash-preview',
    'gemini-3.0-flash-preview': 'gemini-3-flash-preview',
});
const CLAUDE_REASONING_OFF_SYSTEM_PROMPT =
    'Reasoning mode is disabled. Do not use extended thinking. ' +
    'Return concise final answers without chain-of-thought or step-by-step deliberation.';
const CLAUDE_SAFE_DEFAULT_MODEL = 'claude-sonnet-4-5';

function trimShellLine(value) {
    return normalizeModelId(String(value || '').replace(/^['"](.*)['"]$/, '$1'));
}

function readCommandLines(command) {
    try {
        const output = execSync(command, {
            stdio: ['ignore', 'pipe', 'ignore']
        }).toString();
        return output
            .split(/\r?\n/)
            .map(trimShellLine)
            .filter(Boolean);
    } catch {
        return [];
    }
}

let npmGlobalBinDirsCache = null;

function splitCommandTokens(commandLine) {
    const line = normalizeModelId(commandLine);
    if (!line) return [];
    const matches = line.match(/"[^"]*"|'[^']*'|[^\s]+/g) || [];
    return matches.map(trimShellLine).filter(Boolean);
}

function isRunnableFile(filePath) {
    if (!filePath) return false;
    try {
        if (!fs.existsSync(filePath)) return false;
        const stat = fs.statSync(filePath);
        if (!stat.isFile() && !stat.isSymbolicLink()) return false;
        if (process.platform !== 'win32') {
            fs.accessSync(filePath, fs.constants.X_OK);
        }
        return true;
    } catch {
        return false;
    }
}

function getNpmGlobalBinDirs() {
    if (npmGlobalBinDirsCache) {
        return npmGlobalBinDirsCache;
    }
    const dirs = [];
    const addDir = (value) => {
        const dir = trimShellLine(value);
        if (!dir || dirs.includes(dir) || !fs.existsSync(dir)) return;
        dirs.push(dir);
    };

    for (const line of readCommandLines('npm bin -g')) {
        addDir(line);
    }
    for (const prefix of readCommandLines('npm config get prefix')) {
        const cleanedPrefix = trimShellLine(prefix);
        if (!cleanedPrefix || cleanedPrefix === 'undefined' || cleanedPrefix === 'null') continue;
        if (process.platform === 'win32') {
            addDir(cleanedPrefix);
            addDir(path.join(cleanedPrefix, 'bin'));
        } else {
            addDir(path.join(cleanedPrefix, 'bin'));
        }
    }
    npmGlobalBinDirsCache = dirs;
    return dirs;
}

function getCommandNameCandidates(commandName) {
    const base = normalizeModelId(commandName);
    if (!base) return [];
    if (process.platform !== 'win32') return [base];

    const lower = base.toLowerCase();
    const candidates = [];
    if (!lower.endsWith('.cmd')) candidates.push(`${base}.cmd`);
    if (!lower.endsWith('.exe')) candidates.push(`${base}.exe`);
    if (!lower.endsWith('.bat')) candidates.push(`${base}.bat`);
    candidates.push(base);
    return candidates;
}

function getCliSearchDirs() {
    const dirs = [];
    const addDir = (value) => {
        const dir = trimShellLine(value);
        if (!dir || dirs.includes(dir)) return;
        dirs.push(dir);
    };

    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
        addDir(dir);
    }
    for (const dir of getNpmGlobalBinDirs()) {
        addDir(dir);
    }
    return dirs;
}

function resolveCommandPath(commandName) {
    const normalizedCommand = normalizeModelId(commandName);
    if (!normalizedCommand) return '';

    const candidates = [];
    const addCandidate = (value) => {
        const candidate = trimShellLine(value);
        if (!candidate) return;

        // On Windows, npm may create an extensionless shim (for POSIX shells)
        // alongside runnable wrappers like .cmd/.exe/.bat. Prefer wrappers first.
        if (process.platform === 'win32' && !path.extname(candidate)) {
            const wrapperCandidates = ['.cmd', '.exe', '.bat'].map(ext => `${candidate}${ext}`);
            for (const wrapper of wrapperCandidates) {
                if (wrapper && !candidates.includes(wrapper)) {
                    candidates.push(wrapper);
                }
            }
        }

        if (candidates.includes(candidate)) return;
        candidates.push(candidate);
    };

    if (path.isAbsolute(normalizedCommand)) {
        addCandidate(normalizedCommand);
    }

    const commandToken = path.basename(normalizedCommand);
    if (commandToken) {
        if (process.platform === 'win32') {
            for (const found of readCommandLines(`where ${commandToken}`)) {
                addCandidate(found);
            }
        } else {
            for (const found of readCommandLines(`command -v ${commandToken}`)) {
                addCandidate(found);
            }
            for (const found of readCommandLines(`which ${commandToken}`)) {
                addCandidate(found);
            }
        }
    }

    const commandNames = getCommandNameCandidates(normalizedCommand);
    for (const dir of getCliSearchDirs()) {
        for (const name of commandNames) {
            addCandidate(path.join(dir, name));
        }
    }

    for (const candidate of candidates) {
        if (isRunnableFile(candidate)) {
            return candidate;
        }
    }
    return '';
}

function shouldUseShellForCommand(commandPath) {
    if (process.platform !== 'win32') return false;
    const lower = String(commandPath || '').toLowerCase();
    return lower.endsWith('.cmd') || lower.endsWith('.bat');
}

function quoteArgForCmd(arg) {
    const value = String(arg);
    if (value === '') return '""';
    if (!/[\s"]/g.test(value)) return value;
    return '"' + value.replace(/"/g, '""') + '"';
}

function buildCmdCommand(commandPath, args) {
    const cmdParts = [quoteArgForCmd(commandPath), ...args.map(quoteArgForCmd)];
    return cmdParts.join(' ');
}

function spawnWithCmdWrapper(commandPath, args, options) {
    const comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
    const commandLine = buildCmdCommand(commandPath, args);
    return spawn(comspec, ['/d', '/s', '/c', commandLine], {
        ...options,
        shell: false,
    });
}

function spawnSyncWithCmdWrapper(commandPath, args, options) {
    const comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
    const commandLine = buildCmdCommand(commandPath, args);
    return spawnSync(comspec, ['/d', '/s', '/c', commandLine], {
        ...options,
        shell: false,
    });
}

/**
 * Force-kill a spawned process tree.
 * On Windows with shell:true, SIGKILL only kills the wrapper cmd.exe,
 * leaving orphan CLI processes. Use taskkill /T /F to kill the tree.
 */
function forceKillProcess(proc) {
    if (!proc || !proc.pid) return;
    try {
        if (process.platform === 'win32') {
            const result = spawnSync('taskkill', ['/T', '/F', '/PID', String(proc.pid)], {
                stdio: ['ignore', 'pipe', 'pipe'],
                timeout: 5000,
            });
            if (result.status !== 0) {
                const errMsg = (result.stderr || '').toString().trim();
                console.warn(`[Process] taskkill failed for PID ${proc.pid}: ${errMsg || 'exit ' + result.status}`);
                // Fallback: try direct SIGKILL on the wrapper process
                try { proc.kill('SIGKILL'); } catch {}
            }
        } else {
            proc.kill('SIGKILL');
        }
    } catch (e) {
        console.warn(`[Process] Failed to kill PID ${proc.pid}: ${e.message}`);
    }
}

/**
 * npm이 생성한 .cmd 래퍼에서 실제 Node.js 엔트리 스크립트 경로를 추출.
 * %dp0%, %~dp0, %~dp0% 기준 상대 경로로 .js/.cjs/.mjs 파일을 찾는다.
 * 실패 시 빈 문자열 반환.
 */
function extractCmdEntryScript(cmdPath) {
    try {
        const content = fs.readFileSync(cmdPath, 'utf8');
        const cmdDir = path.dirname(cmdPath);
        const pattern = /"%(?:~?dp0%?)[\\\/]([^"]+\.(?:js|cjs|mjs))"/gi;
        let match;
        while ((match = pattern.exec(content)) !== null) {
            const relativeScriptPath = match[1].replace(/[\\\/]/g, path.sep);
            const scriptPath = path.join(cmdDir, relativeScriptPath);
            if (fs.existsSync(scriptPath)) return scriptPath;
        }
    } catch {}
    return '';
}

/**
 * Spawn a CLI command, handling Windows .cmd files safely.
 *
 * npm-generated .cmd shims are batch wrappers around a Node.js entry script.
 * Invoking that script directly avoids cmd.exe quoting bugs with prompts that
 * contain quotes or large multi-line payloads. If we cannot resolve the
 * underlying script and a multi-line arg is present, fall back to a PowerShell
 * temp-file bridge.
 */
function spawnCLI(commandPath, args, options) {
    const useShell = shouldUseShellForCommand(commandPath);
    if (useShell) {
        const entryScript = extractCmdEntryScript(commandPath);
        if (entryScript) {
            return spawn(process.execPath, [entryScript, ...args], {
                ...options,
                shell: false,
            });
        }
    }

    const multilineIdx = useShell ? args.findIndex(a => /\n/.test(String(a))) : -1;
    if (multilineIdx >= 0) {
        // Fallback: PowerShell temp file approach (may still truncate on some setups)
        const tmpFile = path.join(os.tmpdir(), `ivlyrics-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
        fs.writeFileSync(tmpFile, args[multilineIdx], 'utf8');

        const psArgs = args.map((a, i) => {
            if (i === multilineIdx) return '$_p';
            return "'" + String(a).replace(/'/g, "''") + "'";
        }).join(' ');
        const psCmd = "$_p = Get-Content -Raw '" + tmpFile.replace(/'/g, "''") +
            "'; & '" + commandPath.replace(/'/g, "''") + "' " + psArgs;

        const proc = spawn('powershell.exe', ['-NoProfile', '-Command', psCmd], {
            ...options,
            shell: false,
        });
        proc.on('close', () => { try { fs.unlinkSync(tmpFile); } catch {} });
        return proc;
    }

    if (useShell) {
        return spawnWithCmdWrapper(commandPath, args, options);
    }

    return spawn(commandPath, args, options);
}

function getCliCheckArgs(tool) {
    const tokens = splitCommandTokens(tool.checkCommand || '');
    if (tokens.length === 0) return ['--version'];

    const first = normalizeModelId(tokens[0]).toLowerCase();
    const toolCommand = normalizeModelId(tool.command).toLowerCase();
    const toolBase = path.basename(toolCommand);
    if (first === toolCommand || path.basename(first) === toolBase) {
        return tokens.slice(1);
    }
    return tokens;
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

function normalizeGeminiModel(modelId) {
    const normalized = normalizeModelId(modelId)
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

function resolveGeminiModel(modelId, fallbackModel = GEMINI_DEFAULT_MODEL) {
    const normalized = normalizeGeminiModel(modelId);
    if (!normalized) return normalizeGeminiModel(fallbackModel) || GEMINI_DEFAULT_MODEL;
    return normalized;
}

function buildGeminiCliArgs(prompt, model, defaultModel, outputFormat = 'text') {
    const useModel = resolveGeminiModel(model || defaultModel, GEMINI_DEFAULT_MODEL);
    const args = [
        '--prompt',
        prompt,
        '--output-format',
        outputFormat,
    ];
    if (useModel) args.unshift('--model', useModel);
    return args;
}

function buildCodexCliArgs(prompt, model, defaultModel, outputFormat = 'text') {
    const useModel = normalizeModelId(model || defaultModel);
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

    const args = [...configArgs, 'exec', '--skip-git-repo-check'];
    if (outputFormat === 'json') {
        args.push('--json');
    }
    args.push(prompt);
    return args;
}

function extractCodexChunkFromEvent(parsed) {
    if (!parsed || typeof parsed !== 'object') return '';
    if (parsed.type === 'item.completed') {
        const item = parsed.item || {};
        if (item.type === 'agent_message') {
            return typeof item.text === 'string' ? item.text : '';
        }
        return '';
    }

    // Future-proofing: some Codex builds may emit delta events.
    const deltaTextCandidates = [
        parsed?.delta?.text,
        parsed?.delta?.content,
        parsed?.item?.delta?.text,
        parsed?.item?.delta?.content,
        parsed?.textDelta,
        parsed?.contentDelta,
    ];
    for (const candidate of deltaTextCandidates) {
        if (typeof candidate === 'string' && candidate) {
            return candidate;
        }
    }
    return '';
}

function parseCodexJsonOutput(stdout) {
    const lines = String(stdout || '').split(/\r?\n/);
    const chunks = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let parsed;
        try {
            parsed = JSON.parse(trimmed);
        } catch {
            continue;
        }
        const chunk = extractCodexChunkFromEvent(parsed);
        if (chunk) chunks.push(chunk);
    }
    if (chunks.length > 0) return chunks.join('');
    return String(stdout || '').trim();
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
        installUrl: 'https://docs.anthropic.com/en/docs/claude-code',
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

    // Gemini - CLI spawn only
    gemini: {
        mode: 'cli',
        command: 'gemini',
        checkCommand: 'gemini --version',
        installUrl: 'https://github.com/google-gemini/gemini-cli',
        defaultModel: GEMINI_DEFAULT_MODEL,
        buildArgs: (prompt, model, defaultModel) => buildGeminiCliArgs(prompt, model, defaultModel),
        buildStreamArgs: (prompt, model, defaultModel) => buildGeminiCliArgs(prompt, model, defaultModel, 'stream-json'),
        parseOutput: (stdout) => stdout.trim()
    },

    // OpenAI Codex - CLI spawn (OAuth 토큰 교환 절차가 독점적)
    codex: {
        mode: 'cli',
        command: 'codex',
        checkCommand: 'codex --version',
        installUrl: 'https://github.com/openai/codex',
        defaultModel: '',
        buildArgs: (prompt, model, defaultModel) => buildCodexCliArgs(prompt, model, defaultModel),
        buildStreamArgs: (prompt, model, defaultModel) => buildCodexCliArgs(prompt, model, defaultModel, 'json'),
        parseOutput: (stdout) => parseCodexJsonOutput(stdout)
    }
};

// ============================================
// Helper Functions
// ============================================

const toolAvailabilityCache = new Map();
let lastToolCheckTime = 0;
let toolCheckInProgress = false;

function checkToolAvailable(toolId) {
    const tool = CLI_TOOLS[toolId];
    if (!tool) return Promise.resolve({ available: false, error: 'Unknown tool' });

    const commandPath = resolveCommandPath(tool.command);
    if (!commandPath) {
        return Promise.resolve({
            available: false,
            error:
                `${tool.command} executable not found. ` +
                `Install: ${tool.installUrl} — then ensure it's in your PATH and restart Spotify/terminal.`
        });
    }

    const checkArgs = getCliCheckArgs(tool);
    const spawnOptions = {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: os.tmpdir(),
        env: { ...process.env, NO_COLOR: '1' },
        windowsHide: true,
    };

    return new Promise((resolve) => {
        let settled = false;
        let proc;
        try {
            proc = spawnCLI(commandPath, checkArgs, spawnOptions);
        } catch (err) {
            resolve({ available: false, error: `${tool.command} check failed: ${err.message}` });
            return;
        }

        let stdout = '';
        let stderr = '';

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            forceKillProcess(proc);
            resolve({ available: true, note: `${tool.command} found but version check timed out` });
        }, TOOL_CHECK_TIMEOUT_MS);

        proc.stdout.on('data', (data) => { stdout += data.toString(); });
        proc.stderr.on('data', (data) => { stderr += data.toString(); });

        proc.on('close', (code) => {
            clearTimeout(timer);
            if (settled) return;
            settled = true;
            if (code === 0) {
                resolve({ available: true });
            } else {
                const detail =
                    normalizeModelId(stderr) ||
                    normalizeModelId(stdout) ||
                    `exit code ${code}`;
                resolve({
                    available: false,
                    error: `${tool.command} is installed but check command failed: ${detail}`
                });
            }
        });

        proc.on('error', (err) => {
            clearTimeout(timer);
            if (settled) return;
            settled = true;
            resolve({ available: false, error: `${tool.command} check failed: ${err.message}` });
        });
    });
}

async function refreshToolCache() {
    if (toolCheckInProgress) return;
    toolCheckInProgress = true;
    try {
        const toolIds = Object.keys(CLI_TOOLS);
        const results = await Promise.allSettled(
            toolIds.map(toolId => checkToolAvailable(toolId))
        );
        toolIds.forEach((toolId, i) => {
            const status = results[i].status === 'fulfilled'
                ? results[i].value
                : { available: false, error: results[i].reason?.message || 'Check failed' };
            toolAvailabilityCache.set(toolId, status);
        });
        lastToolCheckTime = Date.now();
    } finally {
        toolCheckInProgress = false;
    }
}

function getCachedToolStatus(toolId) {
    return toolAvailabilityCache.get(toolId) || { available: false, error: 'Checking...' };
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

function resolveCodexForcedReasoningEffort(modelId) {
    const selectedModel = normalizeModelId(modelId || readCodexConfiguredModel());
    const modelMetadata = selectedModel ? getCodexCachedModelMetadata(selectedModel) : null;
    const supportedEfforts = (modelMetadata?.supported_reasoning_levels || [])
        .map(level => normalizeModelId(level?.effort))
        .filter(Boolean);
    const supportedSet = new Set(supportedEfforts);
    const lowerModel = selectedModel.toLowerCase();
    // gpt-5 계열 일부는 minimal/none 조합에서 web_search/tool 제약 오류가 발생.
    if (lowerModel === 'gpt-5' || lowerModel.includes('gpt-5-codex')) return 'low';
    if (supportedSet.has('none')) return 'none';
    if (supportedSet.has('minimal')) return 'minimal';
    // Prefer disabling reasoning for non-codex models even if metadata does not list "none".
    return 'none';
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
            const modelId = normalizeGeminiModel(match[1]);
            if (modelId.startsWith('gemini-')) {
                addModelToMap(map, modelId, 'gemini-history');
            }
        }
    }

    return finalizeGeminiModelDiscovery(map, CLI_TOOLS.gemini.defaultModel);
}

function finalizeGeminiModelDiscovery(modelMap, defaultModel) {
    const discoveredModels = new Map(modelMap);
    const discoveredCount = discoveredModels.size;
    if (discoveredCount > 0) {
        addModelToMap(discoveredModels, defaultModel, 'proxy-default');
    }
    return {
        defaultModel: defaultModel || '',
        models: discoveredCount > 0 ? sortModels(Array.from(discoveredModels.values())) : [],
        source: discoveredCount > 0 ? 'gemini-history' : 'fallback'
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
const LYRICS_RESULT_CACHE_TTL_MS = 10 * 60 * 1000;
const LYRICS_RESULT_CACHE_MAX = 200;
const lyricsResultCache = new Map();
const lyricsInflightRequests = new Map();

function getActiveRequestCount() {
    return activeCLIProcesses;
}

function isLyricsWorkloadPrompt(prompt) {
    const text = normalizeModelId(prompt).toLowerCase();
    if (!text) return false;
    return (
        /^translate these \d+ lines of song lyrics/.test(text) ||
        /^convert these \d+ lines of lyrics to pronunciation/.test(text)
    );
}

function makeLyricsRequestKey(toolId, model, prompt) {
    if (!isLyricsWorkloadPrompt(prompt)) return '';
    return `${normalizeModelId(toolId)}::${normalizeModelId(model)}::${prompt}`;
}

function getCachedLyricsResult(cacheKey) {
    if (!cacheKey) return '';
    const cached = lyricsResultCache.get(cacheKey);
    if (!cached) return '';
    if (Date.now() - cached.ts > LYRICS_RESULT_CACHE_TTL_MS) {
        lyricsResultCache.delete(cacheKey);
        return '';
    }
    return cached.result || '';
}

function setCachedLyricsResult(cacheKey, result) {
    if (!cacheKey || !result) return;
    lyricsResultCache.set(cacheKey, { ts: Date.now(), result });
    if (lyricsResultCache.size <= LYRICS_RESULT_CACHE_MAX) return;
    const oldestKey = lyricsResultCache.keys().next().value;
    if (oldestKey) lyricsResultCache.delete(oldestKey);
}

function getInflightLyricsRequest(cacheKey) {
    if (!cacheKey) return null;
    return lyricsInflightRequests.get(cacheKey) || null;
}

function setInflightLyricsRequest(cacheKey, promise) {
    if (!cacheKey || !promise) return;
    lyricsInflightRequests.set(cacheKey, promise);
}

function clearInflightLyricsRequest(cacheKey) {
    if (!cacheKey) return;
    lyricsInflightRequests.delete(cacheKey);
}

/**
 * CLI 도구 실행 (spawn 방식)
 */
function runCLI(toolId, prompt, model = '', timeout = 120000, signal = null) {
    return new Promise((resolve, reject) => {
        const tool = CLI_TOOLS[toolId];
        if (!tool) {
            return reject(new Error(`Unknown tool: ${toolId}`));
        }

        if (activeCLIProcesses >= MAX_CONCURRENT_CLI) {
            return reject(new Error(`Too many concurrent requests (max ${MAX_CONCURRENT_CLI}). Please try again later.`));
        }
        activeCLIProcesses++;

        const commandPath = resolveCommandPath(tool.command);
        if (!commandPath) {
            activeCLIProcesses--;
            return reject(
                new Error(
                    `Failed to locate ${tool.command} executable. ` +
                    `Ensure it is installed and available in PATH.`
                )
            );
        }

        const args = tool.buildArgs(prompt, model, tool.defaultModel);
        const actualModel = model || tool.defaultModel || 'default';

        const promptPreview = prompt.length > 50 ? prompt.substring(0, 50) + '...' : prompt;
        const argsForLog = args.map(a => a === prompt ? `"${promptPreview}"` : a);
        console.log(`\n${'='.repeat(60)}`);
        console.log(`[${toolId}] CLI REQUEST`);
        console.log(`  Model: ${actualModel}`);
        console.log(`  Command: ${commandPath} ${argsForLog.join(' ')}`);
        console.log(`${'='.repeat(60)}`);

        let proc;
        try {
            proc = spawnCLI(commandPath, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                cwd: os.tmpdir(),
                env: { ...process.env, NO_COLOR: '1' },
                windowsHide: true,
            });
        } catch (e) {
            activeCLIProcesses--;
            return reject(new Error(`Failed to spawn ${tool.command}: ${e.message}`));
        }

        let stdout = '';
        let stderr = '';
        let settled = false;
        let processDecremented = false;

        const decrementOnce = () => {
            if (!processDecremented) {
                processDecremented = true;
                activeCLIProcesses--;
            }
        };

        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                decrementOnce();
                forceKillProcess(proc);
                reject(new Error(`Timeout after ${timeout}ms`));
            }
        }, timeout);

        // Kill process if client disconnects before response
        if (signal) {
            const onAbort = () => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    decrementOnce();
                    forceKillProcess(proc);
                    reject(new Error('Request aborted by client'));
                }
            };
            if (signal.aborted) {
                onAbort();
                return;
            }
            signal.addEventListener('abort', onAbort, { once: true });
        }

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            clearTimeout(timer);
            decrementOnce();
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
            decrementOnce();
            if (settled) return;
            settled = true;
            reject(new Error(`Failed to start ${commandPath}: ${err.message}`));
        });
    });
}

/**
 * 통합 실행 함수
 */
async function runTool(toolId, prompt, model = '', timeout = 120000, signal = null) {
    const tool = CLI_TOOLS[toolId];
    if (!tool) {
        throw new Error(`Unknown tool: ${toolId}`);
    }

    return await runCLI(toolId, prompt, model, timeout, signal);
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

    const commandPath = resolveCommandPath(tool.command);
    if (!commandPath) {
        activeCLIProcesses--;
        sendSSEError(
            res,
            `Failed to locate ${tool.command} executable. Ensure it is installed and available in PATH.`
        );
        sendSSEDone(res);
        return;
    }

    const buildArgsFn = typeof tool.buildStreamArgs === 'function' ? tool.buildStreamArgs : tool.buildArgs;
    const args = buildArgsFn(prompt, model, tool.defaultModel);
    const geminiJsonStreamEnabled =
        toolId === 'gemini' &&
        args.some((arg, i) => arg === '--output-format' && args[i + 1] === 'stream-json');
    const codexJsonStreamEnabled =
        toolId === 'codex' &&
        args.includes('--json');
    const actualModel = model || tool.defaultModel || 'default';

    const promptPreview = prompt.length > 50 ? prompt.substring(0, 50) + '...' : prompt;
    const argsForLog = args.map(a => a === prompt ? `"${promptPreview}"` : a);
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[${toolId}] CLI STREAM REQUEST`);
    console.log(`  Model: ${actualModel}`);
    console.log(`  Command: ${commandPath} ${argsForLog.join(' ')}`);
    console.log(`${'='.repeat(60)}`);

    let proc;
    try {
        proc = spawnCLI(commandPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd: os.tmpdir(),
            env: { ...process.env, NO_COLOR: '1' },
            windowsHide: true,
        });
    } catch (e) {
        activeCLIProcesses--;
        sendSSEError(res, `Failed to spawn ${tool.command}: ${e.message}`);
        sendSSEDone(res);
        return;
    }

    let stderr = '';
    let settled = false;
    let totalLength = 0;
    let streamedChunkCount = 0;
    let geminiJsonBuffer = '';
    let codexJsonBuffer = '';

    const flushGeminiStreamLine = (line) => {
        const trimmed = String(line || '').trim();
        if (!trimmed) return;
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed?.type === 'message' && parsed?.role === 'assistant' && typeof parsed.content === 'string' && parsed.content) {
                sendSSEChunk(res, parsed.content);
                streamedChunkCount++;
            }
            if (parsed?.type === 'error') {
                const errText = normalizeModelId(parsed?.error || parsed?.message || 'Gemini stream error');
                if (errText) sendSSEError(res, errText);
            }
        } catch {
            // Fallback: if a non-JSON line appears, forward it as plain text.
            sendSSEChunk(res, trimmed + '\n');
            streamedChunkCount++;
        }
    };

    const flushCodexStreamLine = (line) => {
        const trimmed = String(line || '').trim();
        if (!trimmed) return;
        let parsed;
        try {
            parsed = JSON.parse(trimmed);
        } catch {
            // Ignore non-JSON noise for codex JSON stream mode.
            return;
        }
        const chunk = extractCodexChunkFromEvent(parsed);
        if (chunk) {
            sendSSEChunk(res, chunk);
            streamedChunkCount++;
        }
        if (parsed?.type === 'error') {
            const errText = normalizeModelId(parsed?.error || parsed?.message || 'Codex stream error');
            if (errText) sendSSEError(res, errText);
        }
    };

    const timer = setTimeout(() => {
        if (!settled) {
            settled = true;
            forceKillProcess(proc);
            sendSSEError(res, `Timeout after ${timeout}ms`);
            sendSSEDone(res);
        }
    }, timeout);

    // Client disconnect → kill process
    res.on('close', () => {
        if (!settled) {
            settled = true;
            clearTimeout(timer);
            forceKillProcess(proc);
            // activeCLIProcesses는 proc.on('close')에서 감소됨
        }
    });

    proc.stdout.on('data', (data) => {
        if (settled) return;
        const text = data.toString();
        totalLength += text.length;
        if (!geminiJsonStreamEnabled && !codexJsonStreamEnabled) {
            sendSSEChunk(res, text);
            streamedChunkCount++;
            return;
        }
        if (geminiJsonStreamEnabled) {
            geminiJsonBuffer += text;
            if (geminiJsonBuffer.length > MAX_STREAM_BUFFER_SIZE) {
                settled = true;
                forceKillProcess(proc);
                sendSSEError(res, 'Stream buffer exceeded maximum size');
                sendSSEDone(res);
                return;
            }
            const lines = geminiJsonBuffer.split(/\r?\n/);
            geminiJsonBuffer = lines.pop() || '';
            for (const line of lines) {
                flushGeminiStreamLine(line);
            }
            return;
        }
        codexJsonBuffer += text;
        if (codexJsonBuffer.length > MAX_STREAM_BUFFER_SIZE) {
            settled = true;
            forceKillProcess(proc);
            sendSSEError(res, 'Stream buffer exceeded maximum size');
            sendSSEDone(res);
            return;
        }
        const lines = codexJsonBuffer.split(/\r?\n/);
        codexJsonBuffer = lines.pop() || '';
        for (const line of lines) {
            flushCodexStreamLine(line);
        }
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
            if (geminiJsonStreamEnabled && geminiJsonBuffer) {
                flushGeminiStreamLine(geminiJsonBuffer);
                geminiJsonBuffer = '';
            }
            if (codexJsonStreamEnabled && codexJsonBuffer) {
                flushCodexStreamLine(codexJsonBuffer);
                codexJsonBuffer = '';
            }
            console.log(
                `[${toolId}] STREAM SUCCESS - Total: ${totalLength} chars` +
                `, emitted chunks: ${streamedChunkCount}`
            );
        }
        sendSSEDone(res);
    });

    proc.on('error', (err) => {
        clearTimeout(timer);
        activeCLIProcesses--;
        if (settled) return;
        settled = true;
        sendSSEError(res, `Failed to start ${commandPath}: ${err.message}`);
        sendSSEDone(res);
    });
}

function runToolStream(toolId, prompt, model, timeout, res) {
    const tool = CLI_TOOLS[toolId];
    if (!tool) {
        sendSSEError(res, `Unknown tool: ${toolId}`);
        sendSSEDone(res);
        return;
    }
    runCLIStream(toolId, prompt, model, timeout, res);
}

// ============================================
// API Endpoints
// ============================================

/**
 * 헬스 체크 & 사용 가능한 도구 목록
 */
app.get('/health', (req, res) => {
    if (Date.now() - lastToolCheckTime > TOOL_CACHE_TTL_MS) {
        refreshToolCache().catch(() => {});
    }

    const tools = {};
    for (const toolId of Object.keys(CLI_TOOLS)) {
        tools[toolId] = { ...getCachedToolStatus(toolId), mode: CLI_TOOLS[toolId].mode };
    }

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
app.get('/tools', (req, res) => {
    const tools = [];
    for (const toolId of Object.keys(CLI_TOOLS)) {
        const status = getCachedToolStatus(toolId);
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
    if (isShuttingDown) {
        return res.status(503).json({ error: 'Server is shutting down. Please retry.' });
    }

    const { tool, model, prompt, timeout, stream } = req.body;
    const streamEnabled = stream === true || stream === 'true' || req.query.stream === 'true';

    if (!tool || !prompt) {
        return res.status(400).json({ error: 'Missing tool or prompt' });
    }

    // Model ID validation
    let requestedModel = normalizeModelId(model || '');
    if (tool === 'gemini') {
        requestedModel = normalizeGeminiModel(requestedModel);
    }
    if (requestedModel) {
        if (requestedModel.length > 200) {
            return res.status(400).json({ error: 'Model ID too long (max 200 chars)' });
        }
        if (!/^[\w\-.]+$/.test(requestedModel)) {
            return res.status(400).json({ error: 'Invalid model ID: only alphanumeric, hyphens, underscores, and dots allowed' });
        }
    }

    // Rate limiting
    if (!checkRateLimit(req)) {
        return res.status(429).json({ error: `Rate limit exceeded. Max ${RATE_LIMIT_MAX_REQUESTS} requests per minute.` });
    }

    const toolStatus = await checkToolAvailable(tool);
    if (!toolStatus.available) {
        return res.status(400).json({ error: toolStatus.error });
    }

    const effectiveTimeout = timeout
        ? Math.max(5000, Math.min(600000, Number(timeout) || DEFAULT_TIMEOUT_MS))
        : DEFAULT_TIMEOUT_MS;
    const effectiveModel = requestedModel || '';
    const lyricsRequestKey = makeLyricsRequestKey(tool, effectiveModel, prompt);

    if (streamEnabled) {
        const cached = getCachedLyricsResult(lyricsRequestKey);
        if (cached) {
            console.log(`[API] Stream cache hit - tool: ${tool}, model: ${effectiveModel || 'default'}, prompt length: ${prompt.length}`);
            setupSSE(res);
            sendSSEChunk(res, cached);
            sendSSEDone(res);
            return;
        }

        const inflight = getInflightLyricsRequest(lyricsRequestKey);
        if (inflight) {
            console.log(`[API] Stream joined in-flight request - tool: ${tool}, model: ${effectiveModel || 'default'}, prompt length: ${prompt.length}`);
            setupSSE(res);
            try {
                const sharedResult = await inflight;
                sendSSEChunk(res, sharedResult);
                sendSSEDone(res);
            } catch (e) {
                sendSSEError(res, e?.message || 'Shared request failed');
                sendSSEDone(res);
            }
            return;
        }

        console.log(`[API] Stream request - tool: ${tool}, mode: ${CLI_TOOLS[tool]?.mode}, model: ${requestedModel || 'default'}, prompt length: ${prompt.length}`);
        setupSSE(res);
        runToolStream(tool, prompt, requestedModel || '', effectiveTimeout, res);
        return;
    }

    // Abort CLI process if client disconnects before response is sent
    const ac = new AbortController();
    req.on('close', () => {
        if (!res.writableEnded) ac.abort();
    });

    let isInflightOwner = false;
    try {
        console.log(`[API] Generate request - tool: ${tool}, mode: ${CLI_TOOLS[tool]?.mode}, model: ${requestedModel || 'default'}, prompt length: ${prompt.length}`);
        const startTime = Date.now();
        const cached = getCachedLyricsResult(lyricsRequestKey);
        if (cached) {
            const elapsed = Date.now() - startTime;
            console.log(`[API] Cache hit - tool: ${tool}, model: ${effectiveModel || 'default'}, prompt length: ${prompt.length}`);
            if (!res.writableEnded) {
                res.json({
                    success: true,
                    result: cached,
                    tool,
                    mode: CLI_TOOLS[tool]?.mode,
                    model: requestedModel || CLI_TOOLS[tool]?.defaultModel || 'default',
                    elapsed_ms: elapsed,
                    cached: true
                });
            }
            return;
        }

        let sharedPromise = getInflightLyricsRequest(lyricsRequestKey);
        if (!sharedPromise) {
            sharedPromise = runTool(
                tool,
                prompt,
                effectiveModel,
                effectiveTimeout,
                lyricsRequestKey ? null : ac.signal
            );
            setInflightLyricsRequest(lyricsRequestKey, sharedPromise);
            isInflightOwner = true;
        } else {
            console.log(`[API] Joined in-flight request - tool: ${tool}, model: ${effectiveModel || 'default'}, prompt length: ${prompt.length}`);
        }

        const result = await sharedPromise;
        if (isInflightOwner) {
            clearInflightLyricsRequest(lyricsRequestKey);
            setCachedLyricsResult(lyricsRequestKey, result);
        }
        const elapsed = Date.now() - startTime;
        console.log(`[API] Completed in ${elapsed}ms`);
        if (!res.writableEnded) {
            res.json({
                success: true,
                result,
                tool,
                mode: CLI_TOOLS[tool]?.mode,
                model: requestedModel || CLI_TOOLS[tool]?.defaultModel || 'default',
                elapsed_ms: elapsed,
                cached: false
            });
        }
    } catch (e) {
        if (isInflightOwner) clearInflightLyricsRequest(lyricsRequestKey);
        console.error(`[API] Error:`, e.message);
        if (!res.writableEnded) {
            res.status(500).json({ error: e.message });
        }
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

function isSafeProxyDir(dirPath) {
    try {
        const resolved = path.resolve(dirPath || '');
        const realPath = fs.realpathSync(resolved);
        const resolvedNorm = path.normalize(resolved).toLowerCase();
        const realNorm = path.normalize(realPath).toLowerCase();
        if (resolvedNorm !== realNorm) return false;

        const stat = fs.lstatSync(resolved);
        if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
        if (path.basename(realPath).toLowerCase() !== 'cli-proxy') return false;

        const segments = realNorm.split(path.sep).filter(Boolean);
        if (!segments.includes('spicetify') && !segments.includes('.spicetify')) return false;

        return true;
    } catch {
        return false;
    }
}

function scheduleDirectoryRemoval(dirPath) {
    const resolved = path.resolve(dirPath);
    if (process.platform === 'win32') {
        const escaped = resolved.replace(/"/g, '""');
        const command = `ping 127.0.0.1 -n 4 > nul && rmdir /s /q "${escaped}"`;
        const child = spawn('cmd.exe', ['/d', '/s', '/c', command], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            env: { ...process.env },
        });
        child.unref();
        return;
    }

    const escaped = resolved.replace(/'/g, `'\\''`);
    const command = `sleep 2; rm -rf '${escaped}'`;
    const child = spawn('/bin/sh', ['-c', command], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env },
    });
    child.unref();
}

/**
 * 프록시 자체 정리(삭제)
 * - 마켓플레이스에서 애드온 제거 시 호출되는 용도
 */
app.post('/cleanup', requireAdminRequestGuard, async (req, res) => {
    if (isShuttingDown) {
        return res.status(409).json({ error: 'Server is shutting down' });
    }

    const { target, confirm, dryRun } = req.body || {};
    if (target !== 'proxy') {
        return res.status(400).json({ error: 'Missing/invalid target (expected: proxy)' });
    }
    if (confirm !== 'REMOVE_PROXY') {
        return res.status(400).json({ error: 'Missing confirmation token' });
    }

    const proxyDir = path.resolve(__dirname);
    if (!isSafeProxyDir(proxyDir)) {
        return res.status(500).json({ error: `Unsafe proxy dir: ${proxyDir}` });
    }

    const strategy = process.platform === 'win32' ? 'cmd-rmdir-delayed' : 'sh-rmrf-delayed';
    if (dryRun === true) {
        return res.json({
            success: true,
            dryRun: true,
            target: 'proxy',
            proxyDir,
            strategy
        });
    }

    isShuttingDown = true;
    res.json({
        success: true,
        target: 'proxy',
        proxyDir,
        strategy,
        note: 'Cleanup scheduled. Server will exit shortly.'
    });

    setTimeout(() => {
        try {
            scheduleDirectoryRemoval(proxyDir);
        } catch (e) {
            console.error('[cleanup] Failed to schedule proxy removal:', e.message);
        } finally {
            setTimeout(() => process.exit(0), 250);
        }
    }, 100);
});

/**
 * 파일 업데이트 실행
 */
app.post('/update', requireAdminRequestGuard, async (req, res) => {
    const { target } = req.body;
    if (!target) {
        return res.status(400).json({ error: 'Missing target (addons, proxy, all, or filename)' });
    }

    // 허용된 target만 수락 (path traversal 방지)
    const ALLOWED_TARGETS = new Set([
        'addons', 'proxy', 'all',
        'Addon_AI_CLI_Provider.js'
    ]);
    if (!ALLOWED_TARGETS.has(target)) {
        return res.status(400).json({ error: `Invalid target: ${target}` });
    }

    let proxyBackups = [];
    const backupProxyFile = (filePath) => {
        if (!fs.existsSync(filePath)) return;
        const backupPath = `${filePath}.bak-${Date.now()}-${process.pid}`;
        fs.copyFileSync(filePath, backupPath);
        proxyBackups.push({ filePath, backupPath });
    };

    const restoreProxyBackups = () => {
        for (let i = proxyBackups.length - 1; i >= 0; i--) {
            const item = proxyBackups[i];
            if (!item || !item.backupPath || !item.filePath) continue;
            if (!fs.existsSync(item.backupPath)) continue;
            fs.copyFileSync(item.backupPath, item.filePath);
        }
    };

    const cleanupProxyBackups = () => {
        for (const item of proxyBackups) {
            if (!item || !item.backupPath) continue;
            if (fs.existsSync(item.backupPath)) {
                try { fs.unlinkSync(item.backupPath); } catch {}
            }
        }
        proxyBackups = [];
    };

    try {
        const results = [];
        const integrityMap = await fetchIntegrityMap();

        const downloadFile = async (remotePath, localPath, label) => {
            // Path traversal 방지: 파일명에 경로 구분자나 .. 포함 시 차단
            const basename = path.basename(localPath);
            const resolvedDir = path.resolve(path.dirname(localPath));
            const resolvedFull = path.resolve(localPath);
            if (resolvedFull !== path.join(resolvedDir, basename)) {
                throw new Error(`Invalid path detected: ${label}`);
            }

            const expectedHash = normalizeIntegrityHash(integrityMap[remotePath]);
            if (!expectedHash) {
                throw new Error(`Missing/invalid integrity hash for ${remotePath}`);
            }

            const url = `${GITHUB_RAW_BASE}/${encodeURI(remotePath)}`;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) {
                throw new Error(`Failed to download ${label}: HTTP ${response.status}`);
            }
            const contentBuffer = Buffer.from(await response.arrayBuffer());
            const actualHash = hashSha256Hex(contentBuffer);
            if (!hashesEqual(expectedHash, actualHash)) {
                throw new Error(`Integrity check failed for ${label}`);
            }
            const dir = path.dirname(localPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const tempPath = `${localPath}.tmp-${Date.now()}-${process.pid}`;
            try {
                fs.writeFileSync(tempPath, contentBuffer);
                fs.renameSync(tempPath, localPath);
            } finally {
                if (fs.existsSync(tempPath)) {
                    try { fs.unlinkSync(tempPath); } catch {}
                }
            }
            return { file: label, status: 'updated', integrity: 'verified' };
        };

        const addonDir = getSpicetifyAddonDir();
        const addonFiles = [
            'Addon_AI_CLI_Provider.js'
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
            const lockLocalPath = path.join(__dirname, 'package-lock.json');

            backupProxyFile(serverLocalPath);
            backupProxyFile(pkgLocalPath);
            backupProxyFile(lockLocalPath);

            const result = await downloadFile('cli-proxy/server.js', serverLocalPath, 'server.js');
            results.push(result);
            const pkgResult = await downloadFile('cli-proxy/package.json', pkgLocalPath, 'package.json');
            results.push(pkgResult);
            const lockResult = await downloadFile('cli-proxy/package-lock.json', lockLocalPath, 'package-lock.json');
            results.push(lockResult);

            const npmCommandPath = resolveCommandPath('npm');
            if (!npmCommandPath) {
                console.warn('[update] npm not found; skipping dependency install after proxy update');
                results.push({
                    file: 'npm install',
                    status: 'skipped',
                    note: 'npm not found in PATH; restart may fail if new dependencies are required'
                });
            } else {
                console.log(`[update] Running dependency install: ${npmCommandPath} install`);
                const npmUseShell = shouldUseShellForCommand(npmCommandPath);
                const npmInstallArgs = quoteArgsForShell(['install'], npmUseShell);
                const npmSpawnOptions = {
                    cwd: __dirname,
                    stdio: ['ignore', 'pipe', 'pipe'],
                    encoding: 'utf8',
                    timeout: 180000,
                    env: { ...process.env },
                    windowsHide: true,
                };
                const npmInstallResult = npmUseShell
                    ? spawnSyncWithCmdWrapper(npmCommandPath, npmInstallArgs, npmSpawnOptions)
                    : spawnSync(npmCommandPath, npmInstallArgs, { ...npmSpawnOptions, shell: false });

                if (npmInstallResult.error || npmInstallResult.status !== 0) {
                    const detail =
                        normalizeModelId(npmInstallResult.stderr) ||
                        normalizeModelId(npmInstallResult.stdout) ||
                        (npmInstallResult.error ? npmInstallResult.error.message : `exit code ${npmInstallResult.status}`);
                    throw new Error(`npm install failed after proxy update: ${detail}`);
                }
                results.push({ file: 'npm install', status: 'ok' });
            }

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

        cleanupProxyBackups();

        res.json({ success: true, results });

        // Auto-restart after proxy update
        if (needsRestart) {
            console.log('[update] Proxy updated. Restarting server in 1 second...');
            setTimeout(() => {
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
        if (proxyBackups.length > 0) {
            try {
                restoreProxyBackups();
                console.warn('[update] Rolled back proxy files after failure');
            } catch (restoreErr) {
                console.error('[update] Failed to restore proxy backup:', restoreErr.message);
            } finally {
                cleanupProxyBackups();
            }
        }
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
// Graceful Shutdown
// ============================================

function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[server] ${signal} received. Waiting for in-flight requests...`);

    const forceExit = setTimeout(() => {
        console.warn('[server] Forced shutdown after 30s timeout.');
        process.exit(1);
    }, 30000);
    forceExit.unref();

    const waitAndExit = () => {
        const activeRequests = getActiveRequestCount();
        if (activeRequests <= 0) {
            console.log('[server] Shutdown complete.');
            process.exit(0);
        } else {
            console.log(`[server] Waiting for ${activeRequests} in-flight request(s)...`);
            setTimeout(waitAndExit, 300);
        }
    };
    waitAndExit();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ============================================
// Start Server
// ============================================

if (require.main === module) {
    app.listen(PORT, '127.0.0.1', () => {
        console.log(`\n🚀 ivLyrics CLI Proxy Server v${LOCAL_VERSION}`);
        console.log(`   Running on http://127.0.0.1:${PORT} (localhost only)`);
        console.log(`   Gemini mode: CLI spawn`);
        console.log(`\n📋 Available endpoints:`);
        console.log(`   GET  /health   - Check server status and available tools`);
        console.log(`   GET  /tools    - List available CLI tools`);
        console.log(`   GET  /models   - List available models per tool`);
        console.log(`   POST /generate - Generate text (supports ?stream=true for SSE)`);
        console.log(`   GET  /updates  - Check for available updates`);
        console.log(`   POST /cleanup  - Remove proxy directory and exit`);
        console.log(`   POST /update   - Download and apply updates`);
        console.log(`   POST /v1/chat/completions - OpenAI-compatible endpoint`);
        console.log(`\n🔧 Checking available tools...`);

        refreshToolCache().then(() => {
            for (const toolId of Object.keys(CLI_TOOLS)) {
                const tool = CLI_TOOLS[toolId];
                const status = getCachedToolStatus(toolId);
                const icon = status.available ? '✓' : '✗';
                const detail = status.available
                    ? (status.note ? `available (${status.note})` : 'available')
                    : status.error;
                console.log(`   ${icon} ${toolId} [CLI]: ${detail} (default: ${tool.defaultModel || 'auto'})`);
            }
            console.log('');
        }).catch(() => {});

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
}

// Exported for testing (pure functions only)
if (typeof module !== 'undefined') {
    module.exports = {
        isNewerVersion,
        normalizeModelId,
        normalizeGeminiModel,
        resolveGeminiModel,
        isBlockedClaudeModel,
        resolveClaudeModel,
        extractCodexChunkFromEvent,
        parseCodexJsonOutput,
        extractCmdEntryScript,
        resolveAdminActionToken,
        finalizeGeminiModelDiscovery,
    };
}
