import * as vscode from 'vscode';
import { SessionState } from './types';

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export class CacheWardenStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.command = 'cacheWarden.toggleArmed';
    this.item.name = 'CacheWarden';
    this.item.show();
    this.renderIdle();
  }

  update(state: SessionState | undefined, armed: boolean) {
    if (state?.trackingOnly) {
      this.item.text = state.chatActive ? '$(comment-discussion) Codex: active' : '$(eye) Codex: tracking';
      this.item.color = undefined;
      this.item.tooltip = `CacheWarden is tracking Codex session activity.\nSession: ${state.label}\nAutomated keep-alive is disabled during validation.`;
      return;
    }

    if (!armed) {
      this.item.text = '$(clock) Cache: paused';
      this.item.color = undefined;
      this.item.tooltip = 'CacheWarden is disarmed — click to arm';
      return;
    }

    if (!state) {
      this.item.text = '$(clock) Cache: --:--';
      this.item.color = undefined;
      this.item.tooltip = 'CacheWarden armed — waiting for a Claude session in this window';
      return;
    }

    const { secondsRemaining, keepAliveStreak, keepAliveMaxPings } = state;

    if (state.chatActive) {
      this.item.text = '$(comment-discussion) Cache: active';
      this.item.color = undefined;
      this.item.tooltip = 'Chat turn in progress — cache is being refreshed naturally.\nCountdown starts when the reply finishes.';
      return;
    }

    if (keepAliveStreak >= keepAliveMaxPings) {
      this.item.text = '$(clock) Cache: capped';
      this.item.color = new vscode.ThemeColor('statusBarItem.warningBackground');
      this.item.tooltip = `Max pings (${keepAliveMaxPings}) reached — click to toggle`;
      return;
    }

    if (secondsRemaining === 0) {
      this.item.text = '$(sync~spin) Cache: pinging…';
      this.item.color = undefined;
      this.item.tooltip = 'Keepalive ping in flight — countdown restarts when it completes';
      return;
    }

    const timeStr = formatSeconds(secondsRemaining);
    if (secondsRemaining < 60) {
      this.item.text = `$(clock) Cache: ${timeStr}`;
      this.item.color = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.item.text = `$(clock) Cache: ${timeStr}`;
      this.item.color = undefined;
    }
    this.item.tooltip = `CacheWarden — ${timeStr} until keepalive ping\nSession: ${state.label}\n${keepAliveStreak}/${keepAliveMaxPings} pings used\nClick to toggle`;
  }

  hide() {
    this.item.hide();
  }

  show() {
    this.item.show();
  }

  private renderIdle() {
    this.item.text = '$(clock) Cache: --:--';
    this.item.tooltip = 'CacheWarden — waiting for activity';
  }

  dispose() {
    this.item.dispose();
  }
}
