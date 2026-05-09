# Brief: Monomorphization PR 6 — Cleanup

## Context (read first)

You are a fresh Claude Code session implementing PR 6 of the
**Monomorphization module** migration. This is the cleanup PR
that closes out the migration. Before touching any code, read
these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/monomorphization-module.md` — full design;
   especially §8 PR 6 (this PR)
3. `docs/migrations/monomorphization/pr-1.md` — the original PR
   that introduced the `checker/generics.ts` re-export shim this
   PR deletes
4. `docs/migrations/monomorphization/pr-5.md` — predecessor; the
   override stack is already gone, this PR catches stragglers
5. `compiler/CLAUDE.md` — has the "Where to add a feature" table
   that this PR updates

If the design doc disagrees with this brief, the design doc wins —
report the discrepancy and stop.

## PR scope

**Implements:** `docs/design/monomorphization-module.md#8` (PR 6).

Three small jobs:

1. Fold any remaining "is this from a monomorphization?" branches
   in lowering. They should all be gone by PR 5; this PR catches
   stragglers if any remain.
2. Delete the thin re-export shim at
   `compiler/src/checker/generics.ts` introduced by PR 1.
3. Update `compiler/CLAUDE.md`'s "Where to add a feature" table
   to point at `src/monomorphization/` for generic work.

**Files affected:**

- **DELETED** `compiler/src/checker/generics.ts` — the transition
  re-export shim PR 1 introduced. After PRs 1–5 nothing should
  import from this path; this PR removes the file. Verify
  emptiness before deletion via `rg 'from .*generics' compiler/src/`.
- **MODIFIED** any straggler in
  `compiler/src/kir/lowering-{decl,struct,types,expr}.ts` (or
  elsewhere in lowering) that still has an "is this from a
  monomorphization?" branch. Find these via inspection;
  `rg 'monomorph' compiler/src/kir/` is a starting point.
  Replace the branch with the unified path that treats every
  decl uniformly.
- **MODIFIED** `compiler/CLAUDE.md` — update the "Where to add a
  feature" table so the row for generics / monomorphization
  points at `src/monomorphization/` rather than
  `src/checker/generics.ts`.

**Out of scope (do not touch in this PR):**

- **Don't reformat unrelated code.** Biome must report changes
  only in files you touched intentionally.
- **Don't widen scope.** If you find friction in adjacent code,
  file a GitHub issue per the project's `CLAUDE.md` repo policy
  and link it from the PR description.
- **Don't change `Monomorphization`'s interface.** It is settled
  by PR 4 / PR 5.
- **Don't touch `LoweringCtx` further.** PR 5 already removed
  the two monomorphization-specific fields; remaining fields
  are `#40`'s territory.

## Behaviour preservation

The full test suite (`bun test`) must pass with no test changes.
This PR is mechanical cleanup — deletion of an unused file,
straggler-folding that should already be no-op paths, and a
documentation update. If a test fails, investigate.

**New tests this PR adds:** none.

## Forbidden shortcuts

- **Don't reformat unrelated code.** Biome must report changes
  only in files you touched intentionally.
- **Don't widen scope.** If you find adjacent friction, file a
  GitHub issue per repo policy and link it from the PR.
- **Don't keep the shim "for compatibility."** Nothing in
  `compiler/src/` should import from `checker/generics.ts`
  after PR 1 ran cleanly. If something still does, that's a PR 1
  oversight; fix it here as part of straggler cleanup, then
  delete the shim.
- **Don't introduce a `Monomorphization`-aware comment in
  lowering.** Synthesised decls are just-another-AST-decl. The
  whole point of the migration is that lowering doesn't need to
  care.

## Implementation steps

1. Run `rg 'from .*generics' compiler/src/`. If anything matches
   outside the shim file itself, switch the import to
   `../monomorphization` (or the appropriate relative path).
2. Delete `compiler/src/checker/generics.ts`.
3. Re-run `rg 'from .*generics' compiler/src/` — must match
   nothing.
4. Inspect lowering files for any remaining
   "is this from a monomorphization?" / `if (isGeneric)` /
   `if (decl.kind === '...monomorphized...')` branches. Where
   the branch only existed to feed the now-deleted override,
   collapse to the unified path.
5. Update `compiler/CLAUDE.md`'s "Where to add a feature" table:
   the row for generics / monomorphization work points at
   `src/monomorphization/`.
6. Run full verification recipe.

## Verification recipe

```bash
cd compiler
bun install
bun test                          # must pass with no regressions
bunx biome check src/ tests/      # must report no issues
rg 'from .*generics' src/         # nothing
```

If any check fails, stop and report.

## Output

**Commit messages.** Match existing style:

```
chore(checker): delete generics.ts re-export shim
refactor(kir): fold remaining monomorphization-aware branches in lowering
docs(claude): point generic work at src/monomorphization/
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/monomorphization-module.md#8] (PR 6 of 6)
  for the Monomorphization module migration
  ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- Deletes the `src/checker/generics.ts` re-export shim from PR 1
- Folds remaining "is this from a monomorphization?" branches in
  lowering (stragglers PR 5 didn't catch, if any)
- Updates `compiler/CLAUDE.md`'s "Where to add a feature" table
  to point generic work at `src/monomorphization/`

## Test plan
- [ ] `bun test` passes (no regressions)
- [ ] `bunx biome check` passes
- [ ] `rg 'from .*generics' src/` matches nothing
```

## Escape hatches

Stop and report if:

1. Deleting `checker/generics.ts` breaks the build — means a
   stale import path slipped through PR 1 / PR 2. Fix the
   import path; do not restore the shim.
2. A "is this from a monomorphization?" branch turns out to do
   real work, not just feed the deleted override. That's a
   design-doc gap from PR 4 — stop and report.
3. The diff exceeds ~150 lines — likely scope creep on the
   straggler-folding step.

Report format per `_brief-template.md`.
