# Handoff — 2026-07-10 (branch claude/busy-maxwell-9e40dc)

## What happened this session
Fixed the phase-label validation gap for the 'Enhance' phase in the
feature-pipeline workflow engine (`.claude/workflows/`):

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
  (see gh for URL).

## Open items (carried over, not blocking)
1. `CLAUDE.md` stale refs (`log_analysis` Serena project, nonexistent Python
   app) — user-authored rules, confirm before editing.
