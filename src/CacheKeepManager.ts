import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HookInstaller } from './HookInstaller';
import { parseClaudeAiTitle } from './ClaudeTitleParser';
import { CacheWardenConfig, SessionState } from './types';

/**
 * State is owned by the hook script (~/.claude/cache-warden-keepalive.js); this class only
 * mirrors it for display by polling the script's per-session state dirs
 * (~/.claude/cache-warden/sessions/<session_id>/):
 *   gen        — token written on every Stop ('g…', countdown anchor) or user prompt ('reset-…', chat active)
 *   last_ping  — JSON { t, count } written after each successful ping (re-anchors the countdown)
 *   meta       — JSON { cwd } so each VS Code window shows only its own workspace's sessions
 */
export class CacheKeepManager implements vscode.Disposable {
  private armed = false;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly sessionNames = new Map<string, { name: string; checkedAt: number }>();

  readonly onStateChange: vscode.Event<SessionState[]>;
  private readonly _onStateChange = new vscode.EventEmitter<SessionState[]>();

  constructor(
    private readonly hookInstaller: HookInstaller,
    private config: CacheWardenConfig
  ) {
    this.onStateChange = this._onStateChange.event;

    // Always reinstall when enabled so the deployed script matches this extension version.
    if (config.hookEnabled) {
      this.arm();
    } else if (hookInstaller.isInstalled()) {
      this.disarm();
    }

    this.timer = setInterval(() => this._onStateChange.fire(this.getStates()), 1000);
  }

  get isArmed(): boolean {
    return this.armed;
  }

  /**
   * With a session id: pause/resume just that session (other sessions keep running).
   * Without one (status-bar command): flip the global hook on/off.
   */
  toggle(id?: string) {
    if (id) {
      if (this.hookInstaller.isSessionPaused(id)) {
        this.hookInstaller.resumeSession(id);
      } else {
        this.hookInstaller.pauseSession(id);
      }
      this._onStateChange.fire(this.getStates());
      return;
    }
    if (this.armed) {
      this.disarm();
    } else {
      this.arm();
    }
  }

  private arm() {
    this.hookInstaller.install(this.config.ttlSeconds, this.config.keepAliveMaxPings, this.config.claudePath);
    this.armed = true;
    this._onStateChange.fire(this.getStates());
  }

  private disarm() {
    this.hookInstaller.uninstall();
    this.armed = false;
    this._onStateChange.fire(this.getStates());
  }

  resetStreak() {
    this.hookInstaller.resetCounter();
    this._onStateChange.fire(this.getStates());
  }

  /**
   * Remove a session card (moves its state to trash). Offers an Undo; a still-live
   * chat also reappears on its next turn even without undoing.
   */
  dismiss(id: string) {
    const token = this.hookInstaller.removeSession(id);
    this._onStateChange.fire(this.getStates());
    if (!token) { return; }
    void vscode.window.showInformationMessage('CacheWarden: session card removed.', 'Undo').then(choice => {
      if (choice === 'Undo') {
        this.hookInstaller.restoreSession(id, token);
        this._onStateChange.fire(this.getStates());
      }
    });
  }

  async forcePing() {
    void vscode.window.showInformationMessage(
      'CacheWarden: pings fire automatically when a Claude reply finishes — there is no session to ping manually.'
    );
  }

  updateConfig(config: CacheWardenConfig) {
    this.config = config;
    if (this.armed) {
      this.hookInstaller.install(config.ttlSeconds, config.keepAliveMaxPings, config.claudePath);
    }
  }

  getStates(): SessionState[] {
    const sessions: SessionState[] = [];
    let sids: string[] = [];
    try { sids = fs.readdirSync(this.hookInstaller.sessionsDir); } catch { /* never armed */ }

    for (const sid of sids) {
      const sdir = path.join(this.hookInstaller.sessionsDir, sid);

      let gen = '';
      let anchorMs = 0;
      try {
        const genPath = path.join(sdir, 'gen');
        gen = fs.readFileSync(genPath, 'utf8');
        anchorMs = fs.statSync(genPath).mtimeMs;
      } catch { continue; }

      let streak = 0;
      try {
        const ping = JSON.parse(fs.readFileSync(path.join(sdir, 'last_ping'), 'utf8'));
        if (ping.t > anchorMs) {
          anchorMs = ping.t;
          streak = ping.count;
        }
      } catch { /* no ping yet in this idle period */ }

      let cwd = '';
      let transcriptPath = '';
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(sdir, 'meta'), 'utf8'));
        cwd = meta.cwd || '';
        transcriptPath = meta.transcriptPath || '';
      } catch { /* meta written by >= v0.2 hook only */ }

      if (cwd && !this.matchesWorkspace(cwd)) { continue; }

      const paused = this.hookInstaller.isSessionPaused(sid);
      const sessionArmed = this.armed && !paused;
      const chatActive = gen.startsWith('reset');
      const counting = sessionArmed && gen.startsWith('g') && anchorMs > 0;
      const ageMs = Date.now() - anchorMs;

      // Drop sessions whose chain is long dead (capped/killed) or idle chats from hours ago.
      // Paused sessions stay visible so they can be resumed from the panel.
      const maxAgeMs = chatActive ? 2 * 3600_000 : (this.config.ttlSeconds + 600) * 1000;
      if (!paused && ageMs > maxAgeMs) { continue; }

      const secondsRemaining = counting
        ? Math.max(0, Math.round(this.config.ttlSeconds - ageMs / 1000))
        : this.config.ttlSeconds;

      const sessionName = this.getSessionName(sid, transcriptPath);
      sessions.push({
        id: sid,
        label: sessionName || (cwd ? `${path.basename(cwd)} · ${sid.slice(0, 8)}` : sid.slice(0, 8)),
        armed: sessionArmed,
        keepAliveStreak: streak,
        keepAliveMaxPings: this.config.keepAliveMaxPings,
        secondsRemaining,
        ttlSeconds: this.config.ttlSeconds,
        pingsSentTotal: streak,
        chatActive: sessionArmed && chatActive,
      });
    }

    // Counting sessions first (most urgent on top — also drives the status bar), then active chats.
    sessions.sort((a, b) =>
      Number(a.chatActive ?? false) - Number(b.chatActive ?? false) ||
      a.secondsRemaining - b.secondsRemaining
    );
    return sessions;
  }

  /** Prefer the conversation title/prompt; Claude's live-process name is only a fallback. */
  private getSessionName(sid: string, transcriptPath: string): string {
    const cached = this.sessionNames.get(sid);
    if (cached && Date.now() - cached.checkedAt < 30_000) { return cached.name; }

    let name = '';
    // Claude's VS Code UI writes its generated tab title into the transcript.
    // Prefer the latest such event so our card matches the visible chat header.
    if (transcriptPath) {
      try {
        name = parseClaudeAiTitle(fs.readFileSync(transcriptPath, 'utf8'), sid);
      } catch { /* transcript may not exist yet */ }
    }

    if (transcriptPath) {
      try {
        const index = JSON.parse(fs.readFileSync(path.join(path.dirname(transcriptPath), 'sessions-index.json'), 'utf8'));
        const entry = Array.isArray(index.entries)
          ? index.entries.find((candidate: { sessionId?: string }) => candidate.sessionId === sid)
          : undefined;
        name ||= this.cleanSessionName(entry?.summary || entry?.firstPrompt || '');
      } catch { /* Claude does not create an index for every project */ }
    }

    if (!name) {
      try {
        const historyPath = path.join(os.homedir(), '.claude', 'history.jsonl');
        const lines = fs.readFileSync(historyPath, 'utf8').split(/\r?\n/);
        for (const line of lines) {
          if (!line) { continue; }
          try {
            const entry = JSON.parse(line);
            if (entry.sessionId === sid && !String(entry.display || '').startsWith('/')) {
              name = this.cleanSessionName(entry.display || '');
              if (name) { break; }
            }
          } catch { /* ignore a partially-written history line */ }
        }
      } catch { /* history is optional */ }
    }

    if (!name && transcriptPath) {
      try {
        for (const line of fs.readFileSync(transcriptPath, 'utf8').split(/\r?\n/)) {
          if (!line) { continue; }
          try {
            const entry = JSON.parse(line);
            if (entry.message?.role !== 'user') { continue; }
            const content = entry.message.content;
            const text = typeof content === 'string'
              ? content
              : Array.isArray(content)
                ? content.find((block: { type?: string; text?: string }) => block.type === 'text')?.text || ''
                : '';
            name = this.cleanSessionName(text);
            if (name) { break; }
          } catch { /* ignore a partially-written transcript line */ }
        }
      } catch { /* transcript may have been pruned */ }
    }

    if (!name) {
      try {
        const liveSessionsDir = path.join(os.homedir(), '.claude', 'sessions');
        for (const filename of fs.readdirSync(liveSessionsDir)) {
          if (!filename.endsWith('.json')) { continue; }
          try {
            const liveSession = JSON.parse(fs.readFileSync(path.join(liveSessionsDir, filename), 'utf8'));
            if (liveSession.sessionId === sid) {
              name = this.cleanSessionName(liveSession.name || '');
              if (name) { break; }
            }
          } catch { /* ignore stale or partially-written live-session records */ }
        }
      } catch { /* no live sessions directory */ }
    }

    this.sessionNames.set(sid, { name, checkedAt: Date.now() });
    return name;
  }

  private cleanSessionName(value: string): string {
    const oneLine = String(value).replace(/\s+/g, ' ').trim();
    if (!oneLine) { return ''; }
    return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine;
  }

  private matchesWorkspace(cwd: string): boolean {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return true; }
    const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
    const c = norm(cwd);
    return folders.some(f => {
      const w = norm(f.uri.fsPath);
      return c === w || c.startsWith(w + '\\') || w.startsWith(c + '\\');
    });
  }

  dispose() {
    clearInterval(this.timer);
    this._onStateChange.dispose();
  }
}
