# Brief: Monomorphization PR 2 — Move maps off Checker

## Context (read first)

You are a fresh Claude Code session implementing PR 2 of the
**Monomorphization module** migration. You have no prior context
from the architecture-review session that produced this work.
Before touching any code, read these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/monomorphization-module.md` — full design;
   especially §2 (what), §3 (sub-concerns and the
   constructed-and-threaded shape), §8 PR 2 (this PR)
3. `docs/design/diagnostics-module.md` §3 — pattern reference for
   the Collector-style "constructed value, explicit lifetime"
   shape Monomorphization adopts here
4. `docs/migrations/monomorphization/pr-1.md` — the immediate
   predecessor; this PR depends on the new `src/monomorphization/`
   directory existing
5. `CONTEXT.md` — domain glossary; "Monomorphization" is now a
   concrete value, not a process noun
6. `compiler/CLAUDE.md` — how to build / test / lint

If the design doc disagrees with this brief, the design doc wins —
report the discrepancy and stop.

## PR scope

**Implements:** `docs/design/monomorphization-module.md#8` (PR 2).

The three caches that today live as fields on `Checker` migrate
into a `Monomorphization` instance. The cross-module adoption
methods follow them. `Checker` calls into Monomorphization for
register and read instead of mutating its own maps.

This is the first PR where `Monomorphization` exists as a
runtime value. PR 1 created the directory and moved pure helpers;
this PR creates the constructed-and-threaded instance per design
doc §3.

The pass-3 body-check driver stays on `Checker` for now — PR 3
moves it. Y-a baking is PR 4. Override deletion is PR 5.

**Files affected:**

- **NEW** `compiler/src/monomorphization/index.ts` — exports
  `createMonomorphization()` factory and the
  `Monomorphization` interface. The module owns the three maps
  internally.
- **NEW** `compiler/src/monomorphization/register.ts` —
  `register(genericDecl, typeArgs)` records an instantiation in
  the appropriate map (struct / function / enum). At this stage
  it still produces and stores the existing
  `MonomorphizedStruct/Function/Enum` records (PR 4 transforms
  these into synthesised AST decls).
- **NEW** `compiler/src/monomorphization/adopt.ts` — the
  cross-module merge logic that today lives as
  `adoptMonomorphizedStruct/Function/Enum` on `Checker`. Same
  by-mangled-name dedup behaviour, just relocated.
- **MODIFIED** `compiler/src/checker/checker.ts` — delete the
  three map fields and the three `adoptMonomorphizedX` methods.
  The `Checker` constructor accepts a `Monomorphization`
  instance via its options bag (mirror the
  `lifecycle`/`diag` threading planned in the other modules'
  designs). All sites that previously did
  `this.monomorphizedStructs.set(...)` now call
  `this.monomorphization.register(...)`. All read sites that
  previously did `this.monomorphizedStructs.get(name)` now call
  `this.monomorphization.getMonomorphizedStruct(name)` (or the
  equivalent function/enum accessor).
- **MODIFIED** every KIR lowering file that today reads the
  Checker's maps — switch to reading via
  `monomorphization.products()` or the targeted accessor. Find
  the read sites with
  `rg 'monomorphizedStructs|monomorphizedFunctions|monomorphizedEnums' compiler/src/`.
- **MODIFIED** `compiler/src/index.ts` (or wherever Checker is
  constructed) — construct the `Monomorphization` value before
  the Checker and thread it in, exactly like the design doc §3
  example.

**Out of scope (do not touch in this PR):**

- The pass-3 body-check driver (`checkMonomorphizedBodies` on
  `Checker`) stays in `Checker`. PR 3 moves it.
- Y-a baking. The shape of products is still
  `MonomorphizedStruct/Function/Enum` records. Do not start
  emitting synthesised AST decls — that's PR 4.
- The per-instantiation type-map override on `LoweringCtx`
  (`currentBodyTypeMap`, `currentBodyGenericResolutions`).
  Stays exactly as it is. PR 5 deletes it.
- Lifecycle integration (`lifecycle.decide(baked)`). That hook
  belongs to PR 4, after baking exists.
- Don't introduce a `withInstantiation(product, fn)` helper on
  Monomorphization. That shape is rejected alternative Z in
  design doc §7.3 — adding it now would be a regression.

## Behaviour preservation

The full test suite (`bun test`) must pass with no test changes.
Diff is data-flow refactor only — same instantiations registered,
same products read by lowering, same end-to-end output. If a
test fails, that's a regression — investigate, don't update the
test.

**New tests this PR adds:**

- `compiler/tests/monomorphization/register.test.ts` — table-
  driven: construct a `Monomorphization`, call `register(...)`
  with a fixture generic decl + type args, assert the appropriate
  map contains the expected entry. Coverage for struct,
  function, and enum.
- `compiler/tests/monomorphization/adopt.test.ts` — two
  Monomorphization instances each containing `Foo<i32>`. Adopt
  one into the other. Assert one entry, no duplicates.

Both tests are pure-data; they don't require running the full
checker.

## Forbidden shortcuts

- **Don't keep a "shadow" copy of the maps on `Checker` for
  transition.** Clean cut. The Checker reads through
  `Monomorphization`. If you find a site you can't easily
  rewire, stop and report — it likely means the design needs a
  read-API addition, not a fallback shadow.
- **Don't introduce the `withInstantiation` override hook.**
  That doesn't survive into the final design — Y-a deletes the
  override entirely in PR 5. Adding it here would be code that
  exists for one PR and then gets ripped out.
- **Don't change the data shape of products yet.** Products are
  still `MonomorphizedStruct/Function/Enum` records. Y-a is PR 4.
- **Don't touch pass-3.** It still lives on `Checker`. PR 3
  moves it.
- **Don't widen scope into KIR lowering.** Only the read-site
  switch (Checker maps → Monomorphization accessors). The
  override stack and any push/pop logic stay untouched.
- **Don't reformat unrelated code.** Biome must report changes
  only in the files you touched intentionally.
- **Don't introduce new dependencies.** `package.json` should
  not change.

## Implementation steps

1. Define `Monomorphization` interface in
   `src/monomorphization/index.ts`. Methods: `register(decl,
   typeArgs)`, `getMonomorphizedStruct(name)`,
   `getMonomorphizedFunction(name)`, `getMonomorphizedEnum(name)`,
   `products()` (returns the union of structs/functions/enums for
   read consumers), `adopt(other)`.
2. Implement `createMonomorphization()` factory — returns an
   instance holding the three maps internally.
3. Implement `register.ts` — same logic as today's checker code
   that builds a `MonomorphizedStruct/Function/Enum` and stores
   it in the right map.
4. Implement `adopt.ts` — same logic as today's
   `adoptMonomorphizedX` methods on `Checker`, just iterating
   the other instance's maps.
5. Modify the call site that constructs `Checker` (likely
   `src/index.ts` or the driver) — construct
   `monomorphization` first, pass into the `Checker` options.
6. In `Checker`, delete the three map fields and the three
   `adoptMonomorphizedX` methods. Add `monomorphization` to the
   options bag and store on `this`. Replace every internal use:
   write sites become `register`, read sites become the targeted
   accessor.
7. In KIR lowering, replace every read of the Checker's maps
   with the Monomorphization accessor. The read shape doesn't
   change; only the source.
8. Run `rg 'monomorphizedStructs|monomorphizedFunctions|monomorphizedEnums' compiler/src/`
   — must match nothing after this PR (the maps now live
   privately inside the module).
9. Add the two new tests.
10. Run full verification recipe.

## Verification recipe

```bash
cd compiler
bun install
bun test                          # must pass with no regressions
bunx biome check src/ tests/      # must report no issues
rg 'monomorphizedStructs|monomorphizedFunctions|monomorphizedEnums' src/   # nothing
```

If any check fails, stop and report.

## Output

**Commit messages.** Match existing style:

```
refactor(monomorphization): introduce constructed-and-threaded module value
refactor(checker): delegate generic-instantiation maps to Monomorphization
refactor(kir): read monomorphization products via module accessor
test(monomorphization): cover register and adopt
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/monomorphization-module.md#8] (PR 2 of 6)
  for the Monomorphization module migration
  ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- The three monomorphization maps and their `adoptMonomorphizedX`
  methods migrate from `Checker` to a constructed
  `Monomorphization` instance threaded through the checker
- Lowering reads via the new module accessors; pass 3 still
  driven by `Checker` (moves in PR 3)
- No behaviour change

## Test plan
- [ ] `bun test` passes (no regressions)
- [ ] `bunx biome check` passes
- [ ] `rg 'monomorphizedStructs|monomorphizedFunctions|monomorphizedEnums' src/` matches nothing
- [ ] New tests added: `tests/monomorphization/register.test.ts`,
      `tests/monomorphization/adopt.test.ts`
```

## Escape hatches

Stop and report if:

1. A read site in lowering needs a shape Monomorphization's
   accessors don't expose — that's a design-doc gap, not a
   judgment call.
2. Threading `monomorphization` through the Checker constructor
   conflicts with another in-flight migration (Lifecycle,
   Diagnostics) that also wants threaded options. Coordinate
   with the orchestrator on the options-bag shape rather than
   guessing.
3. The diff exceeds ~600 lines — likely scope creep.
4. A circular import emerges between `src/monomorphization/` and
   `src/checker/` — likely means a checker primitive needs to
   move too, which is PR 3 territory.

Report format per `_brief-template.md`.
