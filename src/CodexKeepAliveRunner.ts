import { execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CODEX_PING_MESSAGE = `[CACHE_WARDEN_KEEPALIVE]
This is an inert cache validation turn.
Do not use tools, read or modify files, access the network, or perform external actions.
Reply with only [CACHE_WARDEN_OK].`;

export function buildCodexKeepAliveArgs(sessionId: string): string[] {
  return [
    'exec', '--sandbox', 'read-only', '--ignore-user-config', '--ignore-rules',
    '--ephemeral', '--json', '--skip-git-repo-check',
    '-c', 'approval_policy="never"',
    '-c', 'project_doc_max_bytes=0',
    '-c', 'project_doc_fallback_filenames=[]',
    '-c', 'web_search="disabled"',
    '-c', 'features.shell_tool=false',
    '-c', 'agents.enabled=false',
    '-c', 'hooks={}',
    '-c', 'mcp_servers={}',
    'resume', sessionId, CODEX_PING_MESSAGE,
  ];
}

export interface CodexRunDiagnostics {
  ok: boolean;
  sessionId: string;
  completed: boolean;
  toolCalls: number;
  error: string;
}

export interface IsolatedCodexHome {
  home: string;
  rolloutPath: string;
  dispose(): void;
}

export function isSafeSessionId(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
}

/** Codex refuses concurrent resumes of the same thread. It is safe to retry once its writer exits. */
export function isCodexThreadWriterConflict(error: string): boolean {
  return /thread-store conflict|already has an active writer/i.test(error);
}

export function parseCodexExecJsonl(output: string, expectedSessionId: string): CodexRunDiagnostics {
  let observedSessionId = '';
  let completed = false;
  const toolCallKeys = new Set<string>();
  let agentMessage = '';
  let error = '';
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) { continue; }
    try {
      const event = JSON.parse(line);
      if (event.type === 'thread.started') { observedSessionId = String(event.thread_id || ''); }
      if (event.type === 'turn.completed') { completed = true; }
      if (event.type === 'turn.failed' || event.type === 'error') {
        error = String(event.error?.message || event.message || event.type);
      }
      if (event.type === 'item.started' || event.type === 'item.completed') {
        const itemType = String(event.item?.type || '');
        if (/tool|command|file_change|mcp/i.test(itemType)) {
          toolCallKeys.add(String(event.item?.id || itemType));
        }
        if (event.type === 'item.completed' && itemType === 'agent_message') {
          agentMessage = String(event.item?.text || '').trim();
        }
      }
    } catch { /* stderr or a partial final line is reported separately */ }
  }
  const sameSession = observedSessionId === expectedSessionId;
  const toolCalls = toolCallKeys.size;
  if (observedSessionId && !sameSession) { error = `Codex resumed unexpected session ${observedSessionId}`; }
  if (!observedSessionId) { error ||= 'Codex did not report a session ID'; }
  if (toolCalls > 0) { error ||= `Codex emitted ${toolCalls} tool call(s)`; }
  if (completed && agentMessage !== '[CACHE_WARDEN_OK]') {
    error ||= 'Codex did not return the expected inert acknowledgement';
  }
  return { ok: sameSession && completed && toolCalls === 0 && !error, sessionId: observedSessionId, completed, toolCalls, error };
}

export class CodexKeepAliveRunner {
  private readonly inFlight = new Set<string>();
  private readonly children = new Map<string, ReturnType<typeof spawn>>();
  private disposed = false;

  async run(sessionId: string, cwd: string, codexPath: string, rolloutPath: string): Promise<CodexRunDiagnostics> {
    if (this.disposed) {
      return { ok: false, sessionId, completed: false, toolCalls: 0, error: 'Codex runner is disposed' };
    }
    if (!isSafeSessionId(sessionId)) {
      return { ok: false, sessionId, completed: false, toolCalls: 0, error: 'Unsafe Codex session ID' };
    }
    if (!rolloutPath) {
      return { ok: false, sessionId, completed: false, toolCalls: 0, error: 'Codex rollout path is unavailable' };
    }
    if (this.inFlight.has(sessionId)) {
      return { ok: false, sessionId, completed: false, toolCalls: 0, error: 'A Codex ping is already in flight' };
    }
    this.inFlight.add(sessionId);
    let isolated: IsolatedCodexHome | undefined;
    try {
      isolated = prepareIsolatedCodexHome(sessionId, rolloutPath);
      return await this.spawnRun(sessionId, cwd, resolveCodex(codexPath), isolated.home);
    } catch (error) {
      return { ok: false, sessionId, completed: false, toolCalls: 0, error: String(error) };
    } finally {
      isolated?.dispose();
      this.inFlight.delete(sessionId);
    }
  }

  private spawnRun(sessionId: string, cwd: string, executable: string, isolatedHome: string): Promise<CodexRunDiagnostics> {
    return new Promise(resolve => {
      const args = buildCodexKeepAliveArgs(sessionId);
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timedOut = false;
      const finish = (result: CodexRunDiagnostics) => {
        if (settled) { return; }
        settled = true;
        this.children.delete(sessionId);
        resolve(result);
      };
      let child;
      try {
        child = spawn(executable, args, {
          cwd: cwd || undefined,
          windowsHide: true,
          shell: false,
          env: { ...process.env, CODEX_HOME: isolatedHome, CACHE_WARDEN_CODEX_PING: '1' },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        this.children.set(sessionId, child);
      } catch (error) {
        finish({ ok: false, sessionId, completed: false, toolCalls: 0, error: String(error) });
        return;
      }
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, 90_000);
      child.stdout.on('data', chunk => { if (stdout.length < 1_000_000) { stdout += String(chunk); } });
      child.stderr.on('data', chunk => { if (stderr.length < 100_000) { stderr += String(chunk); } });
      child.on('error', error => {
        clearTimeout(timeout);
        finish({ ok: false, sessionId, completed: false, toolCalls: 0, error: String(error) });
      });
      child.on('close', code => {
        clearTimeout(timeout);
        if (timedOut) {
          finish({ ok: false, sessionId, completed: false, toolCalls: 0, error: 'Codex ping timed out after 90 seconds' });
          return;
        }
        const result = parseCodexExecJsonl(stdout, sessionId);
        if (code !== 0) {
          result.ok = false;
          const detail = stderr.trim() || `Codex exited with code ${code}`;
          result.error = result.error ? `${result.error}: ${detail}` : detail;
        }
        finish(result);
      });
    });
  }

  dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true;
    for (const child of this.children.values()) {
      try { child.kill(); } catch {}
    }
    this.children.clear();
  }
}

export function prepareIsolatedCodexHome(
  sessionId: string,
  rolloutPath: string,
  codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
): IsolatedCodexHome {
  if (!isSafeSessionId(sessionId)) { throw new Error('Unsafe Codex session ID'); }

  const sessionsRoot = fs.realpathSync(path.join(codexHome, 'sessions'));
  const source = fs.realpathSync(rolloutPath);
  const relativeRollout = path.relative(sessionsRoot, source);
  if (!relativeRollout || relativeRollout.startsWith(`..${path.sep}`) || relativeRollout === '..' || path.isAbsolute(relativeRollout)) {
    throw new Error('Codex rollout is outside the active sessions directory');
  }
  if (!path.basename(source).includes(sessionId)) {
    throw new Error('Codex rollout filename does not match the requested session');
  }
  if (readSessionMetaId(source) !== sessionId) {
    throw new Error('Codex rollout metadata does not match the requested session');
  }

  const before = fs.statSync(source);
  if (!before.isFile()) { throw new Error('Codex rollout is not a regular file'); }

  let isolatedHome = '';
  try {
    isolatedHome = fs.mkdtempSync(path.join(codexHome, '.cache-warden-run-'));
    try { fs.chmodSync(isolatedHome, 0o700); } catch {}
    const isolatedRollout = path.join(isolatedHome, 'sessions', relativeRollout);
    fs.mkdirSync(path.dirname(isolatedRollout), { recursive: true, mode: 0o700 });
    fs.copyFileSync(source, isolatedRollout, fs.constants.COPYFILE_EXCL);
    try { fs.chmodSync(isolatedRollout, 0o600); } catch {}

    const after = fs.statSync(source);
    const copied = fs.statSync(isolatedRollout);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || copied.size !== before.size) {
      throw new Error('Codex rollout changed while its isolated copy was prepared');
    }

    const authSource = path.join(codexHome, 'auth.json');
    if (fs.existsSync(authSource)) {
      fs.linkSync(authSource, path.join(isolatedHome, 'auth.json'));
    }

    let disposed = false;
    return {
      home: isolatedHome,
      rolloutPath: isolatedRollout,
      dispose: () => {
        if (disposed) { return; }
        disposed = true;
        fs.rmSync(isolatedHome, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (isolatedHome) { fs.rmSync(isolatedHome, { recursive: true, force: true }); }
    throw error;
  }
}

function readSessionMetaId(file: string): string {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
    for (const line of buffer.subarray(0, length).toString('utf8').split(/\r?\n/)) {
      if (!line.trim()) { continue; }
      try {
        const event = JSON.parse(line);
        if (event.type === 'session_meta') { return String(event.payload?.id || ''); }
      } catch {}
    }
    return '';
  } finally {
    fs.closeSync(fd);
  }
}

export function resolveCodex(override: string): string {
  if (override) { return override; }
  if (process.platform !== 'win32') { return 'codex'; }
  try {
    const candidates = execFileSync('where.exe', ['codex'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const native = candidates.find(candidate => candidate.toLowerCase().endsWith('.exe') && fs.existsSync(candidate));
    if (native) { return native; }
  } catch {}

  // VS Code's extension host often inherits a narrower PATH than the terminal.
  // Resolve the native binary shipped by the npm package or Codex extension
  // rather than trying to execute the Windows .cmd shim without a shell.
  const appData = process.env.APPDATA;
  if (appData) {
    const npmPackageRoot = path.join(appData, 'npm', 'node_modules', '@openai', 'codex', 'node_modules');
    const npmBinary = findNestedCodexExe(npmPackageRoot, 5);
    if (npmBinary) { return npmBinary; }
  }

  const home = os.homedir();
  for (const extensionsRoot of [path.join(home, '.vscode', 'extensions'), path.join(home, '.vscode-insiders', 'extensions')]) {
    const extensionBinary = findCodexExtensionExe(extensionsRoot);
    if (extensionBinary) { return extensionBinary; }
  }
  return 'codex.exe';
}

function findCodexExtensionExe(extensionsRoot: string): string | undefined {
  let versions: string[] = [];
  try {
    versions = fs.readdirSync(extensionsRoot)
      .filter(name => name.toLowerCase().startsWith('openai.chatgpt-'))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  } catch { return undefined; }
  for (const version of versions) {
    const binary = findNestedCodexExe(path.join(extensionsRoot, version, 'bin'), 3);
    if (binary) { return binary; }
  }
  return undefined;
}

function findNestedCodexExe(root: string, maxDepth: number): string | undefined {
  const visit = (dir: string, depth: number): string | undefined => {
    if (depth > maxDepth) { return undefined; }
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return undefined; }
    const direct = entries.find(entry => entry.isFile() && entry.name.toLowerCase() === 'codex.exe');
    if (direct) { return path.join(dir, direct.name); }
    for (const entry of entries) {
      if (!entry.isDirectory()) { continue; }
      const found = visit(path.join(dir, entry.name), depth + 1);
      if (found) { return found; }
    }
    return undefined;
  };
  return visit(root, 0);
}
