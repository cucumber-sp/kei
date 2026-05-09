# Monomorphization module — concept-cohesive consolidation

**Status.** Designed, not yet implemented. Third concrete instance of
[ADR-0001](../adr/0001-concept-cohesive-modules.md). Migration is
staged across six PRs (§9). The end-state PR (PR 5) is the payoff —
it deletes the per-instantiation type-map override on `LoweringCtx`.

## 1. Why

Generic monomorphization today is implemented across 13+ files. The
pure helpers in `compiler/src/checker/generics.ts` (`substituteType`,
`substituteFunctionType`, `mangleGenericName`,
`MonomorphizedStruct` / `MonomorphizedFunction` records) are clean.
The friction is concentrated in two places that aren't:

**Maps and drivers live on `Checker`.** Three caches
(`monomorphizedStructs`, `monomorphizedFunctions`, `monomorphizedEnums`),
plus the cross-module `adoptMonomorphizedX` methods, plus a
"pass 3" body-checking driver, all hang off the `Checker` class as
if they were just-another-checker-concern. They aren't — they're
monomorphization-specific state and control flow that the checker is
forced to hold because nobody else does.

**Lowering re-walks the maps and toggles a per-instantiation type
map override.** `lowering-decl.ts` lines 290 and 301 push and pop a
type-map override; `lowering-struct.ts:147` and `lowering-types.ts:20`
read it. Each generic body lowered is a state-toggling sequence —
push override, lower body, pop override. Forgetting the pop leaks
substituted types into the next decl; forgetting the push lowers the
generic template instead of the instantiation. The class of bug this
shape invites is "off-by-one in stack discipline" — a class no
production compiler should be exposing.

This ADR-0001 instance addresses the same architectural pattern as
the [Lifecycle module](./lifecycle-module.md) and
[Diagnostics module](./diagnostics-module.md): a cross-cutting
concern that today spreads across pipeline-stage modules with no
concept-cohesive home.

## 2. What — the deepened module

A new top-level directory `compiler/src/monomorphization/`. Owns:

- The pure helpers (`substituteType`, `substituteFunctionType`,
  `mangleGenericName`).
- The instance maps for structs, functions, and enums.
- Discovery — when checker sees `Foo<i32>`, register the
  instantiation.
- Baking — produce the fully-substituted AST decl for each
  instantiation (Y-a, see §4).
- Pass 3 — driving the body-check of baked decls; calls back into
  checker primitives.
- Cross-module adoption — pulling in instantiations registered by
  other modules.
- The integration with [Lifecycle](./lifecycle-module.md): for each
  baked struct, call `Lifecycle.decide(struct)` so the new
  instance gets its own decision.

Lowering loses its generics-awareness entirely.

## 3. Sub-concerns

```
src/monomorphization/
├── substitute.ts      ← pure: substituteType, substituteFunctionType
├── mangle.ts          ← pure: mangleGenericName
├── register.ts        ← discovery: register(genericDecl, typeArgs)
├── bake.ts            ← Y-a: produce fully-substituted AST decl
├── adopt.ts           ← cross-module merge by mangled name
├── check-bodies.ts    ← pass 3 driver; calls into checker
├── index.ts           ← public Monomorphization interface
```

The module is constructed-and-threaded, like Diagnostics' Collector
and the planned Lifecycle:

```ts
const lifecycle = createLifecycle();
const monomorphization = createMonomorphization({ lifecycle });
const checker = new Checker(ast, { diag, lifecycle, monomorphization });
checker.run();
const products = monomorphization.products();   // synthesised AST decls
```

Pattern-consistency across ADR-0001 modules matters: every concept
module is a constructed value with explicit lifetime. No
module-level singletons.

## 4. Y-a: synthesised AST declarations

When Monomorphization bakes `Foo<i32>`, the result is a *fresh AST
declaration* with every node fully type-resolved under the
substitution `{T: i32}`:

```
generic template:                  baked product (Y-a):
  struct Foo<T> {                    struct Foo_i32 {
    field: T                           field: i32
    fn make(): Self<T> {               fn make(): Foo_i32 {
      return Self<T> {                   return Foo_i32 {
        field: T_default()                 field: 0_i32
      }                                  }
    }                                  }
  }                                  }
```

Every `Type` node, every expression's `resolvedType`, every nested
struct reference — substituted. No reference to the type variable
`T` survives in the baked decl.

Three downstream consequences:

**Pass 3 type-checks baked decls directly.** Pass 3 (now driven by
Monomorphization) walks each baked decl and runs the standard checker
body-check on it. Errors discovered in the baked decl carry source
spans pointing at the generic *template* — diagnostics use the
diagnostics module's `secondarySpans` to also indicate the
instantiation site:

```
error[E0042]: type mismatch
  --> generics.kei:5:14    ← span of the generic template's expression
   |
 5 |     return T_default()
   |            ^^^^^^^^^^^ expected i32, got T
   = note: in instantiation `Foo<i32>` (instantiated at foo.kei:12:3)
```

**Lowering treats baked decls identically to user-written ones.** No
"is this generic?" branching, no per-instantiation type map override,
no push/pop discipline. The synthesised decl's nodes already carry
concrete resolved types; lowering reads them directly.

**Cross-module adoption is just deduplication.** Two modules that
each independently bake `Foo<i32>` produce structurally-identical AST
decls. Adoption merges by mangled name and keeps one. (Today's
adoption logic does the same thing; the data shape is just simpler.)

## 5. Integration with Lifecycle

The cross-module seam between Monomorphization and Lifecycle (deferred
in the lifecycle design as Q5c) resolves cleanly:

```
Monomorphization.register(genericStructDecl, [string]) {
  baked = bake(genericStructDecl, { T: string });    // synthesise AST
  this.products.push(baked);
  lifecycle.decide(baked);                             // ← single line
}
```

`Lifecycle.decide` was already designed to run on concrete struct
types (see [lifecycle design §2](./lifecycle-module.md)).
Monomorphization produces concrete struct types. The seam is one
function call per registration.

Note also that the fixed-point iteration in `Lifecycle.decide` runs
*after* all modules have registered their instantiations. So
Monomorphization's `register` only schedules the decide call;
Lifecycle's fixed-point sweeps over the products map once everyone is
done registering.

## 6. Integration with Diagnostics

Pass 3 errors get a richer shape under the new diagnostics module
(see [diagnostics design §6](./diagnostics-module.md) for the β
envelope). The instantiation-context hint becomes a `secondarySpans`
entry pointing at the call site that triggered the instantiation:

```ts
diag.typeMismatch({
  span: bakedExpr.span,           // generic template's expression
  expected: i32,
  got: stringT,
  secondarySpans: [
    { span: instantiationCallSite, label: 'in instantiation `Foo<i32>`' }
  ],
});
```

This is a side-effect of two ADR-0001 modules cooperating cleanly —
neither knows about the other's internals; they meet at the
diagnostic shape.

## 7. Alternatives considered

### 7.1 X — service shape (relocate maps, keep override)

Maps live in Monomorphization; lowering iterates `products()` and
lowers each. The per-instantiation type map override stays in
`LoweringCtx`; it's just populated from Monomorphization's data.

**Rejected.** Smallest delta, but doesn't fix the friction the audit
identified — the override stack and its push/pop discipline remain.
Renaming the data owner without changing the data flow doesn't earn
the deepening.

### 7.2 Y-b — original AST + per-instantiation typed side-map

Original AST is shared between template and instantiations; a
per-instantiation map holds resolved types for each expression node.
Lowering reads from the side-map.

**Rejected.** Mechanically equivalent to today's per-instantiation
type map override, just relocated. Loses Y-a's payoff: lowering still
needs to know "we're inside an instantiation" to read the side-map.

### 7.3 Z — override moves to Monomorphization

Compromise between X and Y. Lowering does
`monomorphization.withInstantiation(product, () => lowerDecl(product.decl))`;
Monomorphization owns the override stack instead of `LoweringCtx`.

**Rejected.** Cleaner ownership but the override pattern itself
remains. Y-a eliminates it; that's the win.

### 7.4 Checker-drives pass 3, Monomorphization is data

Monomorphization exposes `bodiesToCheck()`; the Checker's main loop
calls Monomorphization, gets the list, checks each.

**Rejected.** "Monomorphization owns its own driver" pattern matches
how Lifecycle owns its fixed-point iteration. Symmetry across
ADR-0001 modules helps maintainability — every concept module owns
its loops, the Checker is just the convener.

### 7.5 Big-bang migration

One PR moves everything: maps, drivers, baking, override removal, all
at once.

**Rejected.** Six staged PRs (§8) each behaviour-preserving against
the existing test suite. The big simplification (PR 5, override
removal) is gated behind PRs that verify no behaviour changed first.

## 8. Migration plan

Six PRs.

**PR 1 — Stand up `src/monomorphization/`.** Move
`substituteType`, `substituteFunctionType`, `mangleGenericName`,
`MonomorphizedStruct`, `MonomorphizedFunction` from
`checker/generics.ts` into the new module. Imports updated. Behaviour
unchanged. Old `generics.ts` becomes a thin re-export, then deleted
in PR 6.

**PR 2 — Move maps off Checker.** `monomorphizedStructs`,
`monomorphizedFunctions`, `monomorphizedEnums` migrate from `Checker`
to a `Monomorphization` instance. Cross-module adoption methods
(`adoptMonomorphizedX`) move with them. Checker calls
`monomorphization.register(...)` instead of mutating its own maps.
Lowering reads via Monomorphization's read API. Pass 3 still in
Checker temporarily.

**PR 3 — Move pass-3 driver.** Body-check loop relocates into
`Monomorphization.checkBodies()`. Calls back into checker primitives
(`checker.checkBody(decl)`). Pattern-consistency: Monomorphization
owns its own driver, like Lifecycle owns its fixed-point.

**PR 4 — Bake into synthesised AST decls.** Inside Monomorphization,
transform each instantiation into a fully-substituted AST decl
(Y-a). The output of Monomorphization changes shape from "map of
MonomorphizedStruct/Function" to "list of synthesised AST decls."
Pass 3 type-checks the synthesised decls directly. Lowering still
has the override stack but it's a no-op for synthesised decls (they
already carry concrete resolved types). Lifecycle integration
(`lifecycle.decide(baked)`) wires up here.

**PR 5 — Delete the override stack.** Remove `LoweringCtx`'s
per-instantiation type map field and all push/pop sites in
`lowering-{decl,struct,expr,types}.ts`. Lowering treats synthesised
decls identically to user-written ones. This is the payoff PR — the
override-elimination win that justified Y-a in the first place.
Test suite verifies no regression.

**PR 6 — Cleanup.** Fold any remaining "is this from a
monomorphization?" branches in lowering. Delete the thin re-export
shim in `checker/generics.ts`. Update `compiler/CLAUDE.md`'s "Where
to add a feature" table to point at `src/monomorphization/` for
generic work.

Each PR behaviour-preserving against the existing test suite. PR 5 is
the simplification payoff; PRs 1–4 are setup that keeps everything
working.

## 9. Open questions

- **Synthesised AST node spans.** Should baked AST nodes carry the
  generic template's source span, or the instantiation site's span,
  or both via a wrapper? Choice affects diagnostic readability.
  Recommendation: template span as primary (where the *bug* is),
  instantiation site as `secondarySpans` (where it was *triggered*).
  Confirm during PR 4.
- **Memory cost of synthesised AST.** Today's `MonomorphizedStruct`
  is a small record; baked AST decls are heavier. For a code base
  with many instantiations of the same generic from different
  modules, this could matter. Mitigation: cross-module adoption
  deduplicates. Worth measuring once PR 4 lands.
- **Generic-function `throws` propagation.** [SPEC-STATUS.md](../../SPEC-STATUS.md)
  notes "works for monomorphized cases; some edge cases still drop
  the throws set." This is its own open issue, but worth checking
  whether Y-a baking helps (every baked function has its own
  throws set, so the propagation question becomes "compute throws
  per baked function" — possibly simpler).

## 10. Tests that come with the migration

The product-list shape opens a test pyramid much like Lifecycle's:

- **`Monomorphization.register` — pure, table-driven.** Input: a
  generic decl + type args. Output: a baked AST decl. Snapshot
  fixtures.
- **`Monomorphization.bake` — pure substitution.** Input: a generic
  AST + substitution map. Output: a fully-substituted AST. Diff against
  golden output per fixture.
- **`Monomorphization.adopt` — table-driven.** Input: two
  monomorphization instances both containing `Foo<i32>`. Output:
  merged products list, no duplicates.
- **Existing end-to-end tests** continue to assert behaviour from
  `.kei` source through compiled binary. They should pass unchanged
  through the migration.

After PR 5 lands, three new test files appear under
`tests/monomorphization/` (`register.test.ts`, `bake.test.ts`,
`adopt.test.ts`) and end-to-end coverage stays.
