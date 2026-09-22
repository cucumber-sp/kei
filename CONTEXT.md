# Compiler vocabulary

These are compiler architecture terms. Language syntax and semantics belong in [`spec/`](spec/); the pipeline is mapped in [Compiler architecture](docs/architecture.md).

## Concept module

A top-level module owns a cross-cutting concern even when several compilation stages use it. This follows [ADR-0001](docs/adr/0001-concept-cohesive-modules.md). Pipeline-local transforms such as mem2reg remain in their stage directories.

## Lifecycle

`src/lifecycle/` decides which structs need `__destroy` or `__oncopy`, synthesises hook bodies, and rewrites lifecycle markers in KIR after lowering. `defer` is user-authored scope-exit code and runs before automatic destruction. See the [Lifecycle design](docs/design/lifecycle-module.md).

## Monomorphization

`src/monomorphization/` registers generic instantiations, clones and substitutes declarations, adopts products across modules, and checks instantiated bodies. Lowering reads the baked declarations. See the [Monomorphization design](docs/design/monomorphization-module.md).

## Diagnostics

`src/diagnostics/` owns diagnostic variants, collection per compilation, and formatting. The checker still uses a generic `untriaged` route for some errors; [remaining work](docs/roadmap.md) tracks that cleanup. See the [Diagnostics design](docs/design/diagnostics-module.md).

## Managed type

A value whose copy or scope exit needs compiler-generated work, such as a string or a struct containing managed fields. Lifecycle decisions and KIR marker rewriting govern that work.
