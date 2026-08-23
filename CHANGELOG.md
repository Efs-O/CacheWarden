# Changelog

All notable changes to CacheWarden are documented here.

## [0.3.7]

### Added
- Three-platform CI now runs the same canonical type-check, test, production
  build, and bundle-load smoke command used locally.
- Open VSX and version-independent VSIX installation guidance.
- Regression coverage for hook preservation/recovery, path containment, bounded
  transcript reads, Codex process safeguards, and Forge-generated titles.

### Changed
- Codex maintenance resumes run in a disposable isolated `CODEX_HOME` and
  explicitly disable project instructions, hooks, MCP servers, shell tools, web
  search, and approvals while retaining the ephemeral flag, read-only sandbox,
  and strict result validation.
- The release package command now builds immediately before packaging and emits
  one dependency-free canonical artifact.
- Upgraded esbuild and added a lockfile-pinned VSIX packager to remove the
  development dependency advisory and make packaging reproducible after `npm ci`.

### Fixed
- Forge-wrapped Codex sessions now use the first real user request as their card
  title, and narrow sidebar action rows wrap instead of overflowing.
- Claude hook upgrades preserve unrelated hooks even when several commands share
  one hook entry, reject malformed settings without overwriting them, invalidate
  detached chains on disable, and remove installed files after the last extension
  instance deactivates.
- Claude keep-alive subprocesses now time out, require a safe throwaway fork, and
  use Claude Code safe mode with external capabilities disabled and argument-array
  executable discovery rather than shell interpolation.
- Claude CLI failures now report the nonzero exit and bounded stderr before
  attempting to parse stdout, preserving rate-limit and authentication details.
- Claude maintenance resumes now launch in the session's recorded project
  directory so the CLI can resolve project-scoped conversation IDs.
- Claude maintenance results now require the exact inert acknowledgement after
  cleaning up the validated throwaway fork; unexpected response text fails the
  ping instead of extending its chain.
- Codex keep-alive now rejects unsafe session identifiers, completed-only tool
  events, unexpected response text, and rollout paths or metadata that do not
  identify the requested session. A validated rollout copy contains CLI writes
  so the original rollout remains unchanged even when the installed Codex CLI
  persists an `--ephemeral` resume.
- Workspace filtering now respects Windows case-insensitivity and Unix
  case-sensitivity without accepting sibling path-prefix collisions.
- Large Claude and Codex session files are read through bounded head/tail windows
  instead of blocking the extension host with unbounded whole-file reads.
- The command-palette toggle is now explicitly named for Claude and confirms its
  enabled or disabled state, avoiding a silent no-op appearance beside a Codex
  tracking-only card.
- The sidebar now uses a cryptographic nonce and an explicit webview resource
  allowlist in its Content Security Policy.

## [0.3.6]

### Fixed
- Claude card **Reset** is now scoped to that card and starts a fresh bounded
  countdown for the selected session. It no longer clears every Claude session.
- A Claude card marked **Cache Keep OFF** now arms the global Claude hook when
  necessary, then enables that session as the label promises.
- Removed Claude's non-functional **Ping Now** button. Guarded manual pings are
  available only for Codex sessions, where they can safely resume a known session.
- `cacheWarden.keepAliveDurationSeconds` now bounds Claude keep-alive chains as
  well as Codex chains.
- A transient Codex `thread-store conflict` / active-writer response now delays
  the next automatic ping for 30 seconds instead of permanently pausing it.

### Changed
- Removed the unused `cacheWarden.pingMethod` setting.

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
