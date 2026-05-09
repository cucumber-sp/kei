# Brief: Lifecycle PR 4d — `mark_moved` cutover

## Context (read first)

You are a fresh Claude Code session implementing PR 4d of the
**Lifecycle module** migration. You have no prior context from
the architecture-review session that produced this work. Before
touching any code, read these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/lifecycle-module.md` — full design; especially §3
   (Marker IR), §7 PR 4d (this PR)
3. `CONTEXT.md` — domain glossary; "Lifecycle", "Insert pass",
   "marker IR" have specific meanings
4. `compiler/CLAUDE.md` — how to build / test / lint

If the design doc disagrees with this brief, the design doc wins
— report the discrepancy and stop.

**PR 3 must be merged first.** PRs 4a–4e are parallelisable in
any order after PR 3 lands.

## PR scope

**Implements:** `docs/design/lifecycle-module.md#7` (PR 4d).

Lowering of `move x` stops mutating a global `LoweringCtx.movedVars`
set. It emits a `mark_moved x` marker at the point of the move.
The Lifecycle pass owns its own moved-set during rewrite, built
by walking the markers in source order. The set is consulted
when rewriting `mark_scope_exit` and `mark_param`: a moved var
is skipped at destroy emission.

**This is the second-to-last lifecycle-related field on
`LoweringCtx` to be removed.** `movedVars: Set<string>` goes away
in this PR (only `structLifecycleCache` remains after, removed in
PR 5).

**Files affected:**

- **MODIFIED** `compiler/src/kir/lowering-expr.ts` —
  `lowerMoveExpr` (around line ~881) replaces
  `ctx.movedVars.add(expr.operand.name)` with
  `emit(ctx, { kind: "mark_moved", var: expr.operand.name })`.
  Same condition: only when the operand is an `Identifier`.
- **MODIFIED** `compiler/src/kir/lowering-ctx.ts` — remove the
  `movedVars: Set<string>` field from the `LoweringCtx` interface,
  remove its initialiser in `createLoweringCtx`, remove its reset
  in `resetFunctionState` (`lowering-decl.ts`).
- **MODIFIED** `compiler/src/kir/lowering-scope.ts` — the
  `emitScopeDestroys` and `emitAllScopeDestroysExceptNamed`
  helpers (if still present after PR 4a) drop their
  `ctx.movedVars.has(sv.name)` reads. If 4a has already deleted
  these helpers, this step is a no-op for `lowering-scope.ts`.
- **MODIFIED** `compiler/src/lifecycle/pass.ts` — the rewriter
  builds a per-function moved-set by walking markers in source
  order. When a `mark_moved x` marker is reached, `x` is added to
  the set. When a `mark_scope_exit` or per-exit param destroy is
  rewritten, the moved-set is consulted to skip moved vars. The
  `mark_moved` marker itself is stripped after rewrite.
- **NEW** `compiler/tests/lifecycle/pass-moved.test.ts` — pass
  fixture per design doc §9.

**Out of scope (do not touch in this PR):**

- The other markers — sibling PRs 4a/4b/4c/4e. Don't migrate
  `mark_scope_exit`, `mark_assign`, `mark_param`, or `mark_track`
  here.
- Don't migrate `mark_track` (the per-scope live-var tracking) —
  PR 4e.
- Don't keep `LoweringCtx.movedVars` "for now." This PR's whole
  point is removing it. After this PR, the field doesn't exist;
  `ctx.movedVars` is a TypeScript error anywhere it's read or
  written.
- Don't fold `mark_moved` semantics into `mark_assign.is_move`.
  Different scopes: `is_move` on `mark_assign` is local to one
  assignment ("don't oncopy this RHS"); `mark_moved` is a global
  signal ("don't destroy this var at scope exit"). One can fire
  without the other.
- Don't remove `structLifecycleCache` — that's PR 5.

## Behaviour preservation

The full test suite (`bun test`) must pass with no test changes
other than the new pass fixture this PR adds. Pay particular
attention to:

- `tests/checker/move.test.ts` (or equivalent) — basic move +
  scope-exit interaction
- `tests/e2e/run.test.ts` cases that move a managed local before
  scope exit (no double-destroy)
- `tests/e2e/run.test.ts` cases that move a managed param before
  function exit (no double-destroy across `mark_param` rewrite)

**New tests added by this PR** (per design doc §9):

- `compiler/tests/lifecycle/pass-moved.test.ts` — table-driven:
  - move a tracked local, then scope-exit → no destroy for that
    var; other tracked vars still destroyed
  - move a managed param, then function return → no param destroy
    for that var
  - move a var, conditionally rebind it, scope-exit → matches
    today's behaviour (the marker is monotonic per source order;
    if today's code is monotonic, fixture asserts that; if not,
    file an issue and document)

## Forbidden shortcuts

- **Don't migrate the other markers in this PR.** Sibling PRs
  4a/4b/4c/4e.
- **Don't keep `LoweringCtx.movedVars` "for now."** Removing it is
  the deliverable. Anything that previously read or wrote
  `ctx.movedVars` must be migrated to either emit `mark_moved` (at
  the move site) or read the moved-set off the pass's local state
  (at rewrite time).
- **Don't read `ctx.movedVars` from anywhere after the marker is
  introduced.** It doesn't exist. TypeScript will tell you if you
  missed a site.
- **Don't fold the moved-set into a globally accessible Lifecycle
  module field.** The moved-set is local to one rewrite invocation
  per function. Per design doc §3: "Lifecycle pass owns its own
  moved-set during rewrite."
- **Don't reformat unrelated code.** Biome runs in CI.
- **Don't introduce new dependencies.**

## Implementation steps

1. Confirm `mark_moved` is wired into the marker IR shape per
   design doc §3 (operand: `var: string`). PR 3 should have
   stubbed it.
2. In `lowerMoveExpr`, replace the `ctx.movedVars.add(...)` line
   with the marker emission.
3. Delete `movedVars` from `LoweringCtx`,
   `createLoweringCtx`, and `resetFunctionState`. Run TypeScript
   to find every reader. Remove or migrate each one:
   - In `lowering-scope.ts`: if the destroy-emitting helpers still
     exist (PR 4a not landed yet in this branch), the
     `ctx.movedVars.has(...)` checks in them are dead — those
     helpers no longer drive destroy emission once PR 4a is in.
     Coordinate via the orchestrator if 4a hasn't landed: this PR
     blocks on the moved-set having no in-lowering reader.
4. In `compiler/src/lifecycle/pass.ts`, extend the rewriter:
   per-function, walk markers in source order; on `mark_moved x`,
   add `x` to the local moved-set. On `mark_scope_exit` /
   `mark_param` rewrite, skip vars whose name is in the moved-set.
   Strip the `mark_moved` marker after.
5. Add `tests/lifecycle/pass-moved.test.ts` per design doc §9.
6. Run full verification recipe.

## Verification recipe

```bash
cd compiler
bun install
bun test                          # must pass with no regressions
bunx biome check src/ tests/      # must report no issues
```

If either fails, **stop and report** — don't push through.

## Output

**Commit messages.** Match existing style:

```
feat(lifecycle): rewrite mark_moved into a per-function moved-set
refactor(kir): replace LoweringCtx.movedVars with mark_moved emission
test(lifecycle): cover mark_moved pass rewrite
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/lifecycle-module.md#7] (PR 4d of 5) for
  the Lifecycle module migration ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- `lowerMoveExpr` emits `mark_moved` instead of mutating
  `LoweringCtx.movedVars`
- `LoweringCtx.movedVars` is removed; the Lifecycle pass owns the
  moved-set per rewrite

## Test plan
- [ ] `bun test` passes (no regressions)
- [ ] `bunx biome check` passes
- [ ] New `tests/lifecycle/pass-moved.test.ts` covers
      moved-then-scope-exit and moved-then-param-exit
```

## Escape hatches

Stop and report if:

1. PR 4a has not landed yet — `lowering-scope.ts`'s destroy
   helpers still drive destroy emission and still read
   `ctx.movedVars`. This PR's deliverable (removing the field)
   isn't reachable until 4a is in. Coordinate ordering with the
   orchestrator.
2. A pre-existing test exercises a re-bind-after-move scenario
   whose semantics depend on `movedVars` being *cleared* at some
   point. The current `Set<string>` is monotonic per function;
   the marker-based moved-set should match. If a test fails,
   investigate before changing semantics.
3. The diff exceeds ~200 lines added or ~100 lines deleted across
   `lowering-*.ts`.

Report format per `_brief-template.md`. Wait for orchestrator
guidance — don't continue past a blocker.
