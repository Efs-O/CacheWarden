const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { readUtf8Tail } = require('../.test-dist/FileTail.cjs');

test('reads only complete lines from a bounded file tail', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-warden-tail-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, 'first line\nsecond line\nthird line\n');
  assert.equal(readUtf8Tail(file, 18), 'third line\n');
  assert.equal(readUtf8Tail(file, 1024), 'first line\nsecond line\nthird line\n');
});
