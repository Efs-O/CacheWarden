# Experimental Codex Support Plan

## Goal

Add optional, per-session Codex tracking and keep-alive support without changing
the proven Claude Code path. Codex support must remain disabled by default until
we demonstrate that a keep-alive turn improves `cached_input_tokens` and does not
corrupt, fork, or compete with the active IDE conversation.

## What exists today

### Claude Code path

- Claude hooks (`UserPromptSubmit` and `Stop`) provide session lifecycle events.
- The hook writes per-session state under `~/.claude/cache-warden/sessions/`.
- A detached process resumes the exact session after the TTL and records a ping
  only after a successful inert turn.
- `CacheKeepManager` polls that state and exposes cards, countdowns, pause, reset,
  and dismiss behavior.

### Current Codex capabilities observed locally

- Codex CLI version tested during planning: `0.144.1`.
- Sessions are persisted as JSONL beneath
  `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.
- `session_meta` contains the session ID, working directory, source, originator,
  and CLI version.
- Lifecycle events include `task_started`, `user_message`, and `task_complete`.
- `token_count` events expose both `input_tokens` and `cached_input_tokens` for
  the last turn and the session total.
- `codex exec resume <session-id> <prompt>` can resume a precise session without
  opening an interactive picker.
- Codex reports its hooks feature as stable, but the experiment does not depend
  on undocumented hook payloads initially.

These interfaces are observable current behavior, not a guarantee that an inert
resume preserves the server-side prompt cache. That is what the experiment must
measure.

## Design

### 1. Separate providers

Do not add Codex conditions throughout `HookInstaller` and `CacheKeepManager`.
Introduce a small provider boundary:

```text
SessionProvider
  listSessions(workspace): SessionState[]
  pause(id) / resume(id)
  dismiss(id)
  forcePing(id)
  dispose()

ClaudeSessionProvider   (adapts current behavior)
CodexSessionProvider    (new experimental implementation)
SessionCoordinator      (merges and sorts provider states for the UI)
```

Add `provider: 'claude' | 'codex'` to `SessionState` so IDs cannot collide and
the card can show a small provider label. Keep all Claude state paths and hook
installation behavior unchanged.

### 2. Configuration

- Extend `cacheWarden.targets` to allow `"codex"`.
- Keep the marketplace default as `["claude"]` during the experiment.
- Add `cacheWarden.codexPath` for an optional CLI override; otherwise resolve
  `codex` from PATH.
- Add `cacheWarden.codexExperimentalKeepAlive`, default `false`.
- Tracking may be enabled independently from keep-alive execution.

### 3. Codex session discovery

- Watch `~/.codex/sessions` recursively and perform a bounded startup scan.
- Parse JSONL incrementally using file offsets; never reread every complete file
  once per second.
- Use `session_meta.payload.id` as the stable ID and `cwd` for workspace scope.
- Prefer an explicit thread/session name if present; otherwise use the first real
  `user_message`, shortened with the same rules as Claude labels.
- Treat `task_started` as active and `task_complete` as the countdown anchor.
- Ignore cloud, subagent, or non-interactive sessions initially unless we can
  identify them unambiguously as the current IDE thread.
- Store CacheWarden-only pause/dismiss/counter state under
  `~/.codex/cache-warden/sessions/<session-id>/`; never edit Codex rollout files.

### 4. Codex keep-alive execution

Only when both the Codex target and experimental keep-alive flag are enabled:

```text
codex exec resume <session-id> <inert-prompt>
  --json
  --skip-git-repo-check
  --sandbox read-only
  --ask-for-approval never
```

- Use an inert prompt that explicitly forbids tools, file edits, external actions,
  commits, and natural-language output beyond one marker.
- Spawn without a shell, hide the window on Windows, capture bounded stdout and
  stderr, and enforce a timeout.
- Never pass `--dangerously-bypass-approvals-and-sandbox`.
- Before launching, confirm the rollout has remained idle and no newer
  `task_started` or user event has appeared.
- Serialize pings per session and cancel a pending chain on new activity.
- Count a ping only after a successful `task_complete` for the resumed session.
- Detect accidental forks by comparing the emitted session/thread ID; stop the
  chain immediately if it differs.

### 5. UI behavior

- Show Claude and Codex sessions in the existing card list.
- Add a compact provider indicator and keep per-session pause/dismiss controls.
- While tracking-only mode is active, show Codex cards without an armed
  countdown and explain that experimental keep-alive is disabled.
- Report the last Codex ping result and cached-token observation in the tooltip
  or diagnostic output, not as noisy notifications.

## Test plan

### Phase A: parser fixtures and tracking only

1. Add sanitized JSONL fixtures for session metadata, lifecycle events, malformed
   partial lines, token counts, and two parallel sessions.
2. Verify incremental parsing, workspace filtering, title extraction, active/idle
   transitions, restart recovery, and no duplicate cards.
3. Verify Claude behavior and its deployed hook script remain byte-for-byte
   equivalent except for provider adaptation.
4. Run build, TypeScript checks, and focused provider tests.

Pass gate: tracking is correct for two simultaneous IDE sessions and adds no
Codex turns.

### Phase B: controlled manual keep-alive experiment

Use a disposable test repository and a dedicated Codex session with no valuable
uncommitted work.

1. Record the session ID and a baseline normal turn's `input_tokens` and
   `cached_input_tokens`.
2. Wait beyond the suspected cache TTL and record a second normal-turn baseline.
3. Start a fresh comparable session, send a normal turn, then trigger one inert
   resume before the TTL expires.
4. Inspect JSONL output for the same session ID, exactly one added user/assistant
   turn, no tool calls, no file changes, and successful completion.
5. After the original TTL boundary, send the comparable normal turn and compare
   `cached_input_tokens` against the no-ping baseline.
6. Repeat at least three times to avoid treating normal cache variance as proof.
7. During one run, type a real IDE prompt near the scheduled ping and verify the
   ping cancels without overlapping the live turn.

Pass gate: all repetitions stay on the same session, perform no tools or writes,
avoid concurrent turns, and show a consistent material cached-input benefit.

### Phase C: soak and regression

1. Run Claude and Codex sessions concurrently for at least 30 minutes.
2. Test two Codex sessions in one workspace and sessions in separate workspaces.
3. Test pause/resume, dismiss/undo, extension reload, VS Code restart, missing CLI,
   malformed JSONL, a moved/pruned rollout, command timeout, and failed auth.
4. Confirm no background process survives a cancelled session chain.
5. Confirm CPU and disk activity remain negligible while idle.

Pass gate: no Claude regression, no cross-session ping, no orphan processes, and
clear recovery/error behavior.

## Merge criteria

Merge to `main` only when all of the following are true:

- Phase A, B, and C pass with recorded evidence.
- Cached-token measurements demonstrate benefit; a successful resume alone is
  insufficient.
- No tool calls, file writes, forks, or concurrent-turn errors occur.
- Codex support remains opt-in and experimental in settings and documentation.
- The final branch includes tests, changelog notes, and an uninstall path that
  removes only CacheWarden-owned state.

If the cache benefit cannot be demonstrated, keep tracking-only Codex support as
a separate decision and do not ship automated Codex keep-alive.

## Implementation order

1. Extract the provider interface while preserving Claude behavior.
2. Implement the incremental Codex JSONL parser and tracking-only provider.
3. Add fixtures/tests and validate parallel session tracking.
4. Add the guarded Codex resume runner and diagnostics.
5. Execute the controlled cache experiment and record results in this document.
6. Run soak/regression tests.
7. Review evidence, then either merge, revise, or abandon the keep-alive feature.
