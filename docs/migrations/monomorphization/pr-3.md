# Brief: Monomorphization PR 3 — Move pass-3 body-check driver

## Context (read first)

You are a fresh Claude Code session implementing PR 3 of the
**Monomorphization module** migration. You have no prior context
from the architecture-review session that produced this work.
Before touching any code, read these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/monomorphization-module.md` — full design;
   especially §2 (the module owns its drivers), §3 (sub-concerns
   — `check-bodies.ts`), §7.4 (rejected: checker-drives pass 3),
   §8 PR 3 (this PR)
3. `docs/design/lifecycle-module.md` §2 — pattern reference: the
   way Lifecycle owns its fixed-point iteration is the same shape
   Monomorphization adopts for pass 3
4. `docs/migrations/monomorphization/pr-2.md` — predecessor; this
   PR depends on `Monomorphization` already being a constructed
   value with the maps inside
5. `CONTEXT.md` — domain glossary; "pass 3" is the body-check
   pass for monomorphized declarations, distinct from passes 1
   and 2
6. `compiler/CLAUDE.md` — how to build / test / lint

If the design doc disagrees with this brief, the design doc wins —
report the discrepancy and stop.

## PR scope

**Implements:** `docs/design/monomorphization-module.md#8` (PR 3).

The "pass 3" body-check loop relocates from `Checker` into
`Monomorphization.checkBodies()`. The actual body-checking work
still uses checker primitives (e.g.
`checker.checkBody(decl)`); Monomorphization just owns the
*driver* — the loop, the ordering, the iteration over registered
products.

Pattern-consistency rationale: Lifecycle owns its fixed-point
sweep; Monomorphization owns its body-check sweep. Every
ADR-0001 concept module owns its own loops; the Checker is the
convener (design doc §7.4).

**Files affected:**

- **NEW** `compiler/src/monomorphization/check-bodies.ts` —
  exports the body-check driver. Receives a callback into
  checker primitives so the actual type-checking work doesn't
  move out of the checker module.
- **MODIFIED** `compiler/src/monomorphization/index.ts` — adds
  `checkBodies(checkBody: (decl) => void)` to the
  `Monomorphization` interface; wires through to the new file.
- **MODIFIED** `compiler/src/checker/checker.ts` — delete the
  `checkMonomorphizedBodies` method (or whatever it's called
  today). Where the checker's pass-3 step previously called the
  local method, it now calls
  `this.monomorphization.checkBodies(decl => this.checkBody(decl))`
  (or equivalent — the signature follows what the existing
  per-decl primitive needs).
- **MODIFIED** any helper inside `checker.ts` that the old
  `checkMonomorphizedBodies` relied on but was effectively
  private to it — those stay in `Checker` (they're checker
  primitives), but ensure they have the right access modifier
  for the callback.

**Out of scope (do not touch in this PR):**

- The shape of products. Still
  `MonomorphizedStruct/Function/Enum` records. Y-a is PR 4.
- The per-instantiation type-map override on `LoweringCtx`. The
  body-check loop still relies on it for now — that's fine. PR 4
  bakes the override-redundant version; PR 5 deletes the
  override.
- The order of body-check passes. Pass 3 still runs after pass 2
  in the same outer driver; only its *implementation* moves.
- Lifecycle integration. The `lifecycle.decide(baked)` hook
  belongs to PR 4 (it lives at `register` time, not `checkBodies`
  time — see design doc §5).
- The cross-module adoption logic. Already in
  `Monomorphization` from PR 2. No changes needed.
- Don't widen scope into the KIR lowering files.

## Behaviour preservation

The full test suite (`bun test`) must pass with no test changes.
Pass 3's input is the same set of registered instantiations and
its output is the same set of body-check diagnostics — only the
class that hosts the loop changes. If a test fails, that's a
regression — investigate, don't update the test.

**New tests this PR adds:**

- `compiler/tests/monomorphization/check-bodies.test.ts` — a
  small unit test that constructs a `Monomorphization`, registers
  one instantiation, and calls `checkBodies` with a stub callback
  that records which decls it was invoked with. Assert the
  callback was invoked once with the registered decl. This pins
  the driver's iteration contract independently of the actual
  type-checking primitive.

## Forbidden shortcuts

- **Don't change the order of body-check passes.** Pass 3 still
  runs after pass 2, just driven from Monomorphization. The
  outer Checker `run()` method calls `monomorphization.checkBodies(...)`
  at the same point it previously called the local
  `checkMonomorphizedBodies` method.
- **Don't change the per-instantiation type-map override yet.**
  The driver still relies on the override the way it did before;
  the override only disappears once Y-a baking arrives in PR 4
  and is then deleted in PR 5. Touching it here invents bugs the
  remaining migration was going to handle cleanly.
- **Don't widen scope to Y-a baking.** Products are still records
  (`MonomorphizedStruct/Function/Enum`). The driver iterates the
  records; the per-decl primitive is still the today-shape.
- **Don't move `checker.checkBody` into Monomorphization.** It's a
  checker primitive (it knows about scopes, type tables, the rest
  of the checker's machinery). Monomorphization owns the loop;
  the checker owns each iteration's body.
- **Don't introduce new state on `Monomorphization`** beyond what
  the driver needs to run. No flags, no caches that aren't
  required to drive the loop.
- **Don't reformat unrelated code.** Biome must report changes
  only in files you touched intentionally.

## Implementation steps

1. In `src/monomorphization/check-bodies.ts`, implement the
   driver. It iterates the products map(s) and invokes the
   provided callback per decl. The exact loop shape mirrors the
   current `checkMonomorphizedBodies` on `Checker` — copy the
   ordering and any fixed-point logic verbatim.
2. Add `checkBodies(checkBody)` to the `Monomorphization`
   interface in `index.ts`. The method delegates to
   `check-bodies.ts`.
3. In `Checker`, delete `checkMonomorphizedBodies` (or rename it
   to `checkBody` if a per-decl primitive doesn't already exist
   — but read the existing code first; today's logic likely
   already factors into a per-decl helper).
4. Replace the call site in `Checker.run()` (or wherever the
   outer driver is) with
   `this.monomorphization.checkBodies(decl => this.checkBody(decl))`.
5. Add the new test.
6. Run full verification recipe.

## Verification recipe

```bash
cd compiler
bun install
bun test                          # must pass with no regressions
bunx biome check src/ tests/      # must report no issues
rg 'checkMonomorphizedBodies' src/    # must match nothing
```

If any check fails, stop and report.

## Output

**Commit messages.** Match existing style:

```
refactor(monomorphization): own pass-3 body-check driver
refactor(checker): delegate pass 3 to Monomorphization.checkBodies
test(monomorphization): pin checkBodies iteration contract
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/monomorphization-module.md#8] (PR 3 of 6)
  for the Monomorphization module migration
  ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- Pass 3 body-check loop migrates from `Checker` into
  `Monomorphization.checkBodies()`; per-decl checking still uses
  checker primitives via callback
- Pattern-consistency: same shape as Lifecycle owning its
  fixed-point iteration

## Test plan
- [ ] `bun test` passes (no regressions)
- [ ] `bunx biome check` passes
- [ ] `rg 'checkMonomorphizedBodies' src/` matches nothing
- [ ] New test: `tests/monomorphization/check-bodies.test.ts`
```

## Escape hatches

Stop and report if:

1. The existing `checkMonomorphizedBodies` reaches into checker
   internals in a way that doesn't factor cleanly into a callback
   — that's a design-doc gap. The fix is to first extract a
   `checkBody(decl)` primitive on `Checker`, possibly as a
   prerequisite commit on the same PR, but stop and report
   first.
2. Pass 3 turns out to interact with passes 1/2 in a way the
   design doc didn't acknowledge (e.g. shared mutable state).
3. The diff exceeds ~400 lines — likely scope creep.

Report format per `_brief-template.md`.
