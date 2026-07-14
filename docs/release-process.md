# Release process (option 2+4: tag-pinned plugin source + GitHub Release assets)

_Decision context: `docs/workflow-decomposition-investigation.md` (stage-1 build) and the
option comparison in PR discussion. End users install a **released, pinned build** — never an
unreleased `main` state — and never build anything themselves._

## How distribution works

- The marketplace **catalog** (`.claude-plugin/marketplace.json`) is fetched from the repo's
  default branch when users run `/plugin marketplace add kostua16/feature-workflows` /
  `/plugin marketplace update`.
- The **plugin content** is fetched from wherever the catalog entry's `source` points. After
  the first release this is a **`git-subdir` pin**:

  ```json
  "source": {
    "source": "git-subdir",
    "url": "https://github.com/kostua16/feature-workflows",
    "path": "plugins/feature-workflows",
    "ref": "v1.5.0",
    "sha": "<40-char commit sha>"
  }
  ```

  `git-subdir` (not `github`) because the plugin lives in a subdirectory — a `github` source
  expects the plugin manifest at the repo root. With both `ref` and `sha` set, the **sha is the
  effective pin** (immutable even if the tag is moved or deleted, on hosts that serve commits
  by sha).
- So `main` can move freely between releases: users' catalogs refresh, but plugin content stays
  at the pinned release commit until a new pin commit lands.

## Cutting a release

From a clean checkout of `main`:

```bash
npm run release -- 1.5.0
git push --follow-tags origin main
```

`scripts/release.mjs` does, locally (nothing pushed) and safely re-runnable — if any
validation step fails, the version bump and rebuilt dist are **auto-reverted** (tree clean
again), so fixing the failure and re-running is always possible:

1. Guards: clean tree, on `main` (`--allow-branch` to override for testing), tag free,
   version **strictly greater** than the current one (a downgrade is never a release —
   rollbacks repoint the pin instead, see below).
2. Bumps `plugin.json` (the **single** version bump site — the build injects the
   `// engine-version:` header and `meta.version` into the dist).
3. `npm run build` + the full validation suite (`validate:build`, `validate:versions`,
   `validate:agents`, `npm test`).
4. Commit `chore(release): vX.Y.Z` + annotated tag `vX.Y.Z`.
5. Pins the catalog to the tag (`scripts/pin-marketplace.mjs --release vX.Y.Z`, sha resolved
   locally) and commits `chore(release): pin marketplace to vX.Y.Z`.

The pin commit deliberately lands **after** the tag: the catalog is consumed from `main`, not
from the tag, so the tag never needs to contain its own pin (no chicken-and-egg).

The pushed tag triggers `.github/workflows/release.yml`, which re-validates the tagged tree
from scratch (dist freshness, lockstep, agents, tests, ESM check) and publishes a **GitHub
Release** with auto-generated notes and attached artifacts: `feature-pipeline.js`,
`feature-pipeline.md`, `checksums.txt` (SHA-256). The workflow never writes to branches — it
only verifies and publishes, so a failed run is safely re-runnable.

## Creating the Release from the GitHub UI

"Releases → Draft a new release" is also supported, with two things to know:

1. **The tag must target a commit whose `plugin.json` already carries that version** — the
   workflow's first gate rejects any tag whose tree says otherwise. In practice that means the
   release-prep commit must already be on `main` (the `npm run release` commit, or a
   version-consistent merge like tagging `v1.4.1` on a tree at 1.4.1). You cannot invent
   `vX.Y.Z` from the UI for a version that no commit carries.
2. UI release creation makes the Release object first and the tag push triggers the workflow —
   which detects the existing Release and **attaches the validated artifacts to it** (keeping
   your notes) instead of creating a duplicate.

After a UI-created release, the **catalog pin is still your step** (the release script normally
does it): `npm run marketplace:pin -- --release vX.Y.Z`, commit, push — otherwise end users
keep installing the previous pin (or track `main` before the first release).

## Rollback

One command + one commit — repoint the pin at any previous tag:

```bash
npm run marketplace:pin -- --release v1.4.1
git add .claude-plugin/marketplace.json && git commit -m "chore(release): roll back marketplace to v1.4.1"
git push origin main
```

Users pick it up on their next `/plugin marketplace update`. The bad release's tag/Release can
stay for the record (or be yanked independently).

## Pin integrity check (CI)

Because end users install whatever the pin points at, `scripts/validate-marketplace-pin.mjs`
(`npm run validate:pin`) runs in the PR/main CI (`validate-plugin.yml`) and hard-fails if the
pinned source is inconsistent: the `ref` must be an existing `vX.Y.Z` tag (fetched on demand in
shallow CI checkouts), the `sha` must be exactly the commit that tag points at, and
`plugin.json` **at the pinned commit** must carry the version the tag names. A typo'd or
hand-edited `ref`/`sha` therefore cannot reach `main` unnoticed. Before the first release
(relative-path source) the check passes trivially.

## Dogfooding after the first release

Once the catalog is release-pinned, a local `/plugin marketplace add ./` would fetch plugin
content from the pinned tag — not your working tree. For local development, flip the entry to
the relative path and **don't commit it**:

```bash
npm run marketplace:pin -- --dev     # source -> ./plugins/feature-workflows
# ... dogfood ...
git checkout .claude-plugin/marketplace.json
```

## First release / migration note

Until the first `npm run release` run, the catalog still uses the relative-path source (there
is no tag to pin to yet) — installs behave exactly as before this change. The first release
flips the entry to the pinned form automatically.

## Cadence

Releases are deliberate (script + tag), not per-merge. If per-PR releases are ever wanted, the
same machinery applies with a post-merge auto-bump workflow (conventional-commit driven) and
bot commits to `main` — see the option comparison discussion; the failure-mode analysis favors
keeping the whole release in git either way.
