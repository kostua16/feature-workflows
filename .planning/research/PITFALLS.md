# Domain Pitfalls

**Domain:** Project-scale reverse-design extraction in a bounded dynamic-workflow engine
**Project:** feature-workflows v1.5.0 Project-Scale Extract Design
**Researched:** 2026-07-22
**Overall confidence:** HIGH — repository source, tests, project constraints, and runtime notes agree

## Recommended Milestone Phase Map

The phase names below are used throughout the prevention guidance so each risk has an explicit home.

| Phase | Scope | Exit condition most relevant to pitfalls |
|---|---|---|
| **1. State, Coverage, Migration, and Revision Contracts** | Status vocabulary, coverage invariant, manifest/feature schemas, v1.4.5 migration, revision invalidation | Old state hydrates deterministically; incomplete work cannot satisfy readiness; stale evidence invalidates selectively |
| **2. Bounded Discovery, Validated Graph, and Schedulability** | Bounded inventory, stable feature identity, paginated decomposition, graph validation | Every inventory item is owned, excluded with a reason, or reported unassigned; graph is schedulable |
| **3. Multi-Entry Build, Install, and Version Lockstep** | Top-level and leaf generation, copy/symlink installs, version/release drift | Both workflow entries install, resolve, version, and release together without drift |
| **4. Checkpointed Feature Leaf** | `fp-extract-slice`, gate checkpoints, isolated feature state, parent/child protocol | Interruption at every material gate resumes without repeating verified work or losing artifacts |
| **5. Bounded Scheduler and Transactional Automatic Continuation** | Dependency-aware ready queue, retries, fairness, per-segment budgets, automatic continuation | One command crosses segment boundaries safely; every segment proves progress or stops truthfully |
| **6. Synthesis, Publish, Persist, and Status Truth** | Incremental overview/coverage index, verification, publishing, handoff/status | Published and reported state is tied to the latest verified coverage snapshot |
| **7. Compatibility and Project-Scale Proof** | Cross-mode contract tests, migration fixtures, ceiling/failure E2Es, dogfooding | Design/tune/review/implement/status still consume feature docsets; whole-project scenarios pass |

## Critical Pitfalls

### 1. Treating `skipped`, `blocked`, or capped work as completed coverage

**What goes wrong:** The orchestrator drains only `pending` entries, verifies artifacts only for `done` entries, then sets `extractReady=true` as long as at least one slice completed. A run can therefore announce “Extraction complete” while other slices are blocked or were omitted by `--max-slices`/`--slices`.

**Why it happens:** The current queue overloads `skipped` for two different meanings: explicitly deselected and merely over the per-run cap. `nextPendingSlice()` ignores both `skipped` and `blocked`. The terminal path counts blocked/skipped entries for the message but does not make either prevent readiness.

**Repository evidence:** `seedExtractQueue()` marks both deselected and over-cap entries `skipped` (`extract-scope.mjs:42-60`); `nextPendingSlice()` selects only `pending` (`extract-scope.mjs:66-68`); terminal readiness is assigned after verifying only `doneSlices` (`main.mjs:1200-1255`). Existing tests codify over-cap work as `skipped` and cycles as acceptable input order (`tests/extract-mode.test.mjs:82-115`).

**Consequences:** False whole-project completion, permanently invisible deferred work, misleading coverage percentages, and a resume that has nothing runnable even though the project is incomplete.

**Prevention (Phase 1):** Define the non-overlapping durable feature lifecycle statuses exactly as `runnable`, `deferred`, `in-progress`, `blocked`, `failed`, `skipped`, `excluded`, and `completed`. Represent pre-queue discovery in a separate phase field, and represent retryable versus terminal classification, provenance, and diagnostics in separate reason/evidence fields alongside attempts and transition sequence; none of those metadata values is a lifecycle status. A cap moves work to `deferred`, never `skipped`; a selector changes the declared scope or creates an explicit exclusion with provenance. Compute readiness from a single invariant: inventory is complete, graph is valid, every in-scope feature is `completed`, every mandated artifact is verified, and project synthesis covers the same manifest revision. `blocked`, `failed`, and `deferred` prevent readiness; unassigned inventory is coverage evidence outside the feature lifecycle and also prevents readiness.

**Detection:** Contract tests where one of N features is capped, blocked, failed, or newly discovered must assert `extractReady=false`, exact remaining counts, and a runnable continuation. Add a state-transition table test that rejects illegal terminal transitions.

### 2. Building an automatic continuation loop that can spin without progress

**What goes wrong:** “One user command” becomes an unbounded chain of identical segments: the same blocked/deferred feature is selected, no durable cursor advances, and the command repeatedly re-invokes the workflow until the runtime ceiling or token budget throws.

**Why it happens:** A simple `while (remaining)` loop confuses user-visible continuity with one Workflow invocation. Parent and child workflows share the same 1,000-agent counter, token budget, concurrency cap, and abort signal; calling a child does not reset capacity. Runtime resume is also not the durable cross-session contract.

**Repository evidence:** Runtime constraints are explicit in `docs/dynamic-workflows.md:158-183` and `docs/workflow-decomposition-investigation.md:22-39`. The project explicitly rules out a literally unbounded invocation and requires automatic bounded segments (`.planning/PROJECT.md`, Out of Scope and Runtime capacity). The current extract loop has no progress-generation or no-progress guard (`main.mjs:1092-1170`).

**Consequences:** Runaway cost, ceiling crashes before state/handoff is written, duplicate agent work, and a command that appears hung rather than resumable.

**Prevention (Phase 5):** Make a segment a first-class persisted unit with `segmentId`, manifest revision, start cursor, end cursor, call/token/retry usage, and a progress delta. Stop scheduling before capacity is exhausted, reserve budget for parent-state flush plus handoff, and return `continuation-required`. The command driver may launch the next top-level segment automatically, but only after verifying a durable state revision increased or a feature/gate transition occurred. Repeat of the same progress fingerprint is a hard `no-progress` stop with an actionable report, not another loop.

**Detection:** E2Es for a permanently invalid child result, zero remaining budget, unchanged state revision, command-driver restart, and interruption between segment return and relaunch. Assert finite invocations and a durable continuation point in every case.

### 3. Claiming gate-level resume while persisting only after a whole slice

**What goes wrong:** An interruption after facts, E2E, or detailed-design generation loses the in-memory paths. On resume the feature restarts from its initial gate, potentially overwriting artifacts or paying for the same work again.

**Why it happens:** `extractSlice()` updates `sliceState` after each gate but does not flush it. The parent copies those paths into `slice.artifacts` and writes slice-local state only after `extractSlice()` returns. The parent queue is also flushed only after that return. The comment that interrupted sub-gates resume from recorded paths is therefore true only for a normally returned blocked outcome, not a kill/abort mid-call.

**Repository evidence:** Gate paths are assigned inside `extractSlice()` (`extract-slice.mjs:17-217`), while slice artifact copying and both local/parent flushes happen in the caller after the child returns (`main.mjs:1110-1170`). The current test checks “flush after each slice,” not after each gate (`tests/extract-mode.test.mjs:232-237`).

**Consequences:** Duplicate token spend, partial overwrite, inconsistent parent and feature state, and failure to meet the milestone’s first-incomplete-gate resume contract.

**Prevention (Phase 4):** Give the leaf workflow ownership of one sharded feature-state file and require a checkpoint acknowledgement after every material transition: gate started, artifact written, artifact verified, gate completed, gate blocked. Checkpoint payloads carry a monotonic revision and artifact digest. The parent manifest stores only compact feature status, state path, revision, summary digest, and dependency metadata. Do not advance the parent to the next feature until the child’s terminal-or-continuation checkpoint is acknowledged.

**Detection:** Fault-injection tests abort immediately before and after every gate write and checkpoint. Resume must invoke exactly the first unverified gate, preserve already verified files, and reconcile parent/child revisions deterministically.

### 4. Migrating v1.4.5 state by “accepting any result object”

**What goes wrong:** Older monolithic state hydrates with ambiguous defaults, new statuses silently disappear, or parent and feature shards disagree about which schema they implement. A checksum-valid file can still be semantically invalid.

**Why it happens:** `PIPELINE_STATE.result` is intentionally unconstrained (`type: object`), and `validatePipelineState()` validates only four top-level strings, a result object, optional config, and an optional checksum. There is an engine-version warning, but no explicit state schema version or migration chain.

**Repository evidence:** `schemas.mjs:655-683`, `state.mjs:121-140`, `state.mjs:252-272`, and resume hydration in `main.mjs:84-124`. The checksum detects truncation, not invalid queue transitions, duplicate identities, stale artifact claims, or unsupported future state.

**Consequences:** Corruption mistaken for resumable work, data loss during a rolling upgrade, impossible rollback, and cross-mode consumers reading half-migrated feature docsets.

**Prevention (Phase 1):** Add explicit `stateSchemaVersion` independently of plugin/engine version. Implement pure, ordered migrations from v1.4.5 to the project-manifest schema and from legacy slice entries to feature shards. Normalize missing fields before validation; validate semantic invariants after migration; reject unsupported future versions. Preserve the original file or previous generation until the migrated state is durably verified. Keep additive defaults for existing `planDir`, artifact paths, and cross-mode fields.

**Detection:** Golden fixtures for fresh v1.4.5 extract/design/tune/review states, corrupt-but-checksum-valid states, partially migrated manifests, unknown future versions, and rollback/re-resume. Run each fixture through status plus the intended next mode.

### 5. Making readiness a flag instead of a proof over one coverage snapshot

**What goes wrong:** `extractReady`, `designReady`, overview content, feature artifacts, and reported counts describe different moments. A stale truthy flag survives changes to the queue or source.

**Why it happens:** The current terminal mutates readiness directly. Required project-level synthesis is non-blocking; `overviewPath` existence is enough to skip regeneration; verification checks basic file existence/headings, not whether artifacts cover the latest sources and manifest.

**Repository evidence:** system overview failure is explicitly non-blocking (`extract-slice.mjs:223-254`); overview runs only when `!result.overviewPath` (`main.mjs:1173-1178`); artifact verification checks paths of `doneSlices`, then sets `extractReady` (`main.mjs:1199-1241`); `verifyArtifactPresence()` is existence/size/headings based (`state.mjs`).

**Consequences:** False readiness after later continuation, stale synthesis after a newly completed feature, and downstream tune/review operating on a partial baseline.

**Prevention (Phases 1 and 6):** Replace “flag set” as authority with a derived readiness proof containing `manifestRevision`, `inventoryDigest`, `graphDigest`, completed/excluded/remaining counts, required-artifact verification results, synthesis input digest, and verification revision. Persist `extractReady` only as a cached projection of that proof and invalidate it whenever any input revision changes. Missing required synthesis blocks complete readiness while still allowing a truthful partial report.

**Detection:** Mutate one feature status, artifact digest, graph edge, or inventory revision after a ready snapshot; status must immediately become partial and synthesis must be scheduled again.

### 6. Hiding dependency cycles and dangling edges with stable input order

**What goes wrong:** A dependent feature runs before an unresolved prerequisite, a cycle is silently treated as schedulable, or a typo in `dependsOn` is ignored. The extracted design then misses integration context or bakes in contradictory ownership.

**Why it happens:** The current ordering algorithm falls back to remaining input order for both cycles and dangling references. Dependency information is discarded from the queue entry, so later scheduling cannot enforce it or explain why a feature is blocked.

**Repository evidence:** `seedExtractQueue()` treats unknown dependencies as already satisfied and falls back on cycles (`extract-scope.mjs:33-47`); the returned queue entries omit `dependsOn` (`extract-scope.mjs:48-61`). Tests explicitly expect cycles to fall back and dangling edges not to deadlock (`tests/extract-mode.test.mjs:74-96`).

**Consequences:** Incorrect extraction order, dependents running with absent summaries, non-deterministic results, and queue starvation that is impossible to diagnose from persisted state.

**Prevention (Phase 2):** Validate unique node IDs, edge targets, self-edges, and strongly connected components before scheduling. Reject accidental dangling edges. For a real architectural cycle, persist the SCC explicitly and either extract it as one bounded composite feature or use a documented two-pass strategy; never silently linearize it. Preserve dependencies in the manifest and compute the runnable set from completed prerequisites. A blocked prerequisite blocks only its dependents, not independent components.

**Detection:** Fixtures for self-cycle, two-node cycle, large SCC, dangling ID, blocked prerequisite, and independent branch. Status must name the blocking edge/SCC and still schedule independent work.

### 7. Starving the queue with first-match scheduling or retries

**What goes wrong:** A large early feature monopolizes segment capacity, retryable failures never get another fair attempt, or a blocked prerequisite causes later independent work to wait indefinitely.

**Why it happens:** Current scheduling always picks the first `pending` entry and converts any child failure to `blocked`; blocked entries are never re-queued. The single global retry counter is not a per-feature retry policy and does not capture attempt history.

**Repository evidence:** `nextPendingSlice()` is a first-match scan (`extract-scope.mjs:65-68`); the loop sets failures to `blocked` and continues (`main.mjs:1137-1170`); the only pre-loop stop is the shared retry budget (`main.mjs:1096-1108`).

**Consequences:** Poor throughput, permanently stranded retryable work, misleading “no pending slices,” and failure domains that are isolated only by abandonment.

**Prevention (Phase 5):** Schedule from a deterministic ready set, not array position. Use bounded per-feature/per-gate attempts, persist each failure class and attempt result, and defer retryable work to a later scheduling round or segment. Apply round-robin fairness among ready components, honor dependencies, and cap consecutive work on one feature. Terminal failures remain visible and prevent readiness; independent work continues.

**Detection:** A fixture with one repeatedly failing first feature plus several independent healthy features must complete the healthy features, exhaust exactly the configured attempts for the failure, and report the remainder without spinning.

### 8. Moving the whole repository into prompts or child arguments

**What goes wrong:** Discovery, decomposition, or synthesis exceeds prompt/token limits before extraction starts; JSON child args and state grow quadratically as every feature carries the full inventory and upstream artifacts.

**Why it happens:** Current prompts interpolate the complete `scope.files` list for decomposition, the full feature file list into every extraction gate, and every queue entry into overview synthesis. The current scope resolver is one agent expected to return every file. This is workable at bounded scope, not project scale.

**Repository evidence:** `resolveScope()` asks one verdict for all files (`extract-scope.mjs:73-101`); decomposition interpolates `(scope.files || []).join('\n')` (`main.mjs:1041-1075`); `extractSlice()` repeats `scopeHint` across gates (`extract-slice.mjs:17-217`); `writeSystemOverview()` builds one list from the entire queue (`extract-slice.mjs:223-241`).

**Consequences:** Schema failures, truncated inventories, lost tail features, increased hallucination, and a monolithic parent state that is expensive to read/write on every checkpoint.

**Prevention (Phases 2, 4, and 6):** Persist a paginated inventory and feature index as artifacts. Pass agents artifact paths plus a bounded page/feature summary, never the whole project manifest. Hierarchically refine only oversized discovery nodes. Child args contain feature ID, shard path, compact source summary, and bounded dependency summaries. Incremental synthesis consumes verified per-feature summaries in pages and maintains an input digest.

**Detection:** Measure maximum serialized prompt/args/state size in tests. Use a synthetic inventory beyond one prompt page and assert no page loss, deterministic page cursors, bounded child payload size, and identical aggregate coverage across resumes.

### 9. Treating the retry counter as a call/token budget

**What goes wrong:** The scheduler launches a feature that cannot finish before the shared call or token ceiling, then has too little capacity left to checkpoint or return a handoff. A child throw is mistaken for a feature defect.

**Why it happens:** The existing extract loop checks `budgetExhausted(retryBudget)`, which tracks workflow retry spending, not `budget.remaining()` or total agent calls. Child workflows share, rather than replenish, the parent capacity.

**Repository evidence:** shared limits and hard token exception are documented in `docs/dynamic-workflows.md:158-183` and `docs/workflow-decomposition-investigation.md:22-39`; the extract pre-check uses only `retryBudget` (`main.mjs:1096-1108`).

**Consequences:** Raw ceiling failures, lost terminal state, unpredictable feature truncation, and no truthful estimate of remaining work.

**Prevention (Phase 5):** Track separate budgets for agent calls, tokens, retries, and decisions at segment, feature, and gate levels. Estimate worst-case remaining calls for the next gate; start it only if capacity exceeds that estimate plus a fixed checkpoint/handoff reserve. Thread spent/remaining counters through child JSON returns because module counters do not cross workflow scripts. Segment proactively; never rely on catching the hard ceiling as normal control flow.

**Detection:** Boundary tests at reserve-1, reserve, and reserve+1; adversarial schema retries; review-loop subcaps; and child throws. Every below-reserve case must yield `continuation-required` with no new gate start.

### 10. Resuming against changed source without invalidation

**What goes wrong:** A feature is marked complete even though its files, entry points, or dependencies changed after discovery or extraction. New files are never added to coverage; deleted files remain in prompts; dependent summaries are stale.

**Why it happens:** Current state persists paths and artifact flags but no repository revision, inventory digest, per-feature source digest, or dependency-summary digest. Resume trusts the persisted scope/queue and skips gates when artifact paths are set.

**Repository evidence:** queue entries contain paths/status/artifacts only (`extract-scope.mjs:48-61`, `main.mjs:542-547`); gate self-skip is path/flag based (`extract-slice.mjs:26-217`); artifact repair checks presence, not source freshness (`state.mjs:317-362`).

**Consequences:** Truthful coverage becomes impossible, extracted design contradicts the current code, and final synthesis mixes revisions.

**Prevention (Phases 1, 2, and 4):** Record an agent-derived source snapshot identity at inventory time: repository HEAD when available, dirty-worktree fingerprint, inventory digest, and per-feature file/content metadata digest. At each segment resume, compare current evidence with the persisted snapshot. Classify additions, deletions, moves, and modifications; invalidate the affected feature from the earliest dependent gate and invalidate downstream feature summaries/synthesis. Require an explicit policy for “continue frozen snapshot” versus “refresh to current source”; never silently mix them.

**Detection:** Resume fixtures after file modify/add/delete/rename and dependency change. Assert only affected features and downstream synthesis are invalidated, while unchanged verified shards remain reusable.

### 11. Publishing or reporting an unverified/stale snapshot

**What goes wrong:** Documentation is published before terminal verification, a failed publish is skipped forever on resume, status routes an extract failure to `/design-feature`, or an overview remains stale after more features complete.

**Why it happens:** Publish/persist run before terminal artifact verification. `publishDesign()` sets a truthy object even when `published:false`, while callers skip whenever `result.published` is truthy. The same shape exists for persistence. Status has no extract coverage section, and `deriveNextCommand()` has no extract command branch. Overview is path-guarded rather than digest-guarded.

**Repository evidence:** extract publish/persist precede verification (`main.mjs:1179-1200`); truthy failure objects are set in `publish-persist.mjs:10-68`; status summarizes forward-mode gates only and defaults blocked extract runs to `/design-feature --resume` (`state.mjs:150-244`); overview skips once a path exists (`main.mjs:1173-1178`).

**Consequences:** Public docs and operator status disagree with durable state, retries never happen, users follow the wrong continuation command, and `published` is interpreted as success when it means “attempted.”

**Prevention (Phase 6):** Separate `publishAttempt` from `publishSucceeded`, and tie successful publication to a verified coverage/synthesis revision. Publish bounded project and feature units idempotently; retry failures. Generate status directly from the coverage ledger: processed, remaining, deferred, blocked, failed, excluded, budget usage, active segment, and exact `/extract-design --resume` continuation. Rebuild synthesis when its input digest changes. Run final publication only after verification, while allowing explicitly labeled partial snapshots when requested.

**Detection:** Publish failure then resume; complete another feature after an overview exists; corrupt one published artifact; query status for partial/blocked/complete extract states. Assert status, handoff, and docs carry the same revision and counts.

### 12. Violating the one-level composition boundary

**What goes wrong:** The new slice child tries to compose another workflow, or the extract orchestrator itself is called as a child and then cannot call `fp-extract-slice`. Unknown child/version errors escape as raw workflow crashes. Shared retry/decision/telemetry counters reset or double-count across the boundary.

**Why it happens:** The current implementation is one engine function, so converting a helper call to `workflow()` can look mechanical. It is not: children have isolated script/module state but shared runtime capacity, JSON-only args/returns, and exactly one allowed nesting level.

**Repository evidence:** `docs/workflow-decomposition-investigation.md:22-39,88-139` identifies the leaf-extraction seam and the one-level rule, plus the need to seed counters through args and wrap child errors. `.planning/PROJECT.md` makes the top-level-orchestrator/leaf-child structure a milestone constraint.

**Consequences:** Runtime exceptions, lost telemetry/budget truth, incompatible installed dist files, and a continuation path that cannot launch the intended leaf.

**Prevention (Phases 3 and 4):** Keep `feature-pipeline` as the top-level workflow launched by the command and `fp-extract-slice` as a strict leaf. Define and schema-validate a versioned JSON request/response protocol. Parent owns inventory, graph, scheduling, aggregate coverage, synthesis, and continuation; child owns one feature’s gate machine and shard. Merge child counters/digests explicitly. Wrap unknown workflow, syntax, invalid response, and child throw into a persisted feature outcome before continuing independent work. Extend build/setup/version validation to every shipped workflow file.

**Detection:** Contract tests for protocol version mismatch, missing child, child syntax error, invalid/null return, counter merge, and an assertion that leaf dist contains no `workflow()` call.

## Moderate Pitfalls

### 13. Unstable or colliding feature identities

**What goes wrong:** Two decomposer IDs normalize to the same slug and share a shard directory, or a re-run renames a feature and creates duplicate coverage.

**Prevention (Phase 2):** Derive canonical identity from stable discovery anchors, validate uniqueness before writes, and apply deterministic collision disambiguation. Persist aliases across decomposition revisions. Never use display name as durable identity.

**Repository evidence:** Queue IDs are normalized with `categorizeSlug(...) || 'slice'` without a post-normalization uniqueness check (`extract-scope.mjs:48-58`); `DECOMPOSE_VERDICT` requires IDs but not uniqueness (`schemas.mjs:806-835`).

**Detection:** IDs differing only by case/punctuation, duplicate `slice`, renamed features, and decomposition page merge fixtures.

### 14. Accepting an incomplete or overlapping inventory/ownership map

**What goes wrong:** Files disappear between inventory and feature graph, belong to multiple features without an explicit shared-owner rule, or vendor/generated exclusions are counted inconsistently.

**Prevention (Phase 2):** Reconcile the graph against the inventory before scheduling. Every item must be assigned exactly once, assigned to an explicit cross-cutting/shared bucket, excluded by a deterministic rule with evidence, or listed unassigned (which prevents readiness). Persist discovery/exclusion evidence and page completeness markers.

**Repository evidence:** The decomposer prompt asks for exact-one assignment, but `DECOMPOSE_VERDICT` and `seedExtractQueue()` do not validate coverage, overlap, or exclusion evidence (`main.mjs:1041-1076`; `schemas.mjs:806-835`).

**Detection:** Duplicate ownership, missing last-page files, generated/vendor trees, symlinks, ignored files, and empty-feature fixtures.

### 15. Stale or lossy incremental synthesis

**What goes wrong:** Re-running whole-project synthesis on every segment becomes unbounded, while never re-running it leaves stale cross-feature relationships. Summaries omit failures or excluded scope and still look authoritative.

**Prevention (Phase 6):** Store one verified, bounded synthesis summary per feature and update project views by changed summary digest. Coverage index is deterministic data, not prose. Architecture overview, dependency map, and cross-cutting concerns each record their input manifest revision and completeness state. Verify index rows against the manifest before readiness.

**Repository evidence:** Current overview is one agent call over all queue entries and is non-blocking/path-guarded (`extract-slice.mjs:223-254`; `main.mjs:1173-1178`).

**Detection:** Complete features across multiple segments, revise one feature, fail overview generation, and compare clean one-shot versus resumed incremental output.

### 16. Cross-mode regression from making extract state “design-shaped”

**What goes wrong:** `/tune-feature`, `/design-feature --resume`, `/review-design`, implement gates, or status misread new feature shard fields; a migration clears `designReady`; extract-only status semantics leak into forward modes.

**Prevention (Phases 1 and 7):** Preserve established artifact names and legacy top-level fields, but add explicit state kind/mode contracts for `extract-project` and `extract-feature`. Define which consumers accept each kind. Keep shared checkpoint/budget primitives mode-neutral. Test every legal handoff and reject illegal ones with a precise command.

**Repository evidence:** Multi-slice local state is currently emitted as `mode:'design'`, `designReady` on completed outcome, and a synthetic `planPath` although no plan is written (`main.mjs:1110-1168`). `repairResumeArtifactFlags()` contains a special-case fix because unconditional Plan repair previously disabled persistence/readiness (`state.mjs:317-362`; `tests/extract-mode.test.mjs:167-195`).

**Detection:** Golden flow matrix: legacy extract feature → tune/review/design; new feature shard → tune/review/design; project manifest → status/continue but not implement; forward design/tune/implement states unchanged.

### 17. Mistaking structural unit tests for project-scale proof

**What goes wrong:** Tests pass because source contains a flush call or current helper returns an expected ordering, while interruption, child composition, state migration, continuation, and installed-plugin behavior remain untested.

**Prevention (Phase 7):** Retain pure helper tests, but add executable characterization at three levels: state-machine unit tests, parent/leaf protocol integration tests against generated dist, and end-to-end command scenarios in an installed plugin fixture. Include pagination, interruption at every gate, resume, dependency ordering, partial failure, ceiling reserve, stale source, synthesis refresh, and whole-repository dogfood evidence.

**Repository evidence:** `tests/extract-mode.test.mjs` is mainly helper and source-string assertions; it explicitly enshrines cycle fallback, cap-as-skipped, after-slice flushing, and only “multi-slice never claims parent designReady,” not truthful `extractReady` (`tests/extract-mode.test.mjs:1-241`).

**Detection:** Mutation tests should prove the new scenarios fail when readiness, checkpoint, graph, or budget guards are removed.

## Minor Pitfalls

### 18. Non-idempotent append and overwrite behavior on retries

**What goes wrong:** Audit findings duplicate across resumed segments, or a retried artifact writer overwrites newer content.

**Prevention (Phases 4 and 6):** Give generated sections stable IDs/digests, use compare-and-replace for derived artifacts, and deduplicate append-only findings by feature/gate/finding digest. Record output revision in the shard before acknowledging a gate.

**Detection:** Retry the same completed/blocked gate twice and compare byte output plus issue counts.

### 19. Parent manifest becoming another monolith

**What goes wrong:** Sharded feature files exist, but the parent still embeds every file, artifact, log, attempt, and prompt result, so every checkpoint rewrites an ever-growing JSON document through an agent.

**Prevention (Phase 1):** Enforce a compact manifest schema and size budget. Parent entries reference shards and contain only scheduler/coverage fields and compact verified summaries. Logs and attempt histories live in bounded append-only per-feature/segment artifacts.

**Detection:** State-size growth tests should be approximately O(feature count) with a small fixed entry size, not O(files × gates × attempts).

### 20. Observability that reports counts but not denominators or revisions

**What goes wrong:** “30 done” sounds complete without saying 30/47, which inventory revision was measured, or whether 5 excluded features are inside the denominator.

**Prevention (Phase 6):** Every log, status, handoff, and published index reports the same coverage revision and explicit denominator: discovered, in-scope, completed, deferred, blocked, failed, excluded, unassigned. Include last durable segment/gate and budget reserve.

**Detection:** Snapshot status output for partial, source-drifted, migrated, and complete states and compare it against manifest-derived counts.

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Required mitigation before phase exit |
|---|---|---|
| State, Coverage, Migration, and Revision Contracts | False readiness; ambiguous statuses; unsafe legacy hydration | Formal transition table, derived readiness proof, schema version/migrations, v1.4.5 fixtures |
| Bounded Discovery, Validated Graph, and Schedulability | Prompt overflow; identity collision; missing ownership; hidden cycles | Paginated inventory, canonical IDs, full reconciliation, SCC/dangling-edge validation |
| Multi-Entry Build, Install, and Version Lockstep | Missing leaf dist; copy/symlink resolution or version drift | Two-entry clean build, both install modes, version/release lockstep validation |
| Checkpointed Feature Leaf | Mid-gate loss; parent/child divergence; nesting violation | Gate-level acknowledged checkpoints, compact manifest, versioned leaf protocol, leaf cannot compose |
| Bounded Scheduler and Transactional Automatic Continuation | No-progress loops; starvation; hard ceiling before checkpoint | Deterministic ready set, fair bounded retries, progress fingerprint, explicit reserve, automatic top-level segmentation |
| Synthesis, Publish, Persist, and Status Truth | Stale overview; failed publish treated as done; wrong continuation command | Revision-bound incremental synthesis, verify-before-publish, attempted/succeeded split, extract-aware status |
| Compatibility and Project-Scale Proof | Extract fixes break other modes; structural tests miss runtime behavior | Cross-mode handoff matrix, generated-dist integration, fault injection, large fixture, installed-plugin dogfood |

## What the Roadmap Must Not Defer

- The coverage/status vocabulary and readiness invariant must precede scheduler implementation; otherwise the scheduler will encode today’s `skipped`/`blocked` ambiguity.
- State schema versioning and v1.4.5 migration fixtures must precede sharding; otherwise failures cannot be distinguished from migration loss.
- Inventory/graph validation must precede dependency scheduling; stable order is not a valid cycle policy.
- Gate-level child checkpoints must precede automatic continuation; segment relaunch cannot recover state that was never persisted.
- Budget reserve and no-progress detection must ship with the first continuation loop, not as later hardening.
- Revision-aware synthesis and extract-aware status must precede any `extractReady=true` path.
- Cross-mode fixtures must run from the first state-contract change through the milestone, not only at final release.

## Sources

All findings are repository-grounded; no external ecosystem claims were used.

- `.planning/PROJECT.md` — v1.5.0 goal, active requirements, scope, constraints, and completion truth contract (HIGH confidence).
- `plugins/feature-workflows/workflows/src/main.mjs` — current resume/config, extract queue loop, parent/slice flushing, terminal verification/readiness, publish/persist order (HIGH confidence).
- `plugins/feature-workflows/workflows/src/extract-scope.mjs` — current scope resolution, dependency ordering, queue states, cap/selector behavior (HIGH confidence).
- `plugins/feature-workflows/workflows/src/extract-slice.mjs` — gate self-skip contract, prompt payloads, per-slice artifacts, non-blocking/path-guarded overview (HIGH confidence).
- `plugins/feature-workflows/workflows/src/state.mjs` — validation/checksum limits, state flush, artifact repair, forward-oriented status and next-command logic (HIGH confidence).
- `plugins/feature-workflows/workflows/src/schemas.mjs` — permissive persisted result, scope/decomposition schema gaps, overview shape (HIGH confidence).
- `plugins/feature-workflows/workflows/src/publish-persist.mjs` — attempted-versus-successful publish/persist flag behavior (HIGH confidence; inspected because the required `main.mjs` calls these helpers in the terminal path).
- `docs/dynamic-workflows.md` — hard call/token/nesting/runtime constraints and idempotency guidance (HIGH confidence within this repository’s accepted runtime contract).
- `docs/workflow-decomposition-investigation.md` — verified composition constraints, leaf-extraction seam, counter threading, build/version risks (HIGH confidence).
- `tests/extract-mode.test.mjs` — current characterized behavior and project-scale test gaps (HIGH confidence).

## Confidence Assessment

| Area | Confidence | Notes |
|---|---|---|
| Queue/readiness failure modes | HIGH | Directly demonstrated by current helper and terminal control flow |
| State/checkpoint/migration risks | HIGH | Direct state schemas, validation, flush boundaries, and regression test evidence |
| Composition and budget ceilings | HIGH | Project docs and milestone constraints explicitly agree |
| Prompt/source-drift/synthesis risks | HIGH | Current prompt construction and absence of revision/digest fields are observable in source |
| Cross-mode regression risk | HIGH | Existing special-case resume repair documents a prior concrete failure of this class |
