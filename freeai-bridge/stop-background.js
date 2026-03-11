const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_DIR = path.join(os.homedir(), '.freeai-bridge', 'state');
const PID_PATH = path.join(STATE_DIR, 'bridge.pid');

function isRunning(pid) {
    if (!pid) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

if (!fs.existsSync(PID_PATH)) {
    console.log('freeai-bridge is not running');
    process.exit(0);
}

const pid = Number(fs.readFileSync(PID_PATH, 'utf8').trim());
if (!isRunning(pid)) {
    fs.unlinkSync(PID_PATH);
    console.log('freeai-bridge pid file was stale and has been removed');
    process.exit(0);
}

process.kill(pid, 'SIGTERM');
fs.unlinkSync(PID_PATH);
console.log(`freeai-bridge stopped (pid ${pid})`);
