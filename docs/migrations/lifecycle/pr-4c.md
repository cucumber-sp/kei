# Brief: Lifecycle PR 4c — `mark_param` cutover

## Context (read first)

You are a fresh Claude Code session implementing PR 4c of the
**Lifecycle module** migration. You have no prior context from
the architecture-review session that produced this work. Before
touching any code, read these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/lifecycle-module.md` — full design; especially §3
   (Marker IR), §7 PR 4c (this PR)
3. `CONTEXT.md` — domain glossary; "Lifecycle", "Insert pass",
   "marker IR" have specific meanings
4. `compiler/CLAUDE.md` — how to build / test / lint

If the design doc disagrees with this brief, the design doc wins
— report the discrepancy and stop.

**PR 3 must be merged first.** PRs 4a–4e are parallelisable in
any order after PR 3 lands.

## PR scope

**Implements:** `docs/design/lifecycle-module.md#7` (PR 4c).

Lowering of function entry stops registering managed params on the
function-level scope frame for "destroy at every exit." It emits
one `mark_param param` per managed param at function entry. The
Lifecycle pass walks each function, finds its `mark_param` markers,
and inserts param-destroys at every exit point — `ret`
terminators, the implicit fall-through return at function end, and
the throws-protocol error tag returns.

**Files affected:**

- **MODIFIED** `compiler/src/kir/lowering-decl.ts` — `lowerFunction`
  no longer calls `trackScopeVarByType` for each managed param
  (the loop around line ~187). Instead, after the
  function-level `pushScope` and the param map setup, emit one
  `mark_param p.name` for each param whose checker type triggers
  `Lifecycle.hasDestroy`. Use the existing `Lifecycle.hasDestroy`
  query (introduced in PR 1) — *not* `getStructLifecycle`, which
  is being phased out.
- **MODIFIED** `compiler/src/lifecycle/pass.ts` — extend the
  rewriter to handle `mark_param`. Strategy: collect all
  `mark_param` markers per function during a first walk; in a
  second walk, at every exit point (each `ret` terminator, each
  throws error-tag return path), emit a destroy for every collected
  param in declaration-order-irrelevant order (params don't have
  the reverse-decl-order spec invariant — that's locals only;
  confirm against design doc §3 and spec §6.9 if in doubt).
- **NEW** `compiler/tests/lifecycle/pass-param.test.ts` — pass
  fixture per design doc §9.

**Out of scope (do not touch in this PR):**

- The other markers — sibling PRs 4a/4b/4d/4e. Don't migrate
  `mark_scope_exit`, `mark_assign`, `mark_moved`, or `mark_track`
  here.
- Don't conflate `mark_param` with `mark_track`. Params live for
  the whole function and get destroyed at every exit; tracked
  locals live for a scope and get destroyed at that scope's exit.
  Two markers, two responsibilities.
- Don't move the function-level `pushScope` / `popScopeWithDestroy`
  pair — that's still doing work for non-param tracked locals
  until PR 4e (`mark_track`) lands.
- Don't touch the throws-protocol's `__out` / `__err` synthetic
  params (added by `addThrowsParams`) — those are pointer params,
  not managed types, no destroy fires.
- Don't remove `LoweringCtx.scopeStack`, `movedVars`, or
  `structLifecycleCache`.

## Behaviour preservation

The full test suite (`bun test`) must pass with no test changes
other than the new pass fixture this PR adds. Pay particular
attention to:

- `tests/checker/struct-lifecycle.test.ts` cases that pass managed
  structs as parameters
- `tests/e2e/run.test.ts` cases that take string parameters and
  exit through multiple `return` statements
- `tests/e2e/throws.test.ts` (or equivalent) — the throws-protocol
  has multiple exit paths; param destroys must fire at all of them

**New tests added by this PR** (per design doc §9):

- `compiler/tests/lifecycle/pass-param.test.ts` — table-driven:
  - function with one string param, two `return` paths → destroy
    fires at both
  - function with managed-struct param, throws protocol → destroy
    fires at both the success-tag return and the error-tag return
  - function with mix of managed and non-managed params → only
    managed get destroys
  - function with no managed params → no destroys inserted

## Forbidden shortcuts

- **Don't migrate the other markers in this PR.** Sibling PRs
  4a/4b/4d/4e.
- **Don't conflate `mark_param` with `mark_track`.** Different
  lifetimes, different exit behaviour.
- **Don't insert param destroys via `mark_scope_exit`.** That
  would re-introduce the coupling we're breaking. The function's
  outermost scope-exit handles tracked *locals*; param destroys
  are their own marker because they fire at *every* exit
  (`return`, fall-through, throws-error-tag), not just the
  outermost scope-exit point.
- **Don't reformat unrelated code.** Biome runs in CI.
- **Don't introduce new dependencies.**
- **Don't keep both paths running.** After this PR,
  `trackScopeVarByType` is no longer called for params — only for
  whatever non-param call sites it has (check; if zero, the helper
  itself becomes dead, but its removal waits for PR 5).

## Implementation steps

1. Confirm `mark_param` is wired into the marker IR shape per
   design doc §3. PR 3 should have stubbed it.
2. In `lowerFunction` (`lowering-decl.ts`), replace the
   `trackScopeVarByType` loop with one that calls
   `Lifecycle.hasDestroy(checkerType)` per param and emits
   `mark_param p.name` when true. Strings on the param boundary
   are values, not pointers, so they're *not* destroyed at exit
   (the existing `trackScopeVarByType` already excludes strings;
   preserve that exclusion in the new path).
3. In `compiler/src/lifecycle/pass.ts`, add a per-function
   pre-pass that collects `mark_param` markers. Then on the rewrite
   pass, at every `ret` terminator (and the throws error-tag
   path, if PR 3's pass abstraction surfaces them as terminators),
   emit destroys for the collected params before the terminator.
   The `mark_param` markers themselves are stripped.
4. Add `tests/lifecycle/pass-param.test.ts` per design doc §9.
5. Run full verification recipe.

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
feat(lifecycle): rewrite mark_param into per-exit destroys
refactor(kir): replace param-destroy bookkeeping with mark_param emission
test(lifecycle): cover mark_param pass rewrite
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/lifecycle-module.md#7] (PR 4c of 5) for
  the Lifecycle module migration ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- `lowerFunction` emits `mark_param` for each managed param;
  the Lifecycle pass walks each function and inserts destroys
  before every exit terminator
- `trackScopeVarByType` is no longer called for params

## Test plan
- [ ] `bun test` passes (no regressions)
- [ ] `bunx biome check` passes
- [ ] New `tests/lifecycle/pass-param.test.ts` covers
      multi-`return` and throws-protocol exits
```

## Escape hatches

Stop and report if:

1. The throws-protocol's exit terminator shape isn't visible to
   the pass in a uniform way (e.g. error-tag returns are emitted as
   stores rather than `ret`). Don't paper over with a special case
   — report so PR 3's pass abstraction can be adjusted.
2. A pre-existing e2e test that exercises early-return + managed
   param fails in a way that suggests the *order* of param
   destroys (vs scope-exit destroys at the outermost scope) was
   load-bearing. Spec the order before changing it.
3. The diff exceeds ~250 lines added or ~100 lines deleted from
   `lowering-decl.ts`.

Report format per `_brief-template.md`. Wait for orchestrator
guidance — don't continue past a blocker.
