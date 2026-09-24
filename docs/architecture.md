# Compiler architecture

The compiler is written in TypeScript and runs on Bun. Its only output backend emits C, which a system C compiler turns into a native binary. The standard library in `compiler/std/` is Kei source compiled with the program.

```text
.kei → lexer → parser → AST → checker → typed AST → KIR lowering
     → lifecycle pass → mem2reg → de-SSA → C emitter → cc → binary
```

`compiler/src/cli/driver.ts` coordinates the stages. The module resolver orders imports and rejects cycles. KIR is block based; `mem2reg` promotes eligible stack slots, and de-SSA removes phi nodes before C emission.

Three concepts have their own modules outside the pipeline directories:

| Module | Responsibility | Integration |
| --- | --- | --- |
| `src/lifecycle/` | Decide which structs need `__destroy` / `__oncopy`, synthesise hooks, and replace lifecycle markers with concrete KIR instructions | Checker, KIR lowering, CLI driver |
| `src/monomorphization/` | Register generic instantiations, clone declarations, substitute checker types, adopt products across modules, and check instantiated bodies | Checker and KIR lowering |
| `src/diagnostics/` | Collect typed diagnostics per compilation and format text | Checker, module resolver, CLI driver |

Diagnostics still has a generic `untriaged` variant and `Checker.error` / `warning` helpers; see [remaining work](roadmap.md). The module layout follows [ADR-0001](adr/0001-concept-cohesive-modules.md). Detailed invariants are in the [Lifecycle](design/lifecycle-module.md), [Monomorphization](design/monomorphization-module.md), and [Diagnostics](design/diagnostics-module.md) notes.
