import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyCodexJsonlLine, CodexSessionSnapshot, emptyCodexSnapshot } from './CodexJsonlParser';
import { SessionState } from './types';

interface TrackedFile {
  offset: number;
  remainder: string;
  snapshot: CodexSessionSnapshot;
  visible: boolean;
  baselineSize: number;
}

export class CodexSessionTracker {
  private readonly files = new Map<string, TrackedFile>();
  private readonly dismissed = new Set<string>();
  private readonly indexedTitles = new Map<string, string>();
  private indexOffset = 0;
  private indexRemainder = '';
  private lastDiscoveryMs = 0;
  private initialDiscoveryComplete = false;

  constructor(
    private readonly sessionsRoot = path.join(os.homedir(), '.codex', 'sessions'),
    private readonly sessionIndexPath = path.join(path.dirname(sessionsRoot), 'session_index.jsonl')
  ) {}

  getStates(workspaceFolders: string[], ttlSeconds: number, pingEnabled = false): SessionState[] {
    this.refresh();
    const now = Date.now();
    const byId = new Map<string, CodexSessionSnapshot>();
    for (const tracked of this.files.values()) {
      const snapshot = tracked.snapshot;
      if (!tracked.visible) { continue; }
      if (!snapshot.sessionId || this.dismissed.has(snapshot.sessionId)) { continue; }
      if (snapshot.lastEventMs && now - snapshot.lastEventMs > 2 * 3600_000) { continue; }
      if (!matchesWorkspace(snapshot.cwd, workspaceFolders)) { continue; }
      const previous = byId.get(snapshot.sessionId);
      if (!previous || snapshot.lastEventMs > previous.lastEventMs) { byId.set(snapshot.sessionId, snapshot); }
    }

    return [...byId.values()].map(snapshot => ({
      id: `codex:${snapshot.sessionId}`,
      provider: 'codex',
      label: this.indexedTitles.get(snapshot.sessionId) || snapshot.title || `Codex · ${snapshot.sessionId.slice(0, 8)}`,
      armed: false,
      trackingOnly: true,
      pingEnabled,
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

  getSnapshot(id: string): CodexSessionSnapshot | undefined {
    this.refresh();
    const rawId = id.replace(/^codex:/, '');
    return [...this.files.values()].map(file => file.snapshot)
      .filter(snapshot => snapshot.sessionId === rawId)
      .sort((a, b) => b.lastEventMs - a.lastEventMs)[0];
  }

  private refresh(): void {
    this.readSessionIndex();
    const now = Date.now();
    if (now - this.lastDiscoveryMs > 5000) {
      this.lastDiscoveryMs = now;
      for (const file of discoverRecentJsonl(this.sessionsRoot, now - 2 * 3600_000)) {
        if (!this.files.has(file)) {
          let size = 0;
          try {
            const stat = fs.statSync(file);
            size = stat.size;
          } catch {}
          this.files.set(file, {
            offset: 0, remainder: '', snapshot: emptyCodexSnapshot(),
            visible: this.initialDiscoveryComplete, baselineSize: size,
          });
        }
      }
      this.initialDiscoveryComplete = true;
    }
    for (const [file, tracked] of this.files) { this.readAppended(file, tracked); }
  }

  private readSessionIndex(): void {
    let size = 0;
    try { size = fs.statSync(this.sessionIndexPath).size; } catch { return; }
    if (size < this.indexOffset) {
      this.indexOffset = 0;
      this.indexRemainder = '';
      this.indexedTitles.clear();
    }
    if (size === this.indexOffset) { return; }
    const length = size - this.indexOffset;
    const buffer = Buffer.alloc(length);
    let fd: number | undefined;
    try {
      fd = fs.openSync(this.sessionIndexPath, 'r');
      fs.readSync(fd, buffer, 0, length, this.indexOffset);
      this.indexOffset = size;
    } catch { return; }
    finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch {} } }

    const parts = (this.indexRemainder + buffer.toString('utf8')).split(/\r?\n/);
    this.indexRemainder = parts.pop() || '';
    for (const line of parts) {
      try {
        const entry = JSON.parse(line);
        const id = String(entry.id || entry.session_id || '');
        const title = String(entry.thread_name || '').replace(/\s+/g, ' ').trim();
        if (id && title) { this.indexedTitles.set(id, title.length > 60 ? `${title.slice(0, 57)}…` : title); }
      } catch { /* ignore malformed or partially-written index entries */ }
    }
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
    if (!tracked.visible && size > tracked.baselineSize) { tracked.visible = true; }
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
