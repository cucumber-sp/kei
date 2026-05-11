# Brief: Monomorphization PR 4 — Bake into synthesised AST decls (Y-a)

## Context (read first)

You are a fresh Claude Code session implementing PR 4 of the
**Monomorphization module** migration. **This is the load-bearing
PR of the migration.** It is the largest diff and the change that
PR 5's payoff (deleting the override stack) hinges on. Before
touching any code, read these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/monomorphization-module.md` — full design;
   read in full, but especially §4 (Y-a — the synthesised-AST
   decision and its three downstream consequences), §5 (Lifecycle
   integration — the `lifecycle.register(bakedStructType)` hook), §6
   (Diagnostics integration — `secondarySpans` for instantiation
   context), §7 (alternatives X, Y-b, Z and why Y-a wins), §8 PR 4
   (this PR), §9 (open questions — span policy in particular)
3. `docs/design/lifecycle-module.md` §2 — `Lifecycle.register` is
   designed to run on concrete struct types; baked structs are
   exactly that
4. `docs/design/diagnostics-module.md` §6 — the β envelope
   `secondarySpans` shape this PR's pass-3 errors use
5. `docs/migrations/monomorphization/pr-3.md` — predecessor;
   `Monomorphization.checkBodies` already exists, this PR changes
   what it iterates
6. `CONTEXT.md` — "Y-a", "baked product", "synthesised AST decl"
   are domain terms with specific meanings; do not paraphrase
7. `compiler/CLAUDE.md` — how to build / test / lint

If the design doc disagrees with this brief, the design doc wins —
report the discrepancy and stop.

## PR scope

**Implements:** `docs/design/monomorphization-module.md#8` (PR 4).

The shape of `Monomorphization`'s output changes from "map of
`MonomorphizedStruct/Function/Enum` records" to "list of
fully-substituted synthesised AST declarations" (Y-a, design doc
§4). Each baked product is a fresh AST decl whose every type
node, every expression's resolved type, and every nested struct
reference has been substituted concretely under the
instantiation's type map. No reference to a type variable
survives in the baked decl.

This is the moment Y-a wins over X and Z (design doc §7): pass 3
no longer needs the per-instantiation type-map override because
the baked decls already carry concrete resolved types. The
override stack on `LoweringCtx` becomes a no-op for synthesised
decls — and PR 5 deletes the dead code.

Lifecycle integration also lands here. Each baked struct gets a
`lifecycle.register(bakedStructType)` call as part of registration, per
design doc §5. This resolves the Q5c interaction question that
was deferred from the lifecycle design.

## How "fresh AST decl" is realised — Y-a-clone

**Critical: kei stores `resolvedType` in a Checker-owned side-map,
NOT on AST nodes.** See `Checker.typeMap: Map<Expression, Type>` and
`Checker.genericResolutions: Map<Expression, string>` at
`compiler/src/checker/checker.ts:159,195`. AST expression nodes
themselves don't carry type info. So "fresh AST decl with each
expression's `resolvedType` substituted" means **the walker
deep-clones AST nodes and emits a new side-map keyed by the clones**.

Each baked product is:

```ts
type BakedDecl = {
  decl: Declaration;                       // synthesised AST, cloned subtree
  typeMap: Map<Expression, Type>;          // keyed by `decl`'s expression nodes
  genericResolutions: Map<Expression, string>;
};
```

The walker's contract per expression `eClone` cloned from template
`eTemplate`:

```
bakedTypeMap.set(eClone, substituteType(templateTypeMap.get(eTemplate), substitutionMap));
// same for genericResolutions
```

Downstream consumers (pass-3 body-check, KIR lowering) read from the
baked decl's own side-maps, not from the Checker's global
`typeMap` — that global map is untouched by bake and only contains
template entries.

**Walker scope** (see `compiler/src/ast/nodes/`):

- All `Expression` discriminated-union arms in
  `compiler/src/ast/nodes/expressions.ts`. Most have trivial
  substitution: recurse on children, clone the record. A small
  number need name resolution via `mangleGenericName` (struct-literal
  instantiations of nested generics, call-expr against generic
  functions).
- All `Statement` discriminated-union arms in
  `compiler/src/ast/nodes/statements.ts`. Same shape — recurse + clone.
- All `Type` AST-node arms — call the existing `substituteType` from
  `src/monomorphization/substitute.ts`.

Most kinds are mechanical. The non-trivial cases are flagged below
in "Forbidden shortcuts."

## Files affected

- **NEW** `compiler/src/monomorphization/bake.ts` — implements the
  clone walker. Signature: `bake(genericDecl: Declaration,
  substitutionMap: Map<string, Type>, ctx: BakeCtx) → BakedDecl`,
  where `ctx` carries the Checker's template-side `typeMap` and
  `genericResolutions` (read-only inputs). The walker recurses over
  every Expression / Statement / Type kind and emits a fresh
  side-map. Cloned nodes carry the **template's source span** (per
  design doc §4 / §9: template span is the AST node's primary span;
  instantiation site goes into diagnostic `secondarySpans` at
  error-emission time, not onto the AST node).
- **NEW** `compiler/src/monomorphization/bake-types.ts` (optional) —
  if the clone walker grows large enough to need splitting, factor
  the type-node cloning out. Otherwise inline into `bake.ts`.
- **MODIFIED** `compiler/src/monomorphization/types.ts` — add the
  `BakedDecl` type. The old `MonomorphizedStruct/Function/Enum`
  records can either stay as type aliases for transition (cleaner)
  or be removed entirely if no consumer still reads them. Pick
  transition aliases unless removal is cheap.
- **MODIFIED** `compiler/src/monomorphization/register.ts` —
  `register(genericDecl, typeArgs)` now (a) computes the substitution
  map, (b) invokes `bake(...)` to produce a `BakedDecl`, (c) appends
  to the products list, (d) for baked structs, calls
  `lifecycle.register(bakedStructType)` (design doc §5). The old
  record-construction path is deleted.
- **MODIFIED** `compiler/src/monomorphization/index.ts` — the
  `products()` API now returns `BakedDecl[]`. Internal accessors
  (`getMonomorphizedStruct(name)` etc.) return `BakedDecl` (or
  `BakedDecl.decl` for direct AST consumers; pick one and document).
  Update the `Monomorphization` factory to take `lifecycle` in the
  options bag.
- **MODIFIED** `compiler/src/monomorphization/check-bodies.ts` —
  iterates `BakedDecl[]`. The callback into `checker.checkBody(decl,
  typeMap, genericResolutions)` now receives the baked decl plus its
  side-maps; pass-3 reads types from the baked maps, not from the
  Checker's global maps. Pass-3 errors use the diagnostics module's
  `secondarySpans` envelope per design doc §6.
- **MODIFIED** `compiler/src/checker/checker.ts` — `checkBody` (and
  its struct-method counterparts) accept optional baked side-maps
  and prefer them over `this.typeMap` / `this.genericResolutions`
  when present. Sites that previously read
  `MonomorphizedStruct.fields` / `MonomorphizedFunction.params` now
  read from `BakedDecl.decl` (the AST) instead.
- **MODIFIED** `compiler/src/kir/lowering-decl.ts`,
  `lowering-struct.ts`, `lowering-types.ts` — lowering iterates
  `BakedDecl`s and reads expression types from `BakedDecl.typeMap`
  (a fresh read site replacing the existing override-stack read).
  The override push/pop sites stay but **populate the override from
  `BakedDecl.typeMap` instead of from the Checker's global map**.
  The override is structurally a no-op (each baked decl carries
  its own complete map); PR 5 deletes the field and every push/pop
  site.
- **MODIFIED** call site that constructs `Monomorphization` — pass
  `lifecycle` into the options bag.

**Out of scope (do not touch in this PR):**

- **Don't delete the override stack.** That's PR 5. Keeping it
  as a no-op for synthesised decls is intentional: the test
  suite passes without changes, and PR 5 removes the dead code
  separately for clean review.
- **Don't try to be clever with lazy or incremental baking.**
  Bake fully at register time per design doc §4. Memory cost is
  acknowledged in §9 as a future measurement; first make it
  correct.
- **Don't conflate `lifecycle.register` calls with body-check
  timing.** `lifecycle.register` runs as part of `register`; pass
  3 (body-check) runs later, driven by
  `Monomorphization.checkBodies`. Lifecycle's fixed-point sweep
  runs after all modules have registered (design doc §5).
- **Don't change source spans on synthesised nodes.** They point
  at the generic template per design doc §4. The instantiation
  site goes into diagnostic `secondarySpans` at error-emission
  time, not onto the AST node. Open question §9 covers
  refinement; default is template span primary.
- **Don't widen scope to LoweringCtx hygiene.** The override
  stays as a no-op. Other LoweringCtx fields are #40's
  territory.
- **Don't change the cross-module adoption logic.** Adoption now
  merges synthesised decls by mangled name instead of records by
  mangled name. The merge logic itself is unchanged — two
  modules that bake `Foo<i32>` produce structurally-identical
  decls, so dedup-by-mangled-name still works.

## Behaviour preservation

The full test suite (`bun test`) must pass with no test changes
other than the new tests this PR adds. End-to-end output (compiled
binaries, diagnostic messages on existing fixtures) must be
identical. If a test fails, that's a regression — investigate,
don't update the test.

**New tests this PR adds:**

- **NEW** `compiler/tests/monomorphization/bake.test.ts` — pure
  substitution. Input: a generic AST decl plus a substitution map.
  Output: a synthesised AST decl. Snapshot fixtures covering at
  minimum: (a) struct with `T` field, (b) struct with method
  returning `Self<T>`, (c) struct with nested generic reference
  `Bar<T>` baking through to `Bar_i32`, (d) function with `T`
  parameter and `T` return, (e) enum with `T` variant payload.
- **EXTENDED** `compiler/tests/monomorphization/register.test.ts`
  — additionally assert that `lifecycle.register` is called once
  per baked struct registration (use a stub `lifecycle` that
  records calls).

Pure-data tests; no full compiler run required.

## Forbidden shortcuts

- **Don't try to delete the override stack in this PR.** That's
  PR 5. The override remains as a no-op for synthesised decls
  precisely so this PR's behaviour-preservation property is easy
  to verify: existing tests pass without changes. PR 5 then
  removes the dead code in a clean diff.
- **Don't try to be clever with lazy or incremental baking.**
  Bake fully at register time per design doc §4. If the design
  doc's choice creates measurable memory cost in practice,
  that's a §9 follow-up question for after PR 4 lands.
- **Don't conflate `lifecycle.register` calls with body-check
  timing.** `lifecycle.register` runs in `register`; pass 3 runs
  later in `checkBodies`. Lifecycle's fixed-point runs after all
  registrations complete.
- **Don't change source spans on synthesised AST nodes.** Spans
  point at the generic template (design doc §4). Instantiation
  context goes into diagnostic `secondarySpans` only.
- **Don't introduce a parallel data path.** Once this PR ships,
  there is one shape for products: synthesised AST decls. No
  records-on-the-side, no "legacy mode" flag.
- **Don't reformat unrelated code.** Biome must report changes
  only in files you touched intentionally.
- **Don't mutate the Checker's global `typeMap` or
  `genericResolutions` during bake.** The walker emits a fresh
  side-map per `BakedDecl`. The global maps stay
  template-only — touching them breaks template re-checks and
  diagnostics keyed by template identity.
- **Don't skip cloning any AST node kind.** Every Expression /
  Statement / Type kind in `src/ast/nodes/` must have a clone
  case. If a kind doesn't appear in `bake.ts`, an instantiation
  using it will share node identity with the template — and
  reads from the baked `typeMap` will miss because the side-map
  is keyed by clone identity. TS exhaustiveness checks on
  `switch (node.kind)` are your friend; lean on them.
- **Don't bake a generic decl's `genericParams` list into the
  baked decl.** The baked decl is *concrete* — its `genericParams`
  should be empty. Downstream consumers gate on
  `genericParams.length > 0` to decide "is this a template I
  should skip?"; getting this wrong causes the baked decl to be
  treated as another template.
- **Don't fold name resolution into the clone walker beyond
  `mangleGenericName`.** Struct-literal / call-expr nodes that
  reference nested generics need their target name mangled (e.g.
  `Bar<T>` baked under `{T: i32}` becomes `Bar_i32`). Anything
  else (resolving a method on a substituted struct, etc.) stays
  in the existing checker / lowering paths — they read the
  baked side-map.
- **Don't introduce new dependencies.** `package.json` should
  not change.

## Implementation steps

1. Implement `bake.ts`. Walk the generic AST decl; for every
   type node, expression's `resolvedType`, and nested struct
   reference, substitute via the existing `substituteType`
   helper. Synthesised nodes carry the template's source span.
   Mangled names follow the existing `mangleGenericName` helper
   for nested generic references.
2. Wire `register.ts` to call `bake.ts`. The output goes into
   the products list. For struct bakes, also call
   `lifecycle.register(bakedStructType)`. Delete the old code path that
   built `MonomorphizedStruct/Function/Enum` records.
3. Update the `Monomorphization` interface: `products()` returns
   `AstDecl[]`; targeted accessors return synthesised AST decls.
   Document the new shape in the interface JSDoc.
4. Update `check-bodies.ts` to iterate synthesised decls; the
   callback into the checker primitive receives a fully-
   resolved decl. Pass-3 errors emitted via the diagnostics
   module use `secondarySpans` to attach the instantiation site.
5. Update read sites in `Checker` that previously consumed the
   record shape — switch to reading from the synthesised AST
   decl.
6. Update KIR lowering read sites — iterate synthesised decls.
   The override push/pop sites stay; for synthesised decls the
   override map is empty (no-op).
7. Add the new tests; extend `register.test.ts`.
8. Run full verification recipe.

## Verification recipe

```bash
cd compiler
bun install
bun test                          # must pass with no regressions
bunx biome check src/ tests/      # must report no issues
rg 'MonomorphizedStruct|MonomorphizedFunction|MonomorphizedEnum' src/   # only type aliases (if any) should remain
```

If any check fails, stop and report.

## Output

**Commit messages.** Match existing style:

```
feat(monomorphization): bake instantiations into synthesised AST decls (Y-a)
feat(monomorphization): hook lifecycle.register on baked structs
refactor(checker,kir): consume synthesised AST decls instead of records
test(monomorphization): cover bake substitution and lifecycle hook
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/monomorphization-module.md#8] (PR 4 of 6)
  for the Monomorphization module migration
  ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- Y-a (design doc §4): Monomorphization output changes from
  records to fully-substituted synthesised AST decls; pass 3
  type-checks them directly without a per-instantiation override
- Lifecycle integration: each baked struct receives a
  `lifecycle.register(bakedStructType)` call at registration time
- Diagnostics integration: pass-3 errors carry the instantiation
  site via `secondarySpans`
- The `LoweringCtx` override stack remains in place but is now a
  no-op for synthesised decls — PR 5 deletes the dead code
- Diff size note: this is the largest PR in the migration
  (~800–1200 lines). Reviewer focuses on (1) bake.ts
  correctness, (2) the products() API change, (3) the
  lifecycle.register hook

## Test plan
- [ ] `bun test` passes (no regressions)
- [ ] `bunx biome check` passes
- [ ] New tests: `tests/monomorphization/bake.test.ts`
- [ ] Extended: `tests/monomorphization/register.test.ts` asserts
      `lifecycle.register` is called per baked struct
```

## Escape hatches

Stop and report if:

1. `bake` hits an AST node shape the design doc didn't
   anticipate (e.g. an expression form whose `resolvedType`
   substitution isn't well-defined). That's a design-doc gap;
   do not invent a substitution rule.
2. Memory cost of baked AST decls causes test-suite timeouts or
   OOM on existing fixtures. That's a §9 question coming due
   ahead of schedule — stop and surface, don't paper over.
3. An existing test fails on the synthesised-decl path in a way
   that suggests the override was masking a checker bug. Stop
   and report; don't update the test.
4. The diff exceeds ~1500 lines — well past the design doc's
   load-bearing-PR estimate; suggests scope creep or a missing
   prerequisite extraction.
5. `lifecycle.register` doesn't yet exist (Lifecycle PR 1 hasn't
   landed). Stop and report; don't stub it.

Report format per `_brief-template.md`.
