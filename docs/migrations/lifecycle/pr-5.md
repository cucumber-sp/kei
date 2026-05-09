# Brief: Lifecycle PR 5 — Cleanup, remove transition shims

## Context (read first)

You are a fresh Claude Code session implementing PR 5 of the
**Lifecycle module** migration. You have no prior context from
the architecture-review session that produced this work, nor
from the four PRs that landed before this one. Before touching
any code, read these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/lifecycle-module.md` — full design; especially §7
   PR 5 (this PR) and §2 (what the finished module looks like)
3. `docs/migrations/lifecycle/pr-1.md` — PR 1 introduced the two
   transition shims this PR removes; read its "Out of scope" and
   "Forbidden shortcuts" sections to understand what was
   deliberately left in place
4. `CONTEXT.md` — domain glossary; "Lifecycle", "Decide",
   "Insert pass" have specific meanings
5. `compiler/CLAUDE.md` — how to build / test / lint

If the design doc disagrees with this brief, the design doc wins
— report the discrepancy and stop.

## PR scope

**Implements:** `docs/design/lifecycle-module.md#7` (PR 5 — Cleanup).

This is a removal-only PR. PRs 1–4 stood up the Lifecycle module,
introduced the marker IR, and cut every insertion site over to
the rewriting pass. This PR retires the transition scaffolding
that PRs 1 and 3 left in place and finalises the documentation
to point at the new layout. After this PR, the lifecycle
migration is complete and ADR-0001's concept-cohesive principle
has been demonstrated end-to-end for one cross-cutting concern.

**Files affected:**

- **MODIFIED** `compiler/src/kir/lowering-ctx.ts` — remove the
  `structLifecycleCache` field. The Lifecycle module owns its own
  `Map<StructType, LifecycleDecision>`; the lowering-side memo is
  now redundant. Remove the field, its initialiser, and any
  remaining read sites (PRs 4a–4e should already have cut the
  read sites; verify).
- **MODIFIED** `compiler/src/checker/struct-checker.ts` — remove
  the `methods.set("__destroy", …)` and `methods.set("__oncopy", …)`
  shim PR 1 kept as a transition. The type-checker now consults
  `lifecycle.hasDestroy(struct)` / `lifecycle.hasOncopy(struct)`
  for any `s.__destroy()` / `s.__oncopy()` call-site type-check
  (PR 4 introduced those queries; this PR removes the type-table
  mirror that backed them in the interim).
- **MODIFIED** `compiler/src/kir/lowering-scope.ts`,
  `compiler/src/kir/lowering-expr.ts`,
  `compiler/src/kir/lowering-decl.ts` — remove any helpers that
  became unreachable after PRs 4a–4e cut over (e.g. residual
  `popScopeAndDestroy` / `emitAllScopeDestroys` /
  `emitInnerLoopScopeDestroys` / `emitAllScopeDestroysSkipping`
  variants, residual `movedVars` reads, residual scope-stack
  bookkeeping). Run `bunx biome check` after each removal —
  unused-import / unused-private warnings are how you find them.
- **MODIFIED** `compiler/CLAUDE.md` — update the "Where to add a
  feature" table so lifecycle work points at `src/lifecycle/`
  rather than the scattered checker / lowering sites.

**Out of scope (do not touch in this PR):**

- The Lifecycle module's public API (`src/lifecycle/index.ts`,
  `decide.ts`, `synthesise.ts`, the rewriting pass). This PR is
  removal *inside the pipeline-stage modules* — Lifecycle's own
  surface is frozen by PRs 1–4.
- The Diagnostics and Monomorphization migrations.
- The throws-protocol fields on `LoweringCtx` (tracked in #39).
- Anything covered by issue #38 (defer-vs-destroy ordering) —
  PR 4a already shipped under that resolution; not this PR's
  problem.

## Behaviour preservation

Every test in `compiler/tests/` must pass with no test changes.
This is a removal PR; if a removal triggers a test failure, the
removal target was load-bearing in a way the design doc didn't
predict — **stop and report**, don't patch the test.

Pay particular attention to:

- The `tests/lifecycle/` suite added by PRs 1–3 (`decide.test.ts`,
  `synthesise.test.ts`, `pass.test.ts`).
- `tests/e2e/run.test.ts` cases involving managed structs — these
  catch insertion-time regressions that pure-KIR tests would
  miss.
- `tests/checker/` cases that exercise `s.__destroy()` /
  `s.__oncopy()` call-site type-checking.

**No new tests.** This PR removes code; coverage already exists.

## Forbidden shortcuts

- **Don't reformat unrelated code.** Biome runs in CI; only
  diffs in your PR scope should appear.
- **Don't widen scope.** If you find friction in lowering
  unrelated to lifecycle (e.g. throws-protocol coupling, defer
  helpers that look stale), file a GitHub issue per the repo
  policy and link from the PR. Don't fix it here.
- **Don't change Lifecycle module APIs.** This PR is removal-only
  inside `src/checker/` and `src/kir/`. If `lifecycle.hasDestroy`
  feels awkward at a call site, that's a PR 4 design issue —
  report and stop, don't reshape the API.
- **Don't keep the shim "for safety".** The point of this PR is
  that the shim is unreachable after PR 4. If you can't convince
  yourself a shim is dead, instrument it (throw on entry, run
  `bun test`) before removing — but remove it.

## Implementation steps

1. Confirm PRs 1–4 have all merged into your base branch (the
   shim and the cache only become removable once PR 4 cuts every
   insertion site over). If any of 4a–4e is missing, **stop and
   report**.
2. Remove `structLifecycleCache` from `LoweringCtx`. Run
   `bun test` — failures here mean a 4-series PR didn't cut over
   a read site, which is a PR-4 bug, not this PR's. Stop and
   report.
3. Remove the `methods.set("__destroy", …)` / `methods.set("__oncopy", …)`
   shim from `struct-checker.ts`. Run `bun test`. Failures here
   mean a checker call site is still reading the auto-method off
   the type table instead of via `lifecycle.hasDestroy /
   hasOncopy` — fix the call site to use the query (PR 4
   introduced both queries; they should already exist).
4. Sweep `lowering-{scope,expr,decl}.ts` for unreachable
   helpers. Biome's unused-private and TypeScript's
   `noUnusedLocals` should surface them. Remove each, re-run
   `bun test`.
5. Update `compiler/CLAUDE.md`'s "Where to add a feature" table:
   add a row for "lifecycle hook (`__destroy` / `__oncopy`)" that
   points at `src/lifecycle/`. Adjust the existing rows that
   currently mention scattered lowering sites for lifecycle work
   if any do.
6. Run the full verification recipe.

## Verification recipe

```bash
cd compiler
bun install
bun test                          # must pass with no regressions
bunx biome check src/ tests/      # must report no issues
```

Additional structural checks for this PR:

```bash
# Should match only the Lifecycle pass and synthesised hook
# bodies — not scattered lowering files.
rg 'destroy|oncopy' src/kir/

# Should find no hits.
rg 'structLifecycleCache' src/
rg 'movedVars' src/kir/
rg 'scopeStack' src/kir/lowering-
```

If any of those surface unexpected hits, **stop and report** —
the cleanup is incomplete.

## Output

**Commit messages.** Match existing style:

```
refactor(lowering): drop structLifecycleCache; lifecycle owns its decisions
refactor(checker): remove methods.set("__destroy") transition shim
refactor(lowering): remove dead scope-exit / move-tracking helpers
docs(claude-md): point lifecycle feature work at src/lifecycle/
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/lifecycle-module.md#7] (PR 5 of 5) for
  the Lifecycle module migration ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- Removes `LoweringCtx.structLifecycleCache` (Lifecycle owns its
  own decision map)
- Removes the `struct-checker.ts` `methods.set("__destroy", …)`
  shim that PR 1 kept for transition; checker queries
  `lifecycle.hasDestroy / hasOncopy` instead
- Removes dead scope-exit / move-tracking helpers in
  `lowering-{scope,expr,decl}.ts` left unreachable after PRs 4a–4e
- Updates `compiler/CLAUDE.md`'s feature-routing table

## Test plan
- [ ] `bun test` passes (no regressions)
- [ ] `bunx biome check` passes
- [ ] `rg 'structLifecycleCache' src/` returns no hits
- [ ] `rg 'destroy|oncopy' src/kir/` matches only the Lifecycle
      pass and synthesised hook bodies
```

## Escape hatches

Stop and report if:

1. Removing `structLifecycleCache` breaks a test — a 4-series PR
   missed a read site; this is a PR-4 follow-up, not a PR-5 fix.
2. Removing the `methods.set(…)` shim breaks a test — a checker
   call site is still doing type-table lookup instead of using
   the `lifecycle.hasDestroy / hasOncopy` queries. Don't add the
   query at the call site here; that's PR-4 scope. Report so PR 4
   can be amended.
3. The diff exceeds ~400 lines of net deletion. This PR should be
   small; if it isn't, PRs 1–4 left more transition state than
   the design doc anticipated. Pause for review.

Report format per `_brief-template.md`. Wait for orchestrator
guidance — don't continue past a blocker.
