# Handoff — 2026-07-15 (branch claude/setup-command-org-37b6c9)

## What happened this session
Replaced the per-project engine install with a **user-level symlink install** (target: v1.5.0).
User disliked `/setup` copying the 340KB engine into every project's `.claude/workflows/`.
Decision (user-confirmed via plan mode): engine lives as symlinks in `~/.claude/workflows/`
pointing at `${CLAUDE_PLUGIN_ROOT}/workflows/…`; NOTHING is created in consuming projects;
commands self-repair; `/setup` becomes a doctor/repair command.
Basis: docs/dynamic-workflows.md:182 — Workflow tool resolves `~/.claude/workflows/` too.

- `commands/setup.md` rewritten as doctor: diagnose (SYMLINK-OK/STALE/DANGLING/PLAIN-COPY/
  MISSING), repair via `ln -sfn` (cp fallback for Windows), ESM-validate the PLUGIN engine
  (no delete-on-failure anymore), version report, interactive removal of legacy pre-1.5.0
  project copies (they SHADOW the user-level engine). allowed-tools: Bash, AskUserQuestion.
- All 7 pipeline commands: one **byte-identical** preflight `## Preflight — engine link must
  be healthy` (6 inline checks incl. legacy-copy detection) + silent auto-repair (ln||cp) +
  legacy-shadow rule (proceed+note on version match, STOP→/setup on drift). Old
  drift-AskUserQuestion flow deleted; pipeline-status's soft variant folded in. Frontmatter
  gained Bash(ln/mkdir/cp/readlink:*). Rewrite done via scratchpad script for byte-identity.
- Engine: `state.mjs` flushPipelineState now stamps `engineVersion: meta.version`;
  `main.mjs` resume warns (non-blocking) + sets `result._resumeEngineSkew` on skew (symlink
  tracks plugin, so resume-after-update runs a newer engine). Old states lack the field →
  silent. Both files now import meta (build strips imports; meta literal emitted first).
- `build-workflows.mjs` banner scriptPath → `~/.claude/workflows/…`; validate-plugin-versions
  comment reworded; plugin.json description updated; docs updated (QUICKSTART §2 "No project
  setup" + upgrade note + new troubleshooting rows, root README, plugin README "Why a doctor
  command", feature-pipeline.md + feature-pipeline-documentation.md recipes → plugin dir /
  `~/.claude/workflows`).
- Tests: new `tests/command-preflight.test.mjs` (byte-identity across 7, user-level markers,
  no project-path refs except Legacy lines, Bash perms, setup-is-doctor assertions);
  config-and-state extended (engineVersion optional in validate; flushPipelineState stamp ==
  engine header); harness CANDIDATES += flushPipelineState. **190 tests green**, rebuild done,
  validate:build/versions/agents + ESM check all pass at 1.4.2.

## State
- All changes UNCOMMITTED on branch `claude/setup-command-org-37b6c9` (22 modified + 1 new file).
- Version still 1.4.2 — bump happens via `npm run release -- 1.5.0` (single bump site), NOT hand-edit.

## Next
1. **SPIKE GATE (required, manual, live session with Workflow tool)** — could not run here (no
   Workflow tool in this session): (a) `~/.claude/workflows/wf-spike.js` resolves by name?
   (b) symlink followed? (c) project vs user precedence (expected: project wins → calibrates
   legacy-shadow warning). If symlinks fail but user-level copies work → Branch B: make the
   preflight's cp fallback primary (drop readlink/target lines). If user-level fails entirely →
   design not implementable, revert.
2. After spike passes: commit, then `npm run release -- 1.5.0`.
3. Dogfood per plan §verification: fresh project → pipeline-status auto-creates links; break
   link → self-repair; plant stale legacy copy → STOP→/setup; full /design-feature run;
   --resume on pre-engineVersion state stays silent.
- Known residue (pre-existing): Gate 0.2 facts prompt hardcodes Serena project "log_analysis";
  feature-pipeline-documentation.md still describes the 3-mode engine (needs its own refresh).
- Plan file: ~/.claude/plans/i-dont-like-how-jolly-widget.md
