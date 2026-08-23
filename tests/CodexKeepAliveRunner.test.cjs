const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildCodexKeepAliveArgs, CodexKeepAliveRunner, isCodexThreadWriterConflict,
  parseCodexExecJsonl, prepareIsolatedCodexHome, resolveCodex,
} = require('../.test-dist/CodexKeepAliveRunner.cjs');

test('accepts a completed tool-free turn in the expected session', () => {
  const output = [
    JSON.stringify({ type: 'thread.started', thread_id: 'session-1' }),
    JSON.stringify({ type: 'turn.started' }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '[CACHE_WARDEN_OK]' } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 80 } }),
  ].join('\n');
  assert.deepEqual(parseCodexExecJsonl(output, 'session-1'), {
    ok: true, sessionId: 'session-1', completed: true, toolCalls: 0, error: '',
  });
});

test('rejects a forked session or any tool execution', () => {
  const fork = parseCodexExecJsonl([
    JSON.stringify({ type: 'thread.started', thread_id: 'unexpected' }),
    JSON.stringify({ type: 'turn.completed' }),
  ].join('\n'), 'session-1');
  assert.equal(fork.ok, false);
  assert.match(fork.error, /unexpected session/);

  const tool = parseCodexExecJsonl([
    JSON.stringify({ type: 'thread.started', thread_id: 'session-1' }),
    JSON.stringify({ type: 'item.started', item: { type: 'command_execution' } }),
    JSON.stringify({ type: 'turn.completed' }),
  ].join('\n'), 'session-1');
  assert.equal(tool.ok, false);
  assert.equal(tool.toolCalls, 1);

  const completedOnlyTool = parseCodexExecJsonl([
    JSON.stringify({ type: 'thread.started', thread_id: 'session-1' }),
    JSON.stringify({ type: 'item.completed', item: { id: 'tool-1', type: 'file_change' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '[CACHE_WARDEN_OK]' } }),
    JSON.stringify({ type: 'turn.completed' }),
  ].join('\n'), 'session-1');
  assert.equal(completedOnlyTool.ok, false);
  assert.equal(completedOnlyTool.toolCalls, 1);
});

test('rejects incomplete or error output', () => {
  const result = parseCodexExecJsonl([
    JSON.stringify({ type: 'thread.started', thread_id: 'session-1' }),
    JSON.stringify({ type: 'turn.failed', error: { message: 'busy' } }),
  ].join('\n'), 'session-1');
  assert.equal(result.ok, false);
  assert.equal(result.completed, false);
  assert.equal(result.error, 'busy');
});

test('identifies transient Codex thread-writer conflicts', () => {
  assert.equal(isCodexThreadWriterConflict('thread-store conflict: thread session-1 already has an active writer'), true);
  assert.equal(isCodexThreadWriterConflict('Codex exited with code 1'), false);
});

test('requires the exact inert acknowledgement', () => {
  const result = parseCodexExecJsonl([
    JSON.stringify({ type: 'thread.started', thread_id: 'session-1' }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'I did something else' } }),
    JSON.stringify({ type: 'turn.completed' }),
  ].join('\n'), 'session-1');
  assert.equal(result.ok, false);
  assert.match(result.error, /expected inert acknowledgement/);
});

test('rejects unsafe session identifiers before spawning Codex', async () => {
  const runner = new CodexKeepAliveRunner();
  const result = await runner.run('--dangerous-option', process.cwd(), 'codex');
  assert.equal(result.ok, false);
  assert.match(result.error, /Unsafe Codex session ID/);
  runner.dispose();
});

test('isolates a rollout and leaves the original unchanged', (t) => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-warden-isolation-'));
  t.after(() => fs.rmSync(codexHome, { recursive: true, force: true }));
  const sessionId = '11111111-2222-4333-8444-555555555555';
  const day = path.join(codexHome, 'sessions', '2026', '08', '23');
  fs.mkdirSync(day, { recursive: true });
  const rollout = path.join(day, `rollout-${sessionId}.jsonl`);
  const original = `${JSON.stringify({
    type: 'session_meta', payload: { id: sessionId, cwd: process.cwd() },
  })}\n${JSON.stringify({ type: 'turn_context', payload: {} })}\n`;
  fs.writeFileSync(rollout, original);
  fs.writeFileSync(path.join(codexHome, 'auth.json'), '{"token":"test-only"}');

  const isolated = prepareIsolatedCodexHome(sessionId, rollout, codexHome);
  assert.notEqual(isolated.home, codexHome);
  assert.equal(fs.readFileSync(isolated.rolloutPath, 'utf8'), original);
  assert.equal(fs.readFileSync(path.join(isolated.home, 'auth.json'), 'utf8'), '{"token":"test-only"}');
  fs.appendFileSync(isolated.rolloutPath, '{"type":"test-append"}\n');
  assert.equal(fs.readFileSync(rollout, 'utf8'), original);

  const isolatedHome = isolated.home;
  isolated.dispose();
  assert.equal(fs.existsSync(isolatedHome), false);
});

test('rejects rollout paths outside the active Codex home or with mismatched metadata', (t) => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-warden-isolation-home-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-warden-isolation-outside-'));
  t.after(() => {
    fs.rmSync(codexHome, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(codexHome, 'sessions'), { recursive: true });
  const sessionId = 'session-1';
  const outsideRollout = path.join(outside, `rollout-${sessionId}.jsonl`);
  fs.writeFileSync(outsideRollout, `${JSON.stringify({ type: 'session_meta', payload: { id: sessionId } })}\n`);
  assert.throws(
    () => prepareIsolatedCodexHome(sessionId, outsideRollout, codexHome),
    /outside the active sessions directory/
  );

  const mismatch = path.join(codexHome, 'sessions', `rollout-${sessionId}.jsonl`);
  fs.writeFileSync(mismatch, `${JSON.stringify({ type: 'session_meta', payload: { id: 'another-session' } })}\n`);
  assert.throws(() => prepareIsolatedCodexHome(sessionId, mismatch, codexHome), /metadata does not match/);
});

test('builds an ephemeral, read-only Codex resume with external instructions and tools disabled', () => {
  const args = buildCodexKeepAliveArgs('session-1');
  assert.deepEqual(args.slice(0, 4), ['exec', '--sandbox', 'read-only', '--ignore-user-config']);
  assert.equal(args.includes('--ephemeral'), true);
  assert.equal(args.includes('--ignore-rules'), true);
  assert.equal(args.includes('approval_policy="never"'), true);
  assert.equal(args.includes('project_doc_max_bytes=0'), true);
  assert.equal(args.includes('web_search="disabled"'), true);
  assert.equal(args.includes('features.shell_tool=false'), true);
  assert.equal(args.includes('hooks={}'), true);
  assert.equal(args.includes('mcp_servers={}'), true);
  assert.deepEqual(args.slice(-3, -1), ['resume', 'session-1']);
});

test('resolves an installed native Codex executable or the PATH fallback on Windows', { skip: process.platform !== 'win32' }, () => {
  const executable = resolveCodex('');
  assert.match(executable, /codex\.exe$/i);
  if (path.isAbsolute(executable)) {
    assert.equal(fs.existsSync(executable), true);
  } else {
    assert.equal(executable.toLowerCase(), 'codex.exe', 'a clean machine falls back to PATH');
  }
});
