import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyCodexJsonlLine, CodexSessionSnapshot, emptyCodexSnapshot } from './CodexJsonlParser';
import { SessionState } from './types';

interface TrackedFile {
  offset: number;
  remainder: string;
  snapshot: CodexSessionSnapshot;
}

export class CodexSessionTracker {
  private readonly files = new Map<string, TrackedFile>();
  private readonly dismissed = new Set<string>();
  private lastDiscoveryMs = 0;

  constructor(private readonly sessionsRoot = path.join(os.homedir(), '.codex', 'sessions')) {}

  getStates(workspaceFolders: string[], ttlSeconds: number): SessionState[] {
    this.refresh();
    const now = Date.now();
    const byId = new Map<string, CodexSessionSnapshot>();
    for (const tracked of this.files.values()) {
      const snapshot = tracked.snapshot;
      if (!snapshot.sessionId || this.dismissed.has(snapshot.sessionId)) { continue; }
      if (snapshot.lastEventMs && now - snapshot.lastEventMs > 2 * 3600_000) { continue; }
      if (!matchesWorkspace(snapshot.cwd, workspaceFolders)) { continue; }
      const previous = byId.get(snapshot.sessionId);
      if (!previous || snapshot.lastEventMs > previous.lastEventMs) { byId.set(snapshot.sessionId, snapshot); }
    }

    return [...byId.values()].map(snapshot => ({
      id: `codex:${snapshot.sessionId}`,
      provider: 'codex',
      label: snapshot.title || `Codex · ${snapshot.sessionId.slice(0, 8)}`,
      armed: false,
      trackingOnly: true,
      keepAliveStreak: 0,
      keepAliveMaxPings: 0,
      secondsRemaining: ttlSeconds,
      ttlSeconds,
      pingsSentTotal: 0,
      chatActive: snapshot.taskActive,
      cachedInputTokens: snapshot.cachedInputTokens,
      inputTokens: snapshot.inputTokens,
    }));
  }

  dismiss(id: string): void {
    this.dismissed.add(id.replace(/^codex:/, ''));
  }

  private refresh(): void {
    const now = Date.now();
    if (now - this.lastDiscoveryMs > 5000) {
      this.lastDiscoveryMs = now;
      for (const file of discoverRecentJsonl(this.sessionsRoot, now - 2 * 3600_000)) {
        if (!this.files.has(file)) {
          this.files.set(file, { offset: 0, remainder: '', snapshot: emptyCodexSnapshot() });
        }
      }
    }
    for (const [file, tracked] of this.files) { this.readAppended(file, tracked); }
  }

  private readAppended(file: string, tracked: TrackedFile): void {
    let size = 0;
    try { size = fs.statSync(file).size; } catch { this.files.delete(file); return; }
    if (size < tracked.offset) {
      tracked.offset = 0;
      tracked.remainder = '';
      tracked.snapshot = emptyCodexSnapshot();
    }
    if (size === tracked.offset) { return; }
    const length = size - tracked.offset;
    const buffer = Buffer.alloc(length);
    let fd: number | undefined;
    try {
      fd = fs.openSync(file, 'r');
      fs.readSync(fd, buffer, 0, length, tracked.offset);
      tracked.offset = size;
    } catch { return; }
    finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch {} } }

    const parts = (tracked.remainder + buffer.toString('utf8')).split(/\r?\n/);
    tracked.remainder = parts.pop() || '';
    for (const line of parts) { applyCodexJsonlLine(tracked.snapshot, line); }
  }
}

function discoverRecentJsonl(root: string, cutoffMs: number): string[] {
  const found: Array<{ file: string; mtimeMs: number }> = [];
  const visit = (dir: string, depth: number) => {
    if (depth > 5) { return; }
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { visit(full, depth + 1); }
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try {
          const mtimeMs = fs.statSync(full).mtimeMs;
          if (mtimeMs >= cutoffMs) { found.push({ file: full, mtimeMs }); }
        } catch {}
      }
    }
  };
  visit(root, 0);
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 30).map(item => item.file);
}

function matchesWorkspace(cwd: string, folders: string[]): boolean {
  if (!cwd || folders.length === 0) { return true; }
  const norm = (value: string) => value.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const candidate = norm(cwd);
  return folders.some(folder => {
    const workspace = norm(folder);
    return candidate === workspace || candidate.startsWith(`${workspace}\\`) || workspace.startsWith(`${candidate}\\`);
  });
}
