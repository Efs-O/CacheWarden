# Changelog

All notable changes to CacheWarden are documented here.

## [0.3.5]

### Added
- Codex support: read-only session tracking cards (no Codex usage), plus an
  opt-in `cacheWarden.codexKeepAlive` for guarded per-session countdowns and
  keep-alive pings with caps, idle-duration limits, collision checks, and
  fail-closed pause. Keep-alive is off by default and its pings are real Codex
  turns that consume your Codex usage.
- Cached/total input-token metrics on both Codex and Claude session cards.
- Automatic discovery of native Codex executables installed by npm or bundled
  with the OpenAI VS Code extension on Windows.

### Changed
- Codex sessions present before extension activation are treated as a silent
  baseline. A card appears only after new activity, avoiding stale countdowns on
  reload.

### Fixed
- Claude cards now prefer the transcript's generated `ai-title`, matching the
  title displayed in the Claude Code tab. Sessions without an `ai-title` now use
  Claude's latest `last-prompt` instead of showing the initial prompt.
- Codex cards now prefer the generated conversation title from
  `~/.codex/session_index.jsonl`, matching the title shown by the Codex tab.
- Codex card titles now use the text after `My request for Codex` instead of
  displaying IDE-injected active-file and open-tab context.
- Manual Codex validation pings no longer fail with `spawn codex.exe ENOENT`
  when VS Code's extension host has a narrower `PATH` than the terminal.
- CacheWarden's own Codex maintenance prompt no longer resets the real-user
  activity anchor or ping streak.

## [0.3.3]

### Changed
- Session cards now show Claude's conversation title instead of only the project
  name and shortened session ID, with safe fallbacks for older sessions.

## [0.3.2]

### Added
- README screenshot of the sidebar panel showing a live session card.

## [0.3.1]

### Added
- Dismiss button (✕) on each session card to remove sessions you don't want
  cluttering the panel (e.g. closed chat tabs). Removing a session also stops its
  keepalive; a still-live chat reappears on its next turn.
- Undo for dismiss: removing a card shows an "Undo" notification and trashes the
  session state for an hour rather than deleting it outright, so an accidental ✕
  is recoverable.

## [0.3.0]

### Added
- Per-session pause/resume: toggling keep-alive on one session no longer affects
  other sessions in the same workspace.
- Color-coded keep-alive button (green = on, red = off) plus a `PAUSED` badge on
  inactive session cards.
- `cacheWarden.claudePath` setting to override the Claude Code binary location.

### Changed
- The Claude Code binary is now auto-detected at runtime instead of using a
  hardcoded path, so the extension works on any machine.

### Fixed
- `tsconfig` `module`/`moduleResolution` mismatch that surfaced a type-check error.

## [0.2.0]

### Added
- Per-session state for parallel Claude Code windows (independent countdowns and
  ping streaks).

## [0.1.0]

### Added
- Initial release: idle tracking, TTL countdown, status-bar chip, and automatic
  keep-alive pings for a single Claude Code session.
