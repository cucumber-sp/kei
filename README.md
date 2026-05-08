# Kei

A statically-typed systems programming language that compiles to C.
C performance, modern ergonomics, no runtime.

```kei
import { print, newline } from io;

fn main() -> int {
    print("Hello, World!");
    newline();
    return 0;
}
```

## What is Kei?

A compiled systems language built around explicit control: no garbage collector,
no runtime, no hidden allocations. Structs live on the stack by default,
lifecycle hooks (`__destroy` / `__oncopy`) handle cleanup deterministically, and
the compiler emits readable C that any C compiler can finish optimising.

**Design bet:** RAII with explicit `move` covers ~90% of what a borrow checker
does, at ~0% of the complexity cost. The result feels like C with 2026 manners
— tagged enums, generics, exhaustive errors, nullable types, modules — while
still producing a few-KB binary.

**v1 is single-threaded.** Concurrency primitives (`spawn`, atomics, mutexes,
async) are staged for later. See [SPEC-STATUS.md](./SPEC-STATUS.md).

## A taste of Kei

```kei
import { print } from io;

struct NotFound {}
struct DbError { code: int; }

fn get_user(id: int) -> int throws NotFound, DbError {
    if id < 0    { throw NotFound{}; }
    if id > 1000 { throw DbError{ code: 500 }; }
    return id;
}

fn main() -> int {
    let user = get_user(42) catch {
        NotFound:    return -1;
        DbError e:   return e.code;
    };

    print(user);
    return 0;
}
```

A broader walk-through lives in [`docs/language-guide.md`](./docs/language-guide.md).
For everything else, see the [language specification](./spec/).

## Build & run

**Requirements:** [Bun](https://bun.sh/) and a C compiler (`cc`, `gcc`, or `clang`).

```bash
cd compiler
bun install
```

Compile and run a program:

```bash
bun run src/cli.ts program.kei --run        # compile + execute
bun run src/cli.ts program.kei --build      # binary only
bun run src/cli.ts program.kei --check      # type-check only
bun run src/cli.ts program.kei --emit-c     # inspect generated C
bun run src/cli.ts program.kei --kir        # inspect KIR (pre-opt)
bun run src/cli.ts program.kei --kir-opt    # inspect KIR (post-mem2reg)
```

Build profiles and C-compiler selection:

```bash
bun run src/cli.ts program.kei --build --release
bun run src/cli.ts program.kei --build --backend=clang
```

Run the test suite (≈1,900 tests across lexer, parser, checker, KIR, backend,
modules, and end-to-end binaries):

```bash
bun test
```

Build a standalone `kei` binary (no Bun runtime needed to run it):

```bash
bun run build               # writes dist/kei + dist/std/
./dist/kei program.kei --run
```

The build uses `bun build --compile --bytecode --sourcemap` with whitespace +
syntax minification. The binary expects a `std/` directory next to it (the
script copies one in).

The full getting-started flow is in [`docs/getting-started.md`](./docs/getting-started.md).

## Architecture

```
.kei source
    │
    ▼
  Lexer ──────► tokens
    │
    ▼
  Parser ─────► AST
    │
    ▼
  Checker ────► typed AST   (inference, generics, exhaustiveness,
    │                        lifecycle hook generation)
    ▼
  KIR Lower ──► KIR (SSA-form intermediate representation)
    │
    ▼
  mem2reg ────► optimised KIR (stack → register promotion)
    │
    ▼
  de-SSA ─────► KIR without phi nodes
    │
    ▼
  C Emitter ──► readable .c file
    │
    ▼
  cc ─────────► native binary
```

## Status

**End-to-end (source → binary):** primitives, structs with methods, simple and
data enums, generics with monomorphization, operator overloading, error
handling (`throws` / `catch` / `catch panic` / `catch throw`), arrays with
bounds checks, full control flow, `defer` (LIFO scope-exit), `move` (with
destroy elision), modules with cyclic-import detection, `unsafe` blocks,
manual `alloc` / `free`, auto-generated `__destroy` / `__oncopy`, the `io`,
`mem`, and `arena` stdlib modules, C FFI via `extern fn`, nullable pointers
(`T?` lowered to a nullable raw pointer).

**Spec'd, not yet implemented:** `ref T` / `readonly ref T`, `addr()` /
`init` / `readonly` field-and-param modifiers, the `*T` raw-pointer
spelling that replaces `ptr<T>`, the `__oncopy(self: ref T)` lifecycle
ABI, primitive `T?` with tag-byte representation, traits, function-
pointer type syntax, variadic extern, optimisation passes beyond
mem2reg, debug-mode division-by-zero / overflow / null-deref checks.
The tracking table lives in [SPEC-STATUS.md](./SPEC-STATUS.md).

**Not in Kei:** closures, nested functions, borrow checker, GC, green threads.

## Project layout

```
kei/
├── compiler/     Compiler (TypeScript on Bun) + standard library
├── spec/         Language specification (01-design.md … 13-grammar.md)
├── docs/         Getting started + language guide
└── SPEC-STATUS.md   What's spec'd vs. implemented
```

## Specification

| # | Document |
|---|----------|
| 01 | [Design Principles](./spec/01-design.md) |
| 02 | [Lexical Structure](./spec/02-lexical.md) |
| 03 | [Types](./spec/03-types.md) |
| 04 | [Variables, Constants & Operators](./spec/04-variables.md) |
| 05 | [Control Flow](./spec/05-control.md) |
| 06 | [Functions](./spec/06-functions.md) |
| 07 | [Structures](./spec/07-structures.md) |
| 08 | [Memory Model](./spec/08-memory.md) |
| 09 | [Error Handling](./spec/09-errors.md) |
| 10 | [Modules, Imports & FFI](./spec/10-modules.md) |
| 11 | [Compilation Model](./spec/11-compilation.md) |
| 12 | [KIR — Intermediate Representation](./spec/12-kir.md) |
| 13 | [Grammar & Keywords](./spec/13-grammar.md) |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for repo layout, testing conventions,
and the PR process. Items tagged **PLANNED** in [SPEC-STATUS.md](./SPEC-STATUS.md)
are good first issues.
