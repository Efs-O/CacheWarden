export function parseClaudeAiTitle(contents: string, sessionId: string): string {
  let title = '';
  let lastPrompt = '';
  for (const line of contents.split(/\r?\n/)) {
    if (!line) { continue; }
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'ai-title' && entry.sessionId === sessionId && entry.aiTitle) {
        title = cleanTitle(entry.aiTitle);
      } else if (entry.type === 'last-prompt' && entry.sessionId === sessionId && entry.lastPrompt) {
        lastPrompt = cleanTitle(entry.lastPrompt);
      }
    } catch { /* ignore malformed or partially-written transcript lines */ }
  }
  return title || lastPrompt;
}

function cleanTitle(value: unknown): string {
  const oneLine = String(value || '').replace(/\s+/g, ' ').trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine;
}
