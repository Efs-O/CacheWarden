# CacheWarden release-audit and Open VSX handoff

This file carries forward the release process that was proven on Forge 0.13.2.
It is a plan and evidence checklist for CacheWarden, not proof that CacheWarden
has already passed the audit.

## Intended outcome

Prepare one reviewed CacheWarden release artifact, land the corresponding source
on the GitHub remote, and publish the exact same VSIX to:

1. Visual Studio Marketplace, if a new Marketplace release is intended.
2. Open VSX under the existing `Efsoo` namespace.
3. An optional GitHub Release with the audited VSIX attached, if explicitly
   requested.

Open VSX is also the normal extension source for editors such as VSCodium and
Eclipse Theia. Do not invent separate uploads for downstream editors unless
they operate a distinct registry and the user explicitly asks for it.

## Starting snapshot — 2026-08-23

- Repository: `https://github.com/Efs-O/CacheWarden.git`
- Branch: `main`
- Starting HEAD: `148fdfde09a379c8280059aed6df4a783471bf9d`
- Committed version: `0.3.6`
- Current working-tree version: `0.3.7`
- Extension identity: `Efsoo.cache-warden`
- Runtime entry point: `dist/extension.js`
- CI: Ubuntu, Node 20, build, two TypeScript checks, and `test:codex`
- Packaging: `npm run package` currently runs only `vsce package`; it does not
  force a clean production build first.
- `dist/` is ignored and not tracked, so stale local output is a release risk
  unless the package command builds immediately before creating the VSIX.
- `CHANGELOG.md` and the README install example still name `0.3.6` while the
  dirty working tree declares `0.3.7`.
- `docs/**` is excluded by `.vscodeignore`, so this handoff must not enter the
  published extension.

The repository was already dirty when this handoff was added. Preserve and
review these pre-existing user changes; do not discard or overwrite them:

- `package.json`
- `package-lock.json`
- `src/CodexJsonlParser.ts`
- `src/SidebarProvider.ts`
- `tests/CodexJsonlParser.test.cjs`
- `webview-ui/src/SessionCard.tsx`

## What the Forge release taught us

The Forge audit found real issues after its first Marketplace publication:
stale public documentation, production and development dependency advisories,
package-only files that did not belong in the VSIX, an unreliable smoke test,
and release-source provenance complicated by a squash merge. The useful lesson
is the sequence below, not any Forge-specific implementation.

1. Audit first, but keep it release-bounded. Separate blockers from maintenance
   work that is safer after publication.
2. Never publish different bytes under an existing version. If audit work
   changes the artifact, bump the version.
3. Treat production and development audits separately, then remediate both
   when upgrades can be proven without weakening tests.
4. Make one canonical CI command and one canonical package command. Local CI,
   GitHub CI, and release workflows should call the same scripts.
5. Run a clean `npm ci` before the final CI/package pass so stale
   `node_modules` cannot create a false green result.
6. Inspect the VSIX itself. Source-tree cleanliness does not prove archive
   cleanliness.
7. Publish the same hashed VSIX to every registry; do not rebuild between
   uploads.
8. An upload acknowledgement is not the finish line. Wait until each public
   registry API reports the new version.
9. Check tag-triggered workflows before creating a tag. A manual upload plus an
   automatic tag publication can attempt to publish the same version twice.
10. Keep commit/push/publish authorization explicit, especially when committing
    as `Codex <codex@openai.com>`.

## CacheWarden audit scope

### 1. Repository and release provenance

- Fetch and compare `HEAD`, `origin/main`, tags, and any open release branch.
- Review every pre-existing dirty change before adding audit edits.
- Confirm the intended release version is unused on every target registry.
- Ensure `package.json`, `package-lock.json`, README examples, and changelog all
  agree on the release version.
- Decide whether the release lands through a pull request or a verified
  fast-forward to `main` before uploading the VSIX.

### 2. Functional and privacy audit

CacheWarden touches assistant session data and installs a Claude hook, so these
paths deserve more scrutiny than a generic extension:

- Confirm Claude and Codex transcript/session files are read-only everywhere
  they are meant to be read-only.
- Review hook installation, replacement, upgrade, disable, uninstall, and
  recovery behavior. Do not orphan or overwrite unrelated user hooks.
- Verify CLI discovery and spawning use explicit argument arrays, no shell
  interpolation, bounded execution, cancellation, and clear error reporting.
- Verify Codex keep-alive remains opt-in and every relevant UI/documentation
  surface says that its turns consume Codex usage.
- Verify disabling Codex keep-alive leaves read-only tracking behavior intact.
- Exercise multiple simultaneous Claude and Codex sessions, stale sessions,
  reloads, dismiss/undo, reset, pause/resume, retry, and active-writer conflict
  handling.
- Confirm all timers, watchers, filesystem handles, child processes, webview
  listeners, and VS Code disposables are released on deactivation.
- Search for telemetry, analytics, update pings, unexpected outbound traffic,
  hardcoded machine paths, credentials, tokens, and transcript contents in
  logs or packaged files.
- Verify path containment and platform behavior on Windows, macOS, and Linux.

### 3. Tests and canonical gates

Before release, make `package.json` own the complete gates. A suitable shape is:

```json
{
  "scripts": {
    "type-check": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.webview.json",
    "test": "npm run test:codex",
    "ci": "npm run type-check && npm test && npm run build",
    "package": "npm run build && vsce package --no-dependencies"
  }
}
```

Treat that as a starting proposal, not a blind patch. Check whether the build
has a release mode, whether bundle-load validation is needed, and whether any
runtime dependencies must remain outside the bundle.

Required evidence:

- `npm ci`
- Full `npm audit` and `npm audit --omit=dev`
- `npm run ci`
- `npm run package`
- Tests for every changed parser, tracker, timer, hook, and UI state transition
- A production-bundle load/activation smoke check
- GitHub CI using the same commands
- At least Windows plus one Unix CI runner for path/process-sensitive code;
  three-platform CI is preferable

Do not delete a used tool merely to reduce an audit count. Upgrade it, adapt
real incompatibilities, and rerun the gates. Do not lower coverage or remove
tests to make an upgrade green.

### 4. Manual extension-host smoke test

Automated parser tests do not prove the actual VS Code/CLI/hook integration.
Record results for at least:

- Clean install and first activation
- Claude tracking with the hook enabled and disabled
- Hook upgrade when an older CacheWarden hook already exists
- Preservation of unrelated Claude hook configuration
- Claude session reset, pause/resume, dismiss, and undo
- Codex absent, installed but logged out, and authenticated
- Codex tracking with keep-alive off
- Explicit Codex keep-alive opt-in, manual ping, automatic ping, and usage copy
- Active Codex writer conflict and delayed retry
- Multiple simultaneous sessions and VS Code windows
- VS Code reload, extension disable, and uninstall cleanup
- Missing/misconfigured CLI executables
- Status bar and sidebar agreement throughout the timer lifecycle

Write a dated smoke-status document with exact pass/fail evidence and explicitly
list any accepted non-blockers.

### 5. README and listing audit

The first screen should answer immediately:

- What problem CacheWarden solves
- Why a Claude Code or opt-in Codex user should care
- That keep-alives trade a small maintenance turn for avoiding cache recreation
- That Codex keep-alive is off by default and consumes usage
- What CacheWarden reads or changes on the machine

Also verify:

- Screenshots and GIFs are current and packaged or remotely resolvable.
- Install instructions cover Marketplace, Open VSX, and VSIX without hardcoding
  a stale filename.
- Settings, defaults, commands, supported platforms, and limitations match the
  manifest and implementation.
- Privacy language matches every filesystem, process, hook, and network action.
- `CHANGELOG.md` contains the final release entry.
- Marketplace description, categories, keywords, icon, repository, license,
  bugs URL, and publisher are accurate.
- The positioning is specific. Avoid presenting CacheWarden as a generic AI
  assistant; its wedge is bounded prompt-cache maintenance with visible,
  per-session control.

### 6. Package inspection

After all source and documentation changes are final:

1. Run the canonical package command once.
2. Record the VSIX filename, version, file count, size, and SHA-256.
3. Inspect `extension/package.json`, `extension.vsixmanifest`, and packaged
   README from inside the archive.
4. Confirm `dist/extension.js`, the webview bundle, icons, license, README, and
   required runtime assets are present.
5. Confirm source, tests, docs, `.github`, `.vscode`, `.coordination`, local
   configs, source maps, build configs, test output, VSIX files, secrets, and
   machine paths are absent.
6. Re-run `git diff --check` and require a clean worktree after the release
   commit.

Do not run the package command again after recording the release hash unless
the new artifact is re-inspected and the recorded hash is replaced. ZIP
metadata can change the hash even when source bytes have not changed.

### 7. Credentials and publication

Use the exact case-sensitive publisher/namespace `Efsoo`. Tokens must remain in
the relevant credential store or environment and never enter Git, YAML, logs,
or this document.

Preflight commands:

```powershell
npx vsce verify-pat Efsoo
npx ovsx verify-pat Efsoo
npx vsce show Efsoo.cache-warden --json
Invoke-RestMethod https://open-vsx.org/api/Efsoo/cache-warden
```

A 404 from the Open VSX API is expected before the first publication. Verify
that `cache-warden` is the correct Open VSX extension name derived from the
manifest; do not guess a different identifier from the display name.

After explicit authorization, publish the already-inspected artifact:

```powershell
npx vsce publish --packagePath .\cache-warden-<version>.vsix
npx ovsx publish .\cache-warden-<version>.vsix
```

Then verify:

- GitHub `main` points to the audited release commit.
- Required GitHub CI jobs succeeded for that exact commit.
- Visual Studio Marketplace publicly reports the new version.
- Open VSX publicly reports the new version.
- The public README, icon, description, links, and version history render as
  intended on both registries.
- The local worktree is clean and the published VSIX hash is recorded.

## Definition of done

The CacheWarden release is complete only when all of the following are proven:

- Reviewed source and documentation for the intended version are on the remote.
- Production and development dependency audits have no unresolved release
  blockers.
- Canonical local gates and remote CI pass for the release commit.
- Manual extension-host smoke evidence covers the real hook and CLI paths.
- The exact audited VSIX was uploaded to every authorized registry.
- Each public registry reports the intended version and renders the intended
  listing.
- Remaining maintenance items are documented with severity and rationale.
- No secrets, user transcripts, machine paths, or unrelated working-tree
  changes were committed or packaged.

## First action in the future audit session

Start by reading `CLAUDE.md`, this handoff, `package.json`, `.vscodeignore`, the
CI workflow, and the current dirty diff. Do not publish or normalize the
worktree until the ownership and intent of the existing `0.3.7` changes are
understood.
