---
description: Install (or update) the feature-pipeline workflow engine into this project's .claude/workflows/ — required once per project before the pipeline commands can run.
argument-hint: (no arguments)
allowed-tools: Bash
---

Install the feature-pipeline dynamic-workflow engine from the plugin into the current project.
The Workflow tool resolves workflows only from the project's `.claude/workflows/` directory —
plugins cannot ship workflows directly — so the engine must be copied out of the plugin once
per project (and re-copied after plugin updates).

Run these steps via Bash. Stop and report on any failure.

1. Create the target directory:
   ```
   mkdir -p .claude/workflows/docs
   ```
2. Copy the engine and its reference docs (overwrites any previous version):
   ```
   cp "${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.js" .claude/workflows/feature-pipeline.js
   cp "${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.md" .claude/workflows/feature-pipeline.md
   cp "${CLAUDE_PLUGIN_ROOT}/workflows/docs/feature-pipeline-documentation.md" .claude/workflows/docs/feature-pipeline-documentation.md
   ```
3. Validate the copied engine as an **ES module**. Plain `node --check` parses CommonJS and
   silently passes invalid ESM — do NOT use it. Run:
   ```
   cd .claude/workflows && sed 's/^return final$/\/\/ __sandbox_return__ final/' feature-pipeline.js | node --input-type=module --check
   ```
   Exit 0 with no output = pass. On failure: report the SyntaxError, delete the three copied
   files, and stop.
4. Report the installed engine version and sanity-check it against the plugin manifest:
   ```
   grep -m1 "engine-version:" .claude/workflows/feature-pipeline.js
   grep '"version"' "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json"
   ```
   The two versions must match (the repo's CI enforces this lockstep at release time via
   `scripts/validate-plugin-versions.mjs`). If they differ here, the installed plugin package
   is internally inconsistent — report it as a plugin packaging bug and recommend
   `/plugin update feature-workflows`, but keep the installed files.
5. If the project's `.gitignore` does not cover `.claude/workflows/`, suggest (do not apply
   unasked) adding it — the installed copy is derived from the plugin, not a source of truth.

Finish by telling the user: engine `<version>` installed at `.claude/workflows/feature-pipeline.js`;
the pipeline commands are now runnable in this project:
`/feature-workflows:design-feature`, `/feature-workflows:implement-feature`,
`/feature-workflows:tune-feature`, `/feature-workflows:feature-pipeline`.
Re-run `/feature-workflows:setup` after updating the plugin.
