# Kei Language Guide

A comprehensive reference for all implemented features in Kei v0.1.0.

## Table of Contents

- [Variables](#variables)
- [Types](#types)
- [Type Aliases](#type-aliases)
- [Functions](#functions)
- [Structs](#structs)
- [Enums](#enums)
- [Control Flow](#control-flow)
- [Error Handling](#error-handling)
- [Modules and Imports](#modules-and-imports)
- [Operator Overloading](#operator-overloading)
- [Lifecycle Hooks](#lifecycle-hooks)
- [Memory Management](#memory-management)
- [Implicit Conversions and Literal Suffixes](#implicit-conversions-and-literal-suffixes)
- [Move Semantics](#move-semantics)

---

## Variables

Kei has three kinds of bindings: `let`, `const`, and `static`.

### `let` — Mutable Variables

```kei
let x = 42;          // type inferred as i32
let y: f64 = 3.14;   // explicit type annotation
let name = "Alice";   // string type

x = 100;              // reassignment is fine
```

Variables must be initialized at declaration — uninitialized variables are a compile error.

### `const` — Immutable Bindings

```kei
const PI = 3.14159;
const MAX = 100;

PI = 2.0;  // compile error: cannot reassign const
```

`const` prevents reassignment. The value can be computed at runtime; it just can't change.

### `static` — Compile-Time Constants

```kei
static MAX_USERS = 1000;
pub static VERSION = 1;
```

`static` values are inlined at every use site. They can be exported with `pub`.

### Shadowing

Shadowing is allowed in nested scopes:

```kei
let x = 10;
if true {
    let x = 20;   // shadows outer x
    print(x);     // 20
}
print(x);         // 10
```

---

## Types

### Primitive Types

| Type | Description | C equivalent |
|------|-------------|-------------|
| `i8`, `i16`, `i32`, `i64` | Signed integers | `int8_t`, etc. |
| `u8`, `u16`, `u32`, `u64` | Unsigned integers | `uint8_t`, etc. |
| `isize`, `usize` | Pointer-sized signed/unsigned | `intptr_t`, `size_t` |
| `f32`, `f64` | Floating point | `float`, `double` |
| `bool` | Boolean | `bool` |
| `string` | String (builtin) | `const char*` |
| `void` | No value | `void` |
| `c_char` | C character type | `char` |

### Type Aliases (Built-in)

| Alias | Equivalent |
|-------|-----------|
| `int` | `i32` |
| `uint` | `u32` |
| `byte` | `u8` |
| `short` | `i16` |
| `long` | `i64` |
| `float` | `f32` |
| `double` | `f64` |

### Pointers

Raw pointers are available but require `unsafe` to use:

```kei
fn main() -> int {
    let x: int = 42;
    let p: ptr<int> = unsafe { &x };   // address-of requires unsafe
    let val = unsafe { p.* };          // dereference requires unsafe (postfix .*)
    print(val);                        // 42
    return 0;
}
```

The `null` literal can be assigned to any `ptr<T>`:

```kei
let p: ptr<int> = null;
```

### Arrays

Fixed-size, stack-allocated arrays:

```kei
let arr = [10, 20, 30, 40, 50];   // type inferred: array of i32, length 5

print(arr[0]);         // 10 — indexing
print(arr.len as int); // 5  — .len returns usize, cast to int for print

arr[0] = 99;           // index assignment
```

Array access is bounds-checked at runtime. Accessing an out-of-bounds index triggers a panic.

### Strings

Strings support escape sequences:

```kei
let greeting = "Hello, World!\n";
let tab = "col1\tcol2";
let quote = "She said \"hi\"";
let hex = "\x41";       // 'A'
let nul = "end\0here";
```

String concatenation:

```kei
let first = "hello";
let full = first + " world";
```

---

## Type Aliases

Create transparent type aliases with `type`:

```kei
type UserId = int;
type Score = f64;

fn get_score(id: UserId) -> Score {
    return 100.0;
}
```

Type aliases are fully transparent — `UserId` and `int` are interchangeable.

---

## Functions

### Basic Functions

```kei
fn add(a: int, b: int) -> int {
    return a + b;
}

fn greet(name: string) {
    print("Hello ");
    print(name);
    newline();
}
```

Functions without a `-> Type` annotation return `void`.

### `pub` — Exported Functions

By default, functions are private to their module. Use `pub` to export:

```kei
pub fn add(a: int, b: int) -> int {
    return a + b;
}
```

### `mut` Parameters

Parameters are immutable by default. Use `mut` to get a mutable local copy:

```kei
fn countdown(mut n: int) {
    while n > 0 {
        print(n);
        n = n - 1;    // modifying local copy, caller's value unchanged
    }
}
```

### Recursion

```kei
fn factorial(n: int) -> int {
    if n <= 1 { return 1; }
    return n * factorial(n - 1);
}
```

### Generic Functions

Generic functions are monomorphized at compile time — a separate copy is generated for each set of type arguments.

```kei
fn identity<T>(x: T) -> T {
    return x;
}

fn first<A, B>(a: A, b: B) -> A {
    return a;
}

fn main() -> int {
    // Explicit type arguments
    let x = identity<i32>(42);

    // Type arguments inferred from values
    let y = identity("hello");
    let z = first(42, true);

    return 0;
}
```

### Extern Functions (FFI)

Declare C functions with `extern fn` and call them inside `unsafe`:

```kei
extern fn puts(s: ptr<c_char>) -> int;
extern fn abs(n: int) -> int;

fn main() -> int {
    unsafe {
        puts("Hello from C!");
        let n = abs(-42);
        print(n);   // 42
    }
    return 0;
}
```

---

## Structs

### Basic Structs

```kei
struct Point {
    x: f64;
    y: f64;
}

fn main() -> int {
    let p = Point{ x: 1.0, y: 2.0 };
    print(p.x);   // 1.0
    print(p.y);   // 2.0
    return 0;
}
```

Struct fields are separated by semicolons. Struct literals use `StructName{ field: value }` syntax.

### Methods

Methods are defined inside the struct body. The `self` parameter determines how the struct is passed.

#### By-value (`self: T`) — receives a copy

```kei
struct Point {
    x: f64;
    y: f64;

    fn length_squared(self: Point) -> f64 {
        return self.x * self.x + self.y * self.y;
    }
}

fn main() -> int {
    let p = Point{ x: 3.0, y: 4.0 };
    print(p.length_squared());   // 25.0
    return 0;
}
```

#### By-pointer (`self: ptr<T>`) — can mutate

```kei
struct Counter {
    value: int;

    fn increment(self: ptr<Counter>) {
        unsafe {
            self.*.value = self.*.value + 1;
        }
    }

    fn get(self: Counter) -> int {
        return self.value;
    }
}

fn main() -> int {
    let c = Counter{ value: 0 };
    c.increment();     // auto address-of: compiler passes &c
    c.increment();
    print(c.get());    // 2
    return 0;
}
```

#### Static methods (no `self`)

```kei
struct Point {
    x: f64;
    y: f64;

    fn origin() -> Point {
        return Point{ x: 0.0, y: 0.0 };
    }
}

fn main() -> int {
    let p = Point.origin();
    return 0;
}
```

### Generic Structs

```kei
struct Pair<A, B> {
    first: A;
    second: B;
}

fn main() -> int {
    // Explicit type arguments
    let p = Pair<i32, bool>{ first: 42, second: true };

    // Type arguments inferred from field values
    let q = Pair{ first: "hello", second: 100 };

    print(p.first);    // 42
    return 0;
}
```

Generic structs can have methods:

```kei
struct Box<T> {
    value: T;

    fn get(self: Box<T>) -> T {
        return self.value;
    }

    fn set(self: Box<T>, new_val: T) -> Box<T> {
        return Box<T>{ value: new_val };
    }
}
```

### Unsafe Structs

Regular structs cannot contain `ptr<T>` fields. If you need raw pointers, use `unsafe struct`:

```kei
pub unsafe struct Buffer {
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

An `unsafe struct` with `ptr<T>` fields must define both `__destroy` and `__oncopy`.

---

## Enums

### Simple Enums

C-style enums with an optional backing type:

```kei
enum Color : u8 {
    Red = 0,
    Green = 1,
    Blue = 2
}

fn main() -> int {
    let c: Color = Color.Green;

    switch c {
        case Red: print("red");
        case Green: print("green");
        case Blue: print("blue");
    }

    return 0;
}
```

Enum cases are accessed as `EnumName.Variant`. Switch on enums is exhaustiveness-checked — if you miss a case, it's a compile error (unless you have a `default`).

### Data Enums (Tagged Unions)

Variants can carry data fields:

```kei
enum Shape {
    Circle(radius: f64),
    Rectangle(width: f64, height: f64),
    Point
}

fn main() -> int {
    let s: Shape = Shape.Circle(3.14);
    let r: Shape = Shape.Rectangle(2.0, 5.0);
    let p: Shape = Shape.Point;
    return 0;
}
```

### Destructuring in Switch

Extract variant fields directly in switch cases:

```kei
import { print } from io;

enum Shape {
    Circle(radius: f64),
    Rectangle(width: f64, height: f64),
    Point
}

fn area(s: Shape) -> f64 {
    switch s {
        case Circle(r): return r * r * 3.14159;
        case Rectangle(w, h): return w * h;
        case Point: return 0.0;
    }
}

fn main() -> int {
    print(area(Shape.Circle(5.0)));       // 78.53975
    print(area(Shape.Rectangle(3.0, 4.0))); // 12.0
    return 0;
}
```

### Multiple Values Per Case

```kei
enum Color : u8 { Red = 0, Green = 1, Blue = 2 }

fn is_warm(c: Color) -> bool {
    switch c {
        case Red, Green: return true;
        case Blue: return false;
    }
}
```

---

## Control Flow

### If / Else

Parentheses around the condition are optional. Braces are required.

```kei
if x > 0 {
    print("positive");
} else if x < 0 {
    print("negative");
} else {
    print("zero");
}
```

### If as Expression

`if` can be used as an expression. All branches must return the same type, and `else` is required:

```kei
let abs_val = if x >= 0 { x } else { 0 - x };
```

### While Loop

```kei
let i = 0;
while i < 10 {
    print(i);
    i = i + 1;
}
```

`break` exits the loop. `continue` skips to the next iteration.

### For-Range Loop

```kei
// Exclusive range: 0, 1, 2, ..., 9
for i in 0..10 {
    print(i);
}

// Inclusive range: 0, 1, 2, ..., 10
for i in 0..=10 {
    print(i);
}
```

### For-Each Over Arrays

```kei
let names = ["Alice", "Bob", "Charlie"];

// Iterate over elements
for name in names {
    print(name);
}

// Iterate with index
for name, i in names {
    print(i as int);
    print(name);
}
```

### Switch Statement

No fall-through. Multiple values per case. `default` is optional but required if cases aren't exhaustive.

```kei
switch day {
    case 0: print("Sunday");
    case 1: print("Monday");
    case 6: print("Saturday");
    default: print("weekday");
}
```

### Switch Expression

`switch` can be used as an expression:

```kei
let label = switch code {
    case 200: "OK";
    case 404: "Not Found";
    case 500: "Server Error";
    default: "Unknown";
};
```

With enum destructuring:

```kei
enum Value {
    Int(n: i32),
    Bool(b: bool)
}

let v: Value = Value.Int(99);
let result = switch v {
    case Int(n): n;
    case Bool(b): 0;
};
```

### Defer

Deferred statements run at scope exit in LIFO (reverse) order:

```kei
fn process() {
    defer print("cleanup 1");
    defer print("cleanup 2");
    print("working");
    // Output: working, cleanup 2, cleanup 1
}
```

### Assert and Require

```kei
assert(x > 0);                    // debug-only check
assert(x > 0, "x must be positive");

require(x > 0);                   // always-on check (even in release)
require(x > 0, "x must be positive");
```

Both trigger a panic on failure, printing the message and aborting.

---

## Error Handling

Kei uses explicit, exhaustive error handling. Errors are values — regular structs. There are no exceptions.

### Declaring Throwing Functions

```kei
struct NotFound {
    id: int;
}

struct DbError {
    code: int;
    message: string;
}

fn get_user(id: int) -> int throws NotFound, DbError {
    if id < 0 {
        throw NotFound{ id: id };
    }
    if id == 0 {
        throw DbError{ code: 500, message: "db down" };
    }
    return id;
}
```

The `throws` clause lists every error type the function can produce. Error types are ordinary structs.

### Catch Block — Handle Each Error

```kei
let user = get_user(10) catch {
    NotFound e: {
        print("not found: ");
        print(e.id);
        return -1;
    }
    DbError e: {
        print("db error: ");
        print(e.code);
        return -2;
    }
};
```

Every error type in the `throws` clause must be handled — missing one is a compile error. The variable binding (e.g., `e`) is optional.

### Catch Panic — Abort on Error

When you know an error shouldn't happen and want to crash if it does:

```kei
let user = get_user(10) catch panic;
```

This compiles to: if the function returns any error, call `panic`.

### Catch Throw — Propagate Errors

Re-throw all errors to the calling function:

```kei
fn process(id: int) -> int throws NotFound, DbError {
    let user = get_user(id) catch throw;  // propagate errors up
    return user * 2;
}
```

The enclosing function's `throws` clause must include all the error types being propagated.

### Default Clause

Handle some errors specifically and catch the rest with `default`:

```kei
let user = get_user(10) catch {
    NotFound: return -1;
    default: return -2;
};
```

### Error Propagation Chains

```kei
struct ParseError { pos: int; }
struct ValidationError { code: int; }

fn parse(input: int) -> int throws ParseError {
    if input < 0 { throw ParseError{ pos: input }; }
    return input * 2;
}

fn validate(value: int) -> int throws ValidationError {
    if value > 100 { throw ValidationError{ code: 1 }; }
    return value;
}

fn process(input: int) -> int throws ParseError, ValidationError {
    let parsed = parse(input) catch throw;
    let validated = validate(parsed) catch throw;
    return validated;
}

fn main() -> int {
    let result = process(10) catch {
        ParseError e: {
            print("parse error");
            return 1;
        }
        ValidationError e: {
            print("validation error");
            return 1;
        }
    };
    print(result);   // 20
    return 0;
}
```

---

## Modules and Imports

Every `.kei` file is a module. Names are private by default — use `pub` to export.

### Creating a Module

```kei
// math.kei
pub fn add(a: i32, b: i32) -> i32 {
    return a + b;
}

pub fn multiply(a: i32, b: i32) -> i32 {
    return a * b;
}

fn helper() -> i32 {    // private — not importable
    return 42;
}

pub struct Vec2 {
    x: f64;
    y: f64;
}
```

### Selective Import

Import specific names:

```kei
import { add, multiply } from math;

fn main() -> i32 {
    return add(3, multiply(2, 5));   // 13
}
```

### Whole-Module Import

Import the entire module and use qualified access:

```kei
import math;

fn main() -> i32 {
    return math.add(3, 4);   // 7
}
```

### Importing Structs and Types

```kei
import { Vec2, add } from math;

fn main() -> i32 {
    let v = Vec2{ x: 1.0, y: 2.0 };
    return add(3, 4);
}
```

### Module Resolution

The compiler resolves module names to file paths relative to the main file's directory:

- `import math;` → looks for `math.kei` next to your main file, then in `std/`
- `import net.http;` → looks for `net/http.kei`

The standard library modules (`io`, `mem`) are found automatically in the compiler's `std/` directory.

### Circular Dependencies

Circular imports are detected at compile time:

```
error: circular dependency detected: a → b → a
```

---

## Operator Overloading

Structs can define operator methods to support standard operators. This is currently **type-checked only** — the checker validates the code but it cannot be compiled to a binary yet.

### Binary Operators

| Operator | Method name |
|----------|------------|
| `+` | `op_add` |
| `-` | `op_sub` |
| `*` | `op_mul` |
| `/` | `op_div` |
| `%` | `op_mod` |
| `==` | `op_eq` |
| `!=` | `op_neq` |
| `<` | `op_lt` |
| `>` | `op_gt` |
| `<=` | `op_le` |
| `>=` | `op_ge` |

### Unary and Index Operators

| Operator | Method name |
|----------|------------|
| unary `-` | `op_neg` |
| `[]` read | `op_index` |
| `[]` write | `op_index_set` |

### Example

```kei
struct Vec2 {
    x: int;
    y: int;

    fn op_add(self: Vec2, other: Vec2) -> Vec2 {
        return Vec2{ x: self.x + other.x, y: self.y + other.y };
    }

    fn op_eq(self: Vec2, other: Vec2) -> bool {
        return self.x == other.x && self.y == other.y;
    }

    fn op_neg(self: Vec2) -> Vec2 {
        return Vec2{ x: 0 - self.x, y: 0 - self.y };
    }
}

fn main() -> int {
    let a = Vec2{ x: 1, y: 2 };
    let b = Vec2{ x: 3, y: 4 };
    let c = a + b;        // calls op_add
    let eq = a == b;      // calls op_eq
    let neg = -a;         // calls op_neg
    return 0;
}
```

> **Note**: Operator overloading type-checks correctly but the KIR/backend do not yet lower operator method calls. This code will pass `--check` but cannot be compiled with `--build` or `--run`.

---

## Lifecycle Hooks

Kei structs can define lifecycle hooks that are called automatically by the compiler.

### `__destroy` — Cleanup at Scope Exit

Called when a variable goes out of scope or is overwritten by reassignment:

```kei
import { print } from io;

struct Resource {
    id: int;

    fn __destroy(self: Resource) {
        print("destroying resource ");
        print(self.id);
    }
}

fn main() -> int {
    let r = Resource{ id: 1 };
    print("using resource");
    // r.__destroy() called automatically here (scope exit)
    return 0;
}
```

Output:

```
using resource
destroying resource 1
```

### `__oncopy` — Custom Copy Behavior

Called when a struct value is copied (assignment, parameter passing, return):

```kei
import { print } from io;

struct Counter {
    val: int;

    fn __oncopy(self: Counter) -> Counter {
        print("copying");
        return Counter{ val: self.val + 100 };
    }

    fn __destroy(self: Counter) {
        print("destroy ");
        print(self.val);
    }
}

fn main() -> int {
    let a = Counter{ val: 42 };
    let b = a;           // triggers __oncopy
    print(a.val);        // 42
    print(b.val);        // 142 (100 added by oncopy)
    return 0;
}
```

### Auto-Generated Hooks

If a struct contains `string` fields or fields of types that have lifecycle hooks, the compiler automatically generates `__destroy` and `__oncopy`:

```kei
struct User {
    name: string;
    email: string;
    age: int;
}

fn main() -> int {
    let a = User{ name: "Alice", email: "alice@example.com", age: 30 };
    let b = a;    // auto __oncopy: string fields deep-copied
    // auto __destroy called for both a and b at scope exit
    return 0;
}
```

You don't need to write hooks yourself for structs with `string` fields — the compiler handles it. This also works recursively for nested structs:

```kei
struct Address {
    city: string;
}

struct Person {
    name: string;
    addr: Address;   // Address has string field → auto hooks
}
// Person gets auto-generated __destroy and __oncopy
// that handle both its own string field and Address's hooks
```

### Reassignment Calls `__destroy`

When you reassign a variable, the old value's `__destroy` is called before the new value is stored:

```kei
let r = Resource{ id: 1 };
r = Resource{ id: 2 };    // __destroy(id:1) called, then new value stored
```

---

## Memory Management

Kei is stack-first — all struct data lives on the stack by default. Heap allocation is explicit and requires `unsafe`.

### `alloc` and `free`

```kei
fn main() -> int {
    unsafe {
        let buf = alloc(1024);   // allocate 1024 bytes, returns ptr<u8>
        // use buf...
        free(buf);               // free the memory
    }
    return 0;
}
```

### `sizeof`

Returns the size of a type in bytes:

```kei
let size = sizeof(int);    // 4 (on most platforms)
let ps = sizeof(Point);    // size of the Point struct
```

### `unsafe` Blocks

These operations require `unsafe`:

- `alloc` / `free`
- Calling `extern fn` functions
- Address-of (`&x`)
- Pointer dereference (`p.*`)
- Pointer casts

```kei
fn main() -> int {
    let x: int = 42;

    unsafe {
        let p: ptr<int> = &x;     // address-of
        let val = p.*;             // dereference
        print(val);                // 42
    }

    return 0;
}
```

### Standard Library Memory Helpers

The `mem` module provides safe wrappers so callers don't need their own `unsafe`:

```kei
import { alloc, dealloc, copy, set } from mem;

fn main() -> int {
    let buf = alloc(256 as usize);     // allocate 256 bytes
    set(buf, 0, 256 as usize);        // zero the memory
    dealloc(buf as ptr<void>);         // free it
    return 0;
}
```

---

## Implicit Conversions and Literal Suffixes

### Implicit Widening

Kei allows implicit widening conversions where no data is lost:

```kei
let x: i32 = 42;
let y: i64 = x;      // i32 → i64 is fine

let a: u8 = 255;
let b: u16 = a;      // u8 → u16 is fine
```

### Explicit Casts

Use `as` for explicit type conversion:

```kei
let x: i32 = 42;
let f: f64 = x as f64;     // int to float
let n: i32 = 3.14 as i32;  // float to int (truncates)
let u: usize = x as usize; // signed to unsigned
```

### Numeric Literal Suffixes

Specify the type of a numeric literal directly:

```kei
let a = 42i32;       // i32
let b = 100i64;      // i64
let c = 255u8;       // u8
let d = 1000u32;     // u32
let e = 3.14f32;     // f32
let f = 2.718f64;    // f64
```

Without a suffix, integer literals default to `i32` and float literals default to `f64`.

### Number Literal Formats

```kei
let decimal = 1_000_000;       // underscores for readability
let hex = 0xFF_EE_DD;          // hexadecimal
let binary = 0b1010_0001;      // binary
let octal = 0o755;             // octal
let sci = 1.5e10;              // scientific notation
let neg_exp = 2.5e-3;          // negative exponent
```

---

## Move Semantics

The `move` keyword transfers ownership of a value without triggering `__oncopy`. After a move, the source variable is invalidated — using it is a compile error.

### Moving Variables

```kei
struct Data {
    value: int;
}

fn main() -> int {
    let a = Data{ value: 42 };
    let b = move a;         // bitwise copy, no __oncopy
    // print(a.value);      // compile error: use of moved value
    print(b.value);         // 42
    return 0;
}
```

### Moving into Function Parameters

```kei
fn consume(move d: Data) -> int {
    return d.value;
}

fn main() -> int {
    let d = Data{ value: 42 };
    let result = consume(move d);
    // d is now invalid — can't use it
    return result;
}
```

> **Note**: `move` is parsed and checked (use-after-move is a compile error) but does not yet affect codegen — the lifecycle elision optimization is not implemented in the backend.

---

## The Standard Library

### `io` — Input/Output

```kei
import { print, newline, putc, getc } from io;
```

| Function | Description |
|----------|-------------|
| `print(value: string)` | Print a string |
| `print(value: i32)` | Print an i32 |
| `print(value: i64)` | Print an i64 |
| `print(value: f64)` | Print an f64 |
| `print(value: f32)` | Print an f32 |
| `print(value: bool)` | Print a bool |
| `newline()` | Print a newline character |
| `putc(c: i32)` | Print a single character by ASCII code |
| `getc() -> i32` | Read a character from stdin |

`print` is overloaded for each type. There is no `println` — use `print(...)` followed by `newline()`.

### `mem` — Memory Utilities

```kei
import { alloc, dealloc, copy, set } from mem;
```

| Function | Description |
|----------|-------------|
| `alloc(count: usize) -> ptr<u8>` | Allocate `count` bytes |
| `dealloc(p: ptr<void>)` | Free memory |
| `copy(dest: ptr<u8>, src: ptr<u8>, n: usize)` | Copy `n` bytes |
| `set(dest: ptr<u8>, c: i32, n: usize)` | Fill `n` bytes with value `c` |

These are safe wrappers — they call C stdlib functions internally so callers don't need their own `unsafe` blocks.

---

## Operators Reference

### Arithmetic

`+`, `-`, `*`, `/`, `%`, `++` (postfix), `--` (postfix)

### Comparison

`==`, `!=`, `<`, `<=`, `>`, `>=`

### Logical

`&&`, `||`, `!`

### Bitwise

`&`, `|`, `^`, `~`, `<<`, `>>`

### Assignment

`=`, `+=`, `-=`, `*=`, `/=`, `%=`, `&=`, `|=`, `^=`, `<<=`, `>>=`

### Other

| Operator | Description |
|----------|-------------|
| `.` | Field access |
| `.*` | Pointer dereference |
| `&` | Address-of (unsafe) |
| `as` | Type cast |
| `..` | Exclusive range |
| `..=` | Inclusive range |
