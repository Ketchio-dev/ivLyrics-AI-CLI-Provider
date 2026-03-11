const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const STATE_DIR = path.join(os.homedir(), '.freeai-bridge', 'state');
const PID_PATH = path.join(STATE_DIR, 'bridge.pid');
const LOG_PATH = path.join(STATE_DIR, 'bridge.log');

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function isRunning(pid) {
    if (!pid) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

ensureDir(STATE_DIR);

if (fs.existsSync(PID_PATH)) {
    const existingPid = Number(fs.readFileSync(PID_PATH, 'utf8').trim());
    if (isRunning(existingPid)) {
        console.log(`freeai-bridge is already running (pid ${existingPid})`);
        process.exit(0);
    }
}

const out = fs.openSync(LOG_PATH, 'a');
const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    cwd: __dirname,
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env },
});

child.unref();
fs.writeFileSync(PID_PATH, String(child.pid));
console.log(`freeai-bridge started in background (pid ${child.pid})`);
console.log(`log: ${LOG_PATH}`);
