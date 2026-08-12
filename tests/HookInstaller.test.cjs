const assert = require('node:assert/strict');
const test = require('node:test');
const { buildScript } = require('../.test-dist/HookInstaller.cjs');

test('generated Claude hook bounds total idle duration and preserves it across chain restarts', () => {
  const script = buildScript(280, 7, 1800, '');
  assert.match(script, /const MAX_IDLE_MS = 1800000;/);
  assert.match(script, /Date\.now\(\) - idleStartedAt >= MAX_IDLE_MS/);
  assert.match(script, /String\(idleStartedAt\)/);
});

test('generated Claude hook supports a session-scoped reset restart', () => {
  const script = buildScript(280, 7, 1800, '');
  assert.match(script, /process\.argv\[2\] === '--restart'/);
  assert.match(script, /\[__filename, '--bg', sessionId, '0', projDir, token, String\(Date\.now\(\)\)\]/);
});
