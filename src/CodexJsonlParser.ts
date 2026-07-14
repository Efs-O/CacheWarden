export interface CodexSessionSnapshot {
  sessionId: string;
  cwd: string;
  title: string;
  source: string;
  taskActive: boolean;
  lastEventMs: number;
  lastCompletedMs: number;
  lastUserMessageMs: number;
  inputTokens: number;
  cachedInputTokens: number;
}

export function emptyCodexSnapshot(): CodexSessionSnapshot {
  return {
    sessionId: '', cwd: '', title: '', source: '', taskActive: false,
    lastEventMs: 0, lastCompletedMs: 0, lastUserMessageMs: 0, inputTokens: 0, cachedInputTokens: 0,
  };
}

export function applyCodexJsonlLine(snapshot: CodexSessionSnapshot, line: string): void {
  if (!line.trim()) { return; }
  let event: any;
  try { event = JSON.parse(line); } catch { return; }

  const timestampMs = Date.parse(event.timestamp || '');
  if (Number.isFinite(timestampMs)) { snapshot.lastEventMs = Math.max(snapshot.lastEventMs, timestampMs); }
  const payload = event.payload || {};

  if (event.type === 'session_meta') {
    snapshot.sessionId = String(payload.id || payload.session_id || snapshot.sessionId);
    snapshot.cwd = String(payload.cwd || snapshot.cwd);
    snapshot.source = String(payload.source || payload.originator || snapshot.source);
    const explicitName = payload.thread_name || payload.session_name || payload.name || '';
    if (explicitName) { snapshot.title = cleanCodexTitle(explicitName); }
    return;
  }

  if (event.type !== 'event_msg') { return; }
  if (payload.type === 'task_started') {
    snapshot.taskActive = true;
  } else if (payload.type === 'task_complete') {
    snapshot.taskActive = false;
    const completedMs = Date.parse(payload.completed_at || event.timestamp || '');
    snapshot.lastCompletedMs = Number.isFinite(completedMs) ? completedMs : snapshot.lastEventMs;
  } else if (payload.type === 'user_message') {
    const message = String(payload.message || '');
    if (!message.startsWith('[CACHE_WARDEN_KEEPALIVE]')) {
      snapshot.lastUserMessageMs = Number.isFinite(timestampMs) ? timestampMs : snapshot.lastEventMs;
      if (!snapshot.title) { snapshot.title = cleanCodexTitle(message); }
    }
  } else if (payload.type === 'token_count' && payload.info?.last_token_usage) {
    snapshot.inputTokens = Number(payload.info.last_token_usage.input_tokens) || 0;
    snapshot.cachedInputTokens = Number(payload.info.last_token_usage.cached_input_tokens) || 0;
  }
}

export function cleanCodexTitle(value: unknown): string {
  let text = String(value || '');
  const requestMarker = /^## My request for Codex:\s*$/im;
  const marker = requestMarker.exec(text);
  if (marker) { text = text.slice(marker.index + marker[0].length); }
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (!oneLine || oneLine.startsWith('<')) { return ''; }
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine;
}
