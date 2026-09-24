# Monomorphization module

`src/monomorphization/` owns generic instantiation state for structs, functions, and enums. Each compilation creates a Monomorphization instance; the checker registers concrete products, and KIR lowering consumes them. The module keeps generic bookkeeping in one place across compilation stages.

## Responsibilities

| File | Role |
| --- | --- |
| `mangle.ts` | Build deterministic names from type arguments |
| `substitute.ts` | Substitute type parameters in checker types |
| `register.ts` | Store concrete instantiations by mangled name |
| `bake.ts` | Clone generic AST declarations with fresh node identities |
| `check-bodies.ts` | Drive type checking of instantiated bodies |
| `adopt.ts` | Merge products from other modules, deduplicating by mangled name |
| `index.ts` | Expose registration, lookup, adoption, and product iteration |

A registered product retains its generic declaration, concrete type arguments, concrete checker type, and a baked declaration when body checking needs one. The baked declaration has its own AST node identities. The checker resolves type parameters against the concrete substitutions while checking the clone, records resolved types for its nodes, and lowering reads the baked declaration and its type information directly.

## Compilation flow

1. The checker resolves a generic use and registers the concrete instantiation under its mangled name.
2. Body checking bakes a declaration and checks its body with the concrete substitutions. Products are guarded against repeat checks.
3. For a concrete struct, Monomorphization registers its checker type with Lifecycle so the struct receives its own hook decision.
4. Module compilation adopts products across module boundaries by mangled name.
5. KIR lowering walks the concrete products and emits code for each required instance.

The maps belong to the Monomorphization instance. The checker supplies semantic checks; lowering consumes the resulting concrete declarations. See [compiler architecture](../architecture.md) for the surrounding pipeline.

Generic-function `throws` propagation still has known edge cases; see [SPEC-STATUS.md](../../SPEC-STATUS.md).
