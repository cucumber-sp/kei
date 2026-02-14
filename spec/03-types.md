# Types

Kei has a structured type system organized into primitive types, compound types, and user-defined types. All types fall into one of two memory categories: value types (`struct`) and unsafe types (`unsafe struct`). Both live on the stack with lifecycle hooks for cleanup and copying.

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

## Pointer types

### `ptr<T>` — Raw pointer

Unmanaged pointer that does not own memory. Only allowed in `unsafe struct` fields and `unsafe` blocks.

```kei
// Only in unsafe structs
unsafe struct RawBuffer {
    data: ptr<u8>;
    size: usize;
}
```

**Safety:** No automatic cleanup, no bounds checking, no lifetime validation.

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
            c_free(self.ptr);
            c_free(self.count);
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

### `dynarray<T>` — Dynamic array

Growable, heap-allocated array that owns its memory. Implemented as `unsafe struct` in stdlib:

```kei
let nums: dynarray<int> = [1, 2, 3];
nums.push(4);
nums.pop();
let len = nums.len;     // runtime value
```

- **Memory:** Heap-allocated buffer with automatic cleanup via `__destroy`
- **Copying:** `__oncopy` increments internal refcount (COW semantics)
- **Internal structure:** `{ data: ptr<T>, len: usize, cap: usize, count: ptr<u32> }`

### `slice<T>` — Non-owning view

A view into contiguous memory that does not own the data:

```kei
let arr = [1, 2, 3, 4, 5];
let s: slice<int> = arr[1..4];   // view of elements 1, 2, 3
let len = s.len;
```

- **Memory:** Does not own memory
- **Internal structure:** `{ ptr: ptr<T>, len: usize }`
- **Restrictions:**
  - Cannot outlive source data
  - Cannot be returned from functions
  - Cannot be stored in struct fields

## String type

### `string` — The only string type

Kei has a single `string` type with Copy-on-Write (COW) semantics. It is implemented as an `unsafe struct` in the standard library.

```kei
let s = "hello";              // string literal -> string value
let sub = s[6..];             // substring, shares buffer (refcount++)
let copy = s;                 // refcount++, no data copy
s.push("!");                  // COW: if refcount > 1, copies buffer first
```

- **Location:** Struct lives on the stack, buffer data on the heap
- **Copying:** `__oncopy` increments internal refcount
- **Mutation:** Copy-on-Write — copies buffer only when mutating with shared references
- **Internal structure:** `{ ptr: ptr<u8>, offset: usize, len: usize, cap: usize, count: ptr<u32> }`

String literals produce `string` values pointing to static data. Mutating a literal-backed string triggers COW — the static data is copied to a heap buffer.

## Type comparison

| Category | Location | Owns Memory | Lifecycle Hooks | Can Contain `ptr<T>` |
|----------|----------|-------------|-----------------|---------------------|
| `struct` | Stack | N/A | Auto-generated | No |
| `unsafe struct` | Stack | Manual | User-defined | Yes |
| `array<T,N>` | Stack | N/A | Per-element | No |
| `dynarray<T>` | Stack (struct) + Heap (buffer) | Yes | User-defined (stdlib) | No |
| `slice<T>` | Stack | No | None | No |
| `string` | Stack (struct) + Heap (buffer) | Yes | User-defined (stdlib) | No |

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

Type of the null pointer literal:

```kei
let p: ptr<int> = null;
if (p != null) {
    // safe to dereference
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
