# Structures

Structures are Kei's primary mechanism for organizing related data. They implement the two-tier memory model through two distinct structure types: `struct` and `unsafe struct`.

## Structure types overview

| Type            | Location | Assignment              | Lifecycle Hooks | Raw Pointers (`*T`) | `ref T` fields |
|-----------------|----------|-------------------------|-----------------|---------------------|----------------|
| `struct`        | Stack    | Copy (auto `__oncopy`)  | Auto-generated  | No                  | No             |
| `unsafe struct` | Stack    | Custom (`__oncopy`)     | User-defined    | Yes                 | Yes            |

Both types live on the stack. The key difference is that `unsafe struct`
can contain raw pointers (`*T`) and `ref T` / `readonly ref T` fields, and
requires user-defined lifecycle management.

---

## `struct` — Value types

Value types are stack-allocated and copied on assignment. The compiler
auto-generates lifecycle hooks.

```kei
struct Point {
    x: f64;
    y: f64;

    fn length(self: readonly ref Point) -> f64 {
        return sqrt(self.x * self.x + self.y * self.y);
    }

    fn translate(self: ref Point, dx: f64, dy: f64) {
        self.x += dx;
        self.y += dy;
    }

    fn make(x: f64, y: f64) -> Point {
        return Point{ x: x, y: y };
    }
}
```

### Method self types

Three forms, in preference order:

| Receiver form              | Meaning                                       | Call site compiler does |
|----------------------------|-----------------------------------------------|-------------------------|
| `self: readonly ref T`     | Read-only borrow (default for reads, ≈ C# `in`)  | implicit `&p`        |
| `self: ref T`              | Mutable borrow (default for mutations, ≈ C# `ref`)| implicit `&p`        |
| `self: T`                  | By-value (copy, or consume if `move` at call) | copy / move             |

```kei
let point = Point{ x: 1.0, y: 2.0 };
let len = point.length();     // implicit &point; readonly ref forbids writes
point.translate(5.0, 3.0);    // implicit &point; ref permits writes
```

### Auto-generated lifecycle hooks

The compiler generates `__destroy` and `__oncopy` for every `struct`. For
structs with only primitive fields, these are no-ops (optimized away).
For structs containing fields with hooks, the compiler generates
recursive calls:

```kei
struct User {
    name: string;    // has __oncopy/__destroy
    age: int;        // primitive, no-op
}

// Compiler auto-generates:
// fn __oncopy(self: ref User) {
//     self.name.__oncopy();  // increment string refcount
//     // age is just copied
// }
//
// fn __destroy(self: ref User) {
//     self.name.__destroy(); // decrement string refcount
//     // age — nothing to do
// }
```

Lifecycle hooks take `self: ref Self` and return void. They mutate the
slot in place; the compiler emits `__oncopy(&dest)` immediately after
the bitwise copy of a value into `dest`, and `__destroy(&slot)` at scope
exit or before assignment overwrites the slot. Field destruction order
is **reverse of declaration order**.

### Assignment semantics

```kei
let u1 = User{ name: "Alice", age: 25 };
let u2 = u1;       // __oncopy called → name refcount++
u1.name = "Bob";   // __destroy on old name, __oncopy on new name
```

On reassignment, the compiler inserts:
1. `__destroy` on the old value
2. Copy the new value
3. `__oncopy` on the new value

### Generic structs

```kei
struct Pair<A, B> {
    first: A;
    second: B;
}

let p = Pair<int, string>{ first: 42, second: "hello" };
// Compiler generates Pair_int_string with appropriate lifecycle hooks
```

---

### `readonly` field modifier

A struct field can be marked `readonly`. Two meanings depending on type:

- `readonly name: T` — the slot cannot be reassigned post-construction.
- `readonly name: ref T` — write-through is forbidden (≈ C# `in`); reads
  still auto-deref normally.

```kei
struct AppConfig {
    readonly dbUrl: string;            // string itself is fixed
    readonly online: Shared<bool>;     // handle fixed
}

cfg.dbUrl = "other";                   // ERROR: readonly
cfg.online = Shared<bool>.wrap(false); // ERROR: readonly (replaces handle)
cfg.online.value = false;              // OK: writes through .value (different field)
```

`readonly` says nothing about transitive contents reachable through other
fields — it constrains only the slot it's attached to.

---

## `unsafe struct` — Managed resource types

Unsafe structs provide manual lifecycle management and can contain raw
pointers (`*T`) and `ref T` / `readonly ref T` fields. They are used to
build managed abstractions like `String`, `Shared<T>`, `Array<T>`.

```kei
unsafe struct FileHandle {
    fd: int;
    buffer: *u8;
    bufSize: usize;

    fn __destroy(self: ref FileHandle) {
        unsafe {
            free(self.buffer);
            if self.fd >= 0 {
                closeFd(self.fd);
            }
        }
    }

    fn __oncopy(self: ref FileHandle) {
        unsafe {
            let newBuf = alloc<u8>(self.bufSize);
            memcpy(newBuf, self.buffer, self.bufSize);
            self.fd = dup(self.fd);
            self.buffer = newBuf;
        }
    }
}
```

### Lifecycle hooks

`unsafe struct` supports two lifecycle hooks. The ABI:

| Hook | Signature | Called when |
|------|-----------|------------|
| `__destroy` | `fn __destroy(self: ref T)` | Value goes out of scope or is overwritten |
| `__oncopy` | `fn __oncopy(self: ref T)` | Value is copied (assignment, parameter passing) |

Both hooks take `self: ref T` and return void. The compiler emits
`__oncopy(&dest)` immediately after the bitwise copy of a value into
`dest`, and `__destroy(&slot)` before the slot is reused or its scope
exits. Hooks mutate through the ref in place rather than returning a
new value.

**Rules:**
- `__destroy` is **required** when the struct contains `*T` fields
  (compile error if missing)
- `__oncopy` is **required** when the struct contains `*T` fields
  (compile error if missing — bitwise copy of pointers leads to
  double-free)
- For `unsafe struct` without `*T` fields, both hooks are optional
  (bitwise copy is safe)
- Hooks cannot throw errors

### When hooks are called

```kei
let a = FileHandle{ fd: 5, buffer: unsafe { alloc<u8>(1024) }, bufSize: 1024 };
let b = a;              // __oncopy(&b) called after the bitwise copy
b = otherHandle;        // __destroy(&b), bitwise overwrite, __oncopy(&b)
```

At scope exit:
```kei
fn example() {
    let handle = FileHandle{ ... };
    // ...
} // __destroy(&handle) called here
```

On field reassignment:
```kei
user.name = "new name";
// 1. __destroy(&user.name) on old value
// 2. bitwise write of new value into the slot
// 3. __oncopy(&user.name) on the new value
```

### Constructing an `unsafe struct` with `ref T` fields

A struct literal of an `unsafe struct` is the binding ceremony for its
`ref T` fields. Inside an `unsafe` block, the literal accepts a `*T`
argument for each `ref T` field and seats the binding in one step:

```kei
unsafe {
    let block = alloc(sizeof(T));
    let valuePtr = block as *T;
    placeAt(valuePtr, item);   // memcpy + onCopy from std/mem.kei
    let s = Shared<T>{ value: valuePtr };
}
```

Every `ref T` field of an `unsafe struct` must be initialized by name in
every struct literal — empty literals (`Shared<T>{}`) and partial
literals are a compile error. This makes the literal the single,
indivisible point of construction; there is no observable
half-initialized state to track.

For details on the construction primitives (`memcpy`, `onCopy`,
`onDestroy`, `placeAt`) see `spec/03-types.md` §**Constructing an
`unsafe struct` with `ref T` fields**.

### Move semantics (opt-in)

Use the `move` expression to transfer ownership without calling `__oncopy`:

```kei
let a = FileHandle{ fd: 5, buffer: unsafe { alloc<u8>(1024) }, bufSize: 1024 };
let b = move a;     // no __oncopy, a becomes invalid
// a.fd              // ERROR - a was moved
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
            unsafe {
                onDestroy(&(*self.value));
                dealloc(&(*self.refcount) as *void);
            }
        }
    }
}

// Usage
let a = Shared<User>.wrap(User{ name: "Alice", age: 25 });
let b = a;           // __oncopy → refcount++
// both a and b point to same User
```

### Compile-time errors

The compiler enforces safety rules:

```kei
struct BadValue { data: *u8; }                   // ERROR: *T requires unsafe struct
unsafe struct BadUnsafe { data: *u8; }           // ERROR: must define __destroy and __oncopy
```

---

## Method definitions

All struct types support method definitions within the struct body:

### Static methods (constructors)
```kei
struct Point {
    x: f64;
    y: f64;

    fn make(x: f64, y: f64) -> Point {
        return Point{ x: x, y: y };
    }

    fn origin() -> Point {
        return Point{ x: 0.0, y: 0.0 };
    }
}

let p1 = Point.make(1.0, 2.0);     // constructor
let p2 = Point.origin();           // static method
```

### Instance methods
```kei
struct Counter {
    value: int;

    fn increment(self: ref Counter) {
        self.value += 1;
    }

    fn get(self: readonly ref Counter) -> int {
        return self.value;
    }
}

let counter = Counter{ value: 0 };
counter.increment();              // implicit &counter; ref permits write-through
let val = counter.get();          // implicit &counter; readonly ref forbids writes
```

## Structure literals

All struct types use the same literal syntax:

```kei
// Value struct
let point = Point{ x: 1.0, y: 2.0 };

// Struct with managed fields
let user = User{
    name: "Alice",
    age: 25
};

// Unsafe struct
let handle = unsafe { FileHandle{
    fd: openFile("data.txt"),
    buffer: alloc<u8>(4096),
    bufSize: 4096
}};
```

## Performance characteristics

### Value structs (`struct`)
- **Assignment:** Copy all fields + call `__oncopy` (no-op for primitive-only structs)
- **Method calls:** Pass by value (copy) or by pointer (address)
- **Memory:** Stack-allocated, no heap overhead
- **Compilation:** Direct C struct equivalent with lifecycle function calls

### Unsafe structs (`unsafe struct`)
- **Assignment:** User-defined `__oncopy` (or bitwise copy if not defined)
- **Method calls:** Same as value structs
- **Memory:** Stack-allocated, may manage heap resources internally
- **Compilation:** C struct with user-provided lifecycle functions

---

This structure system provides a clear separation of concerns: value types for simple data with automatic lifecycle management, and unsafe types for resource management with user-defined lifecycle hooks. The two-tier model keeps the language simple while enabling powerful abstractions through the standard library.
