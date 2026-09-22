# Lifecycle module — concept-cohesive consolidation

**Status.** Implemented. Sections 1–6 record the original design and describe the pre-migration code in historical present tense. Section 7 states the current implementation.

## 1. Why

The `__destroy` and `__oncopy` lifecycle hooks for managed types are
implemented across at least eight files spanning the checker, KIR
lowering, and (indirectly via instructions it consumes) the C emitter:

| Concern | Today's location |
|---|---|
| Decide whether a struct needs auto `__destroy` / `__oncopy` | `src/checker/struct-checker.ts` (pass 1.5, fixed-point iteration) |
| Synthesise the KIR body for the auto-generated hook | `src/kir/lowering-struct.ts` |
| Insert destroy at scope exit | `src/kir/lowering-scope.ts` |
| Insert destroy on assignment to a managed slot | `src/kir/lowering-expr.ts` (~3 sites) |
| Skip-on-destroy for moved values | `src/kir/lowering-expr.ts` (`movedVars`) + `src/kir/lowering-scope.ts` (read on emit) |
| Insert destroy for params at function exit | `src/kir/lowering-decl.ts` |
| Lookup memo of "does this struct have hooks?" | `src/kir/lowering-ctx.ts` (`structLifecycleCache`) |

Two friction signals drive the redesign:

**Bugs of the issue-#21 class have no single home.** That issue (closed)
was an insertion-time defect: the C emitter referenced an undeclared
`_v1` in a scope-end `__destroy` after `let x = Struct.make()`. The fix
landed in lowering, but the *cause* was a coordination problem between
how lowering names temporaries and how scope-exit destroy reads them.
Neither side owns the policy; both reach into shared state
(`structLifecycleCache`, `movedVars`).

**Spec'd extensions couldn't be made cleanly.** The design had to accommodate
`Optional<T>`, `Shared<T>`, and a future `String` migration to stdlib.
Each adds new managed types, each requires teaching the *insertion*
logic about new patterns. Today that means edits in 4+ files; under
the deepened design, it means one type-aware rewrite step inside the
Lifecycle module.

The deeper friction this exposes is one [ADR-0001](../adr/0001-concept-cohesive-modules.md)
addresses across the compiler: organising by pipeline stage forces
cross-cutting concerns to spread their state and policy across stages
that were never meant to coordinate beyond their immediate input/output
contract. Lifecycle is the first concrete instance of that ADR.

## 2. What — the deepened module

A new top-level directory `compiler/src/lifecycle/`. Three sub-concerns,
each owned by the module:

- **Decide.** Pure-ish entry point: `decide(struct) → LifecycleDecision`.
  Run as a fixed-point iteration once after pass 1 of the checker
  completes (when all structs are registered) and before pass 2 begins
  type-checking bodies. Decisions live in a Lifecycle-owned
  `Map<StructType, LifecycleDecision>`. *The struct's type table is
  not mutated.*
- **Synthesise.** `synthesise(struct, decision) → KirFunction[]`. Reads
  the decision; produces the `__destroy` / `__oncopy` KIR function
  bodies, including the spec §6.9 reverse-declaration-order invariant.
- **Insert.** A *rewriting pass over already-lowered KIR*, slotted
  between lowering and mem2reg. Lowering emits abstract markers
  (§3); the pass walks the KIR, consults the decision map, and
  rewrites markers into concrete `destroy` / `oncopy` /
  `call_extern_void("kei_string_destroy")` instructions. After the
  pass, no markers survive into mem2reg.

```
.kei source
  → lexer
  → parser
  → checker            ─ calls Lifecycle.decide once, then queries
  →                      Lifecycle.hasDestroy / hasOncopy during
  →                      type-check
  → KIR lowering       ─ emits markers; calls Lifecycle.synthesise
  →                      for auto-generated hook bodies
  → Lifecycle pass     ◄── new
  → mem2reg            ─ no markers visible here
  → de-SSA
  → C emitter
```

## 3. Marker IR

KIR gains six new instruction kinds, all prefixed `mark_`. They are
ephemeral — emitted by lowering, consumed by the Lifecycle pass, and
*must not* survive into mem2reg.

| Marker | Operands | Meaning |
|---|---|---|
| `mark_scope_enter` | `scope_id` | Open a new scope frame |
| `mark_scope_exit` | `scope_id` | Close the scope frame; emit destroys for live tracked vars in reverse declaration order, skipping moved ones |
| `mark_track` | `var, scope_id` | Register `var` as managed in `scope_id`'s frame |
| `mark_moved` | `var` | `var` has been moved out; skip future destroys |
| `mark_assign` | `slot, new_value, is_move` | Assignment to a managed slot — rewrite as destroy-old, store, conditional oncopy |
| `mark_param` | `param` | Destroy `param` at every function exit |

Three deliberate absences:

- **No `mark_early_return` or `mark_loop_break`.** Every actual exit
  point just emits a `mark_scope_exit` for each scope being unwound.
  The Lifecycle pass treats them uniformly. Today's
  `lowering-scope.ts` distinguishes `popScopeAndDestroy` /
  `emitAllScopeDestroys` / `emitInnerLoopScopeDestroys` /
  `emitAllScopeDestroysSkipping`; under the new design those collapse.
- **No type information on `mark_track` or `mark_assign`.** Type is
  read off the var's KIR type at rewrite time. Keeps markers
  type-agnostic so the planned String stdlib migration (when string
  becomes just-another-managed-struct) does not require touching
  insertion logic.
- **No `mark_string_*` distinct from `mark_struct_*`.** Same reason.

## 4. The Decision record

`LifecycleDecision` is the bridge between checker-time existence
queries and lowering-time body synthesis.

```ts
type LifecycleDecision = {
  destroy?: { fields: ManagedFieldRef[] };
  oncopy?:  { fields: ManagedFieldRef[] };
};

type ManagedFieldRef = {
  name: string;
  // Only the field name. Type is re-resolved against the struct at
  // synthesise time, after monomorphization has produced concrete
  // types for any generic parameters.
};
```

Field iteration order in `synthesise` is reverse-declaration per spec
§6.9. The order is the module's invariant, not encoded in the
decision — that way callers can't accidentally produce wrong-order
destroys.

`hasDestroy(struct)` / `hasOncopy(struct)` are derived from the
decision map and used by the checker to type-check call sites that
reference the auto-generated method (e.g. an explicit
`s.__destroy()` call). The decision map is fully populated before any
type-check call site can ask, because the fixed-point runs before
checker pass 2.

## 5. Defer interaction

`defer` (LIFO scope-exit user code) is *not* moved into the Lifecycle
module, despite both firing at scope exit. Per the
[ADR-0001](../adr/0001-concept-cohesive-modules.md) caveat — "the
principle applies to cross-cutting concerns only" — defer is
pipeline-local: concentrated in `lowering-scope.ts`, doesn't sprawl
across stages, doesn't have multi-file coordination problems. There is
no friction signal to justify a `src/defer/` module.

The interleave between defer and auto-destroy is encoded by where
lowering positions `mark_scope_exit` relative to the lowered defer
block:

```
[ defer block 1 lowered to KIR ]   ← user code; runs first
[ defer block 2 lowered to KIR ]   ← LIFO, also user code
mark_scope_exit scope_id           ← lifecycle marker; rewritten later
```

After the Lifecycle pass:

```
[ defer block 1 instructions ]
[ defer block 2 instructions ]
[ destroy var_n ]                  ← reverse declaration order
[ destroy var_n-1 ]
...
```

Lifecycle never imports defer. Defer never imports lifecycle. The
order is one decision at one line.

The order (defers before auto-destroy) is specified in
[spec/05-control.md](../../spec/05-control.md) and
[spec/08-memory.md](../../spec/08-memory.md). Closes
[#38](https://github.com/cucumber-sp/kei/issues/38). User defer code
can reference managed locals while they are still valid (matches
Swift's `defer` semantics).

## 6. Alternatives considered

### 6.1 Insert as a service-during-lowering ("Shape X")

`Lifecycle.onScopeExit(...)`, `onAssign(...)`, `onMove(...)` called
from lowering files at the right moment. Lifecycle owns the policy
and the state; lowering files become callers, not implementers.

**Rejected.** Smaller blast radius, but lowering still imports
Lifecycle and the seam between "lowering" and "lifecycle policy" is
fuzzy (you can still reach into Lifecycle's state from lowering by
accident). The pass approach is strictly cleaner.

### 6.2 Decision stored on the StructType ("Storage P")

`Lifecycle.decide` mutates `structType.methods.set("__destroy", …)` —
the existing pattern. Type-checker sees the auto-generated method
because it's just *on the struct*.

**Rejected.** The type table now contains entries that don't
correspond to anything the user wrote. The "what user wrote vs what
compiler synthesised" distinction blurs in the same data structure.
Re-introduces the very pattern ADR-0001 rejects: shared mutable state
across stages.

### 6.3 Decide as a pure function with no cache ("Storage R")

`decide(struct)` is pure, called wherever needed. No caching, no map.

**Rejected.** Today's fixed-point iteration is real: struct A's
destroy depends on whether B has destroy, which depends on C, etc. A
pure-function model needs the fixed-point to converge externally,
which means callers run a loop — pushing the policy back into them.

### 6.4 Defer as its own concept-cohesive module

`src/defer/` parallel to `src/lifecycle/`, also rewriting
`mark_scope_exit`.

**Rejected.** Defer is pipeline-local; ADR-0001's principle only
applies to cross-cutting concerns. Adding the module would be
cargo-culting the pattern. (See §5.)

## 7. Current implementation

The `src/lifecycle/` module is in use. `decide.ts` computes hook decisions, `synthesise.ts` creates KIR bodies, and `pass.ts` rewrites markers after lowering and before mem2reg. Defer runs before automatic destruction at scope exit. Unit tests cover decisions, synthesis, marker rewrites, and end-to-end behavior.

Managed enum payload destruction remains a separate ownership question; see the memory-model gaps in [SPEC-STATUS.md](../../SPEC-STATUS.md). The migration sequence is recorded in Git history.
