# Design Principles

This document outlines the core design principles that guide Kei language development. Every feature must align with these principles.

## Simplicity over cleverness

The language should be fully understandable by a single person. Every feature must justify its existence.

Kei avoids:
- Complex template metaprogramming
- Hidden control flow
- Implicit behaviors that require deep language knowledge
- Multiple ways to accomplish the same task

```kei
fn processUser(user: User) -> bool {
    if user.active {
        updateDatabase(user);
        return true;
    }
    return false;
}
```

## Explicit over implicit

Side effects, allocations, and ownership transfers are visible in the code. The reader should understand what a piece of code does without looking elsewhere.

### Memory allocations are explicit
```kei
// Stack allocation - obvious value type
struct Point { x: f64; y: f64; }
let p = Point{ x: 1.0, y: 2.0 };

// Heap allocation - explicit via unsafe struct with lifecycle hooks
unsafe struct Database {
    handle: *void;

    fn __destroy(self: ref Database) {
        // cleanup resources
    }
}

// Ownership transfer - explicit via 'move'
let transferred = move db;
```

### Side effects are visible
```kei
// Function that may throw - explicit in signature
fn parseJson(input: string) -> Data throws ParseError {
    // Implementation
}

// External C function - requires unsafe to call
extern fn sqlite3Open(filename: *c_char, db: **void) -> int;
```

## Two worlds of data

All data in Kei falls into one of two categories, each with distinct semantics:

### Value types (`struct`)
- **Location:** Stack
- **Semantics:** Copied on assignment (calls `__oncopy` on fields recursively)
- **Cleanup:** Automatic via compiler-generated `__destroy` (calls `__destroy` on fields recursively)
- **Raw pointers:** Cannot contain `*T` or `ref T` fields

```kei
struct Vec3 {
    x: f64;
    y: f64;
    z: f64;
}

let v1 = Vec3{ x: 1.0, y: 2.0, z: 3.0 };
let v2 = v1; // Copy - v1 and v2 are independent
```

For structs with only primitive fields, `__oncopy` and `__destroy` are no-ops (optimized away by compiler).

For structs containing fields with lifecycle hooks (e.g. `string`), the compiler auto-generates `__oncopy`/`__destroy` that recursively call hooks on those fields.

```kei
struct User {
    name: string;   // string has __oncopy/__destroy
    age: int;        // primitive, no hooks needed
}

let u1 = User{ name: "Alice", age: 25 };
let u2 = u1;  // compiler calls u1.name.__oncopy() automatically
// u1 and u2 are independent, each has its own refcount on the string buffer
```

### Unsafe types (`unsafe struct`)
- **Location:** Stack
- **Semantics:** May contain raw pointers (`*T`) and `ref T` fields; user-defined lifecycle hooks
- **Cleanup:** User-defined `__destroy` method (compile error if missing when `*T` fields present)
- **Raw pointers:** Allowed

```kei
unsafe struct RawBuffer {
    data: *u8;
    size: usize;

    fn __destroy(self: ref RawBuffer) {
        unsafe {
            if self.data != null {
                free(self.data);
            }
        }
    }

    fn __oncopy(self: ref RawBuffer) {
        unsafe {
            let newData = alloc<u8>(self.size);
            memcpy(newData, self.data, self.size);
            self.data = newData;
        }
    }
}
```

`unsafe struct` is used to build managed abstractions like `String`,
`Shared<T>`, `Array<T>` in the standard library. If lifecycle hooks are
implemented incorrectly, memory corruption or leaks may occur — hence the
`unsafe` keyword.

## Zero-cost defaults

Code that doesn't need the heap doesn't touch the heap. Value types on the stack have zero overhead compared to equivalent C code.

### Performance characteristics
- **Primitive-only structs:** Zero overhead - compile to plain C structs with no-op lifecycle hooks (optimized away)
- **Structs with managed fields:** Only pay for lifecycle hooks when the fields require them
- **Function calls:** Direct calls, no dynamic dispatch unless explicit

```kei
// This compiles to efficient stack-only C code
fn vectorLength(v: Vec3) -> f64 {
    return sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

// This involves lifecycle hooks for string fields
fn createUser(name: string) -> User {
    return User{ name: name, age: 0 };
}
```

## Source-only compilation

All Kei code — including dependencies — is compiled from source. No precompiled libraries, no ABI contracts, no headers. The compiler sees everything, enabling:

- **Whole-program optimization**
- **Monomorphization** of generic types and functions
- **Dead code elimination** across module boundaries
- **Inlining** across all boundaries

### External integration
External C libraries are accessed through `extern fn` declarations plus Kei wrapper code:

```kei
// External C function declaration
extern fn sqlite3Open(filename: *c_char, db: **Sqlite3) -> int;

// Kei wrapper for safe usage
fn openDatabase(path: string) -> Database throws DatabaseError {
    unsafe {
        let db: *Sqlite3 = null;
        let result = sqlite3Open(path.toCString(), &db);
        if result != SQLITE_OK {
            throw DatabaseError{ message: "Failed to open database" };
        }
        return Database{ handle: db };
    }
}
```

### Benefits
- **Performance:** No ABI overhead, full optimization
- **Simplicity:** No build complexity from precompiled libraries
- **Reliability:** All code compiled with same compiler and flags
- **Portability:** Source code is the universal distribution format

### Compilation model
```
Dependencies (.kei source) -> Combined with main -> Full program analysis -> KIR -> C -> Binary
```

This approach trades compilation time for runtime performance and simplicity.

## No hidden runtime

Kei emits C. There is no garbage collector, no scheduler, no exception table, no
managed heap. The stdlib is regular Kei code with `unsafe struct` at its lowest
level — nothing magic.

**v1 is single-threaded.** Concurrency primitives (threads, async, channels) are
deliberately out of scope for v1; the staged plan lives in
[`spec/08-memory.md`](./08-memory.md) under **Concurrency**. Programs that need
threads today use FFI and accept the rules there.

---

These principles guide every decision in Kei's design. Features that conflict
with them are reconsidered or rejected.
