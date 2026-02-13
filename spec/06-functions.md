# Functions

Functions are the primary unit of code organization in Kei. They provide a way to encapsulate behavior and manage the interaction between different memory management categories.

## Declaration syntax

Functions are declared using the `fn` keyword:

```kei
fn name(param1: Type1, param2: Type2) -> ReturnType {
    // function body
    return value;
}
```

### Return types
- If no return type is specified, the function returns `void`
- Return type follows the `->` arrow syntax
- `void` functions can use `return;` (without value) or omit return statement

```kei
fn greet(name: str) {           // returns void
    print("Hello, " + name);
}

fn add(a: int, b: int) -> int { // returns int
    return a + b;
}
```

## Parameters

### Parameter mutability

Function parameters are **immutable by default**. Use `mut` to create a mutable local copy:

```kei
fn increment(mut x: int) -> int {
    x += 1;        // ok - x is a mutable copy
    return x;
}

let value = 5;
let result = increment(value);  // value is still 5, result is 6
```

**Important:** `mut` creates a copy of the parameter. Changes do not affect the caller's original value.

### Parameter passing by type category

The parameter passing convention depends on the type category:

| Type Category | Default Behavior | Copy Cost |
|---------------|------------------|-----------|
| `struct` (value) | Copy by value | Cheap (stack) |
| `ref struct` | Reference count increment | Medium |
| `unsafe struct` | Transfer ownership | Cheap |

```kei
// Value types - always copied
struct Point { x: f64; y: f64; }
fn distance(p1: Point, p2: Point) -> f64 {
    // p1 and p2 are independent copies
    let dx = p1.x - p2.x;
    let dy = p1.y - p2.y;
    return sqrt(dx * dx + dy * dy);
}

// Reference types - refcount increment by default
ref struct Database { connection: str; }
fn query(db: Database, sql: str) -> str {
    // db's reference count is incremented
    return db.execute(sql);
}
```

## Optimized parameter passing (Design Question)

**Note:** This section describes a feature that is under design consideration.

For `ref struct` types, there may be a `borrow` keyword to avoid reference count overhead:

```kei
fn printUser(borrow user: User) {
    // Receives a pointer, does not increment refcount
    // Cannot modify, store, or return the borrowed reference
    print("User: " + user.name);
}
```

**Borrow restrictions (if implemented):**
- Callee receives a pointer without ownership
- Cannot store borrowed references in struct fields
- Cannot return borrowed references from functions  
- Cannot call `__free` or `free` on borrowed references

**Alternative approach:** The language may rely entirely on reference counting with compiler optimizations to eliminate unnecessary increments/decrements.

*This design question will be resolved in future iterations.*

## Return value semantics

Return values follow the same type category rules:

### Value types
Copied to the caller:

```kei
fn createPoint() -> Point {
    return Point{ x: 1.0, y: 2.0 };  // copied to caller
}
```

### Reference types
Use Return Value Optimization (RVO) to avoid unnecessary reference count operations:

```kei
fn createUser(name: str) -> User {
    return User{ name: name, email: "" };  // RVO - no refcount overhead
}
```

The compiler implements RVO by passing an "out-pointer" parameter where the return value is constructed directly at the call site.

### Move semantics
Use `move` for zero-cost transfer of ownership:

```kei
fn takeOwnership(data: move Database) -> bool {
    // data is moved, no refcount increment
    return data.isValid();
}

let db = Database{ connection: "localhost" };
let valid = takeOwnership(move db);  // db becomes invalid after this call
```

## Function overloading

Function overloading is **not supported** in version 0.0.1. Functions must have unique names.

```kei
// Not allowed in v0.0.1
fn process(data: int) -> int { return data * 2; }
fn process(data: str) -> str { return data + "!"; }  // ERROR
```

Use descriptive names instead:

```kei
fn processInt(data: int) -> int { return data * 2; }
fn processStr(data: str) -> str { return data + "!"; }
```

## Recursion

Recursive functions are supported with standard stack semantics:

```kei
fn factorial(n: int) -> int {
    if n <= 1 {
        return 1;
    }
    return n * factorial(n - 1);
}
```

**Stack safety:** Kei does not provide automatic tail-call optimization or stack overflow protection in v0.0.1. Deep recursion may cause stack overflow.

## External functions

External C functions are declared with `extern`:

```kei
extern fn malloc(size: usize) -> ptr<u8>;
extern fn free(ptr: ptr<u8>);
extern fn strlen(s: ptr<c_char>) -> usize;

// Kei wrapper for safer usage
fn allocateBytes(count: usize) -> ptr<u8> {
    let ptr = malloc(count);
    if ptr == null {
        panic("allocation failed");
    }
    return ptr;
}
```

## Program entry point

Every Kei program must have a `main` function that serves as the entry point:

```kei
fn main() -> int {
    print("Hello, world!");
    return 0;  // exit code
}
```

**Requirements:**
- Must be named exactly `main`
- Must return `int` (exit code)
- Takes no parameters in v0.0.1 (command-line arguments not yet supported)

## Calling conventions

Kei compiles to C, so calling conventions follow the target C compiler:

- **Small value types:** Passed in registers when possible
- **Large value types:** Passed by pointer (compiler decision)
- **Reference types:** Passed as pointer + refcount metadata
- **Return values:** Small values in registers, large values via RVO

## Function pointers (Future)

Function pointers are planned for future versions:

```kei
// Not yet implemented
type Handler = fn(int) -> bool;
let callback: Handler = processValue;
```

## Performance considerations

### Inlining
The compiler may inline small functions when beneficial. No manual `inline` keyword in v0.0.1.

### Zero-cost abstractions
Functions that operate only on value types compile to efficient C code with no overhead.

### Reference counting overhead
Functions receiving `ref struct` parameters incur reference counting cost unless optimized away by the compiler.

---

The function system balances familiar syntax with the performance characteristics needed for systems programming, while managing the complexity of Kei's three-tier memory model.