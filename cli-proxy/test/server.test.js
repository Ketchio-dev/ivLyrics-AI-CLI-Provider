const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    isNewerVersion,
    normalizeModelId,
    normalizeGeminiModel,
    resolveGeminiModel,
    isBlockedClaudeModel,
    resolveClaudeModel,
    extractCodexChunkFromEvent,
    parseCodexJsonOutput,
    extractCmdEntryScript,
} = require('../server');

test('isNewerVersion: patch bump is newer', () => {
    assert.equal(isNewerVersion('1.0.1', '1.0.0'), true);
});

test('isNewerVersion: same version is not newer', () => {
    assert.equal(isNewerVersion('1.0.0', '1.0.0'), false);
});

test('isNewerVersion: older version is not newer', () => {
    assert.equal(isNewerVersion('1.0.0', '1.0.1'), false);
});

test('isNewerVersion: major bump beats high minor', () => {
    assert.equal(isNewerVersion('2.0.0', '1.9.9'), true);
});

test('isNewerVersion: zero equals zero', () => {
    assert.equal(isNewerVersion('0.0.0', '0.0.0'), false);
});

test('normalizeModelId: trims whitespace', () => {
    assert.equal(normalizeModelId('  claude-sonnet  '), 'claude-sonnet');
});

test('normalizeModelId: null returns empty', () => {
    assert.equal(normalizeModelId(null), '');
});

test('normalizeModelId: undefined returns empty', () => {
    assert.equal(normalizeModelId(undefined), '');
});

test('normalizeModelId: empty string returns empty', () => {
    assert.equal(normalizeModelId(''), '');
});

test('isBlockedClaudeModel: haiku-3 is blocked', () => {
    assert.equal(isBlockedClaudeModel('claude-haiku-3'), true);
});

test('isBlockedClaudeModel: sonnet-4-5 is not blocked', () => {
    assert.equal(isBlockedClaudeModel('claude-sonnet-4-5'), false);
});

test('isBlockedClaudeModel: bare haiku is blocked', () => {
    assert.equal(isBlockedClaudeModel('haiku'), true);
});

test('isBlockedClaudeModel: empty string is not blocked', () => {
    assert.equal(isBlockedClaudeModel(''), false);
});

test('resolveClaudeModel: blocked model returns fallback', () => {
    assert.equal(resolveClaudeModel('claude-haiku-3', 'claude-sonnet-4-5'), 'claude-sonnet-4-5');
});

test('resolveClaudeModel: allowed model passes through', () => {
    assert.equal(resolveClaudeModel('claude-sonnet-4-5', 'claude-sonnet-4-5'), 'claude-sonnet-4-5');
});

test('resolveClaudeModel: empty model returns fallback', () => {
    assert.equal(resolveClaudeModel('', 'claude-sonnet-4-5'), 'claude-sonnet-4-5');
});

test('normalizeGeminiModel: already normalized passes through', () => {
    assert.equal(normalizeGeminiModel('gemini-2.5-flash'), 'gemini-2.5-flash');
});

test('normalizeGeminiModel: strips models/ prefix', () => {
    assert.equal(normalizeGeminiModel('models/gemini-2.5-flash'), 'gemini-2.5-flash');
});

test('normalizeGeminiModel: short alias resolves via map', () => {
    assert.equal(normalizeGeminiModel('3-flash'), 'gemini-3-flash-preview');
});

test('normalizeGeminiModel: dotted alias resolves via map', () => {
    assert.equal(normalizeGeminiModel('gemini-3.0-flash'), 'gemini-3-flash-preview');
});

test('normalizeGeminiModel: empty returns empty', () => {
    assert.equal(normalizeGeminiModel(''), '');
});

test('resolveGeminiModel: empty model returns fallback', () => {
    assert.equal(resolveGeminiModel('', 'gemini-2.5-flash'), 'gemini-2.5-flash');
});

test('resolveGeminiModel: valid model passes through', () => {
    assert.equal(resolveGeminiModel('gemini-2.0-flash', 'gemini-2.5-flash'), 'gemini-2.0-flash');
});

test('extractCodexChunkFromEvent: agent_message item.completed returns text', () => {
    const parsed = { type: 'item.completed', item: { type: 'agent_message', text: 'hello' } };
    assert.equal(extractCodexChunkFromEvent(parsed), 'hello');
});

test('extractCodexChunkFromEvent: non-agent_message item.completed returns empty', () => {
    const parsed = { type: 'item.completed', item: { type: 'other' } };
    assert.equal(extractCodexChunkFromEvent(parsed), '');
});

test('extractCodexChunkFromEvent: null returns empty', () => {
    assert.equal(extractCodexChunkFromEvent(null), '');
});

test('extractCodexChunkFromEvent: empty object returns empty', () => {
    assert.equal(extractCodexChunkFromEvent({}), '');
});

test('parseCodexJsonOutput: valid NDJSON extracts text', () => {
    const input = '{"type":"item.completed","item":{"type":"agent_message","text":"hi"}}\n';
    assert.equal(parseCodexJsonOutput(input), 'hi');
});

test('parseCodexJsonOutput: empty input returns empty', () => {
    assert.equal(parseCodexJsonOutput(''), '');
});

test('parseCodexJsonOutput: mixed non-JSON and JSON extracts valid', () => {
    const input = 'not-json\n{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}\n';
    assert.equal(parseCodexJsonOutput(input), 'ok');
});

test('extractCmdEntryScript: resolves npm cmd wrapper with %dp0% path', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ivlyrics-cmd-test-'));
    const cmdDir = path.join(tempRoot, 'bin');
    const cmdPath = path.join(cmdDir, 'gemini.cmd');
    const scriptPath = path.join(tempRoot, 'gemini', 'dist', 'index.js');
    fs.mkdirSync(cmdDir, { recursive: true });
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(scriptPath, '// test fixture\n', 'utf8');
    fs.writeFileSync(
        cmdPath,
        '@ECHO off\r\n"%dp0%\\..\\gemini\\dist\\index.js" %*\r\n',
        'utf8'
    );

    assert.equal(extractCmdEntryScript(cmdPath), scriptPath);

    fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('extractCmdEntryScript: resolves npm cmd wrapper with %~dp0 path', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ivlyrics-cmd-test-'));
    const cmdDir = path.join(tempRoot, 'bin');
    const cmdPath = path.join(cmdDir, 'gemini.cmd');
    const scriptPath = path.join(tempRoot, 'gemini', 'dist', 'index.js');
    fs.mkdirSync(cmdDir, { recursive: true });
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(scriptPath, '// test fixture\n', 'utf8');
    fs.writeFileSync(
        cmdPath,
        '@ECHO off\r\n"%~dp0\\..\\gemini\\dist\\index.js" %*\r\n',
        'utf8'
    );

    assert.equal(extractCmdEntryScript(cmdPath), scriptPath);

    fs.rmSync(tempRoot, { recursive: true, force: true });
});
