# Handoff — 2026-07-10 (branch claude/busy-maxwell-9e40dc)

## What happened this session
Fixed the phase-label validation gap for the 'Enhance' phase in the
feature-pipeline workflow engine (`plugins/feature-workflows/workflows/`,
the canonical source after main's plugin-layout migration):

- `feature-pipeline.md` — extended the "Phase-label validation (I7)" recipe to
  also collect literal `phase: '...'` opts on `agent()` calls (previously it
  only grepped `phase('...')`/`stateCheckpoint('...')`, so 'Enhance' looked
  declared-but-unused).
- `feature-pipeline.js` — the extended check surfaced 'Checkpoint' and 'Decide'
  as used-but-undeclared; added both to `meta.phases`.
- Verified: ESM check recipe passes; phase-label check is clean in BOTH
  directions (undeclared=0, declared-but-unused=0).

Branch also carries earlier plugin-layout migration prep (AGENT_NS/nsAgent
namespacing, meta.version, docs path updates to plugins/feature-workflows/...).

## State
- All changes committed on `claude/busy-maxwell-9e40dc`; PR opened to main
  (see gh for URL). Merged latest main (plugin-marketplace-layout migration,
  PR #1) into this branch to resolve conflicts — only real conflict was in
  `plugins/feature-workflows/workflows/feature-pipeline.md` (same section
  edited both sides); kept the fixed recipe. Everything else auto-merged via
  git rename detection since main moved `.claude/workflows/*` and
  `.claude/agents|commands|skills/*` into `plugins/feature-workflows/`.

## Open items (carried over, not blocking)
1. `CLAUDE.md` stale refs (`log_analysis` Serena project, nonexistent Python
   app) — user-authored rules, confirm before editing.
