# Brief: Lifecycle PR 4b — `mark_assign` cutover

## Context (read first)

You are a fresh Claude Code session implementing PR 4b of the
**Lifecycle module** migration. You have no prior context from
the architecture-review session that produced this work. Before
touching any code, read these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/lifecycle-module.md` — full design; especially §3
   (Marker IR), §7 PR 4b (this PR)
3. `CONTEXT.md` — domain glossary; "Lifecycle", "Insert pass",
   "marker IR", "Managed type" have specific meanings
4. `compiler/CLAUDE.md` — how to build / test / lint

If the design doc disagrees with this brief, the design doc wins
— report the discrepancy and stop.

**PR 3 must be merged first.** PRs 4a–4e are parallelisable in
any order after PR 3 lands; pick this one when you've got an
afternoon and the assignment-lowering touchpoints loaded in head.

## PR scope

**Implements:** `docs/design/lifecycle-module.md#7` (PR 4b).

Lowering of assignments to managed slots stops emitting
`destroy old → store → oncopy new` directly. It emits a single
`mark_assign slot, new_value, is_move` marker. The Lifecycle pass
rewrites the marker into the same three-instruction sequence at
rewrite time, reading the slot's KIR type to decide
struct-destroy vs `kei_string_destroy`.

**Files affected:**

- **MODIFIED** `compiler/src/kir/lowering-expr.ts` — three
  assignment-to-managed-slot sites (around lines ~632, ~745, ~775
  in the current source: simple `x = v`, `obj.field = v`, and
  `arr[i] = v`) replaced with a `mark_assign` emission. The
  `getStructLifecycle` lookup at the call site, the `load`/`destroy`
  pair, the `store`, and the conditional `oncopy` collapse into the
  marker plus the slot pointer and new-value var.
- **MODIFIED** `compiler/src/lifecycle/pass.ts` — extend the
  rewriter to handle `mark_assign`: look up the slot's pointee
  type, emit `load → destroy → store → oncopy` for managed
  structs, `kei_string_destroy(slot) → store` for strings, plain
  `store` for non-managed slots (the marker is a no-op then).
  Skip the trailing `oncopy` when `is_move` is true.
- **NEW** `compiler/tests/lifecycle/pass-assign.test.ts` — pass
  fixture per design doc §9.

**Out of scope (do not touch in this PR):**

- The other markers (`mark_scope_exit`, `mark_param`, `mark_moved`,
  `mark_track`) — those are sibling PRs 4a/4c/4d/4e. Don't widen
  scope.
- Don't fold the move-elision marker (`mark_moved`) into
  `mark_assign`'s `is_move` semantics. `is_move` on `mark_assign`
  carries one bit: "this particular assignment's RHS is a move
  expression, so suppress the trailing `oncopy`." It does **not**
  affect future destroys of the source variable — that's
  `mark_moved`'s job and lives in PR 4d.
- Don't migrate compound-assignment lowering (`+=`, `-=`, etc.) —
  those don't trigger lifecycle hooks (the slot is updated
  in-place, not replaced) and the existing branches stay as-is.
- Don't migrate field-assign-through-`ref T` (the `isRefField`
  branch around line ~739) — refs don't own the pointee, no
  hook fires, no marker needed.
- Don't remove `LoweringCtx.movedVars`, `structLifecycleCache`, or
  `scopeStack`. They're for sibling PRs.

## Behaviour preservation

The full test suite (`bun test`) must pass with no test changes
other than the new pass fixture this PR adds. Pay particular
attention to:

- `tests/checker/struct-lifecycle.test.ts` and any e2e cases that
  reassign a managed local
- `tests/e2e/run.test.ts` cases that mutate struct fields holding
  strings or nested managed structs
- `tests/e2e/run.test.ts` cases that index-assign into an array
  of managed elements

**New tests added by this PR** (per design doc §9):

- `compiler/tests/lifecycle/pass-assign.test.ts` — table-driven
  pass fixture:
  - assign to non-managed slot → marker rewrites to bare `store`
  - assign to managed-struct slot, non-move RHS → load/destroy/
    store/oncopy
  - assign to managed-struct slot, move RHS → load/destroy/store
    (no oncopy)
  - assign to string slot → `kei_string_destroy`/store
  - assign through `field_ptr` of a managed struct field

## Forbidden shortcuts

- **Don't migrate the other markers in this PR.** Sibling PRs
  4a/4c/4d/4e. Each insertion-site cutover removes the old path
  *for that one site*.
- **Don't fold `mark_moved` semantics into `mark_assign.is_move`.**
  `is_move` is one bit, scoped to the single assignment. The
  global moved-set tracking is a separate marker.
- **Don't widen the marker to carry type information.** Per design
  doc §3: "Type is read off the var's KIR type at rewrite time."
  This keeps the marker String-stdlib-migration-proof.
- **Don't reformat unrelated code.** Biome runs in CI.
- **Don't introduce new dependencies.**
- **Don't keep both paths running.** After this PR, no code outside
  the Lifecycle pass emits the assign-to-managed-slot
  destroy/store/oncopy triple.

## Implementation steps

1. Add `mark_assign` to the marker IR shape per design doc §3
   (operands: `slot: VarId`, `new_value: VarId`,
   `is_move: boolean`). PR 3 should already have stubbed this — if
   not, this is a brief problem; report.
2. Rewrite the three sites in `lowering-expr.ts`:
   - `Identifier` target (line ~632 region): after computing
     `ptrId` and `valueId`, emit `mark_assign ptrId, valueId,
     expr.value.kind === "MoveExpr"` and stop. No `getStructLifecycle`
     lookup, no manual load/destroy/store/oncopy.
   - `MemberExpr` target (line ~745 region): same, after computing
     `ptrDest` and `valueId` for the non-`isRefField` branch.
   - `IndexExpr` target (line ~775 region): same, after computing
     `ptrDest` and `valueId`.
3. In `compiler/src/lifecycle/pass.ts`, add the rewrite branch for
   `mark_assign`. Read the slot's pointee type from KIR; dispatch
   on managed-struct / string / non-managed.
4. Add `tests/lifecycle/pass-assign.test.ts` per design doc §9.
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
feat(lifecycle): rewrite mark_assign in the Insert pass
refactor(kir): replace assign-to-managed-slot triples with mark_assign emission
test(lifecycle): cover mark_assign pass rewrite
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/lifecycle-module.md#7] (PR 4b of 5) for
  the Lifecycle module migration ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- `lowering-expr.ts` emits `mark_assign` at three assignment sites;
  the Lifecycle pass rewrites into load/destroy/store/oncopy at
  rewrite time
- `getStructLifecycle` calls leave the assignment lowering paths;
  type lookup moves to the pass

## Test plan
- [ ] `bun test` passes (no regressions)
- [ ] `bunx biome check` passes
- [ ] New `tests/lifecycle/pass-assign.test.ts` covers managed/
      string/non-managed slots and the `is_move` suppression
```

## Escape hatches

Stop and report if:

1. A pre-existing test fails that suggests one of the three
   assignment sites had a subtler invariant than the marker
   captures (e.g. ordering of side effects between RHS evaluation
   and the destroy of the old value). The marker design assumes
   evaluation order is `valueId computed → marker emitted`, which
   matches today's code.
2. The pass cannot recover the slot's pointee type from the KIR
   `field_ptr` / `index_ptr` / pointer var — suggests the rewrite
   needs auxiliary type info we haven't threaded through. Report.
3. The diff exceeds ~400 lines added or ~150 lines deleted from
   `lowering-expr.ts`.

Report format per `_brief-template.md`. Wait for orchestrator
guidance — don't continue past a blocker.
