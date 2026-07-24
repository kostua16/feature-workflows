The revised plan closes several review4 findings, but it still has six P1 blockers and two P2 issues.

### Findings

- **[P1] Clear the actual publish/persist skip guards** — [plan.md:75](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:75)

  The new invalidation primitive resets `_publishVerified` and `_persistVerified`, but the live extract tail decides whether to run those gates from `result.published` and `result.persist`. Leaving those result objects populated still skips republication and knowledge persistence. Clear or version both actual guard fields and add tests that assert the gate predicates—not only the verification booleans—are false after invalidation.

- **[P1] Invalidate parent outputs when a slice becomes removed** — [plan.md:64](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:64)

  An emptied slice is terminal and explicitly “NOT invalidated,” but `invalidateSliceChain` is the only planned route that stales synthesis, overview, project-index, publication, and persistence evidence. A removal-only update can therefore retain the removed slice in parent views or count it as deferred. Add a removal-specific parent invalidation path: preserve the slice-local historical artifacts, but mark its lifecycle excluded, supersede its feature/index evidence, stale aggregate views, and rerun parent publish/persist.

- **[P1] Specify an executable, collision-safe new-slice allocation algorithm** — [plan.md:59](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:59)

  “Cluster by longest-common directory prefix” does not uniquely define a partition for unrelated or nested paths, and `slice-<hex8 of sorted-cluster-paths>` requires hashing inside a function declared pure while the hashing section says only agents hash. Eight hex characters also need collision handling. Define canonical clustering pseudocode, pass validated cluster digests into reconciliation or provide an engine-available deterministic encoder, exclude removed slices from assignment candidates, and specify collision probing with permutation-invariance tests.

- **[P1] Rebuild mutable registry matches from current state, not immutable sidecars** — [plan.md:47](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:47)

  The authority order says `pipeline-state.json` outranks the registry and immutable `.identity.json`, yet registry recovery rebuilds from creation-time sidecars. After renames or content revisions, that restores stale path/fingerprint matches and can make a fresh run create a duplicate folder. Rebuild mutable `files` and revision fields from current pipeline state/source-digest records; use the sidecar only for immutable ownership and folder location, and fail closed when current revision evidence is unavailable.

- **[P1] Restrict legacy adoption scans to extraction roots** — [plan.md:90](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:90)

  The proposed `docs/**/extract/**/` scan also matches `slices/<id>/` child docsets in the existing multi-slice layout, so migration can offer or register slices as independent features. Define root qualification from pipeline state, exclude `/slices/`, `.pending`, registry/sidecar paths and nested candidates, use deterministic offer order, and add multi-slice legacy fixtures plus repeated-adoption idempotence tests.

- **[P1] Reject weak single-match feature associations** — [plan.md:42](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:42)

  A single matching path or content hash is sufficient to reuse an existing feature whenever it is the only or highest candidate. A genuinely new feature sharing one common file can therefore be attached to and overwrite the wrong docset without producing a tie. Require a defensible similarity threshold or immutable ownership evidence, block low-confidence single matches for explicit `--feature`/`--new` selection, and test overlapping scopes with shared configuration/index files.

- **[P2] Make tombstone retention consistent with replay guarantees** — [plan.md:27](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:27)

  D0 says `--confirm <pendingId>` always resolves, imposes a 30-day deletion TTL, and claims an expired record directs the user to `--resume <planDir>`—which is impossible once the mapping is deleted. The resolution table also says tombstones are never deleted. Keep a compact permanent `pendingId → planDir` locator and expire only bulky payload, retain tombstones indefinitely, or explicitly define post-expiry confirmation as a not-found error.

- **[P2] Define how `--new` creates a distinct deterministic folder** — [plan.md:85](/Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:85)

  `--new` is documented as forcing a new folder, but the same scope deterministically derives the same `featureId` and `planDir`; the collision guard then sees the same ownership digest rather than a distinct identity. Define a stable disambiguator and resulting registry/sidecar semantics, mutual exclusion with `--feature`, and tests proving `--new` cannot overwrite or alias the existing feature.

The new/existing promotion split, immutable ownership versus mutable revision distinction, full digest persistence, upfront hash validation, deterministic removed-slice terminal status, and no-demote evidence history are otherwise materially improved. No source files were modified during this review.
