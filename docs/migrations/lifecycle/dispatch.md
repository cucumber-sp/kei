# Lifecycle migration — dispatch graph

This file describes the PR dependency graph and parallel
dispatch strategy for the **Lifecycle module** migration
([ADR-0001](../../adr/0001-concept-cohesive-modules.md), full
design at [docs/design/lifecycle-module.md](../../design/lifecycle-module.md)).
The cross-migration wave plan lives in
[docs/migrations/README.md](../README.md#cadence); this file
zooms in on the seven Lifecycle PRs and where parallelism is
available.

## Dependency graph

```
PR 1 (Decide moves out)
  └─→ PR 2 (Synthesise moves out)
       └─→ PR 3 (Marker IR + no-op pass)
            ├─→ PR 4a (mark_scope_exit)  ── blocked on issue #38
            ├─→ PR 4b (mark_assign)
            ├─→ PR 4c (mark_param)
            ├─→ PR 4d (mark_moved, removes LoweringCtx.movedVars)
            └─→ PR 4e (mark_track, removes LoweringCtx.scopeStack)
                 └─→ PR 5 (cleanup, removes structLifecycleCache + shim)
```

PRs 4a–4e are independent siblings: each cuts over exactly one
insertion site and verifies the test suite still passes. Sites
that have not migrated yet keep the old logic (markers and old
logic do not overlap — see design doc §7), so any sibling can
land before any other.

PR 5 depends on *all* of 4a–4e: the `structLifecycleCache`
removal and the dead-helper sweep are only safe once every
insertion site is on the marker path.

## Parallelism

**PRs 4a–4e are highly parallelizable.** Up to five simultaneous
Claude Code sessions in worktrees, each owning one marker:

```bash
git worktree add ../kei-lifecycle-pr4a -b lifecycle/pr-4a
git worktree add ../kei-lifecycle-pr4b -b lifecycle/pr-4b
git worktree add ../kei-lifecycle-pr4c -b lifecycle/pr-4c
git worktree add ../kei-lifecycle-pr4d -b lifecycle/pr-4d
git worktree add ../kei-lifecycle-pr4e -b lifecycle/pr-4e
```

PR 4a is the only one with an external blocker — issue #38
(defer-vs-destroy ordering) must resolve before its marker test
can be written. The other four can dispatch immediately after
PR 3 lands.

PR 1, PR 2, PR 3, and PR 5 are sequential. PR 1 stands the
module up; PR 2 fills in Synthesise; PR 3 introduces the
infrastructure 4a–4e build on; PR 5 cleans up after them. None
of those four can overlap with each other within this migration.

## Issue #38 (defer-vs-destroy ordering)

PR 4a is gated on the spec resolution. Before merging PR 4a:

1. Pick a defer-vs-destroy order in `spec/`. The recommendation
   in [#38](https://github.com/cucumber-sp/kei/issues/38) is
   *defer first* (Swift-style), so user defer code can reference
   managed locals while they are still valid.
2. Update [docs/design/lifecycle-module.md §5](../../design/lifecycle-module.md#5)
   to reflect the chosen order — currently it states "the
   recommendation in that issue" without committing.
3. Add a marker test exercising the chosen order: a scope with
   both a `defer { … }` block referencing a managed local and an
   auto-destroy on that local. The expected KIR after the
   Lifecycle pass should show the defer block instructions
   preceding the destroy (or the reverse, depending on the spec
   resolution).
4. Update [SPEC-STATUS.md](../../../SPEC-STATUS.md) to mark the
   ordering as specified rather than open.

PR 4a's brief should reference the resolved spec section
directly; if you reach PR 4a dispatch and #38 is still open,
**hold dispatch** — start PRs 4b–4e instead and circle back.

## Cadence recommendation

Realistic working budget:

- **5 sessions** if every PR is sequential — one per PR slot
  (PR 1, PR 2, PR 3, the 4-series as one wave, PR 5).
- **3 sessions** if PRs 4a–4e parallelize — PR 1 + PR 2 + PR 3
  fold into one early-wave session each, then a single
  orchestration session reviews the 4-series fan-out, then PR 5.

The bottleneck is review throughput, not implementation
throughput. The orchestrator reviews every PR against the design
doc; that's serial regardless of how many sessions are coding.
See [README.md § Bottleneck](../README.md#bottleneck).

Mapping to the cross-migration wave table in
[README.md § Cadence](../README.md#cadence):

| Wave | Lifecycle PR(s) | Notes |
|---|---|---|
| 1 | PR 1 | Foundation alongside Diagnostics/Monomorphization PR 1 |
| 3 | PR 2 | Same wave as Diagnostics PR 4a–g (specificity); independent |
| 4 | PR 3 | Marker IR + no-op pass; gates the 4-series |
| 4–5 | PR 4a–4e | Parallelizable across siblings; PR 4a gated on #38 |
| 5 | PR 5 | Payoff cleanup; cross-migration parallel with monomorph PR 5 + diagnostics' untriaged removal |

## Cross-migration interactions

- **Lifecycle PR 1 must land before Monomorphization PR 4.**
  Monomorphization PR 4 introduces the `monomorphization.register
  → lifecycle.decide(bakedStruct)` call (per CONTEXT.md
  "Monomorphization", "Integration with Lifecycle"). Until
  PR 1 ships, there is no `lifecycle.decide` to call.
- **Diagnostics migration is independent.** No PR in the
  Lifecycle plan reads or writes through the Diagnostics
  collector beyond what existing checker / lowering code
  already does. Diagnostics PRs can interleave freely.
- **Throws-protocol fields on `LoweringCtx` are out of scope for
  Lifecycle.** Tracked separately in #39. PR 5's
  `LoweringCtx`-trimming sweep deliberately leaves those fields
  alone.

## Verification

After PR 5 merges, the migration is done. Sanity checks:

1. `bun test` passes from a clean checkout of the merged base.
2. `rg 'destroy|oncopy' compiler/src/kir/` should match only the
   Lifecycle pass and the synthesised hook bodies — not
   scattered across `lowering-scope.ts`, `lowering-expr.ts`, or
   `lowering-decl.ts`.
3. `LoweringCtx` no longer has `scopeStack`, `movedVars`, or
   `structLifecycleCache` fields. (`rg 'scopeStack|movedVars|structLifecycleCache' compiler/src/`
   should return zero hits.)
4. `compiler/CLAUDE.md`'s "Where to add a feature" table points
   lifecycle work at `src/lifecycle/`.

If any check fails after PR 5 merges, the cleanup was incomplete
— file a follow-up issue rather than reopening the migration.
