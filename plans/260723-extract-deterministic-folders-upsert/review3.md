The revised plan closes the mutable-entry-point slug and FNV findings, but it still has six P1 blockers and one P2 issue.

### Findings

- **[P1] Define an addressable, idempotent scratch-confirmation protocol** — [plan.md:27](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:27)

  Before confirmation there is no `planDir`, but the plan does not define a CLI/handoff argument that locates `<pendingId>.json`; the current confirmation flow resumes with `--resume <planDir>`. It also deletes scratch only after extraction, leaving replay ambiguity after folder/registry creation. Define an explicit pending-resume command, scratch lifecycle states, atomic promotion to an authoritative `featureId`/`planDir`, and crash-idempotent replay tests for every promotion boundary.

- **[P1] Make lifetime registry matching work for complete renames and ambiguous candidates** — [plan.md:42](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:42)

  Anchor equality plus path overlap cannot find a one-file feature—or an entire scope—after all paths are renamed. Move detection happens later during slice reconciliation, so a fresh run creates a second docset despite G1 and the rename acceptance test. The overlap threshold and candidate-tie behavior are also still open. Persist content fingerprints usable before registry selection, fix the threshold and tie rules, and block ambiguous matches rather than silently creating or reusing a feature.

- **[P1] Make registry, sidecar, and pipeline-state updates transactional** — [plan.md:39](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:39)

  The registry, `.identity.json`, and pipeline state are three copies of identity state, but the plan defines no authority order, atomic write protocol, concurrency control, or recovery for a crash between them. Updating registry membership before extraction can expose stale documentation as current, while concurrent extractions can lose registry entries. Specify one authoritative record, compare-and-swap or per-feature atomic updates, root-last commit ordering, and recovery tests for missing, stale, corrupt, and concurrent writes.

- **[P1] Finish the ownership algorithm and persist the data needed for move detection** — [plan.md:54](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:54)

  An unmatched added file can currently become a new slice, an orphan, or an LLM-assigned file; Q5 leaves that policy unresolved, contradicting the claim that reconciliation is pure and fully specified. Additionally, move recognition requires an old per-file content digest, but the persistence contract stores only an aggregate slice digest and file paths. Select one deterministic orphan policy, define prefix scoring and hint matching precisely, validate the exact-one-owner partition, and persist per-file fingerprints with duplicate-content ambiguity handling.

- **[P1] Reset publication and persistence guards during invalidation** — [plan.md:71](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:71)

  The parent invalidation list still omits `result.published`, `result.persist`, and affected `persistenceTracker` evidence, even though the live terminal gates skip on those flags. Updated slice documents can therefore avoid republication and knowledge persistence while status reports reuse old durability evidence. Clear those guards plus stale artifact checks/readiness evidence, and test that publish/persist and handoff durability are regenerated after an update and after crash-resume.

- **[P1] Fail closed when source hashing fails** — [plan.md:99](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:99)

  Digest comparison decides whether a slice is skipped, but the plan calls hash-agent failure “non-blocking” without defining a safe outcome. Treating the failure as unchanged can miss source changes; proceeding without a verified current digest can falsely restore readiness. Require an invalid or missing digest to conservatively invalidate and re-extract, or block the slice with `extractReady=false`; validate the digest schema before persisting it.

- **[P2] Compare full canonical identity in the collision guard** — [plan.md:44](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:44)

  `scopeId16` retains only 64 bits of SHA-256, and the proposed sidecar guard compares the hash-derived `featureId`. A genuine collision therefore produces the same `featureId` and passes the guard. Store the full SHA-256 digest or canonical framed identity inputs in `.identity.json`, compare those before upserting, and define behavior for a missing or corrupt sidecar.

The previous entry-point, repository-relative-path, framed-content, and FNV findings are otherwise addressed. No source files were modified during this review.
