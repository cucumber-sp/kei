# Getting started with Kei

Kei compiles `.kei` source to C, then uses a system C compiler to produce a native executable. You need [Bun](https://bun.sh/) and `cc`, `gcc`, or `clang` on your `PATH`.

From the repository root:

```sh
cd compiler
bun install
```

Create `hello.kei` inside `compiler/`:

```kei
import { print } from io;

fn main() -> int {
    print("Hello, World!");
    return 0;
}
```

Run it:

```sh
bun src/cli.ts hello.kei --run
```

Expected output: `Hello, World!` followed by a newline. The driver resolves `io`, checks the program, lowers it to KIR, emits C, compiles it, and runs the result.

## Useful commands

| Command | Result |
| --- | --- |
| `bun src/cli.ts hello.kei --check` | Check without building |
| `bun src/cli.ts hello.kei --ast` | Print the parsed AST |
| `bun src/cli.ts hello.kei --kir` | Print KIR before mem2reg |
| `bun src/cli.ts hello.kei --kir-opt` | Print KIR after mem2reg |
| `bun src/cli.ts hello.kei --emit-c` | Print generated C |
| `bun src/cli.ts hello.kei --build` | Write a native executable |
| `bun src/cli.ts hello.kei --build --release` | Build with C optimizations |
| `bun src/cli.ts --help` | Show all flags |

To create a standalone compiler, run `bun run build`; it writes `dist/kei` and `dist/std/`. Keep the standard library directory beside the executable.

## Common errors

- **No input file:** put the `.kei` path before `--run` or `--check`.
- **No C compiler found:** install `cc`, `gcc`, or `clang`, then check that it is on `PATH`.
- **Unhandled throwing call:** handle it with `catch`, `catch panic`, or `catch throw` as appropriate.
- **Extern call outside `unsafe`:** call the C function inside an `unsafe` block or use a safe standard library wrapper.
- **Use of moved value:** after `move x`, the original binding `x` cannot be read.

Continue with the [language guide](language-guide.md) for syntax and examples. Check [implementation status](../SPEC-STATUS.md) for features that are specified but not complete.
