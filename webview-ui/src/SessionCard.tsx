import React from 'react';

interface SessionState {
  id: string;
  provider?: 'claude' | 'codex';
  label: string;
  armed: boolean;
  keepAliveStreak: number;
  keepAliveMaxPings: number;
  secondsRemaining: number;
  ttlSeconds: number;
  pingsSentTotal: number;
  trackingOnly?: boolean;
  experimentalPingEnabled?: boolean;
  inputTokens?: number;
  cachedInputTokens?: number;
}

interface Props {
  session: SessionState;
  onToggle: () => void;
  onReset: () => void;
  onPingNow: () => void;
  onDismiss: () => void;
}

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export function SessionCard({ session, onToggle, onReset, onPingNow, onDismiss }: Props) {
  const { label, provider = 'claude', armed, trackingOnly, keepAliveStreak, keepAliveMaxPings, secondsRemaining, ttlSeconds, pingsSentTotal } = session;
  const progress = ttlSeconds > 0 ? secondsRemaining / ttlSeconds : 0;
  const timeStr = secondsRemaining === 0 ? 'expired' : formatSeconds(secondsRemaining);
  const isExpired = secondsRemaining === 0;
  const isCapped = keepAliveStreak >= keepAliveMaxPings;

  const barColor = !armed
    ? 'var(--vscode-disabledForeground)'
    : isExpired || isCapped
    ? 'var(--vscode-errorForeground)'
    : secondsRemaining < 60
    ? 'var(--vscode-notificationsWarningIcon-foreground)'
    : 'var(--vscode-progressBar-background)';

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <span style={styles.label}>
          {label}
          <span style={provider === 'codex' ? styles.codexBadge : styles.claudeBadge}>{provider}</span>
          {trackingOnly
            ? <span style={styles.trackingBadge}>tracking only</span>
            : !armed && <span style={styles.pausedBadge}>paused</span>}
        </span>
        <span style={styles.headerRight}>
          {!trackingOnly && <span style={{ ...styles.time, color: barColor }}>{timeStr}</span>}
          <button
            style={styles.dismissBtn}
            onClick={onDismiss}
            title={trackingOnly ? 'Hide this tracked session until VS Code reloads' : 'Remove this session card (Undo available)'}
            aria-label="Remove session"
          >
            ✕
          </button>
        </span>
      </div>

      {!trackingOnly && <div style={styles.barTrack}>
        <div
          style={{
            ...styles.barFill,
            width: `${Math.round(progress * 100)}%`,
            background: barColor,
          }}
        />
      </div>}

      <div style={styles.row}>
        {trackingOnly ? (
          session.experimentalPingEnabled
            ? <button style={styles.btn} onClick={onPingNow} title="Run one guarded Codex cache validation turn">Test Ping Now</button>
            : <button style={{ ...styles.btn, ...styles.btnOff }} disabled title="Enable the experimental setting to test manually">
                Keep-alive disabled
              </button>
        ) : <button
          style={{ ...styles.btn, ...(armed ? styles.btnOn : styles.btnOff) }}
          onClick={onToggle}
        >
          {armed ? 'Cache Keep ON' : 'Cache Keep OFF'}
        </button>}
        {!trackingOnly && <button style={styles.btn} onClick={onReset}>Reset</button>}
        {!trackingOnly && <button style={styles.btn} onClick={onPingNow}>Ping Now</button>}
      </div>

      <div style={styles.meta}>
        {trackingOnly
          ? `Last turn: ${session.cachedInputTokens ?? 0}/${session.inputTokens ?? 0} cached input tokens`
          : `${keepAliveStreak}/${keepAliveMaxPings} consecutive pings · ${pingsSentTotal} total`}
      </div>
      {!trackingOnly && session.inputTokens !== undefined && <div style={styles.meta}>
        Last turn: {session.cachedInputTokens ?? 0}/{session.inputTokens} cached input tokens
      </div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    border: '1px solid var(--vscode-panel-border)',
    borderRadius: 4,
    padding: '10px 12px',
    marginBottom: 8,
    background: 'var(--vscode-editor-background)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  label: { fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  headerRight: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  dismissBtn: {
    fontSize: 12,
    lineHeight: 1,
    padding: '2px 5px',
    cursor: 'pointer',
    background: 'transparent',
    color: 'var(--vscode-descriptionForeground)',
    border: 'none',
    borderRadius: 3,
    opacity: 0.6,
  },
  pausedBadge: {
    fontSize: 9,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    padding: '1px 5px',
    borderRadius: 8,
    color: '#fff',
    background: '#da3633',
  },
  trackingBadge: {
    fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
    padding: '1px 5px', borderRadius: 8, color: '#fff', background: '#6e7681',
  },
  claudeBadge: {
    fontSize: 9, fontWeight: 600, textTransform: 'uppercase', opacity: 0.65,
  },
  codexBadge: {
    fontSize: 9, fontWeight: 600, textTransform: 'uppercase', color: '#58a6ff',
  },
  time: { fontSize: 13, fontVariantNumeric: 'tabular-nums' },
  barTrack: {
    height: 4,
    background: 'var(--vscode-scrollbarSlider-background)',
    borderRadius: 2,
    marginBottom: 8,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 2,
    transition: 'width 0.9s linear',
  },
  row: { display: 'flex', gap: 6, marginBottom: 6 },
  btn: {
    fontSize: 11,
    padding: '3px 8px',
    cursor: 'pointer',
    background: 'var(--vscode-button-secondaryBackground)',
    color: 'var(--vscode-button-secondaryForeground)',
    border: '1px solid var(--vscode-button-border, transparent)',
    borderRadius: 3,
  },
  btnOn: {
    background: '#238636',
    color: '#fff',
    borderColor: '#2ea043',
  },
  btnOff: {
    background: '#da3633',
    color: '#fff',
    borderColor: '#f85149',
  },
  meta: {
    fontSize: 11,
    opacity: 0.6,
    color: 'var(--vscode-foreground)',
  },
};
