# Types

Kei has a structured type system organized into primitive types, compound types, and user-defined types. All types fall into one of three memory categories: value types, reference types, or unsafe types.

## Primitive types

### Integer types

| Type    | Size    | Range                  |
|---------|---------|------------------------|
| `i8`    | 8 bits  | -128 to 127           |
| `i16`   | 16 bits | -32,768 to 32,767     |
| `i32`   | 32 bits | -2³¹ to 2³¹-1         |
| `i64`   | 64 bits | -2⁶³ to 2⁶³-1         |
| `isize` | Platform| Pointer-sized signed   |
| `u8`    | 8 bits  | 0 to 255              |
| `u16`   | 16 bits | 0 to 65,535           |
| `u32`   | 32 bits | 0 to 2³²-1            |
| `u64`   | 64 bits | 0 to 2⁶⁴-1            |
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

Unmanaged pointer that does not own memory. Only allowed in `unsafe struct` fields and local variables within unsafe contexts.

```kei
let x = 42;
let p: ptr<int> = &x;
let value = p.*;        // dereference

// Only in unsafe structs
unsafe struct RawBuffer {
    data: ptr<u8>;
    size: usize;
}
```

**Safety:** No automatic cleanup, no bounds checking, no lifetime validation.

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

Growable, heap-allocated array that owns its memory:

```kei
let nums: dynarray<int> = [1, 2, 3];
nums.push(4);
nums.pop();
let len = nums.len;     // runtime value
```

- **Memory:** Heap-allocated with automatic cleanup
- **Category:** Reference type (has compiler-generated `__free`)
- **Internal structure:** `{ data: ptr<T>, len: usize, cap: usize }`

When `T` is a `ref struct` or `unsafe struct`, the `__free` function iterates through all elements and calls their cleanup methods. This is monomorphized at the KIR level for efficiency.

### `slice<T>` — Non-owning view

A view into contiguous memory that does not own the data:

```kei
let arr = [1, 2, 3, 4, 5];
let s: slice<int> = arr[1:4];   // view of elements 1, 2, 3
let len = s.len;
```

- **Memory:** Does not own memory
- **Internal structure:** `{ ptr: ptr<T>, len: usize }`
- **Restrictions:** 
  - Cannot outlive source data
  - Cannot be returned from functions  
  - Cannot be stored in `ref struct` fields

## String types

### `str` — Non-owning string view

Read-only string view, equivalent to `slice<u8>`:

```kei
let s: str = "hello";
let sub: str = s[1:4];     // "ell" - zero-cost slice

fn greet(name: str) {
    print("Hello, " + name);
}
```

- **Memory:** Points to static data (for literals) or borrowed data
- **Performance:** Zero-cost slicing and passing
- **Same restrictions as `slice<T>`**

String literals produce `str` values that point to static binary data.

### `string` — Owning dynamic string

Heap-allocated, growable string:

```kei
let s: string = string.from("hello");
s.push(" world");
let view: str = s.as_str();
```

- **Memory:** Heap-allocated with automatic cleanup
- **Category:** Reference type (internally implemented as `ref struct`)

## Type comparison

| Category | Stack | Heap | Owns Memory | Auto Cleanup | Can Contain `ptr<T>` |
|----------|-------|------|-------------|--------------|---------------------|
| `struct` | ✓ | ✗ | N/A | ✗ | ✗ |
| `ref struct` | ✗ | ✓ | ✓ | ✓ | ✗ |
| `unsafe struct` | ✗ | ✓ | ✓ | Manual | ✓ |
| `array<T,N>` | ✓ | ✗ | N/A | ✗ | ✗ |
| `dynarray<T>` | ✗ | ✓ | ✓ | ✓ | ✗ |
| `slice<T>` | ✓ | ✗ | ✗ | ✗ | ✗ |

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

Type aliases are completely transparent - they create no new type, just an alternative name.

## Type conversion

### Implicit conversions
- Integer types promote to larger sizes when safe
- Arrays convert to slices automatically
- Owning strings convert to string views

```kei
let small: i32 = 42;
let large: i64 = small;     // implicit widening

let arr = [1, 2, 3];
let slice: slice<int> = arr; // automatic conversion

let owned: string = string.from("hello");
let view: str = owned;       // automatic conversion
```

### Explicit conversions
```kei
let a: i64 = 1000;
let b: i32 = a as i32;      // explicit cast (may truncate)
let c: f64 = a as f64;      // int to float
```

---

This type system provides memory safety through the three-category approach while maintaining the performance characteristics needed for systems programming.