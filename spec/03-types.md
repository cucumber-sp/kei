# Types

Kei has a structured type system organized into primitive types, compound types, and user-defined types. All types fall into one of two memory categories: value types (`struct`) and unsafe types (`unsafe struct`). Both live on the stack with lifecycle hooks for cleanup and copying.

## Language types vs stdlib types

A few types are **compiler-known** — the parser has dedicated syntax for them
and the checker reasons about them directly. Everything else — `Array<T>`
(heap), `List<T>`, `Shared<T>` — is an **`unsafe struct` written in Kei
itself** and lives (or will live) in the standard library. Having a small
language core and a larger library is deliberate: it keeps the compiler tight
and lets the stdlib evolve without breaking the frontend.

| Type                                 | Defined in       | Notes                                                           |
|--------------------------------------|------------------|-----------------------------------------------------------------|
| primitives (`i32`, `f64`, `bool`, …) | compiler         | builtin                                                         |
| `ref T` / `readonly ref T`           | compiler         | safe reference — params and `unsafe struct` fields only         |
| `*T`                                 | compiler         | raw pointer (unsafe-only)                                       |
| `Optional<T>`                        | compiler intrinsic / stdlib | regular generic enum; replaces the old `T?` syntax. See **Optional and the absence of nulls**. |
| `inline<T, N>`                       | compiler         | fixed-size value-type bag of N elements                         |
| `string`                             | compiler today / stdlib goal | CoW refcounted byte string. Lowercase keyword alias for stdlib `String`. Today the runtime is in C (`runtime.h`); port deferred. |
| `Array<T>` / `array<T>` alias        | stdlib (planned) | heap array, CoW. `array<T>` is the lowercase keyword alias.     |
| `List<T>`                            | stdlib (planned) | growable, deep-copy                                             |
| `Shared<T>`                          | stdlib (planned) | refcounted handle                                               |

Naming conventions for stdlib types and member identifiers are pinned in
[`docs/design/naming-conventions.md`](../docs/design/naming-conventions.md);
the language reference for the pointer/reference model is in
[`docs/design/ref-redesign.md`](../docs/design/ref-redesign.md).

## View vs owned

The "view counterpart" model is `ref T` only. There is **no** `slice<T>`
type: refcounted owning types (`String`, `Array<T>`) return *the same type*
on subranges (cheap because the buffer is shared via refcount with offset/
len adjusted), and `ref T` covers the "non-owning reference into a stack-
bound source" case.

| Source                           | Sub-range / borrow produces | Why                                       |
|----------------------------------|-----------------------------|-------------------------------------------|
| Inline array `inline<T, N>`      | indexed access; `ref T`-typed param to take a borrow | source lifetime = scope |
| String literal, `.rodata`        | `string` (zero-copy)        | `.rodata` is permanent                    |
| Stack value                      | `ref T` (param-only)        | source lifetime = scope                   |
| **`String` (stdlib, CoW)**       | **`String`**                | bumps refcount; shares buffer             |
| **`Array<T>` (stdlib, CoW)**     | **`Array<T>`**              | same story                                |
| **`List<T>` (stdlib, owned)**    | copy or arena-slice         | no free lunch — explicit                  |

Concretely: `let sub = s[6..]` where `s: string` returns a **`string`**,
not a separate view type. The intended representation of `String` is
`{buffer: Shared<U8Buffer>, offset: usize, len: usize}`, so the substring
is zero-copy — offset/len adjustment plus a `Shared<U8Buffer>` refcount bump.
The current C runtime layout is simpler (`{data, len, cap, ref}`) and
substring deep-copies; the user-facing type rule still holds.

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

Kei has a small set of pointer-like types modelled on C# `ref` / `in`
parameters:

| Type             | Safe? | Mutable through? | Auto-deref | Where it appears                                                          |
|------------------|-------|------------------|------------|---------------------------------------------------------------------------|
| `ref T`          | yes   | yes              | yes        | function/method parameter types; `unsafe struct` field types              |
| `readonly ref T` | yes   | no               | yes (read) | function/method parameter types; `unsafe struct` field types              |
| `*T`             | no    | yes              | no         | `unsafe struct` field types; locals inside `unsafe`; `extern fn` signatures |

Picking the right one is mechanical: prefer `ref T` for params that mutate,
`readonly ref T` for read-only params (≈ C# `in`), and `*T` only in unsafe
code (FFI, raw pointer arithmetic, internal layout of stdlib `unsafe struct`s).

### `ref T` — Safe mutable reference (≈ C# `ref`)

Non-null, scope-bound reference to a value. The compiler treats it as the
underlying T at every use site (auto-deref on read; auto-deref on write,
which fires the destroy-then-write-then-oncopy lifecycle protocol on the
pointee). Adding `ref` to a parameter or field doesn't change how callers
or method bodies read or write it; it changes how the compiler lowers it
(slot becomes a pointer) and what positions it's legal in.

```kei
struct Item { value: i32 }

fn read(x: ref Item) -> i32 {
    return x.value;             // x.value reads from *x, returns i32 (auto-deref)
}

struct Counter {
    value: int;

    fn increment(self: ref Counter) {
        self.value += 1;        // auto-deref + lifecycle on the pointee
    }
}

let c = Counter{ value: 0 };
c.increment();                  // compiler inserts &c at the call site
```

`ref T` compiles to `T*` at the C level. Auto-deref insertion is a
front-end transform; nothing about the call ABI changes.

### `readonly ref T` — Safe immutable reference (≈ C# `in`)

Same as `ref T` but writes through the reference are rejected:

```kei
fn show(x: readonly ref Item) -> i32 {
    return x.value;             // OK: reads auto-deref
    // x = Item{...};             // ERROR: readonly ref forbids write-through
}
```

The `readonly` prefix on a `ref T` parameter or `unsafe struct` field
exists purely to communicate (and enforce) "this code does not mutate
through the ref." It compiles to `const T*` in C.

### `*T` — Raw pointer (unsafe-only)

Unmanaged pointer that does not own memory. Usable only inside `unsafe`
blocks, in `unsafe struct` field types, in locals inside `unsafe`, and in
`extern fn` signatures. No automatic cleanup, no bounds checking, no
lifetime validation, no auto-deref — this is a direct C pointer.

`*T` is **non-null at the type level**. To express a pointer that may
be absent, use `Optional<*T>` (see **Optional and the absence of nulls**
below). The runtime layout is still a plain C pointer — the compiler
picks `null` as the `None` representation via the niche optimization.

```kei
unsafe struct RawBuffer {
    data: *u8;          // must always be valid
    size: usize;
}

unsafe {
    let p: *i32 = &x;   // raw address-of (unsafe-only)
    let n = *p;         // explicit dereference; no auto-deref on `*T`
}
```

For accessing a field through a raw pointer, write `(*p).field` — the
arrow operator (`->`) is removed.

### Position restrictions on `ref T` / `readonly ref T`

`ref T` (and the `readonly ref T` form) are **parameter types and `unsafe
struct` field types only**. They may NOT appear as:

- function/method return types,
- safe `struct` field types,
- local variable bindings (`let r: ref T = …` is rejected),
- generic argument positions (e.g. `List<ref T>` is invalid),
- array or other collection element types,
- `static` global types.

Because `ref T` cannot appear in any position that could outlive its source,
it cannot be made to dangle. This is enforced syntactically — no analysis
pass needed.

### When to use `*T` vs `ref T`

- **`ref T`** / **`readonly ref T`** are the default for safe code:
  methods, handler parameters, `unsafe struct` slots that point into
  managed memory.
- **`*T`** is for the cases safe references can't cover: FFI boundaries
  (`extern fn` signatures), internal pointers inside `unsafe struct`
  implementations that need pointer arithmetic or null sentinels.

### Taking pointer values

- `&x` is **unsafe-only** and produces `*T`. `&` does not exist in safe code.
- `*p` is **unsafe-only** and dereferences a `*T` to T. There is no safe-
  code dereference operator (auto-deref on `ref T` is the safe alternative).

At method call sites taking `self: ref T`, the address is taken implicitly:
users write `counter.increment()`, not `(&counter).increment()`.

### `addr(field)` — slot lvalue for a `ref T` field (unsafe-only)

To manipulate the underlying pointer of a `ref T` field of an `unsafe
struct` (e.g. when constructing a `Shared<T>` and pointing its `value`
slot at heap memory), use `addr(field)`:

```kei
unsafe struct Shared<T> {
    refcount: ref i64;
    value: ref T;

    fn wrap(item: ref T) -> Shared<T> {
        let s = Shared<T>{};
        unsafe {
            let block = alloc<u8>(sizeof(i64) + sizeof(T));
            addr(s.refcount) = block as *i64;       // sets WHERE refcount points
            addr(s.value)    = (block + sizeof(i64)) as *T;
            s.refcount = 1;                         // writes through (auto-deref)
            init s.value = item;                    // initialization-write
        }
        return s;
    }
}
```

`addr(field)` returns an lvalue of type `*T` aliasing the raw pointer slot
underlying the `ref T` field. Assigning to `addr(field)` sets where the
reference points; dereferencing it (`*addr(field)`) accesses the pointed-to
memory without firing lifecycle hooks. Outside `unsafe`, `addr(...)` is a
compile error.

### `init field = value` — initialization-write (unsafe-only)

For uninitialized slots during construction. Skips the destroy step
(otherwise lifecycle would run on garbage), bitwise-writes the new T into
the slot, then runs `__oncopy` on the new T. Only valid inside `unsafe`
blocks. Inside `struct` literals, the compiler emits init semantics
implicitly for every field.

## Optional and the absence of nulls

Kei has no `null` literal at the source level and no nullable type
suffix. Absence is expressed through the regular enum `Optional<T>`:

```kei
enum Optional<T> {
    Some(value: T);
    None;
}
```

Used wherever a value may be absent — failed lookups, parse failures,
`Weak<T>::value()`, fields that are populated lazily:

```kei
let name: Optional<string> = maybeLookup(id);

match name {
    Some(s) => print("hi " + s),
    None    => print("anonymous"),
}
```

There is no shortcut to "just get the inner value" — every absent path
is something the type system makes you handle. Bare `*T`, `string`,
`List<T>`, `Array<T>`, user structs and so on are **never absent**;
their values always carry meaningful payload. To express "may be
absent", wrap in `Optional<…>`.

### Representation and niche optimization

`Optional<T>` is *one word* (zero overhead) whenever `T` has an unused
bit pattern that can stand in for `None`. Otherwise it carries a tag
byte:

| Type                  | `Optional<T>` representation                     |
|-----------------------|--------------------------------------------------|
| `Optional<*T>`        | plain C pointer; null pointer = `None` *(unsafe-only)* |
| `Optional<Shared<T>>` | pointer to control block; null = `None`         |
| `Optional<Weak<T>>`   | pointer to control block; null = `None`         |
| `Optional<string>`    | inherits string layout; `len = usize::MAX` = `None` |
| `Optional<bool>`      | one byte; non-`{0,1}` pattern = `None`          |
| `Optional<i32>` and other primitives without niches | `{ tag: u8, value: T }` |
| user struct with no niche | `{ tag: u8, value: T }`                     |

The user spelling is uniform; the compiler picks the cheapest legal
layout per instantiation. This matches Rust's "niche" optimization for
`Option<&T>`, `Option<Box<T>>`, etc.

### The rules

- `Optional<T>` is the only way to express absence at the source level.
- Bare types are never absent — the type system enforces that you can't
  read a "missing" `string` or `i32`.
- Accessing the inner value of an `Optional<T>` requires `match`/`if let`
  destructuring. There is no implicit unwrap.
- `Optional<*T>` and `Optional<Shared<T>>` are zero-overhead at runtime
  thanks to niche layout; you pay for absence only when there's no niche
  to claim.
- The KIR retains `const_null` / `null_check` ops because they operate
  on lowered byte representations. Source code never spells "null".

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
    refcount: ref i64;
    value: ref T;

    fn __oncopy(self: ref Shared<T>) {
        self.refcount += 1;
    }

    fn __destroy(self: ref Shared<T>) {
        self.refcount -= 1;
        if self.refcount == 0 {
            self.value.__destroy();
            unsafe { free(addr(self.refcount)); }
        }
    }
}
```

Lifecycle hooks take `self: ref Self` and return void; they mutate the
slot in place rather than returning a new value. See
[`spec/07-structures.md`](./07-structures.md) for the full ABI and
[`docs/design/ref-redesign.md`](../docs/design/ref-redesign.md) §3.1 for
the worked example.

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

### `inline<T, N>` — Fixed-size value-type array

Compile-time sized "bag of N elements" that lives inline wherever it is used —
on the stack as a local, or embedded directly in a struct field. Value-type:
copying an `inline<T, N>` copies all N elements element-by-element.

```kei
let a: inline<int, 3> = [1, 2, 3];
let x = a[0];           // element access
let n = a.len;          // compile-time constant (3)
```

- **Memory:** Stored inline (stack local, or in-place inside a struct/enum)
- **Safety:** Bounds-checked in debug builds
- **Performance:** Zero overhead, compiles to a C fixed-size array `T[N]`
- **Common use:** Buffers, matrices, small fixed-shape collections inside structs

### `Array<T>` / `array<T>` — Heap-allocated array (planned stdlib)

Heap-allocated array with runtime-determined size, CoW semantics. Not
resizable — use `List<T>` for growable collections. Designed as an
`unsafe struct` in stdlib; the `array<T>` spelling is the lowercase
keyword alias for the canonical `Array<T>` (see
[SPEC-STATUS.md](../SPEC-STATUS.md)). See
[`spec/08-memory.md`](./08-memory.md) for the planned internal layout and
lifecycle contract.

```kei
let nums: array<int> = Array.of(1, 2, 3);
let len = nums.len;
let x = nums[0];
let copy = nums;                // refcount++ (CoW, no data copy)
```

### `List<T>` — Growable collection (planned stdlib)

Resizable list for when elements need to be added or removed. Designed as
an `unsafe struct` in stdlib; not yet implemented. See
[`spec/08-memory.md`](./08-memory.md) for layout.

```kei
let items = List.of<int>();
items.pushBack(1);
items.pushBack(2);
items.popBack();
```

### Sub-ranges and views

There is no `slice<T>` view type. Sub-range semantics:

- **CoW types** (`String`, `Array<T>`): `s[start..end]` returns the same
  type with refcount bump and offset/len adjustment — buffer is shared.
- **`inline<T, N>`**: pass `ref inline<T, N>` to a helper or operate
  in-place with index arithmetic; the source's stack lifetime makes a
  borrow trivially safe.
- **C interop**: pass `*T` and `usize` separately in `extern fn`
  signatures. `unsafe`-only.

## String type

### `string` / `String` — CoW byte string

Kei has one user-facing string type, spelled `string` (lowercase keyword
alias) or `String` (canonical stdlib name). The runtime today is C code
in `runtime.h`; the target shape is a Kei `struct` in stdlib using a
`Shared<U8Buffer>` field for the heap bytes. Either way, the user-facing
semantics are identical:

```kei
let s = "hello";              // string literal -> String value (rodata-backed)
let sub = s[6..];              // substring is a String, sharing the buffer
let copy = s;                  // __oncopy: refcount++, no data copy
```

**Contract (users can rely on these):** strings are immutable from the
outside — `s[i] = x` is not a valid operation. Building strings uses
`StringBuilder` (or `List<u8>`); the result is converted to `string`
once. See [`spec/08-memory.md`](./08-memory.md) for internal layout and
the CoW invariants the implementation is required to uphold.

## Type comparison

| Category                    | Location                    | Owns Memory | Lifecycle Hooks                    | Can contain `*T` |
|-----------------------------|-----------------------------|-------------|------------------------------------|------------------|
| `struct`                    | Stack                       | N/A         | Auto-generated                     | No               |
| `unsafe struct`             | Stack                       | Manual      | User-defined (required with `*T`)  | Yes              |
| `inline<T,N>`               | Inline (stack or in-struct) | N/A         | Per-element                        | No               |
| `string`                    | Stack + Heap                | Yes (CoW)   | Built-in                           | No               |
| `Array<T>` (planned stdlib) | Stack + Heap                | Yes (CoW)   | User-defined                       | No               |
| `List<T>` (planned stdlib)  | Stack + Heap                | Yes         | User-defined                       | No               |

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

### Absence (no `null` literal)

There is no `null` keyword in Kei source. Absence is constructed with
`Optional<T>.None`:

```kei
unsafe {
    let p: Optional<*int> = Optional<*int>.None;
    match p {
        Some(raw) => *raw = 42,    // raw is *int, safe to deref
        None      => {}
    }
}
```

When the target type is unambiguous, the unqualified form is enough:

```kei
let p: Optional<*int> = None;
```

At the C ABI boundary `Optional<*T>` and `*T` are layout-compatible: the
`None` value is the zero pointer. `extern fn` signatures use
`Optional<*T>` for nullable C pointers and bare `*T` for non-null.

> Today the parser/checker still accept `T?` and the `null` literal,
> lowering them to nullable raw pointers. Both are deprecated and the
> rollout to `Optional<T>` is tracked in
> [SPEC-STATUS.md](../SPEC-STATUS.md).

## Type aliases

Create alternative names for existing types:

```kei
type Bytes = Array<u8>;
type UserId = int;       // transparent, fully interchangeable

fn processUser(id: UserId) { /* ... */ }
let userId: UserId = 42;
let regularInt: int = userId;  // allowed - same underlying type
```

Type aliases are completely transparent — they create no new type, just an alternative name.

## Type conversion

### Implicit conversions
- Integer types promote to larger sizes when safe.
- Stack values implicitly take their address when passed to a `ref T` /
  `readonly ref T` parameter (no `&` needed at the call site).

```kei
let small: i32 = 42;
let large: i64 = small;     // implicit widening

fn read(x: ref Item) -> i32 { return x.value; }
let it = Item{ value: 7 };
let v = read(it);            // implicit &it at the call site
```

### Explicit conversions
```kei
let a: i64 = 1000;
let b: i32 = a as i32;      // explicit cast (may truncate)
let c: f64 = a as f64;      // int to float
```

---

This type system provides memory safety through the two-category approach with lifecycle hooks, while maintaining the performance characteristics needed for systems programming. Generics enable code reuse through compile-time monomorphization with zero runtime overhead.
