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
   integration — the `lifecycle.decide(baked)` hook), §6
   (Diagnostics integration — `secondarySpans` for instantiation
   context), §7 (alternatives X, Y-b, Z and why Y-a wins), §8 PR 4
   (this PR), §9 (open questions — span policy in particular)
3. `docs/design/lifecycle-module.md` §2 — `Lifecycle.decide` is
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
`lifecycle.decide(baked)` call as part of registration, per
design doc §5. This resolves the Q5c interaction question that
was deferred from the lifecycle design.

**Files affected:**

- **NEW** `compiler/src/monomorphization/bake.ts` — pure
  substitution from `(genericDecl, substitutionMap)` to a fresh
  synthesised AST decl. Walks the AST; for every type node,
  rewrite via `substituteType`; for every expression's
  `resolvedType`, rewrite via `substituteType`; for every nested
  struct reference, rewrite the referenced type's name (mangled
  if it itself becomes an instantiation). Source spans on
  synthesised nodes point at the generic template per design doc
  §4 and the open-question recommendation in §9 (template span
  primary; instantiation site goes into diagnostic
  `secondarySpans`, not into the AST node itself).
- **MODIFIED** `compiler/src/monomorphization/register.ts` —
  `register(genericDecl, typeArgs)` now (a) computes the
  substitution map, (b) invokes `bake(...)` to produce a
  synthesised AST decl, (c) appends to the products list, (d)
  for baked structs, calls `lifecycle.decide(baked)` (design doc
  §5). The old `MonomorphizedStruct/Function/Enum` record path
  is deleted.
- **MODIFIED** `compiler/src/monomorphization/index.ts` — the
  `products()` API now returns `AstDecl[]` (the union of
  synthesised structs / functions / enums). Internal accessors
  (`getMonomorphizedStruct(name)` etc.) return the synthesised
  AST decl rather than the old record. Update the
  `Monomorphization` factory to take `lifecycle` (already in the
  options bag from the design doc §3 example).
- **MODIFIED** `compiler/src/monomorphization/check-bodies.ts` —
  iterates synthesised AST decls directly. The callback into
  `checker.checkBody(decl)` now receives a fully-resolved decl;
  no per-instantiation override needed at the call site. Pass-3
  errors emitted under this driver use the diagnostics module's
  `secondarySpans` envelope to point at the instantiation call
  site, per design doc §6.
- **MODIFIED** `compiler/src/checker/checker.ts` — wherever the
  Checker previously read a `MonomorphizedStruct.fields` (or
  `MonomorphizedFunction.params`, etc.) record shape, it now
  reads from the synthesised AST decl instead. The information
  is the same; the access shape changes.
- **MODIFIED** `compiler/src/kir/lowering-decl.ts`,
  `lowering-struct.ts`, `lowering-types.ts` — lowering iterates
  synthesised decls instead of records. The override push/pop
  sites stay (push the override, lower, pop the override) but
  for synthesised decls the override is now an empty map — no
  substitution required, the decl already carries resolved
  types. The override is a no-op in this PR; PR 5 deletes the
  field and every push/pop site.
- **MODIFIED** call site that constructs `Monomorphization` —
  pass `lifecycle` into the options bag (already available from
  the surrounding driver per Lifecycle's own migration).

**Out of scope (do not touch in this PR):**

- **Don't delete the override stack.** That's PR 5. Keeping it
  as a no-op for synthesised decls is intentional: the test
  suite passes without changes, and PR 5 removes the dead code
  separately for clean review.
- **Don't try to be clever with lazy or incremental baking.**
  Bake fully at register time per design doc §4. Memory cost is
  acknowledged in §9 as a future measurement; first make it
  correct.
- **Don't conflate `lifecycle.decide` calls with body-check
  timing.** `lifecycle.decide` runs as part of `register`; pass
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
  — additionally assert that `lifecycle.decide` is called once
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
- **Don't conflate `lifecycle.decide` calls with body-check
  timing.** `lifecycle.decide` runs in `register`; pass 3 runs
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
   `lifecycle.decide(baked)`. Delete the old code path that
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
feat(monomorphization): hook lifecycle.decide on baked structs
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
  `lifecycle.decide(baked)` call at registration time
- Diagnostics integration: pass-3 errors carry the instantiation
  site via `secondarySpans`
- The `LoweringCtx` override stack remains in place but is now a
  no-op for synthesised decls — PR 5 deletes the dead code
- Diff size note: this is the largest PR in the migration
  (~800–1200 lines). Reviewer focuses on (1) bake.ts
  correctness, (2) the products() API change, (3) the
  lifecycle.decide hook

## Test plan
- [ ] `bun test` passes (no regressions)
- [ ] `bunx biome check` passes
- [ ] New tests: `tests/monomorphization/bake.test.ts`
- [ ] Extended: `tests/monomorphization/register.test.ts` asserts
      `lifecycle.decide` is called per baked struct
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
5. `lifecycle.decide` doesn't yet exist (Lifecycle PR 1 hasn't
   landed). Stop and report; don't stub it.

Report format per `_brief-template.md`.
