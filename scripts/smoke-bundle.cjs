const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'vscode') return {};
  return originalLoad.call(this, request, parent, isMain);
};

try {
  const extension = require(path.join(__dirname, '..', 'dist', 'extension.js'));
  assert.equal(typeof extension.activate, 'function', 'bundle must export activate()');
  assert.equal(typeof extension.deactivate, 'function', 'bundle must export deactivate()');
  console.log('Production bundle loaded and exposed activate/deactivate.');
} finally {
  Module._load = originalLoad;
}
