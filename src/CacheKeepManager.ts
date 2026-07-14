import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HookInstaller } from './HookInstaller';
import { CodexSessionTracker } from './CodexSessionTracker';
import { CodexKeepAliveRunner } from './CodexKeepAliveRunner';
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
  private readonly codexTracker = new CodexSessionTracker();
  private readonly codexRunner = new CodexKeepAliveRunner();
  private readonly codexAuto = new Map<string, {
    paused: boolean; streak: number; total: number; anchorMs: number;
    idleStartedMs: number; lastUserMessageMs: number; pinging: boolean;
  }>();
  private readonly claudeUsageCache = new Map<string, { checkedAt: number; inputTokens: number; cachedInputTokens: number }>();

  readonly onStateChange: vscode.Event<SessionState[]>;
  private readonly _onStateChange = new vscode.EventEmitter<SessionState[]>();

  constructor(
    private readonly hookInstaller: HookInstaller,
    private config: CacheWardenConfig
  ) {
    this.onStateChange = this._onStateChange.event;

    // Always reinstall when enabled so the deployed script matches this extension version.
    if (config.hookEnabled && config.targets.includes('claude')) {
      this.arm();
    } else if (hookInstaller.isInstalled()) {
      this.disarm();
    }

    this.timer = setInterval(() => {
      const states = this.getStates();
      this._onStateChange.fire(states);
      void this.tickCodex(states);
    }, 1000);
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
      if (id.startsWith('codex:')) {
        if (!this.config.codexExperimentalKeepAlive) {
          void vscode.window.showInformationMessage('CacheWarden: enable experimental Codex keep-alive first.');
          return;
        }
        const state = this.codexAuto.get(id);
        if (state) { state.paused = !state.paused; }
        this._onStateChange.fire(this.getStates());
        return;
      }
      if (this.hookInstaller.isSessionPaused(id)) {
        this.hookInstaller.resumeSession(id);
      } else {
        this.hookInstaller.pauseSession(id);
      }
      this._onStateChange.fire(this.getStates());
      return;
    }
    if (!this.config.targets.includes('claude')) {
      void vscode.window.showInformationMessage('CacheWarden: Codex is tracking-only during the experiment.');
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

  resetStreak(id?: string) {
    if (id?.startsWith('codex:')) {
      const state = this.codexAuto.get(id);
      if (state) {
        state.streak = 0;
        state.total = 0;
        state.anchorMs = Date.now();
        state.idleStartedMs = state.anchorMs;
      }
      this._onStateChange.fire(this.getStates());
      return;
    }
    this.hookInstaller.resetCounter();
    this._onStateChange.fire(this.getStates());
  }

  /**
   * Remove a session card (moves its state to trash). Offers an Undo; a still-live
   * chat also reappears on its next turn even without undoing.
   */
  dismiss(id: string) {
    if (id.startsWith('codex:')) {
      this.codexTracker.dismiss(id);
      this._onStateChange.fire(this.getStates());
      return;
    }
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

  async forcePing(id?: string) {
    if (id?.startsWith('codex:')) {
      if (!this.config.codexExperimentalKeepAlive) {
        void vscode.window.showInformationMessage(
          'CacheWarden: enable the experimental Codex keep-alive setting to run a manual validation ping.'
        );
        return;
      }
      const snapshot = this.codexTracker.getSnapshot(id);
      if (!snapshot) {
        void vscode.window.showWarningMessage('CacheWarden: the Codex session is no longer available.');
        return;
      }
      if (snapshot.taskActive) {
        void vscode.window.showWarningMessage('CacheWarden: Codex is active; the validation ping was cancelled.');
        return;
      }
      if (Date.now() - snapshot.lastEventMs < 2000) {
        void vscode.window.showWarningMessage('CacheWarden: Codex activity is too recent; try again in a few seconds.');
        return;
      }
      const result = await this.runCodexPing(id, true);
      if (!result) { return; }
      if (result.ok) {
        void vscode.window.showInformationMessage('CacheWarden: Codex validation ping completed safely in the same session.');
      } else {
        void vscode.window.showErrorMessage(`CacheWarden: Codex validation ping failed: ${result.error}`);
      }
      return;
    }
    void vscode.window.showInformationMessage(
      'CacheWarden: pings fire automatically when a Claude reply finishes — there is no session to ping manually.'
    );
  }

  private async runCodexPing(id: string, manual: boolean) {
    const auto = this.codexAuto.get(id);
    const snapshot = this.codexTracker.getSnapshot(id);
    if (!snapshot || !auto || auto.pinging) { return undefined; }
    if (snapshot.taskActive || Date.now() - snapshot.lastEventMs < 2000) {
      if (manual) { void vscode.window.showWarningMessage('CacheWarden: Codex is active or activity is too recent.'); }
      return undefined;
    }
    auto.pinging = true;
    this._onStateChange.fire(this.getStates());
    const result = await this.codexRunner.run(snapshot.sessionId, snapshot.cwd, this.config.codexPath);
    auto.pinging = false;
    if (result.ok) {
      auto.streak += 1;
      auto.total += 1;
      auto.anchorMs = Date.now();
    } else if (!manual) {
      auto.paused = true;
      void vscode.window.showErrorMessage(`CacheWarden: automatic Codex ping failed and was paused: ${result.error}`);
    }
    this._onStateChange.fire(this.getStates());
    return result;
  }

  private async tickCodex(states: SessionState[]): Promise<void> {
    for (const session of states) {
      if (session.provider !== 'codex' || !session.armed || session.chatActive || session.secondsRemaining > 0) { continue; }
      const auto = this.codexAuto.get(session.id);
      if (!auto || auto.pinging || auto.streak >= this.config.keepAliveMaxPings) { continue; }
      if (Date.now() - auto.idleStartedMs >= this.config.keepAliveDurationSeconds * 1000) { continue; }
      await this.runCodexPing(session.id, false);
    }
  }

  updateConfig(config: CacheWardenConfig) {
    const shouldArmClaude = config.hookEnabled && config.targets.includes('claude');
    this.config = config;
    if (shouldArmClaude && !this.armed) {
      this.arm();
    } else if (!shouldArmClaude && this.armed) {
      this.disarm();
    } else if (this.armed) {
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
      const usage = this.getClaudeTokenUsage(sid, transcriptPath);
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
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
      });
    }

    if (this.config.targets.includes('codex')) {
      const folders = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) || [];
      const codexStates = this.codexTracker.getStates(
        folders, this.config.ttlSeconds, this.config.codexExperimentalKeepAlive
      );
      for (const session of codexStates) {
        const snapshot = this.codexTracker.getSnapshot(session.id);
        if (!snapshot) { continue; }
        let auto = this.codexAuto.get(session.id);
        if (!auto) {
          const anchor = snapshot.lastCompletedMs || snapshot.lastEventMs || Date.now();
          auto = { paused: false, streak: 0, total: 0, anchorMs: anchor, idleStartedMs: anchor,
            lastUserMessageMs: snapshot.lastUserMessageMs, pinging: false };
          this.codexAuto.set(session.id, auto);
        }
        if (snapshot.lastUserMessageMs > auto.lastUserMessageMs) {
          auto.lastUserMessageMs = snapshot.lastUserMessageMs;
          auto.streak = 0;
          auto.total = 0;
          auto.idleStartedMs = snapshot.lastUserMessageMs;
        }
        if (!snapshot.taskActive && snapshot.lastCompletedMs > auto.anchorMs) {
          auto.anchorMs = snapshot.lastCompletedMs;
        }
        const enabled = this.config.codexExperimentalKeepAlive;
        const counting = enabled && !auto.paused && !snapshot.taskActive && !auto.pinging;
        session.trackingOnly = !enabled;
        session.armed = enabled && !auto.paused;
        session.keepAliveStreak = auto.streak;
        session.keepAliveMaxPings = this.config.keepAliveMaxPings;
        session.pingsSentTotal = auto.total;
        session.chatActive = snapshot.taskActive || auto.pinging;
        session.secondsRemaining = counting
          ? Math.max(0, Math.round(this.config.ttlSeconds - (Date.now() - auto.anchorMs) / 1000))
          : this.config.ttlSeconds;
        sessions.push(session);
      }
    }

    // Counting sessions first (most urgent on top — also drives the status bar), then active chats.
    sessions.sort((a, b) =>
      Number(a.trackingOnly ?? false) - Number(b.trackingOnly ?? false) ||
      Number(a.chatActive ?? false) - Number(b.chatActive ?? false) ||
      a.secondsRemaining - b.secondsRemaining
    );
    return sessions;
  }

  private getClaudeTokenUsage(sid: string, transcriptPath: string): { inputTokens: number; cachedInputTokens: number } {
    const cached = this.claudeUsageCache.get(sid);
    if (cached && Date.now() - cached.checkedAt < 2000) { return cached; }
    let inputTokens = 0;
    let cachedInputTokens = 0;
    if (transcriptPath) {
      try {
        const lines = fs.readFileSync(transcriptPath, 'utf8').split(/\r?\n/);
        for (let index = lines.length - 1; index >= 0; index -= 1) {
          if (!lines[index]) { continue; }
          try {
            const usage = JSON.parse(lines[index]).message?.usage;
            if (!usage) { continue; }
            cachedInputTokens = Number(usage.cache_read_input_tokens) || 0;
            inputTokens = (Number(usage.input_tokens) || 0) + cachedInputTokens +
              (Number(usage.cache_creation_input_tokens) || 0);
            break;
          } catch { /* ignore partial transcript lines */ }
        }
      } catch { /* transcript is optional */ }
    }
    const result = { checkedAt: Date.now(), inputTokens, cachedInputTokens };
    this.claudeUsageCache.set(sid, result);
    return result;
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
