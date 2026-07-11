export interface SessionState {
  id: string;
  provider?: 'claude' | 'codex';
  label: string;
  armed: boolean;
  keepAliveStreak: number;
  keepAliveMaxPings: number;
  secondsRemaining: number;
  ttlSeconds: number;
  pingsSentTotal: number;
  /** A chat turn is in progress (user typed / reply being generated) — countdown not started yet. */
  chatActive?: boolean;
  /** Session is observable, but automated keep-alive is deliberately unavailable. */
  trackingOnly?: boolean;
  inputTokens?: number;
  cachedInputTokens?: number;
}

export interface CacheWardenConfig {
  ttlSeconds: number;
  keepAliveDurationSeconds: number;
  keepAliveMaxPings: number;
  targets: string[];
  hookEnabled: boolean;
  pingMethod: 'clipboard' | 'notify';
  showStatusBar: boolean;
  claudePath: string;
  codexPath: string;
  codexExperimentalKeepAlive: boolean;
}

export const KEEPALIVE_MESSAGE = `[AW_TURN_TYPE: keep-alive]
This is a cache keep-alive maintenance turn.
Do not use tools.
Do not post to the board.
Do not inspect or edit files.
Do not emit natural-language prose.
If the CLI requires a reply, emit only the inert marker [AW_KEEPALIVE_OK].`;

export type WebviewMessage =
  | { type: 'stateUpdate'; sessions: SessionState[] }
  | { type: 'toggle'; sessionId: string }
  | { type: 'reset'; sessionId: string }
  | { type: 'pingNow'; sessionId: string }
  | { type: 'dismiss'; sessionId: string };
