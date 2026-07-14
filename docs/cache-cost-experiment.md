# Cache keep-alive: cost & benefit experiment

This document records what CacheWarden's keep-alive ping actually does to prompt-cache
metrics, the methodology used to measure it, and — honestly — the limits of the evidence
gathered so far. It is provider-neutral: the method applies to any CLI that resumes a
session and reports per-turn input vs. cached-input token counts.

The findings were originally captured during the experimental Codex investigation
(`archive/codex-support` tag). The Codex *code* was dropped; this analysis is kept because
it is the durable, reusable part.

## What we are trying to prove

A keep-alive ping is only worth sending if it delivers a **material cached-input benefit**:
by resuming a session before its server-side cache TTL expires, the next *real* turn should
be billed as a cheap `cache_read` instead of an expensive `cache_creation` rebuild — and the
ping itself must be cheap enough that the trade nets out favorably.

A successful resume alone is **not** proof. Cache metrics must be measured before and after,
and normal cache variance must be ruled out with repetition.

## Method (control-vs-refresh)

Use a disposable session with no valuable uncommitted work.

1. Record a baseline normal turn's `input_tokens` and `cached_input_tokens`.
2. Wait past the suspected cache TTL and record a second normal-turn baseline (the "cold"
   control — this is what you pay with no keep-alive).
3. In a fresh comparable session, send a normal turn, then trigger **one inert resume**
   before the TTL expires.
4. Verify the resume: same session ID, exactly one added user/assistant turn, **no** tool
   calls, **no** file writes, successful completion.
5. After the original TTL boundary, send the comparable normal turn and compare its
   `cached_input_tokens` against the cold-control baseline from step 2.
6. Repeat **at least three times** — one run is indistinguishable from normal cache variance.
7. In one run, type a real prompt near the scheduled ping and confirm the ping cancels
   without overlapping the live turn.

**Pass gate:** every repetition stays on the same session, performs no tools/writes, avoids
concurrent turns, and shows a consistent, material cached-input benefit versus the cold control.

## Evidence gathered

### Claude Code (proven: TTL reset works)

- Cold session, first ping: `cache_creation` ≈ 26021 tokens, `cache_read` 0.
- Second ping within the TTL window: `cache_read` ≈ 26021, `cache_creation` 0.

This demonstrates the mechanism: an in-TTL resume is served from cache and re-anchors the TTL,
so the *following* turn avoids a `cache_creation` rebuild. It confirms the ping does what it
claims; it does not by itself quantify net savings across an arbitrary idle pattern.

### Codex CLI (2026-07-11: safety proven, cost benefit BLOCKED)

- Guarded inert resumes stayed on the exact original session ID, with zero tool events and
  successful completion. After hardening the runner with `--ignore-user-config`,
  `--ignore-rules`, and `-c sandbox="read-only"`, it created no workspace files and left
  `git status` clean.
- Immediate token observation after a same-session inert turn: **`12032` cached / `12260`
  input** — i.e. the ping turn itself was served almost entirely from cache (cheap).
- **The timed control-versus-refresh comparison could not complete**: the account usage limit
  was reached before either final probe. Both probes failed closed with no tools.
- **Result: PASS** for same-session / no-tool / no-write safety; **BLOCKED** for cache-benefit
  evidence until usage resets.

## Honest conclusion

- The ping is **safe** (no tools, no writes, same session) and **cheap** (the ping turn rides
  the existing cache).
- The ping **resets the TTL** so the next real turn can be a `cache_read` (proven on Claude).
- The **net cost/benefit over a full idle-then-resume cycle is not yet quantified.** Whether
  keep-alive saves money depends on the idle pattern: many pings during a long idle can cost
  more than simply eating one `cache_creation` when you return.
- CacheWarden's dependable, defensible value is therefore **latency** — avoiding the ~2–4s
  cold-cache rebuild spike on your next message — with token savings as a situational bonus,
  not a guarantee.

If a future run completes the timed comparison (≥3 repetitions showing a consistent material
benefit), record the numbers here and the "situational bonus" framing can be upgraded.
