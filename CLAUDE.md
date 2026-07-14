# CacheWarden

VS Code extension that keeps Anthropic prompt cache warm before the 5-minute TTL expires.

## What it does

Tracks editor idle time and sends a keepalive ping to Claude Code before the 5-min cache TTL fires. Avoids the ~2–4s latency spike and extra `cache_creation` tokens on the next real message.

## Architecture

```
extension.ts          activation, wires everything together
IdleTracker.ts        VS Code editor/terminal events → fires onIdle(ms)
TimerStore.ts         per-session TTL countdown (default 280s)
CacheKeepManager.ts   armed state, keepAliveStreak, auto-fire
PingDispatcher.ts     clipboard+paste (Method B) or notify (Method C)
StatusBarItem.ts      countdown chip in status bar
SidebarProvider.ts    React webview panel (session cards)
types.ts              shared interfaces
webview-ui/           React webview source
```

## Build

```bash
npm install
npm run build          # esbuild bundle → dist/
npm run watch          # incremental
```

## Run / Debug

Open in VS Code → F5 → Extension Development Host opens.

## Settings (contributes)

- `cacheWarden.ttlSeconds` — default 280 (fires 20s before 5-min TTL)
- `cacheWarden.keepAliveDurationSeconds` — default 1800 (stop after 30 min idle)
- `cacheWarden.keepAliveMaxPings` — default 7 (consecutive ping cap, ~28 min coverage)
- `cacheWarden.targets` — default `["claude"]`
- `cacheWarden.pingMethod` — `"clipboard"` (default) | `"notify"`
- `cacheWarden.showStatusBar` — default true

## Keepalive message

Reused verbatim from forge-relay `buildKeepAliveMessage()`:

```
[AW_TURN_TYPE: keep-alive]
This is a cache keep-alive maintenance turn.
Do not use tools.
Do not post to the board.
Do not inspect or edit files.
Do not emit natural-language prose.
If the CLI requires a reply, emit only the inert marker [AW_KEEPALIVE_OK].
```

## MVP scope

Phase 1: single shared session, IdleTracker + TimerStore + CacheKeepManager + StatusBarItem.  
Codex support is not implemented yet.
