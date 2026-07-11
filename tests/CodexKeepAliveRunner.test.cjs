const assert = require('node:assert/strict');
const test = require('node:test');
const { parseCodexExecJsonl } = require('../.test-dist/CodexKeepAliveRunner.cjs');

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
