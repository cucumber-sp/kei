# Kei

Kei is an experimental statically typed systems language. Its compiler runs on Bun, emits C, and uses a system C compiler to produce native binaries. The language has explicit `move`, deterministic cleanup through `__destroy` / `__oncopy`, generics, tagged enums, modules, and checked error handling.

```kei
import { print } from io;

fn main() -> int {
    print("Hello, World!");
    return 0;
}
```

## Try it

Install [Bun](https://bun.sh/) and a C compiler (`cc`, `gcc`, or `clang`). From the repository root:

```sh
cd compiler
bun install
bun src/cli.ts hello.kei --run
```

`--check` type-checks, `--emit-c` prints generated C, and `--build` writes a native binary. `bun test` runs the compiler suite. `bun run build` creates a standalone `dist/kei` executable with `dist/std/` beside it. See [Getting started](docs/getting-started.md) for a complete example.

## Project map

| Path | Purpose |
| --- | --- |
| `compiler/src/` | Lexer, parser, checker, KIR, lifecycle, diagnostics, monomorphization, and C backend |
| `compiler/std/` | Standard library written in Kei |
| `compiler/tests/` | Unit, integration, and end-to-end tests |
| `docs/` | Tutorials, architecture, and design rationale |
| `spec/` | Language specification |
| `SPEC-STATUS.md` | Specified features that remain partial or unimplemented |

The [language guide](docs/language-guide.md) covers implemented features. The [documentation index](docs/README.md) explains where each kind of information lives. [Compiler architecture](docs/architecture.md) traces the pipeline and its modules. [Contributing](CONTRIBUTING.md) has development commands and conventions.

Kei is a pet project under active development. The specification includes planned language features; check [implementation status](SPEC-STATUS.md) before relying on them.
