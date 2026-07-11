const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { CodexSessionTracker } = require('../.test-dist/CodexSessionTracker.cjs');

test('discovers, incrementally updates, filters, and dismisses Codex sessions', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-warden-codex-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const day = path.join(root, '2026', '07', '11');
  fs.mkdirSync(day, { recursive: true });
  const rollout = path.join(day, 'rollout-test.jsonl');
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'codex-session.jsonl'), 'utf8')
    .replace(/2026-07-11T08:00:0[0-4]\.000Z/g, new Date().toISOString());
  fs.writeFileSync(rollout, fixture);

  const tracker = new CodexSessionTracker(root);
  let states = tracker.getStates(['N:\\work\\demo'], 280);
  assert.equal(states.length, 1);
  assert.equal(states[0].provider, 'codex');
  assert.equal(states[0].trackingOnly, true);
  assert.equal(states[0].chatActive, false);
  assert.equal(states[0].cachedInputTokens, 900);

  fs.appendFileSync(rollout, `${JSON.stringify({
    timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'task_started' },
  })}\n`);
  states = tracker.getStates(['N:\\work\\demo'], 280);
  assert.equal(states[0].chatActive, true);
  assert.equal(tracker.getStates(['N:\\other'], 280).length, 0);

  tracker.dismiss(states[0].id);
  assert.equal(tracker.getStates(['N:\\work\\demo'], 280).length, 0);
});
