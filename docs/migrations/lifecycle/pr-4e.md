# Brief: Lifecycle PR 4e — `mark_track` cutover

## Context (read first)

You are a fresh Claude Code session implementing PR 4e of the
**Lifecycle module** migration. You have no prior context from
the architecture-review session that produced this work. Before
touching any code, read these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/lifecycle-module.md` — full design; especially §3
   (Marker IR), §7 PR 4e (this PR)
3. `CONTEXT.md` — domain glossary; "Lifecycle", "Insert pass",
   "marker IR" have specific meanings
4. `compiler/CLAUDE.md` — how to build / test / lint

If the design doc disagrees with this brief, the design doc wins
— report the discrepancy and stop.

**PR 3 must be merged first.** PRs 4a–4e are parallelisable in
any order after PR 3 lands. This is the **last insertion-site
cutover**; after it, all five lifecycle markers are doing real
work and the Insert sub-concern lives entirely in the Lifecycle
module. PR 5 then sweeps the residue (`structLifecycleCache`,
dead helpers, the "Where to add a feature" table).

## PR scope

**Implements:** `docs/design/lifecycle-module.md#7` (PR 4e).

Per-scope live-var tracking — the `LoweringCtx.scopeStack:
ScopeVar[][]` push/pop discipline and the `trackScopeVar` /
`trackScopeVarByType` helpers — gets replaced with
`mark_scope_enter scope_id` and `mark_track var, scope_id`
markers. Scope IDs are fresh integers minted at lowering time;
they survive into the Lifecycle pass, where the rewriter builds
its own scope→tracked-vars map by walking the markers in source
order.

**Files affected:**

- **MODIFIED** `compiler/src/kir/lowering-scope.ts` — `pushScope`
  emits `mark_scope_enter scope_id` and bumps a scope counter.
  `trackScopeVar` / `trackScopeVarByType` emit `mark_track
  var_name, scope_id` for the current innermost scope when the
  var is managed (string or struct-with-destroy). The
  `scopeStack: ScopeVar[][]` data structure is gone — the helpers
  no longer push/pop frames; they just emit markers.
- **MODIFIED** `compiler/src/kir/lowering-ctx.ts` — remove
  `scopeStack: ScopeVar[][]` and `loopScopeDepth: number` from
  the `LoweringCtx` interface. Loop break/continue use
  `mark_scope_exit` markers for each scope being unwound (already
  the case after PR 4a; this PR removes the now-dead
  `loopScopeDepth`). Add a `nextScopeId: number` counter for
  minting fresh scope IDs. Remove the `ScopeVar` interface — no
  consumers remain.
- **MODIFIED** `compiler/src/kir/lowering-decl.ts` —
  `resetFunctionState` no longer touches `scopeStack`. The
  function-level `pushScope` still fires (now emitting
  `mark_scope_enter`); the function-level `popScopeWithDestroy`
  is already a `mark_scope_exit` after PR 4a.
- **MODIFIED** `compiler/src/lifecycle/pass.ts` — the rewriter
  walks `mark_scope_enter` / `mark_track` to build a
  `Map<scope_id, TrackedVar[]>`. On `mark_scope_exit scope_id`,
  reads the tracked-vars list for that scope and emits destroys in
  reverse declaration (i.e. reverse track-emission) order, with the
  moved-set (PR 4d) skip applied. All four marker kinds are
  stripped after rewrite.
- **NEW** `compiler/tests/lifecycle/pass-track.test.ts` — pass
  fixture per design doc §9.

**Out of scope (do not touch in this PR):**

- The other markers — sibling PRs 4a/4b/4c/4d. By the time this
  PR runs, those have landed; don't re-migrate them.
- Don't keep `LoweringCtx.scopeStack` after this PR — it must be
  gone. Same for `loopScopeDepth` and the `ScopeVar` interface.
- Don't fold scope tracking back into the lowering as a "helper
  cache." Markers are the source of truth. The pass owns the
  scope→tracked-vars map; lowering owns marker emission.
- Don't remove `structLifecycleCache` — that's PR 5.
- Don't update `compiler/CLAUDE.md`'s "Where to add a feature"
  table — that's PR 5's documentation sweep.

## Behaviour preservation

The full test suite (`bun test`) must pass with no test changes
other than the new pass fixture this PR adds. Pay particular
attention to:

- `tests/e2e/run.test.ts` cases that nest scopes (block
  expressions, `if` arms, loop bodies, `unsafe` blocks) holding
  managed locals — destroy order must match today's reverse
  declaration order
- `tests/e2e/run.test.ts` cases that `break` / `continue` out of a
  loop holding managed locals in inner scopes — the multi-scope
  unwind already runs through `mark_scope_exit` after PR 4a; this
  PR makes the var-set behind each scope exit live in markers
  rather than `scopeStack`
- `tests/kir/` snapshots that print scope-tracked destroy
  sequences — instruction positions don't move; the producer does

**New tests added by this PR** (per design doc §9):

- `compiler/tests/lifecycle/pass-track.test.ts` — table-driven:
  - single scope with two tracked vars → destroys in reverse
    declaration order
  - nested scopes → inner scope's tracked vars destroyed at inner
    `mark_scope_exit`; outer's at outer
  - loop body with `break` traversing two scope frames → both
    sets of tracked vars destroyed in inner-first, reverse-decl
    order
  - `mark_track` emitted with the correct innermost `scope_id`
    when tracking happens inside an `if` arm

## Forbidden shortcuts

- **Don't migrate the other markers in this PR.** Sibling PRs
  4a/4b/4c/4d. By this PR, all are merged.
- **Don't keep `LoweringCtx.scopeStack` after this PR.** It must
  be gone. TypeScript will tell you if you missed a reader.
- **Don't fold scope tracking back into the lowering.** Markers
  are the source of truth. If you find yourself wanting a
  `currentScope` cache in `LoweringCtx`, you're rebuilding what
  the markers already encode — stop and re-read design doc §3.
- **Don't introduce a `scope_id` parameter on `mark_track` that
  is anything other than the innermost open scope.** That makes
  the marker contextual on lowering's tree-walk position, which is
  fine; it does *not* support tracking into a non-innermost scope.
  No call site needs that.
- **Don't reformat unrelated code.** Biome runs in CI.
- **Don't introduce new dependencies.**

## Implementation steps

1. Confirm `mark_scope_enter` and `mark_track` are wired into the
   marker IR shape per design doc §3. PR 3 should have stubbed
   them. (`mark_scope_enter` is the §3 marker; today's `pushScope`
   has no marker counterpart, so this is the first emitter.)
2. Add `nextScopeId: number` to `LoweringCtx`. Mint a fresh ID
   in `pushScope`; emit `mark_scope_enter scope_id`. Stash the
   ID on a small per-function "open scopes" stack-of-numbers (a
   plain `number[]`) so that `mark_scope_exit` can be tagged with
   the right ID and `mark_track` can name the innermost open
   scope. This stack is bookkeeping, not a `ScopeVar[][]` — no
   tracked-var data lives in lowering anymore.
3. Replace `trackScopeVar` and `trackScopeVarByType` bodies: the
   "is this var managed?" check (string or
   `Lifecycle.hasDestroy(struct)`) stays; the
   `currentScope.push({...})` becomes
   `emit(ctx, { kind: "mark_track", var: name, scope_id: innermost })`.
   Drop the `varId` parameter if unused (the pass resolves the
   var by name at rewrite time, same as `mark_moved`).
4. Delete `scopeStack`, `loopScopeDepth`, and `ScopeVar` from
   `LoweringCtx` / `lowering-ctx.ts`. Run TypeScript to find every
   reader. After PRs 4a + 4d, the remaining readers should be the
   ones this step is removing.
5. In `compiler/src/lifecycle/pass.ts`, extend the rewriter:
   per-function pre-walk to build `Map<scope_id, TrackedVar[]>`
   from `mark_track`. Reuse the existing `mark_scope_exit` rewrite
   (PR 4a) but read tracked vars from the new map instead of
   whatever transitional shape PR 4a used. Strip
   `mark_scope_enter` and `mark_track` after.
6. Add `tests/lifecycle/pass-track.test.ts` per design doc §9.
7. Run full verification recipe.

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
feat(lifecycle): rewrite mark_track + mark_scope_enter into a scope→vars map
refactor(kir): replace LoweringCtx.scopeStack with mark_track emission
test(lifecycle): cover mark_track pass rewrite
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/lifecycle-module.md#7] (PR 4e of 5,
  last insertion-site cutover) for the Lifecycle module migration
  ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- `pushScope` and `trackScopeVar` emit `mark_scope_enter` and
  `mark_track` markers; the Lifecycle pass owns the
  scope→tracked-vars map at rewrite time
- `LoweringCtx.scopeStack`, `loopScopeDepth`, and the `ScopeVar`
  interface are removed
- After this PR, all five lifecycle markers (`mark_scope_enter`,
  `mark_scope_exit`, `mark_track`, `mark_assign`, `mark_param`,
  `mark_moved`) are doing real work; PR 5 sweeps the residue

## Test plan
- [ ] `bun test` passes (no regressions)
- [ ] `bunx biome check` passes
- [ ] New `tests/lifecycle/pass-track.test.ts` covers nested
      scopes, loop unwind, and innermost-scope `mark_track` IDs
```

## Escape hatches

Stop and report if:

1. PR 4a has not landed yet — `mark_scope_exit`'s rewrite still
   needs to source tracked vars from somewhere, and that
   somewhere is `scopeStack` until this PR moves it. The
   migration order requires 4a before 4e if both are landing
   sequentially. Coordinate with the orchestrator.
2. A pre-existing snapshot test prints a destroy in a position
   that doesn't match the marker-driven rewrite. That's almost
   certainly a fixture-ordering issue (the rewrite runs after
   lowering completes, so destroys land at the marker's source
   position) — investigate before updating the snapshot.
3. The diff exceeds ~400 lines added or ~250 lines deleted across
   `lowering-*.ts` and `lowering-ctx.ts`.

Report format per `_brief-template.md`. Wait for orchestrator
guidance — don't continue past a blocker.
