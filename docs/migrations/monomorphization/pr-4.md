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

## How "fresh AST decl" is realised — Path A (revised, take 4)

**Critical context — three prior attempts hit escape hatches; this
section preserves what each learned:**

1. First framing assumed `resolvedType` lives on AST nodes. **It
   doesn't** — kei stores it in a Checker side-map.
2. Second framing assumed pass 2 body-checks templates and we
   substitute that map. **It doesn't** — templates are body-checked
   only in pass 3, against a specific instantiation's substitutions.
3. Third framing introduced `BakedDecl` with its own typeMap to
   avoid touching the global. **Over-designed** — clone-keyed
   entries in the global typeMap don't corrupt template-keyed ones
   (different identities, same map). No wrapper needed.

The kei-faithful realisation:

### Half 1 — AST clone (`bake.ts`, pure)

A pure walker over the template `Declaration` produces a fresh AST
subtree. Every nested `Expression`, `Statement`, and `Type` node has
a new identity. Type-node substitution is applied inline (call
existing `substituteType` from `src/monomorphization/substitute.ts`).
Struct-literal and call-expr `typeArgs` are substituted; references
to nested generic structs get their target name mangled via
`mangleGenericName`.

**The clone walker writes NO type-side-map entries.** It produces
pure AST only.

Signature:

```ts
bake(genericDecl: Declaration, substitutionMap: Map<string, Type>) → Declaration
```

### Half 2 — Body type-check (extend `checker.checkBody` signature)

Today's `checkMonomorphizedFunctionBody` /
`checkMonomorphizedStructMethodBodies` derive `typeSubs` from
`decl.genericParams.zip(monoX.typeArgs)`. Clones have empty
`genericParams` (they're concrete), so that derivation yields an
empty map — substitution would never apply.

**The signature must change** to accept `typeSubs` explicitly:

```ts
// Before (derives typeSubs from decl.genericParams):
checkBody(decl: Declaration): void
// After (accepts typeSubs explicitly):
checkBody(decl: Declaration, typeSubs?: Map<string, Type>): void
```

Backward-compatible — omitted / empty `typeSubs` yields current
behaviour. The Monomorphization driver passes the substitution map
explicitly when calling against a clone. The existing pass-3 callers
also migrate to pass `typeSubs` explicitly rather than deriving
from `decl.genericParams`.

The checker re-walks the clone with
`typeResolver.setSubstitutions(typeSubs)` set. The checker's normal
`setExprType` writes into the global `this.typeMap` and
`this.genericResolutions` keyed by the cloned expression nodes —
clone-keyed entries live alongside template-keyed ones from pass 2.
Different identities, no collision.

### The product shape — just `Declaration[]`

```ts
// Monomorphization.products() returns Declaration[].
// Type info lives in Checker.typeMap keyed by clone identities.
type Product = Declaration;
```

**No `BakedDecl` wrapper, no per-product side-map.** Downstream
consumers (KIR lowering) walk the product directly and read each
expression's resolved type from `Checker.typeMap` by clone identity
— exactly the path used today for user-written decls.

### KIR walks the clone, not the template

Today's KIR lowering iterates `monoStruct.originalDecl.methods` and
`monoFunc.declaration.body` — the **template**. For clone-keyed
entries to be useful, KIR must walk the **clone** when lowering a
monomorphized decl. This PR updates the lowering iteration sites
(`lowering.ts:101`, `lowering-decl.ts:250`,
`lowering-struct.ts:147`-ish region, `lowering-types.ts`) to walk
the cloned `Product` instead. Expression type reads then hit the
global `typeMap` by clone identity — same path as user-written decls.

### When bake runs

**Lazily inside `Monomorphization.checkBodies`**, not at register
time. Registration sites (`literal-checker.ts:300,385`,
`call-checker.ts:630,820`) stay unchanged — they continue to build
the existing `MonomorphizedStruct/Function` records inline (the
`originalDecl` is back-filled in pass 3 via
`checker.ts:441-453,512-523`).

The PR-3 driver already iterates registered instantiations; it now
bakes each on the fly, then calls
`checker.checkBody(clonedDecl, typeSubs)`. Lifecycle integration
(`lifecycle.register(monoStructType)`) happens at register time on
the existing path; struct types are available without the originalDecl.

### Walker scope (bake.ts)

The cloner recurses over the AST discriminated unions in
`src/ast/nodes/`:

- **All `Expression` arms** in `expressions.ts`: literal, identifier,
  binary, unary, call, member, index, struct-literal,
  array-literal, cast, if-expr, block-expr, match-expr, move, etc.
  Most are trivial (recurse + clone). Non-trivial: struct-literal /
  call-expr `typeArgs` are substituted; struct names mangled via
  `mangleGenericName` for nested-generic instances.
- **All `Statement` arms** in `statements.ts`: let, assign, return,
  if, while, for, switch, break, continue, defer, expr-stmt, block,
  unsafe-block, panic-stmt, throw-stmt, etc. Trivial: recurse +
  clone.
- **Type AST nodes**: call `substituteType` inline.

Use exhaustive `switch (node.kind)` — TS exhaustiveness will catch
a missed kind.

**Spans on cloned nodes** point at the template (template span
primary; instantiation site goes into diagnostic `secondarySpans`
at error-emission time, not onto the AST node).

### PR 5's payoff (unchanged from earlier framings)

PR 5 still deletes `LoweringCtx.currentBodyTypeMap` and
`LoweringCtx.currentBodyGenericResolutions` and every lowering-side
push/pop site. Lowering reads from `Checker.typeMap` directly by
clone identity — same path as user-written decls take today. No
override needed; clone keys are already first-class in the global
map.

The Checker's *internal* per-instantiation map field stays as an
implementation detail of `checker.checkBody`'s pass-3 re-walk —
different field from the LoweringCtx override that PR 5 deletes.

## Files affected

- **NEW** `compiler/src/monomorphization/bake.ts` — the **pure AST
  clone walker** (Half 1 above). Signature:
  `bake(genericDecl: Declaration, substitutionMap: Map<string, Type>) → Declaration`.
  Returns a cloned `Declaration` with fresh node identities; type
  nodes have `substituteType` applied; nested-generic struct/call
  names use `mangleGenericName`. Writes no type-side-map entries.
  Cloned nodes carry the **template's source span** (per design
  doc §4 / §9).
- **MODIFIED** `compiler/src/checker/checker.ts` — **extend the
  `checkBody` / `checkMonomorphizedFunctionBody` /
  `checkMonomorphizedStructMethodBodies` signatures to accept
  `typeSubs?: Map<string, Type>` explicitly** (default = empty
  map). Inside, instead of deriving `typeSubs` from
  `decl.genericParams.zip(monoX.typeArgs)`, use the parameter when
  provided and fall back to the derivation when omitted. Existing
  pass-3 callers migrate to pass `typeSubs` explicitly (compute it
  once from the registration's `typeArgs`).
- **MODIFIED** `compiler/src/monomorphization/check-bodies.ts` —
  for each registered instantiation, **drive the bake**:
  1. Compute the substitution map (template `genericParams` zipped
     with `monoX.typeArgs`).
  2. Call `bake(originalDecl, substitutionMap)` to get the cloned
     `Declaration`.
  3. Invoke
     `checker.checkBody(clonedDecl, typeSubs=substitutionMap)`
     (or the struct-method counterpart). The checker re-walks the
     clone with substitutions threaded through `typeResolver`;
     `setExprType` writes into `Checker.typeMap` keyed by the clone
     identities.
  4. Append the cloned `Declaration` to the products list / instance
     map keyed by mangled name.
- **MODIFIED** `compiler/src/monomorphization/types.ts` —
  optionally extend the existing `MonomorphizedStruct/Function/Enum`
  records with a `baked?: Declaration` field carrying the clone,
  or replace them with `Declaration` directly. Pick whichever
  requires fewer call-site changes at register time.
- **MODIFIED** `compiler/src/monomorphization/index.ts` — the
  `products()` API returns `Declaration[]` (the cloned decls).
  Internal accessors return the clone for lookup-by-mangled-name.
  Update the `Monomorphization` factory to take `lifecycle` in the
  options bag.
- **MODIFIED** `compiler/src/monomorphization/register.ts` —
  registration sites stay structurally unchanged. They still build
  the existing records inline. For structs, call
  `lifecycle.register(monoStructType)` here as today's pattern.
- **MODIFIED** `compiler/src/kir/lowering.ts:101`,
  `lowering-decl.ts:250`, `lowering-struct.ts` (~`lowerMonomorphizedMethod`),
  `lowering-types.ts` — **switch the iteration target from
  `originalDecl` (template) to the cloned `Declaration` (product)**.
  Today these read `monoStruct.originalDecl.methods` and
  `monoFunc.declaration.body` — now they read from the clone.
  Expression type reads through `getExprKirType` / similar already
  go through `Checker.typeMap`; they'll hit the clone-keyed entries
  naturally once the iteration target switches.
- **MODIFIED** `compiler/src/kir/lowering-ctx.ts` and any
  `LoweringCtx.currentBodyTypeMap` / `currentBodyGenericResolutions`
  push/pop site — **the override remains in place but becomes a
  no-op for cloned decls** (the global `Checker.typeMap` already
  has the right entries by clone identity). PR 5 deletes the
  override entirely.
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
- **Don't try to suppress global-typeMap writes during bake.**
  `Checker.setExprType` writes to the global `typeMap`. Walking a
  clone naturally writes clone-keyed entries into the global —
  these don't corrupt template-keyed entries (different
  identities). The previous brief's "global stays template-only"
  rule was wrong; clone-keyed entries in global are fine and
  expected.
- **Don't skip cloning any AST node kind.** Every Expression /
  Statement / Type kind in `src/ast/nodes/` must have a clone
  case. If a kind doesn't appear in `bake.ts`, an instantiation
  using it will share node identity with the template — and
  reads from `Checker.typeMap` by the expected clone identity
  would miss. TS exhaustiveness checks on `switch (node.kind)`
  are your friend; lean on them.
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
