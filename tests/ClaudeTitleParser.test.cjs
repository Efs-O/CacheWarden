const assert = require('node:assert/strict');
const test = require('node:test');
const { parseClaudeAiTitle } = require('../.test-dist/ClaudeTitleParser.cjs');

test('prefers the latest generated Claude title for the requested session', () => {
  const transcript = [
    JSON.stringify({ type: 'user', sessionId: 'session-1', message: { content: 'A long initial prompt' } }),
    JSON.stringify({ type: 'ai-title', sessionId: 'session-1', aiTitle: 'Initial generated title' }),
    'malformed json',
    JSON.stringify({ type: 'ai-title', sessionId: 'other', aiTitle: 'Wrong session' }),
    JSON.stringify({ type: 'ai-title', sessionId: 'session-1', aiTitle: 'Review plan and advise' }),
  ].join('\n');
  assert.equal(parseClaudeAiTitle(transcript, 'session-1'), 'Review plan and advise');
});

test('falls back to Claude last-prompt when no generated title exists', () => {
  const transcript = [
    JSON.stringify({ type: 'last-prompt', sessionId: 'session-1', lastPrompt: 'hello' }),
    JSON.stringify({ type: 'last-prompt', sessionId: 'session-1', lastPrompt: 'testing the app - just post something' }),
  ].join('\n');
  assert.equal(parseClaudeAiTitle(transcript, 'session-1'), 'testing the app - just post something');
});
