# Types

Kei has a structured type system organized into primitive types, compound types, and user-defined types. All types fall into one of two memory categories: value types (`struct`) and unsafe types (`unsafe struct`). Both live on the stack with lifecycle hooks for cleanup and copying.

## Language types vs stdlib types

A few types in this document are **compiler-known** — the parser has dedicated syntax
for them and the checker reasons about them directly. Everything else — including
`string`, `array<T>` (heap), `List<T>`, and `Shared<T>` — is an **`unsafe struct`
written in Kei itself** and lives in the standard library. Having a small language
core and a larger library is deliberate: it keeps the compiler tight and lets the
stdlib evolve without breaking the frontend.

| Type                | Defined in | Notes                                      |
|---------------------|------------|--------------------------------------------|
| primitives (`i32`, `f64`, `bool`, …) | compiler | builtin                                    |
| `ptr<T>`            | compiler   | raw pointer, non-null                      |
| `T?` (nullable)     | compiler   | see **Nullability**                        |
| `array<T, N>`       | compiler   | fixed-size stack array                     |
| `slice<T>`          | compiler   | non-owning view                            |
| `string`            | stdlib     | CoW refcounted byte string                 |
| `array<T>`          | stdlib     | heap array, CoW                            |
| `List<T>`           | stdlib     | growable, deep-copy                        |
| `Shared<T>`         | stdlib     | refcounted handle                          |

## View vs owned

For every type that owns heap memory, there is a **view** counterpart — `slice<T>`
for arrays, `ref T` for single values (see **Safe references** below). Views never
destroy, never copy.

**View safety rule (enforced without a borrow checker):** a view can only be
constructed from a source whose lifetime the compiler can trivially see — stack
values, string literals / `.rodata`, or another view. Sources whose backing buffer
outlives their struct (the CoW heap types — `string`, `array<T>`, `List<T>`,
`Shared<T>`) **do not produce views**; they produce a fresh owned handle with a
bumped refcount.

| Source                           | Sub-range / borrow produces | Why |
|----------------------------------|-----------------------------|-----|
| Stack array `array<T, N>`        | `slice<T>`                  | source lifetime = scope, trivially checked |
| String literal, `.rodata`        | `string` (or `slice<u8>`)   | `.rodata` is permanent                     |
| Another `slice<T>`               | `slice<T>`                  | inherits source's scope bound              |
| Stack value                      | `ref T`                     | source lifetime = scope                    |
| **`string` (stdlib, CoW)**       | **`string`**                | must bump refcount; shares buffer, no UAF  |
| **`array<T>` (stdlib, CoW)**     | **`array<T>`**              | same story                                 |
| **`List<T>` (stdlib, owned)**    | copy or arena-slice         | no free lunch — explicit                   |

Concretely: `let sub = s[6..]` where `s: string` returns a **`string`**, not a
`slice<u8>`. The internal representation of `string` is already `{ptr, offset,
len, cap, count}`, so the substring is zero-copy — it's just offset/len
adjustment plus a refcount bump. But it's a tracked owner, not a dangling view.

## Primitive types

### Integer types

| Type    | Size    | Range                  |
|---------|---------|------------------------|
| `i8`    | 8 bits  | -128 to 127           |
| `i16`   | 16 bits | -32,768 to 32,767     |
| `i32`   | 32 bits | -2^31 to 2^31-1         |
| `i64`   | 64 bits | -2^63 to 2^63-1         |
| `isize` | Platform| Pointer-sized signed   |
| `u8`    | 8 bits  | 0 to 255              |
| `u16`   | 16 bits | 0 to 65,535           |
| `u32`   | 32 bits | 0 to 2^32-1            |
| `u64`   | 64 bits | 0 to 2^64-1            |
| `usize` | Platform| Pointer-sized unsigned |

#### Built-in aliases

| Alias    | Equivalent | Notes |
|----------|-----------|-------|
| `byte`   | `u8`      | |
| `short`  | `i16`     | |
| `int`    | `i32`     | Default for integer literals |
| `long`   | `i64`     | |

### Floating-point types

| Type  | Size    | Precision |
|-------|---------|-----------|
| `f32` | 32 bits | IEEE 754 single |
| `f64` | 64 bits | IEEE 754 double |

#### Built-in aliases

| Alias    | Equivalent | Notes |
|----------|-----------|-------|
| `float`  | `f32`     | |
| `double` | `f64`     | Default for float literals |

### Other primitive types

| Type   | Description |
|--------|-------------|
| `bool` | Boolean value (`true` or `false`) |
| `c_char` | C-compatible character type |

### Type inference defaults
- Integer literals default to `int` (`i32`)
- Floating-point literals default to `double` (`f64`)

```kei
let a = 42;     // int (i32)
let b = 3.14;   // double (f64)
let c = 42u32;  // u32 (explicit suffix)
let d = 2.5f32; // f32 (explicit suffix)
```

## Pointer and reference types

Kei has **three** pointer-like types, each with a clear purpose:

| Type          | Safe? | Mutable? | Non-null? | Scope-bound? | Use for                          |
|---------------|-------|----------|-----------|--------------|----------------------------------|
| `ref T`       | yes   | no       | yes       | yes          | read-only borrow, param types    |
| `ref mut T`   | yes   | yes      | yes       | yes          | mutable borrow, mutating methods |
| `ptr<T>`      | no    | yes      | yes       | no           | FFI, `unsafe struct` internals   |

Picking the right one is almost mechanical: prefer `ref T`, reach for `ref mut T`
when the receiver must mutate, and `ptr<T>` only in `unsafe` code.

### `ptr<T>` — Raw pointer (unsafe, non-null)

Unmanaged pointer that does not own memory. Only usable in `unsafe struct`
fields and `unsafe` blocks. No automatic cleanup, no bounds checking, no
lifetime validation — this is a direct C pointer.

`ptr<T>` is **non-null at the type level**. To express a pointer that may be
absent, use the nullable suffix: `ptr<T>?` (see **Nullability** below); its
representation is still a plain C pointer (null = absent).

```kei
// Only in unsafe structs
unsafe struct RawBuffer {
    data: ptr<u8>;      // must always be valid
    size: usize;
}
```

### `ref T` — Safe immutable reference

Non-null, read-only, scope-bound reference to a value. Usable in **safe code**,
no `unsafe` block needed to read. The compiler rejects writes through a `ref T`
and rejects constructing a `ref T` from something whose lifetime isn't visible
(i.e. not a value in the current or an enclosing scope).

```kei
fn handleRoot(app: ref App, req: Request) -> Response {
    let user = app.db.lookup(req.userId);   // read: OK
    // app.db = other;                       // ERROR: no writes through `ref App`
    return Response{ body: user.name };
}

let app = App.new();
let r = handleRoot(&app, req);              // &app in safe code = ref App
```

`ref T` compiles to `const T*` — same C-level representation as `ptr<T>`, but
with compile-time read-only + scope rules layered on top.

### `ref mut T` — Safe mutable reference

Same as `ref T` but writes through it are permitted. Mostly used for methods
that mutate their receiver:

```kei
struct Counter {
    value: int;

    fn increment(self: ref mut Counter) {
        self.value += 1;        // no unsafe block needed
    }
}

let mut c = Counter{ value: 0 };
c.increment();                  // compiler inserts &mut c
```

### v1 restrictions on `ref`

`ref T` and `ref mut T` are **parameter types and local bindings only** in v1.
They may NOT appear as:
- struct fields (would require real lifetime tracking),
- return types (same reason),
- array or collection element types.

These restrictions let the "scope-bound" rule be a trivial syntactic check
instead of a full borrow analysis. Future versions may relax them once a
concrete lifetime story is in place.

### When to use `ptr<T>` vs `ref T`

- **`ref T`** is the default for safe code: methods, handler parameters, anywhere
  a borrow is appropriate.
- **`ptr<T>`** is for the two cases safe references can't cover: FFI boundaries
  (`extern fn` signatures) and internal pointers inside `unsafe struct`
  implementations (`Shared<T>` etc.).
- **Do not use `ptr<T>` in ordinary `fn` signatures** — this was an earlier spec
  ambiguity. It's now unsafe-only.

### Taking references: `&expr` and `&mut expr`

- `&expr` in safe code produces `ref T`.
- `&mut expr` in safe code produces `ref mut T`.
- `&expr` inside an `unsafe` block produces `ptr<T>` (raw address-of).

At method call sites, `&` is inserted implicitly when the method declares
`self: ref Self` or `self: ref mut Self` — users write `counter.increment()`,
not `(&mut counter).increment()`.

## Nullability

`T?` is the suffix form of "optional / may be absent." Reading is natural —
`string?` is "a string, or nothing"; `ptr<User>?` is "a pointer to a User, or
nothing."

```kei
let name: string? = maybeLookup(id);    // may be absent
let node: ptr<Node>? = findChild(tree); // may be absent

// Must check before use — compiler enforces
if name != null {
    print(name);     // narrowed to `string` here
}
```

### Representation and niche optimization

`T?` is laid out to cost nothing when `T` has an unused bit-pattern ("niche")
that can stand in for the absent state; otherwise a one-byte tag is added.

| Type     | `T?` representation                              |
|----------|--------------------------------------------------|
| `ptr<T>?`| plain C pointer; null pointer = absent           |
| `string?`| inherits string layout; `len = usize::MAX` = absent |
| `slice<T>?` | slice layout; null pointer = absent           |
| `i32?`, `bool?`, other primitives | `{ tag: u8, value: T }` |
| user struct with no niche | `{ tag: u8, value: T }`               |

Niches let you promise "zero cost when there's room" while keeping the type rule
uniform — the user writes `?`, the compiler picks the cheapest legal layout.

### The rules

- Bare `ptr<T>`, `string`, `slice<T>`, `List<T>`, user structs etc. are **never
  null / never absent**. `null` is not a value of those types.
- `T?` is the only way to express absence. `null` is the literal for the absent
  state of any `T?`.
- Accessing a `T?` as if it were `T` is a type error. Narrow with `if x != null { … }`
  or pattern-match.

## Generics

Kei supports generic types and functions through compile-time monomorphization. Generic code is instantiated for each concrete type at compile time, producing specialized, efficient code.

### Generic functions

```kei
fn max<T>(a: T, b: T) -> T {
    return if a > b { a } else { b };
}

let x = max<int>(10, 20);       // monomorphized to max_int
let y = max<f64>(3.14, 2.71);   // monomorphized to max_f64
```

### Generic structs

```kei
struct Pair<A, B> {
    first: A;
    second: B;
}

let p = Pair<int, string>{ first: 42, second: "hello" };
```

### Generic unsafe structs

```kei
unsafe struct Shared<T> {
    ptr: ptr<T>;
    count: ptr<u32>;

    fn __oncopy(self: Shared<T>) -> Shared<T> {
        self.count.increment();
        return self;
    }

    fn __destroy(self: Shared<T>) {
        self.count.decrement();
        if (self.count.value == 0) {
            self.ptr.destroy();
            free(self.ptr);
            free(self.count);
        }
    }
}
```

### Monomorphization

All generic types and functions are monomorphized at compile time:

```kei
// Source code
let a = Pair<int, bool>{ first: 1, second: true };
let b = Pair<string, f64>{ first: "hi", second: 3.14 };

// Compiler generates two separate struct types:
// Pair_int_bool { first: int; second: bool; }
// Pair_string_f64 { first: string; second: f64; }
```

No runtime overhead — generics are a purely compile-time feature.

## Array and collection types

### `array<T, N>` — Fixed-size array

Compile-time sized arrays that live on the stack:

```kei
let a: array<int, 3> = [1, 2, 3];
let x = a[0];           // element access
let n = a.len;          // compile-time constant (3)
```

- **Memory:** Stack-allocated
- **Safety:** Bounds-checked in debug builds
- **Performance:** Zero overhead, compiles to C array

### `array<T>` — Heap-allocated array (stdlib)

Heap-allocated array with runtime-determined size, CoW semantics. Not resizable —
use `List<T>` for growable collections. **Defined in stdlib** as an `unsafe struct`;
the `array<T>` spelling is not a built-in type constructor. See
[`spec/08-memory.md`](./08-memory.md) for the internal layout and lifecycle contract.

```kei
let nums: array<int> = array.of(1, 2, 3);
let len = nums.len;
let x = nums[0];
let copy = nums;                // refcount++ (CoW, no data copy)
```

### `List<T>` — Growable collection (stdlib)

Resizable list for when elements need to be added or removed. **Defined in stdlib.**
See [`spec/08-memory.md`](./08-memory.md) for layout.

```kei
let items = List.of<int>();
items.push(1);
items.push(2);
items.pop();
```

### `slice<T>` — Non-owning view

A view into contiguous memory that does not own the data:

```kei
let arr = [1, 2, 3, 4, 5];
let s: slice<int> = arr[1..4];   // view of elements 1, 2, 3
let len = s.len;
```

- **Memory:** Does not own memory
- **Read-only:** Elements cannot be modified through a slice
- **Internal structure:** `{ ptr: ptr<T>, len: usize }`
- **Restrictions:**
  - Cannot outlive source data
  - Cannot be returned from functions
  - Cannot be stored in struct fields

## String type

### `string` — CoW byte string (stdlib)

Kei has one user-facing string type. It is **defined in stdlib** as an `unsafe
struct` using CoW refcount semantics. The compiler knows enough about `string`
to lower string literals and indexing, but the implementation is Kei code.

```kei
let s = "hello";              // string literal -> string value (rodata-backed)
let sub = s[6..];             // substring is a slice<u8> view — no refcount change
let copy = s;                 // __oncopy: refcount++, no data copy
```

**Contract (users can rely on these):** strings are immutable from the outside —
`s[i] = x` is not a valid operation. Building strings uses `StringBuilder` (or
`List<u8>`); the result is converted to `string` once. See
[`spec/08-memory.md`](./08-memory.md) for internal layout and the CoW invariants
the stdlib implementation is required to uphold.

## Type comparison

| Category | Location | Owns Memory | Lifecycle Hooks | Can Contain `ptr<T>` |
|----------|----------|-------------|-----------------|---------------------|
| `struct` | Stack | N/A | Auto-generated | No |
| `unsafe struct` | Stack | Manual | User-defined (required with `ptr<T>`) | Yes |
| `array<T,N>` | Stack | N/A | Per-element | No |
| `slice<T>` | Stack (view) | No | None | No |
| `array<T>` (stdlib) | Stack + Heap | Yes (CoW) | User-defined | No |
| `List<T>` (stdlib) | Stack + Heap | Yes | User-defined | No |
| `string` (stdlib) | Stack + Heap | Yes (CoW) | User-defined | No |

## Special types

### `void`

Represents the absence of a return value. Implied when no `-> Type` is specified:

```kei
fn doSomething() {          // returns void
    print("doing something");
}

fn explicit() -> void {     // equivalent
    print("explicit void");
}
```

### `null`

`null` is the literal for the absent state of any nullable type `T?`. It is **not**
a value of non-nullable types — `ptr<int> = null` is a type error; use `ptr<int>? = null`.

```kei
let p: ptr<int>? = null;    // nullable pointer, absent
if p != null {
    *p = 42;                 // narrowed to ptr<int>, safe to deref
}
```

## Type aliases

Create alternative names for existing types:

```kei
type Bytes = slice<u8>;
type UserId = int;       // transparent, fully interchangeable

fn processUser(id: UserId) { /* ... */ }
let user_id: UserId = 42;
let regular_int: int = user_id;  // allowed - same underlying type
```

Type aliases are completely transparent — they create no new type, just an alternative name.

## Type conversion

### Implicit conversions
- Integer types promote to larger sizes when safe
- Arrays convert to slices automatically

```kei
let small: i32 = 42;
let large: i64 = small;     // implicit widening

let arr = [1, 2, 3];
let slice: slice<int> = arr; // automatic conversion
```

### Explicit conversions
```kei
let a: i64 = 1000;
let b: i32 = a as i32;      // explicit cast (may truncate)
let c: f64 = a as f64;      // int to float
```

---

This type system provides memory safety through the two-category approach with lifecycle hooks, while maintaining the performance characteristics needed for systems programming. Generics enable code reuse through compile-time monomorphization with zero runtime overhead.
