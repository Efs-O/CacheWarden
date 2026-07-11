import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const HOOK_ID = 'cache-warden-keepalive';

export class HookInstaller {
  private readonly claudeDir = path.join(os.homedir(), '.claude');
  private readonly settingsPath = path.join(this.claudeDir, 'settings.json');
  readonly scriptPath = path.join(this.claudeDir, `${HOOK_ID}.js`);
  readonly stateDir = path.join(this.claudeDir, 'cache-warden');
  readonly sessionsDir = path.join(this.stateDir, 'sessions');
  readonly trashDir = path.join(this.stateDir, 'trash');

  install(intervalSeconds: number, maxLoops: number, claudePath = ''): void {
    fs.mkdirSync(this.claudeDir, { recursive: true });
    fs.writeFileSync(this.scriptPath, buildScript(intervalSeconds, maxLoops, claudePath), 'utf8');
    // Legacy single-session state files from <= v0.1.x
    try { fs.rmSync(path.join(this.stateDir, 'gen'), { force: true }); } catch {}
    try { fs.rmSync(path.join(this.stateDir, 'last_ping'), { force: true }); } catch {}
    this.upsertHooks();
  }

  uninstall(): void {
    this.removeHooks();
  }

  isInstalled(): boolean {
    try {
      const s = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
      return s.hooks?.Stop?.some((e: any) => e.hooks?.[0]?.command?.includes(HOOK_ID)) ?? false;
    } catch { return false; }
  }

  resetCounter(): void {
    try {
      for (const sid of fs.readdirSync(this.sessionsDir)) {
        fs.rmSync(path.join(this.sessionsDir, sid, 'last_ping'), { force: true });
      }
    } catch {}
  }

  /** Path to a per-session marker, sanitized to match the hook's sdirFor(). */
  private sessionFile(sid: string, name: string): string {
    const safe = String(sid).replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(this.sessionsDir, safe, name);
  }

  /** Pause/resume a single session without touching the global hook (so other sessions keep going). */
  pauseSession(sid: string): void {
    const f = this.sessionFile(sid, 'paused');
    try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, String(Date.now())); } catch {}
  }

  resumeSession(sid: string): void {
    try { fs.rmSync(this.sessionFile(sid, 'paused'), { force: true }); } catch {}
  }

  isSessionPaused(sid: string): boolean {
    try { return fs.existsSync(this.sessionFile(sid, 'paused')); } catch { return false; }
  }

  /**
   * Forget a session: move its state dir into `trash/` (so the card disappears and
   * any in-flight chain dies once its `gen` token no longer resolves). Returns a
   * trash token for restoreSession(), or null if there was nothing to remove.
   * A session that is still a live chat reappears on its next turn regardless.
   * Trash sits beside sessions/ so getStates() and the hook's pruner never scan it.
   */
  removeSession(sid: string): string | null {
    const safe = String(sid).replace(/[^a-zA-Z0-9._-]/g, '_');
    const src = path.join(this.sessionsDir, safe);
    try {
      if (!fs.existsSync(src)) { return null; }
      fs.mkdirSync(this.trashDir, { recursive: true });
      this.purgeTrash();
      const token = `${safe}__${Date.now()}`;
      fs.renameSync(src, path.join(this.trashDir, token));
      return token;
    } catch { return null; }
  }

  /** Undo a removeSession(): move the trashed dir back to its session slot. */
  restoreSession(sid: string, token: string): void {
    const safe = String(sid).replace(/[^a-zA-Z0-9._-]/g, '_');
    const src = path.join(this.trashDir, token);
    const dst = path.join(this.sessionsDir, safe);
    try { if (fs.existsSync(src)) { fs.renameSync(src, dst); } } catch {}
  }

  /** Drop trashed sessions older than the undo window so trash can't accumulate. */
  private purgeTrash(): void {
    const cutoff = Date.now() - 60 * 60 * 1000;
    try {
      for (const d of fs.readdirSync(this.trashDir)) {
        const ts = Number(d.split('__').pop());
        if (!Number.isFinite(ts) || ts < cutoff) {
          try { fs.rmSync(path.join(this.trashDir, d), { recursive: true, force: true }); } catch {}
        }
      }
    } catch {}
  }

  private upsertHooks(): void {
    let s: any = {};
    try { s = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8')); } catch {}

    if (!s.hooks) { s.hooks = {}; }

    const stopCmd = `node "${this.scriptPath}"`;
    const resetCmd = `node "${this.scriptPath}" --reset`;

    if (!s.hooks.Stop) { s.hooks.Stop = []; }
    s.hooks.Stop = s.hooks.Stop.filter((e: any) => !e.hooks?.[0]?.command?.includes(HOOK_ID));
    s.hooks.Stop.push({ hooks: [{ type: 'command', command: stopCmd }] });

    if (!s.hooks.UserPromptSubmit) { s.hooks.UserPromptSubmit = []; }
    s.hooks.UserPromptSubmit = s.hooks.UserPromptSubmit.filter((e: any) => !e.hooks?.[0]?.command?.includes(HOOK_ID));
    s.hooks.UserPromptSubmit.push({ hooks: [{ type: 'command', command: resetCmd }] });

    fs.writeFileSync(this.settingsPath, JSON.stringify(s, null, 2), 'utf8');
  }

  private removeHooks(): void {
    let s: any = {};
    try { s = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8')); } catch { return; }

    for (const event of ['Stop', 'UserPromptSubmit'] as const) {
      if (s.hooks?.[event]) {
        s.hooks[event] = s.hooks[event].filter((e: any) => !e.hooks?.[0]?.command?.includes(HOOK_ID));
        if (s.hooks[event].length === 0) { delete s.hooks[event]; }
      }
    }
    if (s.hooks && Object.keys(s.hooks).length === 0) { delete s.hooks; }

    fs.writeFileSync(this.settingsPath, JSON.stringify(s, null, 2), 'utf8');
  }
}

function buildScript(intervalSeconds: number, maxLoops: number, claudePathOverride: string): string {
  const stateDir = path.join(os.homedir(), '.claude', 'cache-warden').replace(/\\/g, '\\\\');
  return `#!/usr/bin/env node
'use strict';
// ${HOOK_ID}
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');

const stateDir = '${stateDir}';
const sessionsDir = path.join(stateDir, 'sessions');

// Resolve the Claude Code binary at runtime so this works on any machine (no hardcoded user path).
// We point at the package's native .exe directly: Node >= 18.20 throws EINVAL spawning .cmd without shell.
const CLAUDE_OVERRIDE = ${JSON.stringify(claudePathOverride || '')};
function resolveClaude() {
  const isWin = process.platform === 'win32';
  const exe = isWin ? 'claude.exe' : 'claude';
  const tries = [];
  if (CLAUDE_OVERRIDE) tries.push(CLAUDE_OVERRIDE);
  if (process.env.CACHE_WARDEN_CLAUDE) tries.push(process.env.CACHE_WARDEN_CLAUDE);
  const roots = [];
  if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'npm'));
  if (process.env.PREFIX) roots.push(process.env.PREFIX);
  roots.push(path.join(os.homedir(), '.npm-global'));
  roots.push('/usr/local', '/usr');
  for (const r of roots) tries.push(path.join(r, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', exe));
  tries.push(path.join(os.homedir(), '.claude', 'local', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', exe));
  tries.push(path.join(os.homedir(), '.claude', 'local', exe));
  for (const t of tries) { try { if (t && fs.existsSync(t)) return t; } catch {} }
  try {
    const which = isWin ? 'where' : 'which';
    const out = execSync(which + ' ' + exe, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split(/\\r?\\n/)[0];
    if (out && fs.existsSync(out)) return out;
  } catch {}
  return exe; // last resort: rely on PATH at spawn time
}
const CLAUDE = resolveClaude();
const MAX_LOOPS = ${maxLoops};
const INTERVAL_MS = parseInt(process.env.CACHE_WARDEN_INTERVAL_MS || '', 10) || ${intervalSeconds * 1000};
// Inert prompt: a bare "." makes the model resume the interrupted task (it attempted Edits in forks).
const PING_MSG = '[AW_TURN_TYPE: keep-alive]\\nThis is a cache keep-alive maintenance turn.\\nDo not use tools.\\nDo not post to the board.\\nDo not inspect or edit files.\\nDo not emit natural-language prose.\\nIf the CLI requires a reply, emit only the inert marker [AW_KEEPALIVE_OK].';

// Hooks fired inside the headless keepalive session must do nothing.
// The ping runs with disableAllHooks; this env guard is a second layer.
if (process.env.CACHE_WARDEN_PING) process.exit(0);

function logErr(e) { try { fs.mkdirSync(stateDir, { recursive: true }); fs.writeFileSync(path.join(stateDir, 'last_error'), new Date().toISOString() + ' ' + String(e && e.stack || e)); } catch {} }
// State is per session so parallel sessions (e.g. 3 VS Code windows) each keep their own chain.
function sdirFor(sid) { return path.join(sessionsDir, String(sid).replace(/[^a-zA-Z0-9._-]/g, '_')); }
function readGen(sdir) { try { return fs.readFileSync(path.join(sdir, 'gen'), 'utf8'); } catch { return ''; } }
function writeGen(sdir, t) { try { fs.mkdirSync(sdir, { recursive: true }); fs.writeFileSync(path.join(sdir, 'gen'), t); } catch {} }
function writeMeta(sdir, cwd, transcriptPath) { try { fs.mkdirSync(sdir, { recursive: true }); fs.writeFileSync(path.join(sdir, 'meta'), JSON.stringify({ cwd: cwd || '', transcriptPath: transcriptPath || '', t: Date.now() })); } catch {} }
function pruneSessions() {
  try {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    for (const d of fs.readdirSync(sessionsDir)) {
      const p = path.join(sessionsDir, d);
      let mtime = 0;
      try { mtime = fs.statSync(path.join(p, 'gen')).mtimeMs; } catch {}
      if (mtime < cutoff) { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} }
    }
  } catch {}
}

// projDir from the hook payload can be empty; fall back to scanning all project dirs.
function findForkFile(projDir, forkId) {
  const name = forkId + '.jsonl';
  if (projDir) {
    const p = path.join(projDir, name);
    if (fs.existsSync(p)) return p;
  }
  const root = path.join(os.homedir(), '.claude', 'projects');
  try {
    for (const d of fs.readdirSync(root)) {
      const p = path.join(root, d, name);
      if (fs.existsSync(p)) return p;
    }
  } catch {}
  return '';
}

if (process.argv[2] === '--bg') {
  const sessionId = process.argv[3];
  const count = parseInt(process.argv[4] || '0', 10);
  const projDir = process.argv[5] || '';
  const token = process.argv[6] || '';
  const sdir = sdirFor(sessionId);

  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, INTERVAL_MS);

  // A newer Stop or a user prompt IN THIS SESSION rotates the token; stale chains die here.
  // Other sessions have their own gen file and no longer interfere.
  if (!token || readGen(sdir) !== token) process.exit(0);
  if (count >= MAX_LOOPS) process.exit(0);
  // Paused from the panel: stop this session's chain without affecting any other session.
  if (fs.existsSync(path.join(sdir, 'paused'))) process.exit(0);

  try {
    // NOT --bare: it skips auth ("Not logged in") so no API call happens. disableAllHooks prevents
    // the fork's own Stop/UserPromptSubmit hooks from re-arming loops (env vars don't reach hooks).
    const ka = spawn(CLAUDE, ['--settings', '{"disableAllHooks":true}', '--tools', '', '--resume', sessionId, '--fork-session', '--print', PING_MSG, '--output-format', 'json'],
      { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
        env: Object.assign({}, process.env, { CACHE_WARDEN_PING: '1' }) });
    ka.stdin.end();
    let out = '';
    ka.stdout.on('data', (d) => { out += d; });
    ka.on('close', (code) => {
      let ok = false;
      try {
        const forkId = JSON.parse(out).session_id;
        ok = true;
        if (forkId && forkId !== sessionId) {
          const f = findForkFile(projDir, forkId);
          if (f) fs.rmSync(f, { force: true });
        }
        try { fs.writeFileSync(path.join(sdir, 'last_ping'), JSON.stringify({ t: Date.now(), count: count + 1 })); } catch {}
      } catch (e) {
        logErr('ping failed, exit ' + code + ', out: ' + String(out).slice(0, 200));
      }
      // Chain only after a successful ping (next TTL window starts at ping completion).
      if (ok && count + 1 < MAX_LOOPS && readGen(sdir) === token && !fs.existsSync(path.join(sdir, 'paused'))) {
        spawn(process.execPath, [__filename, '--bg', sessionId, String(count + 1), projDir, token],
          { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      }
      process.exit(0);
    });
    ka.on('error', (e) => { logErr(e); process.exit(0); });
  } catch (e) {
    logErr(e);
    process.exit(0);
  }
} else {
  const isReset = process.argv.includes('--reset');
  let stdinData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { stdinData += d; });
  process.stdin.on('end', () => {
    try {
      const input = JSON.parse(stdinData);
      const sdir = sdirFor(input.session_id);
      writeMeta(sdir, input.cwd, input.transcript_path);
      if (isReset) {
        // User prompt in this session: kill only this session's chain (chat refreshes its own cache).
        writeGen(sdir, 'reset-' + Date.now());
      } else if (!fs.existsSync(path.join(sdir, 'paused'))) {
        const projDir = input.transcript_path ? path.dirname(input.transcript_path) : '';
        const token = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        writeGen(sdir, token);
        pruneSessions();
        spawn(process.execPath, [__filename, '--bg', input.session_id, '0', projDir, token],
          { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      }
    } catch (e) { logErr(e); }
    process.exit(0);
  });
  process.stdin.resume();
}
`;
}
