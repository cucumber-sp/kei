# CONTEXT

Glossary of cross-cutting concepts that the kei compiler architecture
discusses by name. Kei language terms (types, expressions, statements,
memory model, etc.) live in `spec/`; this file is for the *compiler*
domain — the names that show up in architecture conversations and need
to mean the same thing every time.

This file grows lazily. Terms land here when they earn a name in a
design discussion (e.g. an `improve-codebase-architecture` or
`grill-with-docs` session). If you read past a term and don't know
what it means, that's a signal to either look it up here or add it.

## Concept-cohesive module

A module organised around a single domain concept (e.g. **Lifecycle**,
**Diagnostics**, **Monomorphization**) rather than around a pipeline
stage (checker, KIR, backend). The interface lives in one place; the
pipeline stages call into it at the right moment. See
[ADR-0001](./docs/adr/0001-concept-cohesive-modules.md).

## Lifecycle (module — planned, see ADR-0001)

Owns everything to do with `__destroy` and `__oncopy` hooks for managed
types. Lives at `compiler/src/lifecycle/`.

Three sub-concerns:

- **Decide** — pure-ish: `decide(struct) → LifecycleDecision`. Fixed-point
  iteration over all registered structs runs once before checker
  type-checks bodies. Decisions live in a Lifecycle-owned
  `Map<StructType, LifecycleDecision>` — *not* mutated onto the type
  table. Checker queries `Lifecycle.hasDestroy(struct)` /
  `hasOncopy(struct)` to type-check call sites that reference the
  auto-generated method.
- **Synthesise** — `synthesise(struct, decision) → KirFunction[]`. Reads
  the decision; produces the `__destroy` / `__oncopy` KIR function
  bodies. Field-iteration order (reverse declaration per spec §6.9) is
  the module's invariant, not the caller's.
- **Insert** — implemented as a **rewriting pass over already-lowered
  KIR**, slotted between lowering and mem2reg. Lowering emits abstract
  markers (`mark_scope_enter`, `mark_scope_exit`, `mark_track`,
  `mark_moved`, `mark_assign`, `mark_param`); the pass walks them and
  rewrites into concrete `destroy` / `oncopy` /
  `call_extern_void("kei_string_destroy")` instructions. After the
  pass, no markers survive.

The pass approach keeps lowering ignorant of lifecycle policy. It also
keeps markers type-agnostic, so the planned String stdlib migration
(see [SPEC-STATUS.md](./SPEC-STATUS.md)) doesn't require touching the
insertion logic — strings becoming a struct just means
`destroy_slot var` resolves differently at rewrite time.

## Diagnostics (module — planned, see ADR-0001)

Owns user-facing diagnostic construction, severity resolution, and
formatting. Lives at `compiler/src/diagnostics/`. See
[design doc](./docs/design/diagnostics-module.md).

Three sub-concerns:

- **Catalog** — a discriminated-union `Diagnostic` type whose arms are
  the source of truth for kinds, codes, default severities, and
  payload shape. Construction sugar (typed methods like
  `diag.typeMismatch({...})`) is generated from the union; call sites
  use the methods.
- **Collector** — constructed-and-threaded per compile (no module
  singleton). Resolves severity at emit time using lint config
  (empty in v1; the resolver hook leaves room for future
  configurability). Snapshots produce the diagnostic list a driver
  prints.
- **Formatter** — pluggable: text (default) and JSON (for tooling).
  Walks the union and exhaustively pattern-matches on `kind`. LSP
  integration not in scope but the JSON shape is chosen to map
  cleanly later.

Codes are advisory (no stability promise pre-1.0).

## Monomorphization (module — planned, see ADR-0001)

Owns generic instantiation: discovery, baking, cross-module adoption,
and pass-3 body-checking. Lives at `compiler/src/monomorphization/`.
See [design doc](./docs/design/monomorphization-module.md).

Key choice: **baked products are fully-substituted synthesised AST
declarations** (Y-a). When `Foo<i32>` is registered, Monomorphization
produces a fresh AST decl with every type node, every expression's
resolved type, every nested struct reference substituted concretely.
Lowering treats baked decls identically to user-written ones — no
per-instantiation type map override, no "is this generic?" branching.

Sub-concerns:

- **Substitute / Mangle** — pure helpers (relocated from
  `checker/generics.ts`).
- **Register** — checker call sites that see `Foo<i32>` invoke
  `monomorphization.register(genericDecl, typeArgs)`.
- **Bake** — produce fully-substituted AST decl per instantiation.
- **Adopt** — cross-module: deduplicate by mangled name.
- **CheckBodies** — pass-3 driver; calls back into checker
  primitives. Owned by Monomorphization for symmetry with how
  Lifecycle owns its fixed-point.

Integration with Lifecycle: `monomorphization.register` calls
`lifecycle.decide(bakedStruct)` — single line, single seam.

Integration with Diagnostics: pass-3 errors use the β envelope's
`secondarySpans` to point at both the generic template (where the
bug is) and the instantiation site (where it was triggered).

The win: lowering loses an entire category of state-toggling bugs.
The `LoweringCtx` per-instantiation type map override and its push/pop
discipline disappear (PR 5 of the migration).

## Defer

User-authored LIFO scope-exit code (`defer { … }`). Distinct from
**Lifecycle**: defer is *user-authored*, lifecycle is
*compiler-authored*. Defer stays in `kir/lowering-scope.ts` because
it's pipeline-local — it doesn't sprawl across stages and doesn't
warrant its own concept-cohesive module per ADR-0001's caveat.

At scope exit, lowering emits the defer block's lowered KIR *first*,
then `mark_scope_exit`. The Lifecycle pass appends destroys after.
Result: defers run before auto-destroys at scope exit. Pending spec
resolution (issue #38) confirming this order.

## Managed type

A type that owns resources requiring cleanup or copy semantics. Today:
strings, and structs containing managed fields. Triggers the Lifecycle
module's Decide step.

## Pipeline stages

- **Lexer** (`src/lexer/`) — source text → tokens.
- **Parser** (`src/parser/`) — tokens → AST.
- **Checker** (`src/checker/`) — AST → typed AST + diagnostics.
- **KIR lowering** (`src/kir/`) — typed AST → SSA-form IR.
- **mem2reg** (`src/kir/`) — promote stack allocations to SSA values.
- **de-SSA** (`src/backend/`) — eliminate phi nodes.
- **C emitter** (`src/backend/`) — KIR → C source.

Pipeline stages are the *flow*; concept-cohesive modules cut across
them. A stage that touches a concept calls into the concept's module
rather than re-deriving the policy.
