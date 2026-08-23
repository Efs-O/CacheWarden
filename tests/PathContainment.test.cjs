const assert = require('node:assert/strict');
const test = require('node:test');
const { pathsAreRelated, pathsShareWorkspace } = require('../.test-dist/PathContainment.cjs');

test('matches Windows workspaces without prefix collisions', () => {
  assert.equal(pathsAreRelated('C:\\work\\repo', 'C:\\work\\repo\\src'), true);
  assert.equal(pathsAreRelated('C:\\work\\repo2', 'C:\\work\\repo'), false);
  assert.equal(pathsAreRelated('c:/WORK/repo/src', 'C:\\work\\repo'), true);
});

test('keeps Unix containment case-sensitive', () => {
  assert.equal(pathsAreRelated('/work/repo', '/work/repo/src'), true);
  assert.equal(pathsAreRelated('/work/Repo', '/work/repo'), false);
  assert.equal(pathsAreRelated('/work/repository', '/work/repo'), false);
});

test('rejects relative and mixed-platform paths', () => {
  assert.equal(pathsAreRelated('../repo', '/work/repo'), false);
  assert.equal(pathsAreRelated('C:\\work\\repo', '/work/repo'), false);
  assert.equal(pathsShareWorkspace('', ['/work/repo']), true);
});
