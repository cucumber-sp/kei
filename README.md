# The Kei Programming Language

> Write like Go/TypeScript, runs like C

Kei is a statically typed systems programming language designed for performance without compromise. It combines the ergonomics of modern high-level languages with the efficiency of systems languages through a unique compilation model that generates readable C code as an intermediate representation.

## Quick Look

```kei
// Hello World
fn main() -> int {
    print("Hello, World!");
    return 0;
}
```

```kei
// HTTP server in Kei
import http;
import json;

struct User {
    name: string;
    email: string;
}

fn handleUser(req: http.Request) -> http.Response throws http.BadRequest {
    let user = json.parse<User>(req.body) catch {
        http.BadRequest: throw http.BadRequest("Invalid JSON");
    };

    let response = User{ name: user.name, email: user.email };
    return http.ok(json.stringify(response));
}

fn main() -> int {
    let server = http.Server{ port: 8080 };
    server.route("/user", handleUser);
    server.listen();
    return 0;
}
```

## Why Kei?

### Performance Without Pain
- **No garbage collector** — lifecycle hooks (`__destroy`/`__oncopy`) for deterministic cleanup
- **Zero runtime overhead** — primitive-only structs compile to plain C with no hook calls
- **Stack-first design** — all structs live on the stack, heap usage is explicit
- **Compiles to optimized C** — leverage decades of C compiler optimizations

### Developer Experience
- **Familiar syntax** — TypeScript/C#-style syntax with modern features
- **Explicit error handling** — throws/catch mechanism instead of exceptions
- **Strong type system** — catch bugs at compile time
- **Generics** — compile-time monomorphization with zero runtime overhead
- **Source-only compilation** — whole-program optimization

### Two Worlds of Data
Kei organizes all data into two distinct categories:

1. **Value types** (`struct`) — Stack allocated, auto-generated lifecycle hooks, no raw pointers
2. **Unsafe types** (`unsafe struct`) — Stack allocated, user-defined lifecycle hooks, raw pointers allowed

Standard library types like `string`, `dynarray<T>`, and `Shared<T>` are built using `unsafe struct` with lifecycle hooks, providing safe abstractions over heap-allocated resources.

## Architecture

```
.kei source -> Lexer -> Parser -> AST -> Type Checker -> KIR Lowering -> KIR -> C Backend -> .c -> GCC/Clang -> binary
```

Kei uses **KIR (Kei Intermediate Representation)** as a bridge to generate clean, readable C code that can be optimized by any C compiler.

## Design Principles

- **Simplicity over cleverness** — The language should be fully understandable by a single person
- **Explicit over implicit** — Side effects, allocations, and ownership transfers are visible
- **Zero-cost defaults** — Code that doesn't need the heap doesn't touch the heap
- **Source-only compilation** — All dependencies compiled from source for maximum optimization

## Quick Examples

### Memory Management
```kei
// Value type - stack allocated, auto lifecycle hooks
struct Point {
    x: f64;
    y: f64;
}

// Struct with managed fields
struct User {
    name: string;    // string has __oncopy/__destroy for refcounting
    age: int;
}

fn main() -> int {
    let p1 = Point{ x: 1.0, y: 2.0 };
    let p2 = p1; // Copy - just memcpy (no hooks needed for primitives)

    let u1 = User{ name: "Alice", age: 25 };
    let u2 = u1;          // __oncopy -> name refcount++
    let u3 = move u1;     // Zero-cost transfer, u1 becomes invalid

    return 0;
} // __destroy called on u2, u3 (name refcount--)
  // p1, p2 just go out of scope (no-op)
```

### Error Handling
```kei
fn divide(a: f64, b: f64) -> f64 throws DivisionByZero {
    if (b == 0.0) {
        throw DivisionByZero();
    }
    return a / b;
}

fn main() -> int {
    let result = divide(10.0, 0.0) catch {
        DivisionByZero: {
            print("Cannot divide by zero!");
            return 1;
        };
    };
    print("Result: " + result);
    return 0;
}
```

### Enums with Data
```kei
enum Shape {
    Circle(radius: f64);
    Rectangle(width: f64, height: f64);
    Point;
}

fn area(shape: Shape) -> f64 {
    match (shape) {
        Circle(r): return 3.14 * r * r;
        Rectangle(w, h): return w * h;
        Point: return 0.0;
    }
}
```

### Generics
```kei
fn max<T>(a: T, b: T) -> T {
    return if a > b { a } else { b };
}

struct Pair<A, B> {
    first: A;
    second: B;
}

let p = Pair<int, string>{ first: 42, second: "hello" };
let m = max<int>(10, 20);  // monomorphized at compile time
```

## Current Status

**Version:** 0.0.1 (Work in Progress)
**Target:** February 2026

### What's Included
- Static typing with type inference
- Two-tier memory model (`struct` / `unsafe struct`)
- Lifecycle hooks (`__destroy` / `__oncopy`)
- Generics with compile-time monomorphization
- Exception-style error handling
- Single `string` type with COW semantics
- Source-only compilation
- C FFI support

### What's Not (Yet)
- Async/await
- Standard library
- Closures
- Traits/interfaces
- Operator overloading
- Macros

## Specification

Detailed language specification is available in the [`spec/`](spec/) directory:

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
12. [KIR — Kei Intermediate Representation](spec/12-kir.md)
13. [Grammar & Keywords](spec/13-grammar.md)

## Getting Started

*Coming soon - compiler implementation in progress*

## License

*To be determined*

---

*Kei is a work in progress. This specification represents the target design for version 0.0.1.*
