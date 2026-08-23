const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { buildScript, HookInstaller } = require('../.test-dist/HookInstaller.cjs');

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

test('generated Claude hook uses bounded, argument-array process discovery and validates fork IDs', () => {
  const script = buildScript(280, 7, 1800, '', '/tmp/cache-warden-state');
  assert.match(script, /execFileSync\(which, \[exe\]/);
  assert.doesNotMatch(script, /execSync\(which \+/);
  assert.match(script, /setTimeout\(\(\) => \{ timedOut = true; try \{ ka\.kill\(\); \} catch \{\} \}, 90000\)/);
  assert.match(script, /Claude did not create a safe throwaway fork/);
  assert.match(script, /Claude throwaway fork could not be located for cleanup/);
  assert.match(script, /Claude did not return the expected inert acknowledgement/);
  assert.ok(
    script.indexOf('fs.rmSync(f, { force: true })') < script.indexOf('Claude did not return the expected inert acknowledgement'),
    'a safe throwaway fork must be removed even when its acknowledgement is rejected'
  );
  assert.match(script, /isInside\(root, projDir\)/);
  assert.match(script, /'--safe-mode', '--disable-slash-commands', '--no-chrome', '--strict-mcp-config'/);
  assert.match(script, /'--settings', '\{"disableAllHooks":true\}', '--tools', ''/);
  assert.match(script, /const stateDir = "\/tmp\/cache-warden-state";/);
  assert.match(script, /const workingDir = String\(readMeta\(sdir\)\.cwd \|\| ''\)/);
  assert.match(script, /\{ cwd: workingDir, stdio: \['pipe', 'pipe', 'pipe'\]/);
  assert.ok(
    script.indexOf("if (code !== 0) throw new Error('Claude exited with code '") < script.indexOf('const response = JSON.parse(out)'),
    'CLI failures must report stderr before parsing possibly empty stdout'
  );
});

test('generated Claude hook is valid JavaScript and handles reset payloads without spawning a ping', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-warden-hook-script-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stateRoot = path.join(root, 'state');
  const scriptPath = path.join(root, 'cache-warden-keepalive.js');
  fs.writeFileSync(scriptPath, buildScript(30, 2, 120, process.execPath, stateRoot));

  const syntax = spawnSync(process.execPath, ['--check', scriptPath], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);

  const sessionId = '11111111-2222-4333-8444-555555555555';
  const payload = JSON.stringify({
    session_id: sessionId,
    cwd: root,
    transcript_path: path.join(root, `${sessionId}.jsonl`),
  });
  const reset = spawnSync(process.execPath, [scriptPath, '--reset'], {
    input: payload, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(reset.status, 0, reset.stderr);
  const sessionDir = path.join(stateRoot, 'sessions', sessionId);
  assert.match(fs.readFileSync(path.join(sessionDir, 'gen'), 'utf8'), /^reset-/);
  const meta = JSON.parse(fs.readFileSync(path.join(sessionDir, 'meta'), 'utf8'));
  assert.equal(meta.cwd, root);
  assert.equal(meta.transcriptPath, path.join(root, `${sessionId}.jsonl`));
});

test('install upgrades only CacheWarden hooks and uninstall preserves unrelated hook entries', (t) => {
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-warden-hook-'));
  t.after(() => fs.rmSync(claudeDir, { recursive: true, force: true }));
  const settingsPath = path.join(claudeDir, 'settings.json');
  const unrelated = { type: 'command', command: 'node unrelated.js' };
  fs.writeFileSync(settingsPath, JSON.stringify({
    theme: 'dark',
    hooks: {
      Stop: [{ matcher: 'all', hooks: [
        unrelated,
        { type: 'command', command: 'node old-cache-warden-keepalive.js' },
      ] }],
      Notification: [{ hooks: [{ type: 'command', command: 'notify-me' }] }],
    },
  }));

  const installer = new HookInstaller(claudeDir);
  if (process.platform !== 'win32') { fs.chmodSync(settingsPath, 0o600); }
  installer.install(280, 7, 1800, '');
  let settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.hooks.Stop.flatMap(entry => entry.hooks).filter(hook => hook.command.includes('cache-warden-keepalive')).length, 1);
  assert.equal(settings.hooks.Stop.flatMap(entry => entry.hooks).some(hook => hook.command === unrelated.command), true);
  assert.equal(settings.hooks.Notification[0].hooks[0].command, 'notify-me');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(settingsPath).mode & 0o777, 0o600, 'settings permissions are preserved');
  }

  const sessionDir = path.join(installer.sessionsDir, 'session-1');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, 'gen'), 'g-active');
  installer.uninstall();
  settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.equal(JSON.stringify(settings).includes('cache-warden-keepalive'), false);
  assert.equal(settings.hooks.Stop[0].hooks[0].command, unrelated.command);
  assert.match(fs.readFileSync(path.join(sessionDir, 'gen'), 'utf8'), /^disabled-/);

  installer.pauseSession('..');
  assert.equal(fs.existsSync(path.join(installer.stateDir, 'paused')), false);
  assert.equal(installer.removeSession('../outside'), null);
});

test('malformed Claude settings are never overwritten', (t) => {
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-warden-hook-invalid-'));
  t.after(() => fs.rmSync(claudeDir, { recursive: true, force: true }));
  const settingsPath = path.join(claudeDir, 'settings.json');
  fs.writeFileSync(settingsPath, '{ invalid json');
  const installer = new HookInstaller(claudeDir);
  assert.throws(() => installer.install(280, 7, 1800, ''));
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{ invalid json');
  assert.equal(fs.existsSync(installer.scriptPath), false);
});

test('last-instance release cleans up CacheWarden files without removing unrelated hooks', (t) => {
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-warden-hook-instances-'));
  t.after(() => fs.rmSync(claudeDir, { recursive: true, force: true }));
  const settingsPath = path.join(claudeDir, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({ hooks: {
    Stop: [{ hooks: [{ type: 'command', command: 'node unrelated.js' }] }],
  } }));

  const first = new HookInstaller(claudeDir);
  const second = new HookInstaller(claudeDir);
  first.registerInstance();
  second.registerInstance();
  first.install(280, 7, 1800, '');
  first.releaseInstance();
  assert.equal(fs.existsSync(first.scriptPath), true, 'another live extension instance keeps the shared hook alive');

  second.releaseInstance();
  assert.equal(fs.existsSync(first.scriptPath), false);
  assert.equal(fs.existsSync(first.stateDir), false);
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.equal(settings.hooks.Stop[0].hooks[0].command, 'node unrelated.js');
});
