# Memory maintenance

How to keep these Serena memories healthy. The 7 memories `CLAUDE.md` reads on startup:
`core`, `handoff`, `session_start`, `task_completion`, `suggested_commands`, `memory_maintenance`,
`conventions`.

## Rules
- **`handoff` is the living document.** Update it at the end of every session with current state +
  next actions. Convert relative dates to absolute (e.g. "2026-07-10", not "today"). Also write the
  next handoff to `.remember/remember.md` (per the SessionStart hook).
- **`core` is stable** — only change it when invariants, structure, or the roadmap genuinely shift.
- **`session_start` is a pointer**, not content — it just routes to the other memories. Keep it thin.
- **Don't duplicate git history or code structure** into memory. Store the non-obvious *why*
  (decisions, constraints, gotchas), not what a reader can grep.
- **One concern per memory.** Before adding a new memory, check whether an existing one covers it;
  update rather than fork. Prune memories that become false.
- Cross-link with backticked `mem:` references so future sessions can traverse.

## When the pipeline's knowledge-persist gate runs
The `knowledge-persist` agent (Gate 5.5) may append findings to `CLAUDE.md` + Serena memory. Keep
those additions consistent with these conventions; consolidate duplicates during maintenance.
