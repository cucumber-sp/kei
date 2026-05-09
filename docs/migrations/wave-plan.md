# Migration wave plan

Cross-migration execution plan for the
[ADR-0001](../adr/0001-concept-cohesive-modules.md) concept-cohesive
module migrations:
[Lifecycle](../design/lifecycle-module.md),
[Diagnostics](../design/diagnostics-module.md),
[Monomorphization](../design/monomorphization-module.md).

This file is the **canonical dispatch order** for the orchestrator
and the agents working on individual PRs. Each per-migration
[`dispatch.md`](#per-migration-dispatch-graphs) describes its own
PR dependency graph; this file sequences them across migrations.

The cadence is **wave-based, not full-migration-first.** A
full-migration-first approach would serialise 17+ PRs
unnecessarily — the migrations were designed at the architecture
level (ADR-0001) to be independent. By-wave dispatch lands
foundations in parallel, exploits parallel-friendly cutovers, and
respects only the *real* cross-migration gates (a small handful).

## Waves

### Wave 1 — Foundation (3 parallel sessions)

| Brief | Description |
|---|---|
| [`lifecycle/pr-1`](./lifecycle/pr-1.md) | Stand up `src/lifecycle/`; move Decide + fixed-point out of `struct-checker.ts`. |
| [`diagnostics/pr-1`](./diagnostics/pr-1.md) | Stand up `src/diagnostics/` skeleton (empty union, Collector, formatter scaffold). |
| [`monomorphization/pr-1`](./monomorphization/pr-1.md) | Stand up `src/monomorphization/`; relocate pure helpers (`substituteType`, `mangleGenericName`, etc.). |

**Why parallel:** Each PR creates a new top-level directory and
relocates self-contained code. Zero file overlap.

**Blockers:** None.

**Output:** All three concept-module directories exist on `main`
with their pure helpers and skeletons in place.

---

### Wave 2 — Diagnostics codemod (sequential)

| Brief | Description |
|---|---|
| [`diagnostics/pr-2`](./diagnostics/pr-2.md) | `untriaged` catch-all variant + Bun codemod migrating 162 `new Diagnostic(...)` call sites in one mechanical diff. |
| [`diagnostics/pr-3`](./diagnostics/pr-3.md) | Wire `Collector` through `Checker` (constructed-and-threaded). |

**Why sequential within Wave 2:** PR 3 plumbing depends on PR 2's
unified call-site shape. Both are tightly coupled within
Diagnostics; nothing else in the migration system depends on either
landing first.

**Why before Wave 3:** PR 2 touches every checker file. Landing it
before Wave 3 keeps Wave 3's checker-touching work
(`monomorphization/pr-2`) from rebasing through 162 mechanical
changes.

**Blockers:** `diagnostics/pr-1` (Wave 1).

**Output:** All checker diagnostics emit through
`diag.untriaged({...})` via the threaded `Collector`. Behaviour
unchanged.

---

### Wave 3 — Internal moves + diagnostics specificity (up to 9 parallel)

| Brief | Description |
|---|---|
| [`lifecycle/pr-2`](./lifecycle/pr-2.md) | Move Synthesise (hook-body generator) out of `kir/lowering-struct.ts` into `src/lifecycle/`. |
| [`monomorphization/pr-2`](./monomorphization/pr-2.md) | Move the three monomorphization maps off `Checker` into a constructed-and-threaded `Monomorphization` instance. |
| [`diagnostics/pr-4a`](./diagnostics/pr-4a.md) | Type errors specificity (E1xxx). |
| [`diagnostics/pr-4b`](./diagnostics/pr-4b.md) | Name resolution specificity (E2xxx). |
| [`diagnostics/pr-4c`](./diagnostics/pr-4c.md) | Calls specificity (E3xxx). |
| [`diagnostics/pr-4d`](./diagnostics/pr-4d.md) | Structs specificity (E4xxx). |
| [`diagnostics/pr-4e`](./diagnostics/pr-4e.md) | Lifecycle / checker rules specificity (E5xxx). |
| [`diagnostics/pr-4f`](./diagnostics/pr-4f.md) | Operators specificity (E6xxx). |
| [`diagnostics/pr-4g`](./diagnostics/pr-4g.md) | Modules specificity (E7xxx). |

**Why parallel:** Lifecycle PR 2 and Monomorphization PR 2 touch
disjoint files. Diagnostics 4a–4g touch different checker
categories with additive edits to three shared files
(`types.ts`, `index.ts`, `format.ts`) — low conflict rate, easy to
rebase in arrival order.

**Blockers:**

- Lifecycle PR 2 needs `lifecycle/pr-1` (Wave 1).
- Monomorphization PR 2 needs `monomorphization/pr-1` (Wave 1).
- Diagnostics 4a–4g need `diagnostics/pr-3` (Wave 2).

**Output:** Both internal moves done; up to seven categories of
diagnostics now have specific variants with codes. `untriaged`
still in place for any sites not yet migrated.

---

### Wave 4 — Markers / pass-3 / Y-a baking + lifecycle cutovers

This wave is two halves: the upstream half runs sequentially per
migration; the downstream half (lifecycle 4a–4e) is parallel-friendly.

#### Wave 4 upstream

| Brief | Description |
|---|---|
| [`lifecycle/pr-3`](./lifecycle/pr-3.md) | Marker IR (`mark_*` instructions) + no-op rewrite pass between lowering and mem2reg. |
| [`monomorphization/pr-3`](./monomorphization/pr-3.md) | Move pass-3 body-check driver from `Checker` into `Monomorphization.checkBodies()`. |
| [`monomorphization/pr-4`](./monomorphization/pr-4.md) | **Load-bearing PR.** Y-a baking — synthesised AST decls; lifecycle integration via `lifecycle.decide(baked)` hook. |

**Sequential within each migration; cross-migration parallel** —
Lifecycle PR 3 and Monomorphization PR 3 / PR 4 touch different
files. Monomorphization PR 4 is the largest and riskiest in the
whole migration system; review carefully.

**Hard cross-migration gate:** Monomorphization PR 4 calls
`lifecycle.decide(...)`, so it requires Lifecycle PR 1 (Wave 1) to
have shipped. Lifecycle PR 1 is gated long before Wave 4 starts;
no friction.

#### Wave 4 downstream — lifecycle insertion-site cutovers (5 parallel siblings)

| Brief | Description |
|---|---|
| [`lifecycle/pr-4a`](./lifecycle/pr-4a.md) | `mark_scope_exit` cutover — first real-rewrite PR. **Blocked on issue #38** (defer-vs-destroy spec resolution). |
| [`lifecycle/pr-4b`](./lifecycle/pr-4b.md) | `mark_assign` cutover. |
| [`lifecycle/pr-4c`](./lifecycle/pr-4c.md) | `mark_param` cutover. |
| [`lifecycle/pr-4d`](./lifecycle/pr-4d.md) | `mark_moved` cutover; removes `LoweringCtx.movedVars`. |
| [`lifecycle/pr-4e`](./lifecycle/pr-4e.md) | `mark_track` cutover; removes `LoweringCtx.scopeStack`. |

**Why parallel:** Each marker is independent — different lowering
sites, different `LoweringCtx` fields. Up to 5 parallel sessions
once Lifecycle PR 3 lands.

**Blocker for 4a only:** [issue #38](https://github.com/cucumber-sp/kei/issues/38)
must be closed (spec must specify defer-vs-destroy ordering)
before 4a can merge. 4b–4e have no spec dependency.

---

### Wave 5 — Payoff + cleanup (4 parallel sessions)

| Brief | Description |
|---|---|
| [`monomorphization/pr-5`](./monomorphization/pr-5.md) | **Payoff PR.** Delete `LoweringCtx.currentBodyTypeMap` + `currentBodyGenericResolutions` and every push/pop site. |
| [`monomorphization/pr-6`](./monomorphization/pr-6.md) | Cleanup: delete `checker/generics.ts` shim, fold straggler branches, update `compiler/CLAUDE.md`. |
| [`lifecycle/pr-5`](./lifecycle/pr-5.md) | Cleanup: remove `structLifecycleCache`, the `methods.set("__destroy", ...)` shim, update `compiler/CLAUDE.md`. |
| [`diagnostics/pr-5`](./diagnostics/pr-5.md) | Remove `untriaged` catch-all + delete `src/errors/diagnostic.ts`. |

**Why parallel:** Cleanup PRs touch their own migration's residue;
disjoint files. Each migration finishes independently.

**Blockers:**

- `monomorphization/pr-5` needs `monomorphization/pr-4`.
- `monomorphization/pr-6` needs `monomorphization/pr-5`.
- `lifecycle/pr-5` needs all of `lifecycle/pr-4a..4e` (gates on
  the last marker cutover).
- `diagnostics/pr-5` needs all of `diagnostics/pr-4a..4g` (gates
  on the last category PR).

**Output:** All three migrations complete. The `LoweringCtx`
override stack is gone (the headline simplification of Y-a). The
ADR-0001 pattern is demonstrated end-to-end across three
cross-cutting concerns, ready for follow-up candidates
([#39 throws](https://github.com/cucumber-sp/kei/issues/39),
[#40 LoweringCtx hygiene](https://github.com/cucumber-sp/kei/issues/40)).

---

## Hard cross-migration gates

| Gate | Reason |
|---|---|
| `monomorphization/pr-4` requires `lifecycle/pr-1` merged | Mono PR 4 calls `lifecycle.decide(bakedStruct)`. |
| `lifecycle/pr-4a` requires [issue #38](https://github.com/cucumber-sp/kei/issues/38) closed | Spec must define defer-vs-destroy ordering before the rewrite picks an order. |
| `monomorphization/pr-5` requires `monomorphization/pr-4` merged | PR 5 deletes the override that PR 4 made a no-op. |

No other cross-migration constraints exist. Within a migration,
PR N requires PR N−1 (or its predecessor cluster); see the
per-migration dispatch.md for specifics.

## Bottleneck

**Implementation throughput** is N parallel worktrees — Wave 3
peaks at 9 simultaneous PRs. **Review throughput is one
orchestrator (you).** Realistic working budget for the 17+ PRs is
3–5 focused review sessions; sessions can be days apart since each
is a clean review pass.

If review throughput limits you to one PR at a time, the wave
plan still holds — just drop concurrency. Each wave's PRs land
sequentially in arrival order; the order *within* a wave doesn't
matter except for the hard gates above.

## How to use this plan

For each session you spawn:

1. Pick a wave, pick a brief from that wave that has its
   prerequisites merged.
2. Create the worktree per
   [README §Workspace dispatch](./README.md#workspace-dispatch):
   ```bash
   git worktree add ../kei-<module>-<pr> -b <module>/<pr>
   ```
3. Start a fresh Claude Code session in the worktree.
4. Feed it the brief contents as the first prompt
   (`docs/migrations/<module>/<pr>.md`). The brief points the
   session at the relevant ADR, design doc, CONTEXT.md, and
   `compiler/CLAUDE.md`.
5. The session implements, runs `bun test` + `bunx biome check`,
   and opens a PR.
6. You review against the design doc; merge or request changes.

The session never has to know about wave coordination — its brief
is self-contained. The wave plan is the orchestrator's tool, not
the session's.

## Per-migration dispatch graphs

For PR-level dependencies and cross-migration interactions
specific to one migration, see:

- [Lifecycle dispatch graph](./lifecycle/dispatch.md)
- [Diagnostics dispatch graph](./diagnostics/dispatch.md)
- [Monomorphization dispatch graph](./monomorphization/dispatch.md)
