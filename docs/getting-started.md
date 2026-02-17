# Getting Started with Kei

Kei is a statically-typed systems programming language that compiles to C.
It aims for Rust-like safety, Go-like simplicity, and C-level performance.

## Prerequisites

You need two things installed:

1. **Bun** (v1.0+) — the Kei compiler is written in TypeScript and runs on Bun.
   ```sh
   curl -fsSL https://bun.sh/install | bash
   ```

2. **A C compiler** — one of `cc`, `gcc`, or `clang`. The Kei compiler will find whichever is available.
   - macOS: Xcode Command Line Tools (`xcode-select --install`)
   - Ubuntu/Debian: `sudo apt install gcc`
   - Fedora: `sudo dnf install gcc`

Verify both are installed:

```sh
bun --version    # should print 1.x
cc --version     # or gcc --version / clang --version
```

## Installation

Clone the repository and install dependencies:

```sh
git clone <repo-url> kei
cd kei/compiler
bun install
```

That's it. The compiler runs directly from source — no build step needed.

## Hello World

Create a file called `hello.kei`:

```kei
import { print } from io;

fn main() -> int {
    print("Hello, World!");
    return 0;
}
```

Compile and run it:

```sh
bun run src/cli.ts hello.kei --run
```

You should see:

```
Hello, World!
```

### What just happened?

1. The compiler lexed and parsed your source file
2. It resolved the `import { print } from io` — pulling in the standard `io` module
3. It type-checked everything
4. It lowered the code to KIR (Kei Intermediate Representation)
5. It ran optimization passes (mem2reg, de-SSA)
6. It emitted C code, compiled it with your system's C compiler, and ran the binary

## CLI Flags

```
kei <file.kei> [options]
```

| Flag | What it does |
|------|-------------|
| *(no flag)* | Lex only — prints tokens |
| `--check` | Type-check without generating code |
| `--ast` | Print the AST as an indented tree |
| `--ast-json` | Print the AST as JSON |
| `--kir` | Print the KIR (lowered IR before optimization) |
| `--kir-opt` | Print KIR after mem2reg optimization |
| `--emit-c` | Print the generated C code to stdout |
| `--build` | Compile to a native binary |
| `--run` | Compile and immediately execute |
| `--help`, `-h` | Show help |
| `--version`, `-V` | Show compiler version |

### Examples

```sh
# Type-check without compiling
bun run src/cli.ts hello.kei --check

# See what C code gets generated
bun run src/cli.ts hello.kei --emit-c

# Compile to a binary (creates hello in the same directory)
bun run src/cli.ts hello.kei --build

# Run the compiled binary yourself
./hello
```

## Your First Program

Let's write something more interesting — a Fibonacci calculator with error handling.

Create `fib.kei`:

```kei
import { print, newline } from io;

struct InvalidInput {
    n: int;
}

fn fibonacci(n: int) -> int throws InvalidInput {
    if n < 0 {
        throw InvalidInput{ n: n };
    }
    if n <= 1 {
        return n;
    }
    let a: int = 0;
    let b: int = 1;
    for i in 2..=n {
        let tmp = a + b;
        a = b;
        b = tmp;
    }
    return b;
}

fn main() -> int {
    // Print the first 10 Fibonacci numbers
    for i in 0..10 {
        let result = fibonacci(i) catch panic;
        print(result);
        print(" ");
    }
    newline();

    // Try an invalid input
    let bad = fibonacci(-1) catch {
        InvalidInput e: {
            print("Error: invalid input ");
            print(e.n);
            newline();
            return 1;
        }
    };

    return 0;
}
```

Run it:

```sh
bun run src/cli.ts fib.kei --run
```

Output:

```
0 1 1 2 3 5 8 13 21 34
Error: invalid input -1
```

This program demonstrates several Kei features:
- **Structs** (`InvalidInput`) used as error types
- **Error handling** (`throws`, `throw`, `catch`, `catch panic`)
- **For-range loops** with both exclusive (`0..10`) and inclusive (`2..=n`) ranges
- **The standard library** (`import { print, newline } from io`)

## Common Errors and What They Mean

### `error: no input file provided`

You forgot to pass a `.kei` file:

```sh
# Wrong
bun run src/cli.ts --run

# Right
bun run src/cli.ts myfile.kei --run
```

### `Cannot call extern function outside unsafe block`

You're calling a C function (declared with `extern fn`) without wrapping the call in `unsafe {}`. Either use the standard library wrappers (like `io.print` instead of raw `puts`) or add an unsafe block:

```kei
extern fn puts(s: ptr<c_char>) -> int;

fn main() -> int {
    // Wrong: puts("hello");
    unsafe { puts("hello"); }  // Right
    return 0;
}
```

### `Unhandled throwing function call`

You called a function that `throws` errors without handling them. Every call to a throwing function must use `catch`:

```kei
fn get(id: int) -> int throws NotFound {
    if id < 0 { throw NotFound{}; }
    return id;
}

fn main() -> int {
    // Wrong: let x = get(5);
    let x = get(5) catch panic;          // Right: crash on error
    let y = get(5) catch {               // Right: handle the error
        NotFound: return -1;
    };
    return 0;
}
```

### `Non-exhaustive catch block`

Your `catch` block doesn't handle all the error types the function can throw:

```kei
fn fetch() -> int throws NotFound, Timeout { ... }

// Wrong — missing Timeout handler:
let x = fetch() catch {
    NotFound: return -1;
};

// Right — handle all error types:
let x = fetch() catch {
    NotFound: return -1;
    Timeout: return -2;
};
```

### `Cannot reassign const variable`

A `const` binding is immutable. Use `let` if you need to reassign:

```kei
const x = 10;
x = 20;  // Error!

let y = 10;
y = 20;  // Fine
```

### `Use of moved value`

After using `move`, the original variable is no longer valid:

```kei
let a = Point{ x: 1.0, y: 2.0 };
let b = move a;
print(a.x);  // Error: a has been moved
```

### `Array index out of bounds`

Array bounds are checked at runtime in debug mode. Accessing an index beyond `arr.len` will panic:

```kei
let arr = [10, 20, 30];
let x = arr[5];  // Runtime panic: index 5 out of bounds for array of length 3
```

### `error: no C compiler found`

The Kei compiler needs `cc`, `gcc`, or `clang` to be in your `PATH`. Install one (see Prerequisites above).

## Next Steps

Read the [Language Guide](language-guide.md) for a comprehensive tour of all Kei features.
