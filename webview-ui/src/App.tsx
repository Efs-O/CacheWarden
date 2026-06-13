import React, { useEffect, useState } from 'react';
import { SessionCard } from './SessionCard';

declare function acquireVsCodeApi(): {
  postMessage: (msg: unknown) => void;
};

const vscode = acquireVsCodeApi();

interface SessionState {
  id: string;
  label: string;
  armed: boolean;
  keepAliveStreak: number;
  keepAliveMaxPings: number;
  secondsRemaining: number;
  ttlSeconds: number;
  pingsSentTotal: number;
}

export function App() {
  const [sessions, setSessions] = useState<SessionState[]>([]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === 'stateUpdate') {
        setSessions(msg.sessions);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const postToggle = (id: string) => vscode.postMessage({ type: 'toggle', sessionId: id });
  const postReset = (id: string) => vscode.postMessage({ type: 'reset', sessionId: id });
  const postPingNow = (id: string) => vscode.postMessage({ type: 'pingNow', sessionId: id });

  if (sessions.length === 0) {
    return (
      <div style={styles.empty}>
        <p>No active sessions detected.</p>
        <p style={{ fontSize: 11, opacity: 0.6 }}>Start coding to begin tracking.</p>
      </div>
    );
  }

  return (
    <div style={styles.root}>
      {sessions.map(s => (
        <SessionCard
          key={s.id}
          session={s}
          onToggle={() => postToggle(s.id)}
          onReset={() => postReset(s.id)}
          onPingNow={() => postPingNow(s.id)}
        />
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { padding: 8, fontFamily: 'var(--vscode-font-family)', fontSize: 13 },
  empty: { padding: 16, color: 'var(--vscode-foreground)', opacity: 0.7, textAlign: 'center' },
};
