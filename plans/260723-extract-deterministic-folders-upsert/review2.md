The revised plan is materially better, but it still has five P1 blockers and one P2 issue.

### Findings

- **[P1] Finalize `planDir` only after scope confirmation** — [plan.md:31](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:31)

  The plan writes the manifest and checkpoint under the preflight-derived directory, then allows confirmation to change the scope and re-derive `planDir`. The current checkpoint persists state under the original directory and resumes from that path. Define a bootstrap state location plus atomic promotion/relocation, or defer every `planDir`-scoped write until confirmation.

- **[P1] Reconcile membership-based identity with in-place updates** — [plan.md:43](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:43)

  Adding a file changes `scopeId` and possibly `area`/`primary-slug`. `--update` nevertheless keeps the old directory, while a subsequent fresh run derives a new directory from the updated membership. The same feature can therefore split into two docsets. Use an identity that survives membership evolution, or define folder migration plus a stable lookup/redirect mechanism.

- **[P1] Specify deterministic slice-ownership reconciliation** — [plan.md:51](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:51)

  “Reconcile membership + ownership” does not define which slice receives an added or moved file, how removed files and slices are handled, or how overlapping/ambiguous ownership is resolved. Define a pure algorithm with stable slice IDs, exactly-one-owner enforcement, orphan handling, and tests for add/remove/move/new-slice cases.

- **[P1] Invalidate durable queue and parent-derived state** — [plan.md:55](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:55)

  Multi-slice guards are reconstructed from `slice.artifacts`, but the proposed helper targets `sliceState`. It also leaves `overviewPath`, synthesis state, publish/persist guards, readiness, status projection, and handoff potentially stale. Invalidation must update the durable queue entry, slice-local state, and every affected parent artifact. Add a crash-resume test immediately after invalidation.

- **[P1] Remove mutable `entryPoints` from the folder slug** — [plan.md:42](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:42)

  The lexicographically smallest entry point is ordered, but the entry-point set is discovered from code and can change after an ordinary edit even when the file set is unchanged. That still changes `primary-slug`. Derive it from stable file identity or persist the initial slug as part of the feature identity.

- **[P2] Replace the truncated FNV folder identity** — [plan.md:43](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:43)

  Twelve hex characters provide 48 bits, not the approximately `1.8e19` namespace claimed for full 64-bit FNV. FNV-1a is also not collision-resistant. Use a sufficiently long SHA-256 prefix and verify any existing directory’s identity sidecar before upserting.

The repository-relative path rule and framed content digest now adequately address their previous findings. No files were modified during this review.
