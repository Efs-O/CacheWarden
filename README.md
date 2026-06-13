# CacheWarden

> Keep Claude Code's Anthropic prompt cache warm — auto-ping before the 5-minute TTL expires.

CacheWarden is a VS Code extension that watches your Claude Code sessions and fires
an inert keep-alive turn just before the prompt cache's 5-minute TTL lapses. That
avoids the ~2–4s latency spike and the extra `cache_creation` token cost you'd
otherwise pay on your next real message after an idle gap.

It works **per session**: open three Claude Code windows and each gets its own
independent countdown, ping streak, and on/off switch.

## Why

Anthropic's prompt caching keeps your conversation context "hot" for 5 minutes
after each turn. Step away longer than that and the cache expires — the next
message has to rebuild it, which is slower and bills `cache_creation` tokens.
CacheWarden sends a tiny no-op turn (no tools, no prose) a few seconds before the
TTL, re-anchoring the window so your context stays cached while you're idle.

## Features

- **Per-session tracking** — one card per active Claude Code session, scoped to the
  current workspace.
- **Automatic keep-alive** — a Claude Code `Stop` hook fires the ping when a reply
  finishes; the chain re-anchors after each successful ping.
- **Per-session pause** — turn keep-alive off for one session without touching the
  others. The button is green when armed, red when paused, with a `PAUSED` badge.
- **Status bar countdown** — the most-urgent session's remaining time, at a glance.
- **Bounded** — caps consecutive pings and total idle duration so it stops on its
  own when you've clearly walked away.

## How it works

On activation CacheWarden installs a small `Stop` / `UserPromptSubmit` hook into
`~/.claude/settings.json` and a keep-alive script at
`~/.claude/cache-warden-keepalive.js`. When a Claude reply finishes, the hook
arms a per-session countdown; just before the TTL it resumes the session headless
(`--fork-session --print`, with all hooks disabled) to send an inert keep-alive
turn, then deletes the throwaway fork. The Claude binary is auto-detected at
runtime (override with `cacheWarden.claudePath` if needed).

The keep-alive turn is deliberately inert:

```
[AW_TURN_TYPE: keep-alive]
This is a cache keep-alive maintenance turn.
Do not use tools.
Do not post to the board.
Do not inspect or edit files.
Do not emit natural-language prose.
If the CLI requires a reply, emit only the inert marker [AW_KEEPALIVE_OK].
```

## What it changes on your system

CacheWarden is transparent about touching your Claude Code setup. When enabled it:

- **Writes a hook into `~/.claude/settings.json`** — adds `Stop` and
  `UserPromptSubmit` entries that run its keep-alive script. It only inserts/removes
  its own entries and leaves your other hooks untouched. Disabling the extension
  removes them.
- **Installs a script at `~/.claude/cache-warden-keepalive.js`** — the keep-alive
  runner, rewritten on each activation to match the installed version.
- **Stores per-session state under `~/.claude/cache-warden/`** — countdown anchors
  and ping counts, pruned automatically after 24h.
- **Sends keep-alive turns to Claude Code** — each ping resumes your session
  headlessly in a throwaway fork (with all hooks disabled), submits the inert
  message above, then deletes the fork. These turns are real API calls; they
  consume `cache_read` tokens (the point is to *avoid* the larger `cache_creation`
  cost on your next message), and they count against your usage like any turn.

Nothing leaves your machine beyond the normal Claude Code traffic, and removing the
extension reverts all of the above.

> **Status: pre-release / work in progress.** Actively developed and tested mainly
> on Windows. Expect rough edges, and please file issues.

## Install

**From VSIX:**

```bash
code --install-extension cache-warden-0.3.0.vsix
```

Or in VS Code: Extensions panel → `…` menu → **Install from VSIX…**

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `cacheWarden.ttlSeconds` | `280` | Idle seconds before a keep-alive ping (20s before the 5-min TTL). |
| `cacheWarden.keepAliveDurationSeconds` | `1800` | Stop pinging after this much total idle (30 min). |
| `cacheWarden.keepAliveMaxPings` | `7` | Max consecutive pings per idle session (~28 min coverage). |
| `cacheWarden.targets` | `["claude"]` | Which assistant to watch (Claude only for now). |
| `cacheWarden.hookEnabled` | `true` | Install the Claude Code hook that fires pings automatically. |
| `cacheWarden.pingMethod` | `"clipboard"` | How pings are prepared (`clipboard` or `notify`). |
| `cacheWarden.showStatusBar` | `true` | Show the cache countdown in the status bar. |
| `cacheWarden.claudePath` | `""` | Absolute path to the Claude Code binary. Empty = auto-detect. |

## Current support

- **Claude Code** — implemented.
- **Codex** — not implemented yet (the `targets` setting is reserved for future expansion).

## Build from source

```bash
npm install
npm run build     # esbuild bundle → dist/
npm run watch     # incremental
npm run package   # produce a .vsix
```

Press `F5` in VS Code to launch an Extension Development Host.

## License

[Apache-2.0](LICENSE) © Efs-O
