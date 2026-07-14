const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { applyCodexJsonlLine, cleanCodexTitle, emptyCodexSnapshot } = require('../.test-dist/CodexJsonlParser.cjs');

test('parses Codex metadata, lifecycle, title, and cached-token metrics', () => {
  const snapshot = emptyCodexSnapshot();
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'codex-session.jsonl'), 'utf8');
  for (const line of fixture.split(/\r?\n/)) { applyCodexJsonlLine(snapshot, line); }

  assert.equal(snapshot.sessionId, '11111111-2222-4333-8444-555555555555');
  assert.equal(snapshot.cwd, 'N:\\work\\demo');
  assert.equal(snapshot.title, 'Implement the parser tests without changing Claude');
  assert.equal(snapshot.taskActive, false);
  assert.equal(snapshot.lastCompletedMs, Date.parse('2026-07-11T08:00:04.000Z'));
  assert.equal(snapshot.lastUserMessageMs, Date.parse('2026-07-11T08:00:01.000Z'));
  assert.equal(snapshot.inputTokens, 1200);
  assert.equal(snapshot.cachedInputTokens, 900);
});

test('does not treat a CacheWarden ping as real user activity', () => {
  const snapshot = emptyCodexSnapshot();
  applyCodexJsonlLine(snapshot, JSON.stringify({
    timestamp: '2026-07-11T08:00:01.000Z', type: 'event_msg',
    payload: { type: 'user_message', message: '[CACHE_WARDEN_KEEPALIVE]\nmaintenance' },
  }));
  assert.equal(snapshot.lastUserMessageMs, 0);
  assert.equal(snapshot.title, '');
});

test('prefers an explicit session name and ignores system-tag text as a title', () => {
  const snapshot = emptyCodexSnapshot();
  applyCodexJsonlLine(snapshot, JSON.stringify({
    timestamp: '2026-07-11T08:00:00.000Z', type: 'session_meta',
    payload: { id: 'session-2', cwd: 'N:\\work', thread_name: 'Named experiment' },
  }));
  applyCodexJsonlLine(snapshot, JSON.stringify({
    timestamp: '2026-07-11T08:00:01.000Z', type: 'event_msg',
    payload: { type: 'user_message', message: 'A later prompt' },
  }));
  assert.equal(snapshot.title, 'Named experiment');
  assert.equal(cleanCodexTitle('<system-reminder>hidden</system-reminder>'), '');
});

test('truncates long titles to the sidebar limit', () => {
  const title = cleanCodexTitle('x'.repeat(100));
  assert.equal(title.length, 58);
  assert.ok(title.endsWith('…'));
});

test('uses the real request instead of injected IDE context for the title', () => {
  const title = cleanCodexTitle(`# Context from my IDE setup:

## Active file: temp/readon.md

## Open tabs:
- readon.md

## My request for Codex:
Fix the installer naming
`);
  assert.equal(title, 'Fix the installer naming');
});
