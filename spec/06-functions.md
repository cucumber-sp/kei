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

Kei supports function overloading by parameter types. Multiple functions may
share a name as long as their parameter lists differ:

```kei
fn process(data: int) -> int { return data * 2; }
fn process(data: string) -> string { return data + "!"; }
fn process(a: int, b: int) -> int { return a + b; }

let x = process(10);           // picks (int) -> int
let y = process("hi");         // picks (string) -> string
let z = process(1, 2);         // picks (int, int) -> int
```

**Resolution rules:**
- Exact type match wins over widening conversions.
- Ambiguous calls (two equally good matches) are a compile error.
- Return type is not considered — overloads that differ only by return type are rejected.
- Methods on a struct share the overload set with that struct's other methods of the same name.

Prefer distinct names when the operations are semantically different — overloading
is best for "same operation, several input shapes."

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

**Stack safety:** Kei does not provide automatic tail-call optimization or
stack-overflow protection. Deep recursion can blow the stack — handle with
care or use an explicit work queue.

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

**Requirements (compiler-enforced):**
- Must be named exactly `main`.
- Must return `int` — compile error if the return type is anything else.
- Takes no parameters today. Command-line arguments (likely
  `args: slice<string>`) will be added once `slice<T>` of stdlib types lands.
- Cannot declare `throws` — unhandled errors at the entry point are a program
  termination concern, not a type-system concern.

## Calling conventions

Kei compiles to C, so calling conventions follow the target C compiler:

- **Small value types:** Passed in registers when possible
- **Large value types:** Passed by pointer (compiler decision)
- **Return values:** Small values in registers, large values via RVO

## Function pointers

Function-pointer types use the `fn(...) -> ...` syntax directly as a first-class type:

```kei
type Handler   = fn(ref App, Request) -> Response;
type BinaryCmp = fn(int, int) -> bool;

fn isPositive(x: int) -> bool { return x > 0; }

let cb: fn(int) -> bool = isPositive;
let ok = cb(42);
```

Function pointers in Kei are **plain C function pointers** — one word (8 bytes on
64-bit), no hidden environment, same ABI as a C `bool (*cb)(int)`. Any Kei
function pointer can be passed across an FFI boundary that expects a C callback;
and any C callback pointer can be called from Kei.

## No closures

Kei deliberately has no closures. There is no capture list, no hidden environment,
no heap-promoted closure type. If a function needs additional state, it takes
that state as an **explicit parameter**:

```kei
// Bundle state into a struct
struct App {
    db: ptr<DB>;
    config: Config;
}

// Handlers are module-level functions with explicit state
fn handleRoot(app: ref App, req: Request) -> Response {
    return Response{ body: "hello" };
}

fn handleUser(app: ref App, req: Request) -> Response {
    let user = app.db.lookup(req.userId);
    return Response{ body: user.name };
}

// Registration passes the plain function pointer — no environment bundling
app.register("/",      handleRoot);
app.register("/user",  handleUser);
```

**Why no closures:**
- Keeps `fn(...) -> ...` values small and C-ABI-compatible at every call site.
- Eliminates an entire class of "hidden allocations" questions.
- Makes future async simpler — no captures to track across `await` points.
- "Polymorphic behaviour with bundled state" will be served by traits when they
  land (see `SPEC-STATUS.md`).

**For the "same callback shape, different state" case**, use a tagged enum of
handler structs, or (eventually) a trait object. Never reach for closures.

## No nested functions

`fn` declarations are only valid at **module level** or **inside a struct body**
(as methods). You cannot declare a function inside a block:

```kei
fn outer() -> int {
    fn inner() -> int {     // ERROR: functions cannot be nested inside blocks
        return 1;
    }
    return inner();
}
```

Move helpers to module scope. This keeps the compilation model straightforward
and matches the no-closures decision — there is never an outer scope to capture.

## Performance considerations

### Inlining
The compiler may inline small functions when beneficial. There is no manual
`inline` keyword.

### Zero-cost abstractions
Functions that operate only on value types compile to efficient C code with no overhead.

### Lifecycle hook overhead
Functions receiving parameters with managed fields incur `__oncopy`/`__destroy` cost unless optimized away by the compiler (e.g. last-use optimization converts copy to move).

---

The function system balances familiar syntax with the performance characteristics needed for systems programming, while managing the complexity of Kei's two-tier memory model.