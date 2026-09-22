# Compiler guide

Run commands from `compiler/`. This project uses Bun and a system C compiler, not a Node test runner.

```sh
bun install
bun test
bun test tests/checker/arrays.test.ts
bunx biome check src/ tests/
bun src/cli.ts program.kei --run
bun src/cli.ts program.kei --check
bun src/cli.ts program.kei --emit-c
bun src/cli.ts program.kei --kir
bun src/cli.ts program.kei --kir-opt
bun run build
```

`bun run build` writes a standalone `dist/kei` and copies `std/` to `dist/std/`; keep them together. `--build` emits a native binary, `--release` selects the optimized C build, and `--backend=clang` selects a C compiler.

## Where to edit

| Change | Main locations |
| --- | --- |
| Syntax | `src/lexer/`, `src/parser/`, `src/ast/`, then checker, KIR, and backend as needed |
| Type rule | `src/checker/types/`, checker, `src/kir/lowering-types.ts`, backend |
| KIR instruction | `src/kir/kir-types/`, lowering, `mem2reg.ts` if memory-related, de-SSA, C emitter |
| Lifecycle hook or scope cleanup | `src/lifecycle/` and marker emission in `src/kir/` |
| Generic instantiation | `src/monomorphization/`, checker integration, KIR lowering |
| Diagnostic | `src/diagnostics/types.ts`, `index.ts`, `format.ts`, and emitting stage |
| Standard library API | `std/*.kei` and end-to-end tests |

The [architecture overview](../docs/architecture.md) traces the pipeline. Tests use `bun:test` in `tests/` and should cover the changed layer plus an end-to-end path when behavior crosses stages. Biome enforces formatting and linting; relative imports omit `.ts` extensions. Project-wide documentation rules live in [the root guidance](../CLAUDE.md).
