# CacheWarden — VS Code Cache Keep-Alive Extension

## What This Is

A small standalone VS Code extension that tracks idle time per AI chat session
and keeps the Anthropic prompt cache warm before the 5-minute TTL expires.

Target sidebar:
- **Claude Code** VS Code extension (the official Anthropic CLI sidebar)

Codex support is not implemented yet.

NOT Cursor-specific. Works in plain VS Code and VS Code forks.

---

## The Problem

Anthropic's prompt cache has a **5-minute TTL** (300 s). After 5 minutes of
silence the cached system prompt is evicted. The next message triggers a full
cache write (~2–4 s latency spike + billed cache_creation tokens). During an
active coding session you often pause for longer than 5 minutes without thinking
about it — debugging, reading docs, context-switching.

The `cache-timer` extension (agastalver) solves this for Cursor by reading
Cursor's private `agent-transcripts/*.jsonl` files and firing Cursor-specific
compositor commands. It cannot work in plain VS Code.

Forge Relay's `claude-auto-bridge.js` already implements the keepalive message
pattern for the **headless** Claude bridge (Mode B). We reuse that design here
for the **interactive** sidebars.

---

## Keepalive Message (from forge-relay)

```
[AW_TURN_TYPE: keep-alive]
This is a cache keep-alive maintenance turn.
Do not use tools.
Do not post to the board.
Do not inspect or edit files.
Do not emit natural-language prose.
If the CLI requires a reply, emit only the inert marker [AW_KEEPALIVE_OK].
```

This is the proven inert ping from `scripts/claude-auto-bridge.js`. Claude
acknowledges with `[AW_KEEPALIVE_OK]` and nothing else. We reuse it verbatim.

---

## Architecture

```
Extension host
  ├── IdleTracker          — measures ms since last VS Code editor/terminal activity
  ├── TimerStore           — per-session countdown state (TTL 280 s default)
  ├── PingDispatcher       — sends the keepalive via the best available method
  ├── StatusBarItem        — per-session countdown chip in the status bar
  ├── SidebarProvider      — webview panel with session cards + Cache Keep toggle
  └── CacheKeepManager     — armed/disarmed state, max-pings cap, auto-fire logic
```

---

## Activity Detection (how we know a session is active)

### Method 1 — VS Code editor events (always available)
- `vscode.workspace.onDidChangeTextDocument`
- `vscode.window.onDidChangeActiveTextEditor`
- `vscode.window.onDidChangeTextEditorSelection`
- `vscode.window.onDidOpenTerminal` / terminal data events

These reset the idle clock. When idle time passes 280 s (4 min 40 s) without a
ping having been sent, the ping fires.

### Method 2 — VS Code Language Model API (Claude Code only, optional)
`vscode.lm.selectChatModels({ vendor: 'anthropic' })` — if Claude Code exposes
a chat participant, we can watch for assistant messages via the LM API and reset
the timer on each reply. This is the cleanest signal.

### Method 3 — Session file watching (future)
Claude Code stores session state under `~/.claude/projects/<slug>/`. A watcher
on that directory can detect when new assistant messages are written, same
principle as cache-timer but pointed at the Claude Code path structure.

---

## Ping Dispatch Methods (in priority order)

### Method A — VS Code Chat API (best, if available)
```ts
// vscode.chat is proposed API — check availability at runtime
const participant = await vscode.chat.createChatParticipant(...)
```
Not yet stable. Fall through to B if unavailable.

### Method B — Clipboard paste (works today, semi-manual)
1. Write the keepalive message to clipboard
2. Execute `workbench.action.chat.open` to focus the chat
3. Execute `editor.action.clipboardPasteAction` to paste into the input
4. Show status bar notification: **"Cache ping ready — press Enter"**

This is exactly what `cache-timer` does. It is not fully automatic but it is
one keypress.

### Method C — Notification with text copy (fallback)
Show a VS Code notification: `"Cache expiring in 30s — click to copy ping"`.
User clicks, message goes to clipboard, they paste manually.

### Default recommendation
Ship with **Method B** as the default. Gate Method A behind a feature flag so
it can be enabled when the VS Code chat API stabilises.

---

## Auto-ping Cap (from forge-relay design)

```
keepAliveStreak: number   // consecutive pings since last real turn
keepAliveMaxPings: number // default 7, configurable
```

After `maxPings` consecutive auto-pings with no real activity, stop pinging and
let the cache go cold. A real user message resets `keepAliveStreak = 0`.

This bounds idle cost to `maxPings × ping_cost` (a ping is tiny — usually a
cache-read turn, ~$0.000X).

---

## Settings

```jsonc
"cacheWarden.ttlSeconds": 280,              // default 4:40 before TTL fires
"cacheWarden.keepAliveDurationSeconds": 1800, // stop after 30 min of idle
"cacheWarden.keepAliveMaxPings": 7,         // consecutive ping cap (~28 min coverage)
"cacheWarden.targets": ["claude"],          // which Claude sidebar to watch
"cacheWarden.pingMethod": "clipboard",      // "clipboard" | "notify"
"cacheWarden.showStatusBar": true
```

---

## UI

### Status bar item (right side)
```
🕐 Cache: 3:42   ← green
🕐 Cache: 0:28   ← yellow (< 60 s)
🕐 Cache: expired ← red
```
Clicking opens the sidebar panel.

### Sidebar panel
One card per tracked session:

```
┌──────────────────────────────────┐
│  Claude Code session             │
│  ████████████░░░░░  3:42 left   │
│  [Cache Keep ON]  [Reset]        │
│  2 pings sent / 3 max            │
└──────────────────────────────────┘
```

Cache Keep toggle arms/disarms the auto-ping for that session. Reset button
restarts the keepAliveStreak counter.

---

## Tech Stack

- TypeScript strict, VS Code Extension API
- esbuild for bundling (same as Forge / Forge Relay)
- React webview for sidebar panel (same pattern as Forge)
- No runtime dependencies beyond `vscode`

---

## Key Reference Code

### Keep-alive message (reuse verbatim from forge-relay)
`n:/vs code apps/forge-relay/scripts/claude-auto-bridge.js`
→ `buildKeepAliveMessage()` lines 140–151

### Timer store pattern
`n:/vs code apps/forge-relay` → adapt `TimerManager` from cache-timer
(already read in this session — the pattern is clear)

### Clipboard paste dispatch
`cache-timer` extension (downloaded, unpacked in Downloads/cache-timer-unpacked)
→ `CacheKeepManager.sendKeepAlive()` — clipboard write + paste action

---

## File Layout (planned)

```
CacheWarden/
├── src/
│   ├── extension.ts          activation entry
│   ├── IdleTracker.ts        VS Code event hooks → idle ms
│   ├── TimerStore.ts         per-session TTL countdown
│   ├── CacheKeepManager.ts   armed state, streak, auto-fire
│   ├── PingDispatcher.ts     clipboard / notify dispatch
│   ├── StatusBarItem.ts      countdown chip
│   ├── SidebarProvider.ts    webview panel
│   └── types.ts              shared interfaces
├── webview-ui/
│   └── src/
│       ├── App.tsx
│       └── SessionCard.tsx
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
└── docs/
    └── SPEC.md               ← this file
```

---

## MVP Scope (first ship)

1. `IdleTracker` — watches editor/terminal events, fires `onIdle(ms)`
2. `TimerStore` — single shared session (no per-chat splitting yet)
3. `CacheKeepManager` — armed by default when TTL < 30 s, clipboard+paste method
4. `StatusBarItem` — countdown, click to open settings
5. Settings: `ttlSeconds`, `keepAliveMaxPings`, `pingMethod`

Codex support is not implemented yet. Per-chat splitting should stay scoped to
Claude sessions until a safe Codex tracker and keepalive path are added.
