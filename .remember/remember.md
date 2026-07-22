# Milestone v1.5.0 — SHIPPED + Nyquist-VALIDATED (all 11 phases)

GSD milestone **v1.5.0 Project-Scale Extract Design**: COMPLETE and VALIDATED.
STATE.md `status: completed`, **11/11 phases, 100%**. All phase sub-issues **#20–#30** and parent
**#19** CLOSED on GitHub. Branch `worktree-ver1.5.0` pushed through `5df5b49`.

## Execution (plan + execute per phase)
Sequentially 1→11. One `general-purpose` opus sub-agent per phase ran `/gsd-plan-phase <id> --auto`
then `/gsd-execute-phase <id> --auto`. Orchestrator verified each before closing its issue.
- P1 `61d80bd` · P2 `4fa026e` · P3 `f7d9361` · P4 `2ac7ce9` · P5 `a8dc72b` · P6 `b6ce7bf`
- P7 `948299d` · P8 `32d9905` · P9 `0f6e4bd` · P10 `d733758` · P11 `2bc3a76`
- One transient API timeout on P9 mid-impl — re-spawned with recovery instructions; salvaged uncommitted diff.

## Nyquist validation (this session) — `/gsd-validate-phase <id> --auto` per phase, sequential
+661 gap-filling tests (**787 → 1448, all green**), 11/11 `VALIDATION.md` artifacts written,
build drift-free. Commits: P1 `4b722c2`/`005af84`, P2 `cab072c`, P3 `5c43c63`/`bad4300`,
P4 `1733fce`, P5 `1071ab5`, P6 `394a630`, P7 `83edb83`, P8 `c4477a6`, P9 `ff89504`,
P10 `c4a1caa`, P11 `5df5b49`.

**8 real defects caught & fixed by validation:**
- P2 — `validateGraph` overlap detection was unreachable dead code → rewrote with pathClaims map.
- P6 — `deriveCoverageIndex` `inProgress` vs canonical `'in-progress'` (in-progress features uncounted).
- P6 — `CONTINUUATION_ACK` typo (double-U) → correct-spelling access returned undefined.
- P6 — `synthesizeProjectViews` skipped rebuild on feature removal.
- P6 — `recordAttemptedWrite` lost `unitType` on re-attempt.
- P8 — `checkpointDesign` dataKey `_definition` vs actual field `_define` (digest computed from path string, not content).
- P9 — `recordDegradationEvent` threw on non-object truthy input (loose falsy guard).
- P10 — `designBudgetSummary` shallow-spread `gateSpend` → shared refs → consumer mutation corrupted live budget.

## Notes for next session
- Sub-agents run the GSD workflows **inline** (Skill/Task spawn not callable from inside a sub-agent);
  they produced RESEARCH/PLAN/SUMMARY + STATE.md updates themselves. Outcomes verified correct each time.
- Validation agents were inconsistent about committing — orchestrator checked `git status` and committed
  where the agent hadn't (P2). Later phases were told to commit explicitly, which worked.
- Two autonomous decisions worth a human glance: (1) P2 cycle-policy HITL resolved via configurable
  policy-map classification (defers policy to config); (2) P11's `gsd-tools state.complete-phase`
  mis-counted (8/11), hand-corrected to 11/11.
- `.remember/remember.md` (this file) is the session buffer; left uncommitted.
