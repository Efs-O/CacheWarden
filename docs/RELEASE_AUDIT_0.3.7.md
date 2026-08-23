# CacheWarden 0.3.7 release audit

Date: 2026-08-23
Status: version 0.3.7 is published and publicly verified on both registries.
Completed evidence and remaining manual coverage gaps are recorded below.

## Provenance

- Repository: `https://github.com/Efs-O/CacheWarden.git`
- Branch: `main`
- Audited base: `148fdfde09a379c8280059aed6df4a783471bf9d`
- `origin/main` matched the audited base after `git fetch --prune origin`.
- Intended version: `0.3.7`
- Visual Studio Marketplace latest version at preflight: `0.3.6`
- Open VSX preflight for `Efsoo.cache-warden`: `404 Not Found` (first publication)
- No release tags or tag-triggered publication workflow were present.

The pre-existing 0.3.7 worktree changes were reviewed and retained: the version
bump, Forge transcript title extraction and its regression test, and narrow
sidebar layout fixes. `FORGE.md` remains user-owned and is excluded from the
VSIX. The handoff and this audit document are also excluded by `.vscodeignore`.

## Automated evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Clean dependency install | Pass | `npm ci`; 299 packages installed |
| Full dependency audit | Pass | `npm audit`; 0 vulnerabilities |
| Production dependency audit | Pass | `npm audit --omit=dev`; 0 vulnerabilities |
| Canonical local gate | Pass | `npm run ci`; type checks against the declared VS Code 1.85 minimum, 31 tests, production build, and bundle-load smoke passed |
| Replacement remote CI | Pass | Commit `0fdf8957141bf64629f97c841831b0116913743f`; GitHub run `32657734535` passed on Ubuntu, Windows, and macOS |
| Codex CLI argument compatibility | Pass | Installed `codex-cli 0.147.0` accepted the generated read-only ephemeral resume arguments through `resume --help` without an API call |
| Claude CLI argument compatibility | Pass | Installed Claude Code 2.1.185 exposes the safe-mode, hook/tool disable, resume, fork, print, and JSON flags used by the generated hook |
| Marketplace credential preflight | Pass | `npx vsce verify-pat Efsoo` verified the publisher PAT without printing it |
| Open VSX credential preflight | Pass | `npx ovsx verify-pat Efsoo` confirmed publish access without printing the token |
| Package inclusion preview | Pass | `npx vsce ls --tree`; only manifest/listing files, `dist` bundles, and release icons remain |
| Canonical package | Pass | `cache-warden-release.vsix`; 134,665 bytes; 10 ZIP entries / 8 extension files; SHA-256 `FB3888CB7C156EA3C43B227A09F55E5DF582A762B96F1A43C5EBFA9A40632991` |
| Clean VSIX activation | Pass | Isolated VS Code profile installed `efsoo.cache-warden@0.3.7` from the canonical artifact and activated it without a CacheWarden or CSP error |
| Whitespace check | Pass | `git diff --check` |
| Secret/machine-path scan | Pass | No credentials, private keys, or hardcoded user-home paths found in release inputs |

The first CI run for release-source commit `bf27701b3f2734a3127f17f7731c80c56e4ae472`
passed on Ubuntu and macOS but exposed a Windows-only portability error in a
test: a clean runner correctly returned the supported `codex.exe` PATH fallback,
while the assertion required an installed file. The assertion now accepts that
fallback and still requires existence for resolved absolute binaries; the
expected `where.exe` miss is also silenced. Publication remained paused pending
a clean replacement matrix.

Replacement release commit `0fdf8957141bf64629f97c841831b0116913743f`
passed all three jobs in GitHub Actions run `32657734535`. The Node 20 runtime
deprecation annotation emitted by `actions/checkout@v4` and
`actions/setup-node@v4` is upstream workflow-action maintenance and did not
affect any job; it is a follow-up rather than a 0.3.7 blocker.

The current canonical package preview contains eight extension files:
`CHANGELOG.md`, `LICENSE`, `README.md`, `package.json`, both production bundles,
and the two release icons. Source, tests, docs, project scaffolding, source maps,
the screenshot, `FORGE.md`, the lockfile, and existing VSIX files are excluded.

## Safety findings fixed for 0.3.7

- Claude settings updates now preserve unrelated commands within mixed hook
  entries and refuse malformed settings instead of replacing them.
- Disarming rotates every active chain token; last-instance deactivation removes
  CacheWarden's hooks, script, and state without affecting unrelated hooks.
- Claude executable discovery uses argument arrays, session and fork IDs are
  validated, project containment is checked before deleting a fork transcript,
  and the subprocess has a 90-second timeout. Claude Code safe mode disables
  skills, plugins, MCP, browser integration, slash commands, hooks, and tools.
- Codex maintenance uses the documented read-only sandbox flag and an ephemeral
  resume. User config, exec rules, project instructions, approvals, hooks, MCP
  servers, shell tools, agents, and web search are disabled for the invocation.
- Each Codex maintenance process receives a private disposable `CODEX_HOME`
  containing only a validated copy of the requested rollout and a local hard
  link to `auth.json` when present. Physical path containment, filename, and
  `session_meta` ID checks fail closed; the directory is removed after exit.
- Codex results require the original thread ID, successful completion, no tool
  events, and exactly `[CACHE_WARDEN_OK]`; active children are terminated during
  extension disposal.
- Claude and Codex transcript reads are bounded. Workspace matching is
  case-insensitive on Windows, case-sensitive on Unix, and rejects sibling
  prefix collisions.
- Numeric settings are clamped in the manifest and runtime so a malformed or
  externally edited value cannot create a rapid keep-alive loop.

## Accepted non-blockers

- `npm ci` reports deprecation notices for `whatwg-encoding` and
  `prebuild-install`. Both are development-only transitives of the current
  `@vscode/vsce` release; `prebuild-install` is under optional `keytar`.
  The full and production audits are clean, and removing the packager would
  weaken release reproducibility.
- npm reports unapproved install scripts for esbuild, optional keytar, and
  `@vscode/vsce-sign`. The platform esbuild package still makes all gates pass;
  signing is not used by the package-only command. This should be monitored when
  npm's install-script policy or the packager changes.
- React 19, TypeScript 7, and Node 26 type definitions are maintenance upgrades,
  not release fixes. CacheWarden remains on the tested React 18, TypeScript 5,
  and Node 20 lines.

## Manual extension-host smoke status

In progress. Each unchecked item below remains a release blocker until dated
evidence is added.

Windows evidence recorded 2026-08-23 with VS Code 1.134.0, Claude Code 2.1.185,
and Codex CLI 0.147.0: an isolated Extension Development Host loaded the current
source, activated `Efsoo.cache-warden` without an extension-host error, rendered
the sidebar's Codex tracking-only card, installed exactly one CacheWarden command
under both Claude hook events while preserving unrelated commands, and removed
both commands on clean host shutdown. The first interactive pass also exposed an
ambiguous silent Claude toggle beside a Codex-only card; the command was renamed
and given explicit enabled/disabled confirmation. The post-fix reload produced
both expected confirmations and restored exactly one command under each hook
event. That reload also surfaced VS Code's missing-webview-CSP warning; the policy
now uses a cryptographic nonce and an explicit local-resource allowlist. A fresh
isolated host emitted no CSP warning, and Chromium runtime inspection confirmed
that the live sidebar iframe contained the policy, loaded only the local bundle,
and used the exact nonce allowed by `script-src`. The reused profile's warning was
stale webview state and is not reproducible on the clean-install path.
Opening a second isolated development host created a second instance lease
without duplicating either hook. Closing that host removed only its lease; the
original host retained one live lease and one command under each hook event.

A bounded live Codex probe used two maintenance turns. The first authenticated,
tool-free resume completed in the requested session with the exact inert
acknowledgement, but Codex CLI 0.147.0 appended 31,474 bytes to the original
rollout despite its documented `--ephemeral` flag. The prefix was verified
byte-for-byte, the appended records were validated as only that maintenance
turn, and the rollout was restored to its exact pre-probe size and SHA-256. A
second run against a disposable `CODEX_HOME` completed with the same session ID,
zero tool calls, and the exact acknowledgement while the original rollout's
size and SHA-256 remained unchanged. The temporary home was then removed. This
finding produced the permanent isolation described above; no further Codex
turns are authorized or required for this audit pass.

The bounded Claude probe used its two authorized attempts without reaching the
provider. The first nonzero CLI exit exposed that empty stdout was parsed before
stderr, hiding the failure reason. After correcting and reinstalling that
diagnostic path, the second attempt reported `No conversation found with session
ID`; the generated hook had not launched Claude in the session's recorded
project directory. The hook now validates and supplies that directory to the
subprocess, with regression assertions for both findings. The original Claude
transcript remained unchanged and no Claude process or throwaway fork remained.
The original two-attempt authorization was exhausted at that point; another
attempt was deferred until the user supplied fresh authorization.

With fresh authorization, one additional single-ping attempt used the corrected
working directory and completed successfully. The hook accepted a distinct,
safe fork ID, recorded exactly one ping, deleted the fork, and left the original
77,099-byte transcript at its exact pre-test SHA-256; the project JSONL count
also returned to its baseline and no Claude process remained. Review of that
success path found that the JSON response text was not yet checked. The hook now
requires the exact `[AW_KEEPALIVE_OK]` result after deleting the validated fork,
and unexpected text fails rather than continuing the chain. No additional
provider call was made for that final fail-closed assertion.

After the final fixes, a new isolated Extension Development Host was launched
from the rebuilt source with the same bounded settings. Its 2026-08-23 21:05:49
extension-host log records activation of `Efsoo.cache-warden` with no
CacheWarden error or CSP warning. The installed Claude configuration still had
exactly one CacheWarden command under each supported event and retained both
unrelated `Stop` commands.

The normal VS Code profile currently has `efsoo.cache-warden@0.3.7` installed,
but its `dist/extension.js` hash differs from this audited build. It is a stale
local development package and must not be used as smoke evidence. Run the current
source through an Extension Development Host (`F5`) and confirm the window title
contains `[Extension Development Host]` before testing.

Suggested smoke settings keep the exercise bounded while remaining within the
manifest's validated ranges:

```json
{
  "cacheWarden.targets": ["claude", "codex"],
  "cacheWarden.ttlSeconds": 30,
  "cacheWarden.keepAliveDurationSeconds": 120,
  "cacheWarden.keepAliveMaxPings": 2,
  "cacheWarden.hookEnabled": true,
  "cacheWarden.codexKeepAlive": false
}
```

Before the first run, record a hash or recoverable copy of
`~/.claude/settings.json`. After activation, verify exactly one CacheWarden
command exists under both `Stop` and `UserPromptSubmit`, including when an
unrelated command shares the same hook entry. After disabling the hook setting
and after closing the last development-host window, verify those two commands
are gone while the unrelated entry remains.

- [x] Clean VSIX install and first activation (Windows, 2026-08-23)
- [x] Claude tracking with hook enabled and disabled (Windows, 2026-08-23)
- [ ] Upgrade from an older CacheWarden hook
- [x] Preservation of unrelated Claude hook entries (Windows, 2026-08-23)
- [ ] Claude reset, pause/resume, dismiss, and undo
- [x] Claude fork cleanup and bounded-chain behavior (Windows, 2026-08-23)
- [ ] Codex absent, installed but logged out, and authenticated
- [x] Codex tracking with keep-alive off (Windows, 2026-08-23)
- [ ] Explicit Codex opt-in, manual ping, automatic ping, and usage copy
- [ ] Active Codex writer conflict and delayed retry
- [x] Multiple Claude/Codex sessions and multiple VS Code windows (Windows, 2026-08-23)
- [ ] VS Code reload, extension disable, and uninstall cleanup
- [ ] Missing and misconfigured CLI executable paths
- [ ] Status bar and sidebar agreement throughout the timer lifecycle
- [ ] Windows smoke plus one Unix extension-host smoke

For each item, record the date, OS, VS Code version, Claude/Codex CLI version,
observed sidebar/status text, and any relevant notification. Do not paste
transcript contents, credentials, or the full Claude settings file into this
document.

## Release completion

The user explicitly authorized staging, committing, pushing, creating a new
local VSIX, and publishing it to both registries. The release was completed as
follows:

1. Release-source commit `bf27701b3f2734a3127f17f7731c80c56e4ae472`
   was pushed to `main`. Its first CI run exposed the clean-Windows test issue
   documented above; packaging and publication remained paused.
2. Replacement release commit `0fdf8957141bf64629f97c841831b0116913743f`
   was pushed and passed the Ubuntu, Windows, and macOS matrix.
3. `npm run package` was run once. The resulting artifact was inspected as
   version `0.3.7`, publisher `Efsoo`, with no source, tests, docs, lockfile,
   source maps, `FORGE.md`, or nested VSIX content.
4. A clean isolated profile installed and activated that exact VSIX.
5. The unchanged artifact was accepted by the Visual Studio Marketplace and
   Open VSX. Both public version-specific downloads matched the local SHA-256.
   Marketplace's public latest-version index reported `0.3.7` at
   2026-08-23 18:30:19 UTC; Open VSX reported `0.3.7` published at
   2026-08-23 18:24:27 UTC. Both version-specific README assets contained the
   intended isolation/Open VSX copy and no stale 0.3.6 install filename.

Unchecked manual scenarios above remain explicit follow-up coverage gaps. They
were not silently converted into passes when the user authorized publication.
