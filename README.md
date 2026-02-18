# Kei

A statically-typed systems programming language that compiles to C.
Rust-like safety, Go-like simplicity, C-level performance.

```kei
import { print, newline } from io;

fn main() -> int {
    print("Hello, World!");
    newline();
    return 0;
}
```

## What is Kei?

Kei is a compiled systems programming language designed around explicit control.
There's no garbage collector, no runtime, no hidden allocations. Structs live on
the stack by default, lifecycle hooks (`__destroy`/`__oncopy`) handle cleanup
deterministically, and the compiler generates readable C that feeds into any C
compiler for final optimization.

The goal: write high-level code that compiles down to the same thing you'd write
by hand in C.

## Syntax Tour

### Variables and Types

```kei
let x = 42;                  // type inferred as i32
let y: i64 = 100;            // explicit type
const PI = 3.14159;          // compile-time constant
let hex = 0xFF_EE_DD;        // numeric separators
let bin = 0b1010_0001;       // binary literal
```

Primitive types: `i8` `i16` `i32` `i64` `u8` `u16` `u32` `u64` `f32` `f64`
`bool` `usize` `isize` `string`

Aliases: `int` = `i32`, `long` = `i64`, `float` = `f32`, `double` = `f64`,
`byte` = `u8`, `short` = `i16`

### Structs and Methods

```kei
struct Point {
    x: f64;
    y: f64;

    // by-value method (receives a copy)
    fn length_squared(self: Point) -> f64 {
        return self.x * self.x + self.y * self.y;
    }

    // by-pointer method (mutates in place)
    fn translate(self: ptr<Point>, dx: f64, dy: f64) {
        unsafe {
            self->x = self->x + dx;
            self->y = self->y + dy;
        }
    }
}

fn main() -> int {
    let p = Point{ x: 3.0, y: 4.0 };
    let len2 = p.length_squared();  // 25.0
    return 0;
}
```

### Enums

```kei
// Simple enum with backing type
enum Color : u8 {
    Red = 0,
    Green = 1,
    Blue = 2
}

// Data enum (tagged union)
enum Shape {
    Circle(radius: f64),
    Rectangle(width: f64, height: f64),
    Point
}

fn describe(s: Shape) -> f64 {
    switch s {
        case Circle(r): return r * r * 3.14159;
        case Rectangle(w, h): return w * h;
        case Point: return 0.0;
    }
}
```

### Error Handling

No exceptions. Errors are values, checked exhaustively at compile time.

```kei
struct NotFound {}
struct DbError { code: int; }

fn get_user(id: int) -> int throws NotFound, DbError {
    if id < 0 {
        throw NotFound{};
    }
    if id > 1000 {
        throw DbError{ code: 500 };
    }
    return id;
}

fn main() -> int {
    // handle each error type
    let user = get_user(42) catch {
        NotFound: return -1;
        DbError e: return e.code;
    };

    // or panic on any error
    let user2 = get_user(1) catch panic;

    return 0;
}
```

### Arrays

```kei
import { print } from io;

fn main() -> int {
    let arr = [10, 20, 30, 40, 50];
    print(arr[0]);              // 10
    print(arr.len);             // 5 (compile-time constant)

    for item in arr {
        print(item);
    }

    for item, index in arr {
        // index is the iteration counter
    }

    return 0;
}
```

### Control Flow

```kei
// if/else (works as expression)
let max = if a > b { a } else { b };

// C-style for loops
for (let i = 0; i < 10; i = i + 1) { }   // 0 to 9
for (let i = 0; i <= 10; i = i + 1) { }  // 0 to 10

// while
while count < 10 {
    count = count + 1;
    if count == 5 { continue; }
    if count == 8 { break; }
}

// switch (no fallthrough)
switch color {
    case Color.Red: x = 1;
    case Color.Green, Color.Blue: x = 2;
    default: x = 0;
}

// defer (LIFO at scope exit)
defer cleanup();
```

### Generics

Compile-time monomorphization — zero runtime cost.

```kei
fn max<T>(a: T, b: T) -> T {
    return if a > b { a } else { b };
}

struct Pair<A, B> {
    first: A;
    second: B;
}

let p = Pair<int, bool>{ first: 42, second: true };
let m = max<int>(10, 20);    // generates max_int at compile time
```

> **Note:** Generics are type-checked and monomorphized at the checker level.
> Backend codegen for generics is still in progress.

### Memory Management

```kei
// Value type — stack allocated, auto lifecycle
struct User {
    name: string;
    age: int;
}

fn main() -> int {
    let u1 = User{ name: "Alice", age: 25 };
    let u2 = u1;           // __oncopy auto-generated (copies string)
    let u3 = move u1;      // zero-cost transfer, u1 is now invalid

    return 0;
}   // __destroy auto-generated for u2, u3 (cleans up string)

// Unsafe struct — manual lifecycle, raw pointers allowed
unsafe struct Buffer {
    data: ptr<u8>;
    size: usize;

    fn __destroy(self: Buffer) {
        unsafe { free(self.data); }
    }

    fn __oncopy(self: Buffer) -> Buffer {
        let new_data = unsafe { alloc(self.size) };
        return Buffer{ data: new_data, size: self.size };
    }
}
```

### Modules

```kei
// math.kei
pub fn add(a: i32, b: i32) -> i32 {
    return a + b;
}

pub struct Vec2 { x: f64; y: f64; }
```

```kei
// main.kei — selective import
import { add, Vec2 } from math;

fn main() -> int {
    return add(3, 4);
}
```

```kei
// main.kei — whole-module import
import math;

fn main() -> int {
    return math.add(3, 4);
}
```

### Operator Overloading

```kei
struct Vec2 {
    x: f64;
    y: f64;

    fn op_add(self: Vec2, other: Vec2) -> Vec2 {
        return Vec2{ x: self.x + other.x, y: self.y + other.y };
    }

    fn op_eq(self: Vec2, other: Vec2) -> bool {
        return self.x == other.x && self.y == other.y;
    }
}

let a = Vec2{ x: 1.0, y: 2.0 };
let b = Vec2{ x: 3.0, y: 4.0 };
let c = a + b;    // calls op_add
let eq = a == b;   // calls op_eq
```

> **Note:** Operator overloading is type-checked. Backend codegen is still in
> progress.

## Building and Running

### Requirements

- [Bun](https://bun.sh/) (JavaScript runtime)
- A C compiler (`cc` — GCC or Clang)

### Install

```bash
cd compiler
bun install
```

### Usage

```bash
# Type-check only
bun run src/cli.ts program.kei --check

# Compile and run
bun run src/cli.ts program.kei --run

# Compile to binary
bun run src/cli.ts program.kei --build

# View generated C code
bun run src/cli.ts program.kei --emit-c

# View intermediate representations
bun run src/cli.ts program.kei --ast       # AST tree
bun run src/cli.ts program.kei --kir       # KIR (before optimization)
bun run src/cli.ts program.kei --kir-opt   # KIR (after mem2reg)
```

### Run Tests

```bash
cd compiler
bun test
```

1,650+ tests across lexer, parser, type checker, KIR lowering, and C backend.

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
  Checker ────► typed AST (type inference, generics monomorphization,
    │           exhaustiveness checking, lifecycle hook generation)
    ▼
  KIR Lowering ► KIR (SSA-form intermediate representation)
    │
    ▼
  mem2reg ────► optimized KIR (stack → register promotion)
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

## Current Status

### Works end-to-end (source → binary)

- All primitive types, type inference, numeric literals (hex, bin, oct, separators)
- Structs with methods (by-value and by-pointer), static methods
- Simple enums and data enums with destructuring in switch
- Error handling: `throws`/`catch`/`catch panic`/`catch throw`
- Arrays: literals, indexing with bounds checks, `.len`, for-in iteration
- Control flow: if/else (expression), while, for-range, switch, defer, break/continue
- Memory: `alloc`/`free` in unsafe blocks, pointers, address-of, dereference
- Auto-generated `__destroy` and `__oncopy` for structs with managed fields
- Modules: selective imports, whole-module imports, cycle detection
- Standard library: `io` (print, newline, putc, getc), `mem` (alloc, dealloc, copy)
- `assert`, `require`, `sizeof`, type casting, `move` semantics
- C FFI via `extern fn`

### Type-checked but backend in progress

- Generics (monomorphization works at checker level)
- Operator overloading (method resolution works at checker level)

### Not yet implemented

- Heap-allocated collections (`List<T>`, `slice<T>`)
- String methods and operations
- Closures, traits/interfaces, async/await, macros

## Specification

Full language spec in [`spec/`](spec/):

1. [Design Principles](spec/01-design.md)
2. [Lexical Structure](spec/02-lexical.md)
3. [Types](spec/03-types.md)
4. [Variables, Constants & Operators](spec/04-variables.md)
5. [Control Flow](spec/05-control.md)
6. [Functions](spec/06-functions.md)
7. [Structures](spec/07-structures.md)
8. [Memory Model](spec/08-memory.md)
9. [Error Handling](spec/09-errors.md)
10. [Modules, Imports & FFI](spec/10-modules.md)
11. [Compilation Model](spec/11-compilation.md)
12. [KIR — Intermediate Representation](spec/12-kir.md)
13. [Grammar & Keywords](spec/13-grammar.md)

## Design Principles

- **Simplicity over cleverness** — fully understandable by a single person
- **Explicit over implicit** — allocations, side effects, and ownership transfers are visible
- **Zero-cost defaults** — code that doesn't need the heap doesn't touch the heap
- **Source-only compilation** — all dependencies compiled from source for whole-program optimization
