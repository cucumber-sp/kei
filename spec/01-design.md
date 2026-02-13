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
// Good: Clear and explicit
fn processUser(user: User) -> bool {
    if (user.active) {
        updateDatabase(user);
        return true;
    }
    return false;
}

// Avoided: Clever but obscure
// (hypothetical complex feature)
```

## Explicit over implicit

Side effects, allocations, and ownership transfers are visible in the code. The reader should understand what a piece of code does without looking elsewhere.

### Memory allocations are explicit
```kei
// Stack allocation - obvious
struct Point { x: f64; y: f64; }
let p = Point{ x: 1.0, y: 2.0 };

// Heap allocation - explicit via 'ref struct'
ref struct Database { connection: string; }
let db = Database{ connection: "localhost" };

// Ownership transfer - explicit via 'move'
let transferred = move db;
```

### Side effects are visible
```kei
// Function that may throw - explicit in signature
fn parseJson(input: string) -> Data throws ParseError {
    // Implementation
}

// External C function - explicit 'extern'
extern fn malloc(size: usize) -> ptr<u8>;
```

## Three worlds of data

All data in Kei falls into one of three categories, each with distinct semantics:

### Value types (`struct`)
- **Location:** Stack
- **Semantics:** Copied on assignment
- **Memory:** No heap allocations
- **Cleanup:** No cleanup needed

```kei
struct Vec3 {
    x: f64;
    y: f64; 
    z: f64;
}

let v1 = Vec3{ x: 1.0, y: 2.0, z: 3.0 };
let v2 = v1; // Copy - v1 and v2 are independent
```

### Reference types (`ref struct`)
- **Location:** Heap
- **Semantics:** Reference counted by default, move on explicit request
- **Memory:** Automatic allocation/deallocation
- **Cleanup:** Compiler-generated `__free` function
- **Restrictions:** Cannot contain `ptr<T>` fields

```kei
ref struct User {
    name: string;
    email: string;
}

let user1 = User{ name: "Alice", email: "alice@example.com" };
let user2 = user1; // Reference count increment
let user3 = move user1; // Zero-cost transfer, user1 becomes invalid
```

### Unsafe types (`unsafe struct`)
- **Location:** Programmer-controlled
- **Semantics:** May contain raw pointers
- **Memory:** Manual management required
- **Cleanup:** Must define `free` method manually

```kei
unsafe struct RawBuffer {
    data: ptr<u8>;
    size: usize;
    
    fn free(self) {
        if (self.data != null) {
            c_free(self.data);
        }
    }
}
```

## Zero-cost defaults

Code that doesn't need the heap doesn't touch the heap. Value types on the stack have zero overhead compared to equivalent C code.

### Performance characteristics
- **Value types:** Zero overhead - compile to plain C structs
- **Reference types:** Only pay for reference counting when used
- **Function calls:** Direct calls, no dynamic dispatch unless explicit

```kei
// This compiles to efficient stack-only C code
fn vectorLength(v: Vec3) -> f64 {
    return sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

// This uses heap and reference counting
fn createUser(name: string) -> User {
    return User{ name: name, email: "" };
}
```

## Source-only compilation

All Kei code — including dependencies — is compiled from source. No precompiled libraries, no ABI contracts, no headers. The compiler sees everything, enabling:

- **Whole-program optimization**
- **Monomorphization** of generic code paths
- **Dead code elimination** across module boundaries
- **Inlining** across all boundaries

### External integration
External C libraries are accessed through `extern fn` declarations plus Kei wrapper code:

```kei
// External C function declaration
extern fn sqlite3_open(filename: ptr<c_char>, db: ptr<ptr<sqlite3>>) -> int;

// Kei wrapper for safe usage
fn openDatabase(path: string) -> Database throws DatabaseError {
    let db: ptr<sqlite3> = null;
    let result = sqlite3_open(path.c_str(), &db);
    if (result != SQLITE_OK) {
        throw DatabaseError("Failed to open database");
    }
    return Database{ handle: db };
}
```

### Benefits
- **Performance:** No ABI overhead, full optimization
- **Simplicity:** No build complexity from precompiled libraries  
- **Reliability:** All code compiled with same compiler and flags
- **Portability:** Source code is the universal distribution format

### Compilation model
```
Dependencies (.kei source) → Combined with main → Full program analysis → KIR → C → Binary
```

This approach trades compilation time for runtime performance and simplicity.

---

These principles guide every decision in Kei's design. Features that conflict with these principles are reconsidered or rejected.