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
fn greet(name: string) {        // returns void
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

### Parameter passing

All parameters are copied by default with `__oncopy` called. For primitive-only structs this is just a memcpy. For structs with managed fields, lifecycle hooks are called:

```kei
// Primitive-only struct - just memcpy
struct Point { x: f64; y: f64; }
fn distance(p1: Point, p2: Point) -> f64 {
    // p1 and p2 are independent copies
    let dx = p1.x - p2.x;
    let dy = p1.y - p2.y;
    return sqrt(dx * dx + dy * dy);
}

// Struct with managed fields - copy + lifecycle hooks
fn greet(user: User) {
    // __oncopy called on entry (user.name refcount++)
    print("Hello, " + user.name);
}   // __destroy called on exit (user.name refcount--)
```

## Return value semantics

Return values are copied to the caller with `__oncopy`. The compiler applies Return Value Optimization (RVO) to avoid unnecessary copies:

```kei
fn createPoint() -> Point {
    return Point{ x: 1.0, y: 2.0 };  // RVO - constructed directly at call site
}

fn createUser(name: string) -> User {
    return User{ name: name, age: 0 };  // RVO - no extra __oncopy/__destroy
}
```

### Move parameters
Use `move` for zero-cost transfer of ownership:

```kei
fn consume(move user: User) {
    // user is moved, no __oncopy
    print(user.name);
}   // __destroy called here

let user = User{ name: "Alice", age: 25 };
consume(move user);  // user becomes invalid after this call
```

## Function overloading

Function overloading is **not supported** in version 0.0.1. Functions must have unique names.

```kei
// Not allowed in v0.0.1
fn process(data: int) -> int { return data * 2; }
fn process(data: string) -> string { return data + "!"; }  // ERROR
```

Use descriptive names instead:

```kei
fn processInt(data: int) -> int { return data * 2; }
fn processStr(data: string) -> string { return data + "!"; }
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
extern fn strlen(s: ptr<c_char>) -> usize;
extern fn memcpy(dest: ptr<u8>, src: ptr<u8>, n: usize) -> ptr<u8>;
extern fn sqlite3_open(filename: ptr<c_char>, db: ptr<ptr<void>>) -> int;
```

### Calling extern functions requires `unsafe`

The compiler cannot verify safety of foreign code, so all `extern fn` calls must be inside an `unsafe` block:

```kei
extern fn strlen(s: ptr<c_char>) -> usize;

fn stringLength(s: ptr<c_char>) -> usize {
    return unsafe { strlen(s) };  // must be in unsafe block
}
```

This is intentional — calling into C is inherently unsafe (no bounds checking, no lifetime guarantees, possible UB). Safe wrappers expose a safe API:

```kei
extern fn c_abs(x: i32) -> i32;

// Safe wrapper — users call this without unsafe
pub fn abs(x: i32) -> i32 {
    return unsafe { c_abs(x) };
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

### Lifecycle hook overhead
Functions receiving parameters with managed fields incur `__oncopy`/`__destroy` cost unless optimized away by the compiler (e.g. last-use optimization converts copy to move).

---

The function system balances familiar syntax with the performance characteristics needed for systems programming, while managing the complexity of Kei's two-tier memory model.