import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

const HOOK_ID = 'cache-warden-keepalive';

export class HookInstaller {
  private readonly settingsPath: string;
  readonly scriptPath: string;
  readonly stateDir: string;
  readonly sessionsDir: string;
  readonly trashDir: string;
  private readonly instanceId = `${process.pid}-${randomUUID()}`;
  private instanceRegistered = false;

  constructor(private readonly claudeDir = path.join(os.homedir(), '.claude')) {
    this.settingsPath = path.join(claudeDir, 'settings.json');
    this.scriptPath = path.join(claudeDir, `${HOOK_ID}.js`);
    this.stateDir = path.join(claudeDir, 'cache-warden');
    this.sessionsDir = path.join(this.stateDir, 'sessions');
    this.trashDir = path.join(this.stateDir, 'trash');
  }

  registerInstance(): void {
    const instancesDir = path.join(this.stateDir, 'instances');
    fs.mkdirSync(instancesDir, { recursive: true });
    fs.writeFileSync(
      path.join(instancesDir, `${this.instanceId}.json`),
      JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
      'utf8'
    );
    this.instanceRegistered = true;
  }

  releaseInstance(): void {
    if (!this.instanceRegistered) { return; }
    this.instanceRegistered = false;
    const instancesDir = path.join(this.stateDir, 'instances');
    try { fs.rmSync(path.join(instancesDir, `${this.instanceId}.json`), { force: true }); } catch {}
    if (!this.hasLiveInstances(instancesDir)) { this.uninstall(true); }
  }

  install(intervalSeconds: number, maxLoops: number, keepAliveDurationSeconds: number, claudePath = ''): void {
    const settings = this.readSettings();
    const nextSettings = this.withHooks(settings);
    fs.mkdirSync(this.claudeDir, { recursive: true });
    fs.writeFileSync(
      this.scriptPath,
      buildScript(intervalSeconds, maxLoops, keepAliveDurationSeconds, claudePath, this.stateDir),
      'utf8'
    );
    // Legacy single-session state files from <= v0.1.x
    try { fs.rmSync(path.join(this.stateDir, 'gen'), { force: true }); } catch {}
    try { fs.rmSync(path.join(this.stateDir, 'last_ping'), { force: true }); } catch {}
    this.writeSettings(nextSettings);
  }

  uninstall(removeFiles = false): void {
    this.removeHooks();
    this.cancelAllChains();
    if (removeFiles) {
      try { fs.rmSync(this.scriptPath, { force: true }); } catch {}
      try { fs.rmSync(this.stateDir, { recursive: true, force: true }); } catch {}
    }
  }

  isInstalled(): boolean {
    try {
      const s = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
      return s.hooks?.Stop?.some((entry: any) =>
        entry.hooks?.some((hook: any) => String(hook?.command || '').includes(HOOK_ID))
      ) ?? false;
    } catch { return false; }
  }

  resetCounter(): void {
    try {
      for (const sid of fs.readdirSync(this.sessionsDir)) {
        fs.rmSync(path.join(this.sessionsDir, sid, 'last_ping'), { force: true });
      }
    } catch {}
  }

  /** Reset one Claude card and, when armed, begin a new countdown for only that session. */
  resetSession(sid: string, restart: boolean): void {
    try { fs.rmSync(this.sessionFile(sid, 'last_ping'), { force: true }); } catch {}
    if (!restart) { return; }
    try {
      spawn(process.execPath, [this.scriptPath, '--restart', sid], {
        detached: true, stdio: 'ignore', windowsHide: true,
      }).unref();
    } catch {}
  }

  /** Path to a per-session marker, sanitized to match the hook's sdirFor(). */
  private sessionFile(sid: string, name: string): string {
    const safe = safeSessionId(sid);
    if (!safe) { throw new Error('Invalid Claude session ID'); }
    return path.join(this.sessionsDir, safe, name);
  }

  /** Pause/resume a single session without touching the global hook (so other sessions keep going). */
  pauseSession(sid: string): void {
    try {
      const f = this.sessionFile(sid, 'paused');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, String(Date.now()));
    } catch {}
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
    const safe = safeSessionId(sid);
    if (!safe) { return null; }
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
    const safe = safeSessionId(sid);
    if (!safe || !token.startsWith(`${safe}__`) || !/^\d+$/.test(token.slice(safe.length + 2))) { return; }
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

  private withHooks(settings: any): any {
    const s = removeOwnedHooks(settings);
    if (!s.hooks) { s.hooks = {}; }

    if (!s.hooks || typeof s.hooks !== 'object' || Array.isArray(s.hooks)) {
      throw new Error(`Claude settings hooks must contain an object: ${this.settingsPath}`);
    }

    const stopCmd = `${quoteHookArg(process.execPath)} ${quoteHookArg(this.scriptPath)}`;
    const resetCmd = `${stopCmd} --reset`;

    if (s.hooks.Stop !== undefined && !Array.isArray(s.hooks.Stop)) {
      throw new Error(`Claude Stop hooks must contain an array: ${this.settingsPath}`);
    }
    if (!s.hooks.Stop) { s.hooks.Stop = []; }
    s.hooks.Stop.push({ hooks: [{ type: 'command', command: stopCmd }] });

    if (s.hooks.UserPromptSubmit !== undefined && !Array.isArray(s.hooks.UserPromptSubmit)) {
      throw new Error(`Claude UserPromptSubmit hooks must contain an array: ${this.settingsPath}`);
    }
    if (!s.hooks.UserPromptSubmit) { s.hooks.UserPromptSubmit = []; }
    s.hooks.UserPromptSubmit.push({ hooks: [{ type: 'command', command: resetCmd }] });
    return s;
  }

  private removeHooks(): void {
    if (!fs.existsSync(this.settingsPath)) { return; }
    const settings = this.readSettings();
    const next = removeOwnedHooks(settings);
    if (JSON.stringify(next) !== JSON.stringify(settings)) { this.writeSettings(next); }
  }

  private cancelAllChains(): void {
    try {
      for (const sid of fs.readdirSync(this.sessionsDir)) {
        const genPath = path.join(this.sessionsDir, sid, 'gen');
        try { fs.writeFileSync(genPath, `disabled-${Date.now()}`, 'utf8'); } catch {}
      }
    } catch {}
  }

  private readSettings(): any {
    if (!fs.existsSync(this.settingsPath)) { return {}; }
    const parsed = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Claude settings must contain a JSON object: ${this.settingsPath}`);
    }
    return parsed;
  }

  private writeSettings(settings: any): void {
    fs.mkdirSync(this.claudeDir, { recursive: true });
    const tempPath = `${this.settingsPath}.cache-warden-${process.pid}-${Date.now()}.tmp`;
    let mode = 0o600;
    try { mode = fs.statSync(this.settingsPath).mode & 0o777; } catch {}
    try {
      fs.writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', mode });
      fs.renameSync(tempPath, this.settingsPath);
    } finally {
      try { fs.rmSync(tempPath, { force: true }); } catch {}
    }
  }

  private hasLiveInstances(instancesDir: string): boolean {
    let live = false;
    try {
      for (const filename of fs.readdirSync(instancesDir)) {
        const file = path.join(instancesDir, filename);
        try {
          const pid = Number(JSON.parse(fs.readFileSync(file, 'utf8')).pid);
          if (Number.isInteger(pid) && pid > 0 && isProcessAlive(pid)) { live = true; }
          else { fs.rmSync(file, { force: true }); }
        } catch { try { fs.rmSync(file, { force: true }); } catch {} }
      }
    } catch {}
    return live;
  }
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error: any) { return error?.code === 'EPERM'; }
}

function safeSessionId(value: unknown): string {
  const id = String(value || '');
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id) ? id : '';
}

function removeOwnedHooks(settings: any): any {
  const next = JSON.parse(JSON.stringify(settings));
  for (const event of ['Stop', 'UserPromptSubmit'] as const) {
    if (!Array.isArray(next.hooks?.[event])) { continue; }
    next.hooks[event] = next.hooks[event]
      .map((entry: any) => {
        if (!Array.isArray(entry?.hooks)) { return entry; }
        const hooks = entry.hooks.filter((hook: any) => !String(hook?.command || '').includes(HOOK_ID));
        return hooks.length === entry.hooks.length ? entry : { ...entry, hooks };
      })
      .filter((entry: any) => !Array.isArray(entry?.hooks) || entry.hooks.length > 0);
    if (next.hooks[event].length === 0) { delete next.hooks[event]; }
  }
  if (next.hooks && Object.keys(next.hooks).length === 0) { delete next.hooks; }
  return next;
}

function quoteHookArg(value: string): string {
  if (process.platform === 'win32') { return `"${value.replace(/"/g, '""')}"`; }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildScript(
  intervalSeconds: number,
  maxLoops: number,
  keepAliveDurationSeconds: number,
  claudePathOverride: string,
  stateRoot = path.join(os.homedir(), '.claude', 'cache-warden')
): string {
  return `#!/usr/bin/env node
'use strict';
// ${HOOK_ID}
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFileSync } = require('child_process');

const stateDir = ${JSON.stringify(stateRoot)};
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
    const which = isWin ? 'where.exe' : 'which';
    const out = execFileSync(which, [exe], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split(/\\r?\\n/)[0];
    if (out && fs.existsSync(out)) return out;
  } catch {}
  return exe; // last resort: rely on PATH at spawn time
}
const CLAUDE = resolveClaude();
const MAX_LOOPS = ${maxLoops};
const MAX_IDLE_MS = ${Math.max(0, keepAliveDurationSeconds) * 1000};
const intervalOverride = parseInt(process.env.CACHE_WARDEN_INTERVAL_MS || '', 10);
const INTERVAL_MS = Number.isFinite(intervalOverride) && intervalOverride >= 1000 && intervalOverride <= 3600000
  ? intervalOverride : ${intervalSeconds * 1000};
// Inert prompt: a bare "." makes the model resume the interrupted task (it attempted Edits in forks).
const PING_MSG = '[AW_TURN_TYPE: keep-alive]\\nThis is a cache keep-alive maintenance turn.\\nDo not use tools.\\nDo not post to the board.\\nDo not inspect or edit files.\\nDo not emit natural-language prose.\\nIf the CLI requires a reply, emit only the inert marker [AW_KEEPALIVE_OK].';

// Hooks fired inside the headless keepalive session must do nothing.
// The ping runs with disableAllHooks; this env guard is a second layer.
if (process.env.CACHE_WARDEN_PING) process.exit(0);

function logErr(e) { try { fs.mkdirSync(stateDir, { recursive: true }); fs.writeFileSync(path.join(stateDir, 'last_error'), new Date().toISOString() + ' ' + String(e && e.stack || e)); } catch {} }
// State is per session so parallel sessions (e.g. 3 VS Code windows) each keep their own chain.
function safeId(value) { const id = String(value || ''); return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id) ? id : ''; }
function sdirFor(sid) { const safe = safeId(sid); return safe ? path.join(sessionsDir, safe) : ''; }
function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}
function readGen(sdir) { try { return fs.readFileSync(path.join(sdir, 'gen'), 'utf8'); } catch { return ''; } }
function readMeta(sdir) { try { return JSON.parse(fs.readFileSync(path.join(sdir, 'meta'), 'utf8')); } catch { return {}; } }
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
  if (!safeId(forkId)) return '';
  const name = forkId + '.jsonl';
  const root = path.join(os.homedir(), '.claude', 'projects');
  if (projDir && isInside(root, projDir)) {
    const p = path.join(projDir, name);
    if (fs.existsSync(p)) return p;
  }
  try {
    for (const d of fs.readdirSync(root)) {
      const p = path.join(root, d, name);
      if (fs.existsSync(p)) return p;
    }
  } catch {}
  return '';
}

if (process.argv[2] === '--restart') {
  const sessionId = process.argv[3] || '';
  const sdir = sdirFor(sessionId);
  if (!sdir || fs.existsSync(path.join(sdir, 'paused'))) process.exit(0);
  let projDir = '';
  try { projDir = path.dirname(readMeta(sdir).transcriptPath || ''); } catch {}
  const token = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  writeGen(sdir, token);
  spawn(process.execPath, [__filename, '--bg', sessionId, '0', projDir, token, String(Date.now())],
    { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  process.exit(0);
} else if (process.argv[2] === '--bg') {
  const sessionId = process.argv[3];
  const count = parseInt(process.argv[4] || '0', 10);
  const projDir = process.argv[5] || '';
  const token = process.argv[6] || '';
  const idleStartedAt = parseInt(process.argv[7] || '', 10) || Date.now();
  const sdir = sdirFor(sessionId);
  if (!sdir) process.exit(0);

  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, INTERVAL_MS);

  // A newer Stop or a user prompt IN THIS SESSION rotates the token; stale chains die here.
  // Other sessions have their own gen file and no longer interfere.
  if (!token || readGen(sdir) !== token) process.exit(0);
  if (count >= MAX_LOOPS) process.exit(0);
  if (Date.now() - idleStartedAt >= MAX_IDLE_MS) process.exit(0);
  // Paused from the panel: stop this session's chain without affecting any other session.
  if (fs.existsSync(path.join(sdir, 'paused'))) process.exit(0);

  try {
    const workingDir = String(readMeta(sdir).cwd || '');
    if (!path.isAbsolute(workingDir) || !fs.statSync(workingDir).isDirectory()) {
      throw new Error('Claude session working directory is unavailable');
    }
    // NOT --bare: it skips auth ("Not logged in") so no API call happens. disableAllHooks prevents
    // the fork's own Stop/UserPromptSubmit hooks from re-arming loops (env vars don't reach hooks).
    const ka = spawn(CLAUDE, [
      '--safe-mode', '--disable-slash-commands', '--no-chrome', '--strict-mcp-config',
      '--settings', '{"disableAllHooks":true}', '--tools', '', '--resume', sessionId,
      '--fork-session', '--print', PING_MSG, '--output-format', 'json'
    ],
      { cwd: workingDir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
        env: Object.assign({}, process.env, { CACHE_WARDEN_PING: '1' }) });
    ka.stdin.end();
    let out = '';
    let err = '';
    let finished = false;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; try { ka.kill(); } catch {} }, 90000);
    ka.stdout.on('data', (d) => { if (out.length < 1000000) out += d; });
    ka.stderr.on('data', (d) => { if (err.length < 100000) err += d; });
    ka.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      let ok = false;
      try {
        if (timedOut) throw new Error('Claude keep-alive timed out after 90 seconds');
        if (code !== 0) throw new Error('Claude exited with code ' + code + ': ' + err.slice(0, 200));
        const response = JSON.parse(out);
        const forkId = response.session_id;
        if (!safeId(forkId) || forkId === sessionId) throw new Error('Claude did not create a safe throwaway fork');
        const f = findForkFile(projDir, forkId);
        if (!f) throw new Error('Claude throwaway fork could not be located for cleanup');
        fs.rmSync(f, { force: true });
        if (String(response.result || '').trim() !== '[AW_KEEPALIVE_OK]') {
          throw new Error('Claude did not return the expected inert acknowledgement');
        }
        ok = true;
        try { fs.writeFileSync(path.join(sdir, 'last_ping'), JSON.stringify({ t: Date.now(), count: count + 1 })); } catch {}
      } catch (e) {
        logErr('ping failed, exit ' + code + ': ' + String(e && e.stack || e));
      }
      // Chain only after a successful ping (next TTL window starts at ping completion).
      if (ok && count + 1 < MAX_LOOPS && readGen(sdir) === token && !fs.existsSync(path.join(sdir, 'paused'))) {
        spawn(process.execPath, [__filename, '--bg', sessionId, String(count + 1), projDir, token, String(idleStartedAt)],
          { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      }
      process.exit(0);
    });
    ka.on('error', (e) => { if (!finished) { finished = true; clearTimeout(timeout); logErr(e); } process.exit(0); });
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
      if (!sdir) throw new Error('invalid session id');
      writeMeta(sdir, input.cwd, input.transcript_path);
      if (isReset) {
        // User prompt in this session: kill only this session's chain (chat refreshes its own cache).
        writeGen(sdir, 'reset-' + Date.now());
      } else if (!fs.existsSync(path.join(sdir, 'paused'))) {
        const projDir = input.transcript_path ? path.dirname(input.transcript_path) : '';
        const token = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        writeGen(sdir, token);
        pruneSessions();
        spawn(process.execPath, [__filename, '--bg', input.session_id, '0', projDir, token, String(Date.now())],
          { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      }
    } catch (e) { logErr(e); }
    process.exit(0);
  });
  process.stdin.resume();
}
`;
}
