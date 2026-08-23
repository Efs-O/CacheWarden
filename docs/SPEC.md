# CacheWarden technical specification

CacheWarden is a VS Code extension that observes Claude Code and, optionally,
Codex sessions in the current workspace. It keeps an idle prompt cache warm with
bounded, inert maintenance turns.

## Providers

### Claude Code

When `cacheWarden.hookEnabled` and the `claude` target are enabled, CacheWarden
installs its own `Stop` and `UserPromptSubmit` hooks in `~/.claude/settings.json`.
The hooks maintain per-session state under `~/.claude/cache-warden/sessions/`.

- A real user prompt invalidates that session's existing keep-alive chain.
- A completed response starts a per-session countdown.
- At `ttlSeconds`, the generated hook resumes the session in a throwaway fork,
  with Claude Code safe mode, hooks, skills, plugins, MCP, browser integration,
  slash commands, and built-in tools disabled, using an inert prompt.
- The chain ends at either `keepAliveMaxPings` or
  `keepAliveDurationSeconds`, measured from the end of the real response.
- Cards can pause/resume or reset one session. A reset supersedes that session's
  existing timer and begins a fresh bounded countdown.

### Codex

When `codex` is included in `cacheWarden.targets`, CacheWarden incrementally
observes new activity under `~/.codex/sessions/`. Historical rollout files are a
silent baseline after extension activation; a card appears only after new activity.

`cacheWarden.codexKeepAlive` is opt-in because each maintenance turn consumes
Codex usage. When enabled and a session has been idle for `ttlSeconds`,
CacheWarden runs `codex exec resume` with user configuration and rules ignored,
an ephemeral read-only sandbox, project instructions and external tools disabled,
and a 90-second timeout. It accepts a result only if it is for the original
thread, completes successfully with the exact inert acknowledgement, and has no
tool calls. Ephemeral execution keeps the maintenance turn out of rollout files.

If Codex reports an active thread writer, CacheWarden treats that as transient:
it does not issue a competing write, waits 30 seconds, then re-evaluates the
session. Other failures pause automatic keep-alive and notify the user.

## Sidebar controls

Each card represents one session.

- **Cache Keep ON/OFF** pauses or resumes that session. Clicking an OFF Claude
  card also arms the global Claude hook when that is the only missing prerequisite.
- **Reset** is scoped to the selected card and clears its streak. For an armed
  Claude or Codex card, it also starts a fresh countdown.
- **Ping Now** is shown only for opted-in Codex cards. It is disabled while Codex
  is active and otherwise submits one guarded validation turn.
- **Dismiss** removes the card. Claude dismissals offer Undo; a live session can
  reappear after its next activity.

## Configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `cacheWarden.ttlSeconds` | `280` | Idle seconds before a maintenance ping. |
| `cacheWarden.keepAliveDurationSeconds` | `1800` | Maximum total idle coverage for a session. |
| `cacheWarden.keepAliveMaxPings` | `7` | Maximum consecutive maintenance pings. |
| `cacheWarden.targets` | `["claude"]` | Providers to observe: `claude`, `codex`, or both. |
| `cacheWarden.hookEnabled` | `true` | Install Claude hooks and permit Claude keep-alive. |
| `cacheWarden.showStatusBar` | `true` | Show the most urgent session in the status bar. |
| `cacheWarden.claudePath` | `""` | Absolute Claude executable path; empty auto-detects. |
| `cacheWarden.codexPath` | `""` | Absolute Codex executable path; empty auto-detects. |
| `cacheWarden.codexKeepAlive` | `false` | Permit guarded Codex maintenance turns. |

## Safety properties

- Maintenance prompts are inert and instruct the model not to use tools or edit
  files.
- Claude runs in a fork and removes the throwaway fork transcript after success.
- Codex uses a read-only sandbox and validates thread identity, completion, and
  zero tool calls, while disabling project instructions, hooks, MCP servers,
  shell tools, and web search for the maintenance invocation.
- Codex writer conflicts do not make the extension bypass Codex locking; they
  simply postpone automatic work.
- Claude settings updates are atomic, preserve unrelated hooks, and fail without
  overwriting malformed JSON. Disarming invalidates detached keep-alive chains.
- Transcript reads are bounded and never write to Claude or Codex transcripts.
