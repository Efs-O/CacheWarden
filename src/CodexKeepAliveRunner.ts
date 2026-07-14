import { execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CODEX_PING_MESSAGE = `[CACHE_WARDEN_KEEPALIVE]
This is an inert cache validation turn.
Do not use tools, read or modify files, access the network, or perform external actions.
Reply with only [CACHE_WARDEN_OK].`;

export interface CodexRunDiagnostics {
  ok: boolean;
  sessionId: string;
  completed: boolean;
  toolCalls: number;
  error: string;
}

export function parseCodexExecJsonl(output: string, expectedSessionId: string): CodexRunDiagnostics {
  let observedSessionId = '';
  let completed = false;
  let toolCalls = 0;
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
        if (event.type === 'item.started' && /tool|command|file_change|mcp/i.test(itemType)) { toolCalls += 1; }
      }
    } catch { /* stderr or a partial final line is reported separately */ }
  }
  const sameSession = observedSessionId === expectedSessionId;
  if (observedSessionId && !sameSession) { error = `Codex resumed unexpected session ${observedSessionId}`; }
  if (!observedSessionId) { error ||= 'Codex did not report a session ID'; }
  if (toolCalls > 0) { error ||= `Codex emitted ${toolCalls} tool call(s)`; }
  return { ok: sameSession && completed && toolCalls === 0 && !error, sessionId: observedSessionId, completed, toolCalls, error };
}

export class CodexKeepAliveRunner {
  private readonly inFlight = new Set<string>();

  async run(sessionId: string, cwd: string, codexPath: string): Promise<CodexRunDiagnostics> {
    if (this.inFlight.has(sessionId)) {
      return { ok: false, sessionId, completed: false, toolCalls: 0, error: 'A Codex ping is already in flight' };
    }
    this.inFlight.add(sessionId);
    try {
      return await this.spawnRun(sessionId, cwd, resolveCodex(codexPath));
    } finally {
      this.inFlight.delete(sessionId);
    }
  }

  private spawnRun(sessionId: string, cwd: string, executable: string): Promise<CodexRunDiagnostics> {
    return new Promise(resolve => {
      const args = [
        'exec', 'resume', '--json', '--skip-git-repo-check',
        '--ignore-user-config', '--ignore-rules', '-c', 'sandbox="read-only"',
        sessionId, CODEX_PING_MESSAGE,
      ];
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (result: CodexRunDiagnostics) => {
        if (settled) { return; }
        settled = true;
        resolve(result);
      };
      let child;
      try {
        child = spawn(executable, args, {
          cwd: cwd || undefined,
          windowsHide: true,
          shell: false,
          env: { ...process.env, CACHE_WARDEN_CODEX_PING: '1' },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        finish({ ok: false, sessionId, completed: false, toolCalls: 0, error: String(error) });
        return;
      }
      const timeout = setTimeout(() => {
        child.kill();
        finish({ ok: false, sessionId, completed: false, toolCalls: 0, error: 'Codex ping timed out after 90 seconds' });
      }, 90_000);
      child.stdout.on('data', chunk => { if (stdout.length < 1_000_000) { stdout += String(chunk); } });
      child.stderr.on('data', chunk => { if (stderr.length < 100_000) { stderr += String(chunk); } });
      child.on('error', error => {
        clearTimeout(timeout);
        finish({ ok: false, sessionId, completed: false, toolCalls: 0, error: String(error) });
      });
      child.on('close', code => {
        clearTimeout(timeout);
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
}

export function resolveCodex(override: string): string {
  if (override) { return override; }
  if (process.platform !== 'win32') { return 'codex'; }
  try {
    const candidates = execFileSync('where.exe', ['codex'], { encoding: 'utf8', windowsHide: true })
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
