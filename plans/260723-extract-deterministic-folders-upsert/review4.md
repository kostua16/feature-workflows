The revised plan substantially improves the review3 design, but it still has seven P1 blockers and one P2 issue.

### Findings

- **[P1] Retain a durable `pendingId` promotion locator** — [plan.md:30](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:30)

  The plan deletes `.pending/<pendingId>.json` immediately after promotion, then says replaying `--confirm <pendingId>` detects `PROMOTED` and locates the authoritative `planDir`. After deletion, no specified record maps that ID to the folder, and the advertised `EXTRACTING`/`DONE` scratch states cannot exist. Retain a promotion tombstone or transaction record keyed by `pendingId`, store the resulting `featureId`/`planDir`, and define recovery for every partial sidecar/registry/state write before cleanup.

- **[P1] Separate new-feature promotion from existing-feature reuse** — [plan.md:29](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:29)

  After registry lookup, D0 always writes `.identity.json`, a registry entry, and `pipeline-state.json`. If lookup found an existing feature, that path can overwrite its resumable state instead of loading it and handing off to `--resume <planDir> --update`. The collision guard is also ambiguous: comparing the requester's current `scopeDigest` with an identity sidecar created from the initial scope would reject legitimate membership/content changes. Define distinct new-versus-existing branches and separate immutable folder ownership identity from the mutable current-scope revision.

- **[P1] Use an atomically acquired lock or generation-checked registry update** — [plan.md:56](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:56)

  A busy flag inside `.registry.json` is only a check-then-replace operation. Two invocations can both read an idle entry, both write `extracting`, and overwrite whole-registry snapshots; temp-rename prevents torn JSON but does not serialize read-modify-write or protect unrelated entries. Use exclusive per-feature lock creation or CAS/generation checking with retry-and-merge, or remove the promised concurrent-same-feature guarantee and test.

- **[P1] Finish the pure ownership and removed-slice state machine** — [plan.md:66](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:66)

  `reconcileSlices(persistedSlices, currentFiles)` claims no LLM input, but the new-subsystem rule still consumes a decomposer hint. Multiple zero-score additions also lack canonical processing/grouping and stable-ID allocation rules. Finally, an emptied slice becomes `removed`, while the generic membership-change path invalidates it back to `pending`. Remove the hint dependency or make it an explicit deterministic input; define permutation-invariant batch allocation; and specify a removed-slice branch that retains history without re-extracting or republishing it.

- **[P1] Add a real persistence-evidence invalidation primitive** — [plan.md:87](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:87)

  The plan says affected `persistenceTracker` entries are marked not verified, but the live tracker deliberately refuses to demote `durably-verified` writes. It also omits the live `_publishVerified` and `_persistVerified` booleans. Define a new pure invalidation operation that versions or removes affected keys while appending an invalidation history event, enumerate the feature/synthesis/project-index keys before artifact paths are cleared, and reset both verification booleans.

- **[P1] Validate identity hashes before registry lookup** — [plan.md:45](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:45)

  Content fingerprints are required to select a feature, but hash-failure handling is defined only later during per-slice change detection. During a full rename, missing or malformed preflight hashes can yield zero registry matches and create a second folder before D2 can conservatively mark anything changed. Require complete, schema-valid per-file hashes and `scopeDigest` before `findFeature` or promotion; otherwise block identity selection unless an explicitly validated `--feature=<id>` is supplied.

- **[P1] Resolve migration for existing extract docsets** — [plan.md:158](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:158)

  Existing v1.5 folders have neither registry entries nor `.identity.json`. Leaving migration as Q1 means a fresh post-upgrade extraction cannot find the existing folder and creates another docset, violating the lifetime-folder goal. Choose and specify an explicit migration/import protocol, including identity derivation, collision handling, root-last writes, rollback/recovery, and tests proving old resume paths and new registry lookup converge on one folder.

- **[P2] Persist the full slice change digest** — [plan.md:78](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:78)

  The combined slice digest is truncated to 16 hex characters, so a 64-bit collision can classify changed sources as unchanged even though full per-file SHA-256 values are available. Persist and validate the full 64-hex SHA-256 digest; reserve truncation for display or folder naming only.

The content-aware rename matching, deterministic prefix scoring, fail-closed slice hashing, full canonical folder collision sidecar, and explicit publish/persist invalidation intent are otherwise materially improved. No source files were modified during this review.
