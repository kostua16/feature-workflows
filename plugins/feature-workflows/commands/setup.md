---
description: Doctor/repair for the feature-pipeline engine install — diagnoses the user-level ~/.claude/workflows/ symlinks, recreates them, validates the plugin engine, and cleans up legacy per-project copies. The pipeline commands self-repair automatically; run this when something looks wrong.
argument-hint: (no arguments)
allowed-tools: Bash, AskUserQuestion
---

Diagnose and repair the feature-pipeline dynamic-workflow engine install. Since v1.5.0 the engine
is not copied into projects: the Workflow tool resolves it from user-level `~/.claude/workflows/`,
where each file is a symlink into the installed plugin (`${CLAUDE_PLUGIN_ROOT}/workflows/`), so
plugin updates propagate automatically. The pipeline commands create and repair these links on
their own — this command is the explicit doctor for when something looks wrong (or after moving
the plugin).

The three managed targets (paths relative to `~/.claude/workflows/`):

- `feature-pipeline.js` → `${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.js`
- `feature-pipeline.md` → `${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.md`
- `docs/feature-pipeline-documentation.md` → `${CLAUDE_PLUGIN_ROOT}/workflows/docs/feature-pipeline-documentation.md`

Run these steps via Bash. Report each step's outcome.

1. Diagnose each of the three targets `p` and report one state per file:
   - SYMLINK-OK — `[ -L p ]`, target exists, and `readlink p` equals the current plugin path
   - SYMLINK-STALE — `[ -L p ]`, target exists, but `readlink p` points somewhere else
   - DANGLING — `[ -L p ] && [ ! -e p ]` (plugin moved or uninstalled since the link was made)
   - PLAIN-COPY — `[ -e p ] && [ ! -L p ]` (copy fallback in use, e.g. symlinks unavailable)
   - MISSING — `[ ! -e p ] && [ ! -L p ]`
2. Repair anything that is not SYMLINK-OK:
   ```
   mkdir -p ~/.claude/workflows/docs
   ln -sfn "${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.js" ~/.claude/workflows/feature-pipeline.js
   ln -sfn "${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.md" ~/.claude/workflows/feature-pipeline.md
   ln -sfn "${CLAUDE_PLUGIN_ROOT}/workflows/docs/feature-pipeline-documentation.md" ~/.claude/workflows/docs/feature-pipeline-documentation.md
   ```
   If `ln -sfn` fails (e.g. Windows without developer mode), fall back to `cp` of the same three
   files and report that the install is in copy-fallback mode: the pipeline-command preflights
   re-copy automatically whenever the copy's `engine-version:` drifts from the plugin's.
3. Validate the plugin engine as an **ES module**. Plain `node --check` parses CommonJS and
   silently passes invalid ESM — do NOT use it. Run:
   ```
   cd "${CLAUDE_PLUGIN_ROOT}/workflows" && sed 's/^return final$/\/\/ __sandbox_return__ final/' feature-pipeline.js | node --input-type=module --check
   ```
   Exit 0 with no output = pass. On failure: report the SyntaxError as a plugin packaging bug and
   recommend `/plugin update feature-workflows`. Do NOT delete anything — a link to a broken
   plugin is a diagnosis, not something to destroy.
4. Report the engine version and sanity-check it against the plugin manifest:
   ```
   grep -m1 "engine-version:" "${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.js"
   grep '"version"' "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json"
   ```
   The two versions must match (the repo's CI enforces this lockstep at release time via
   `scripts/validate-plugin-versions.mjs`). If they differ here, the installed plugin package is
   internally inconsistent — report it as a plugin packaging bug and recommend
   `/plugin update feature-workflows`. If any target is in PLAIN-COPY mode, also show that copy's
   `engine-version:` header (with symlinks, installed == plugin by construction).
5. Check for legacy per-project copies (pre-1.5.0 installs):
   ```
   test -e .claude/workflows/feature-pipeline.js && echo LEGACY-ENGINE
   test -e .claude/workflows/feature-pipeline.md && echo LEGACY-REFERENCE
   test -e .claude/workflows/docs/feature-pipeline-documentation.md && echo LEGACY-DOC
   ```
   If any exist, explain that project-level workflows shadow the user-level engine, so a stale
   project copy would run instead of the current one. Ask the user (AskUserQuestion) whether to
   delete the legacy files; only on an explicit yes, `rm` the found files (and remove the
   `.claude/workflows/docs` / `.claude/workflows` directories if now empty). Never delete without
   a yes. Mention that a leftover `.claude/workflows/` entry in the project's `.gitignore` (old
   setup advice) is now unnecessary and can optionally be removed.
6. Finish with a summary: state of each target (symlink or copy-fallback), engine `<version>`, any
   legacy copies found/removed, and a reminder that the pipeline commands
   (`/feature-workflows:design-feature`, `/feature-workflows:implement-feature`,
   `/feature-workflows:tune-feature`, `/feature-workflows:extract-design`,
   `/feature-workflows:review-design`, `/feature-workflows:feature-pipeline`,
   `/feature-workflows:pipeline-status`) self-repair this install automatically — this doctor
   command is only needed for diagnosis and legacy cleanup.
