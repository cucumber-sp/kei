# Memory Model

Kei's memory model provides deterministic resource management without garbage collection through a three-tier approach: stack allocation for value types, reference counting for reference types, and manual management for unsafe types.

## Overview

Kei achieves memory safety and performance through:
- **No garbage collector runtime** — all cleanup is compile-time determined
- **Automatic reference counting** for heap-allocated types
- **Compiler optimizations** to eliminate unnecessary refcount operations
- **Explicit move semantics** for zero-cost transfers when needed
- **Stack-first design** — heap allocation only when explicitly requested

## Stack allocation (default)

Primitives and value `struct` types are stack-allocated with zero-cost cleanup:

```kei
fn example() {
    let x = 42;                             // stack - integer
    let p = Point { x: 1.0, y: 2.0 };      // stack - value struct
    let arr = [1, 2, 3, 4, 5];             // stack - fixed-size array
}   // automatic cleanup: just stack pointer adjustment
```

**Characteristics:**
- **Allocation:** Stack frame, no heap involvement
- **Assignment:** Full copy of all fields
- **Cleanup:** None needed — variables disappear with stack frame
- **Performance:** Optimal — equivalent to C stack variables

## Heap allocation (`ref struct`) — Reference counted by default

`ref struct` values are heap-allocated and reference-counted. Assignment increments the reference count. When the reference count reaches 0, the compiler-generated `__free` function is called automatically.

**No GC runtime** — all reference counting operations are inserted at compile time.

```kei
fn example() {
    let a = User { name: string.from("Alice"), age: 25 };
    let b = a;          // refcount++ — both a and b are valid
    print(b.name);      // works
    print(a.name);      // works — a is still alive
}   // b scope exit: refcount-- (2→1)
    // a scope exit: refcount-- (1→0) → __free() called
```

### Reference counting semantics

**Assignment behavior:**
- Default assignment increments reference count
- Both variables remain valid
- Cleanup happens when last reference goes out of scope

**Memory layout:**
Each `ref struct` includes hidden reference count metadata:
```c
// Generated C structure
typedef struct {
    int refcount;
    UserData data;
} User;
```

## `move` — Explicit ownership transfer (opt-in)

For zero-cost transfer without reference counting overhead, use `move` explicitly:

```kei
fn example() {
    let a = User { name: string.from("Alice"), age: 25 };
    let b = move a;     // zero-cost, no refcount. a is dead.
    print(b.name);      // works
    // print(a.name);   // COMPILE ERROR: use after move
}
```

**When to use move:**
- Performance-critical paths where refcount overhead matters
- Transferring ownership to functions that consume the value
- One-time initialization patterns
- Large data structures where copying metadata is expensive

## Function parameters

Parameter passing behavior depends on the calling convention:

### Default passing (reference counting)
```kei
fn process(user: User) {
    // refcount++ on entry, refcount-- on exit
    print(user.name);
}   // automatic refcount-- here

let user = User { name: "Alice", age: 25 };
process(user);       // refcount — user still valid after call
process(user);       // can call again
```

### Move parameters (ownership transfer)
```kei
fn consume(move user: User) {
    // owns user, no refcount operations
    print(user.name);
}   // __free() called here - user is consumed

let user = User { name: "Alice", age: 25 };
consume(move user);  // move — user is gone after this call
// consume(user);    // ERROR - user was moved
```

**Function signature syntax:**
- `fn process(user: User)` — increment refcount, keep original alive
- `fn consume(move user: User)` — transfer ownership, original becomes invalid

## Compiler optimizations

The compiler can optimize away reference counting operations through static analysis:

### Single ownership optimization
When the compiler proves that a value is never shared (single ownership), no reference counting overhead is generated:

```kei
fn optimized() -> User {
    let user = User { name: "Alice", age: 25 };  // refcount = 1
    return user;  // compiler sees single owner → no refcount, direct move
}
```

### Last use analysis
The compiler can identify the last use of a variable and avoid unnecessary refcount operations:

```kei
fn example() {
    let user = createUser();
    processUser(user);      // last use detected
    // compiler generates move instead of refcount increment/decrement
}
```

### Dead code elimination
Unreachable refcount operations are removed:

```kei
if (false) {
    let user = User { ... };  // entire block eliminated
}
```

## Return Value Optimization (RVO)

For `ref struct` returns, the compiler uses Return Value Optimization to avoid unnecessary copying and reference counting:

```kei
// Programmer writes:
fn createUser(name: string, age: int) -> User {
    return User { name: name, age: age };
}
let user = createUser(string.from("Alice"), 25);
```

```c
// Compiler generates (C equivalent):
void createUser(String name, int age, User* __out) {
    __out->name = name;
    __out->age = age;
    __out->refcount = 1;
}
User* user = malloc(sizeof(User));
createUser(name, 25, user);
```

**Benefits:**
- No temporary objects created
- No unnecessary refcount increment/decrement
- Direct construction at the destination
- Same performance as manual C memory management

## `unsafe` blocks

For scenarios requiring manual memory management, use `unsafe` blocks:

```kei
unsafe {
    let raw: ptr<u8> = heap_alloc(1024);
    // raw pointer arithmetic allowed
    let offset_ptr = raw + 512;
    heap_free(raw);
}
```

**Allowed in unsafe blocks:**
- Raw pointer arithmetic
- Manual allocation/deallocation  
- External function calls
- Pointer type casts
- Direct memory access without bounds checking

**Safety note:** Code in `unsafe` blocks bypasses memory safety guarantees. The programmer is responsible for correctness.

## Debug safety checks

In debug builds, the compiler inserts runtime safety checks via KIR:

- **Array/slice bounds checking** — panic on out-of-bounds access
- **Division by zero** → `panic` with stack trace
- **Integer overflow detection** — wrap in release, panic in debug
- **Null pointer dereference** — immediate crash with diagnostic
- **Use-after-move detection** — catch moved value usage

All checks are **completely removed in release builds** for zero overhead.

### Example safety check insertion
```kei
// Source code
let arr = [1, 2, 3];
let x = arr[idx];

// Debug build (conceptual C output)
if (idx >= 3) panic("array bounds check failed");
int x = arr[idx];

// Release build (conceptual C output)  
int x = arr[idx];  // direct access, no checks
```

## Memory layout guarantees

### Value structs (`struct`)
- Laid out exactly like C structs
- No hidden metadata
- Guaranteed ABI compatibility with C
- Optimal packing and alignment

### Reference structs (`ref struct`)
- Heap-allocated with reference count header
- Reference count stored before user data
- Pointer passed around points to user data (not header)
- Compatible with C when passed as pointers

### Arrays and slices
- Fixed arrays: contiguous stack allocation
- Dynamic arrays (`dynarray`): heap allocation with capacity metadata
- Slices (`slice`): pointer + length, no ownership

## Performance characteristics

| Operation | Value Types | Reference Types | Unsafe Types |
|-----------|-------------|-----------------|---------------|
| Creation | Stack alloc | Heap alloc + refcount=1 | Heap alloc |
| Assignment | Copy all fields | refcount++ | Move pointer |
| Function call | Copy or &pointer | refcount++/-- | Pointer |
| Cleanup | None | refcount--, __free if 0 | Manual free |
| Cache performance | Excellent | Good (locality) | Variable |
| Runtime overhead | Zero | Low (optimized) | Zero |

## Cyclic reference handling

Reference counting cannot automatically handle cycles. For cyclic data structures:

1. **Avoid cycles through design** — use tree/DAG structures when possible
2. **Break cycles manually** — explicitly clear references
3. **Use weak references** (future feature) — non-owning pointers
4. **Use unsafe pointers** — manual cycle breaking in `unsafe` blocks

```kei
// Potential cycle
ref struct Node {
    parent: ptr<Node>;      // ERROR: would be ref struct cycle
    children: dynarray<Node>; // owns children
}

// Solution: break with unsafe pointer
unsafe struct Node {
    parent: ptr<Node>;        // non-owning back-pointer
    children: dynarray<Node>; // owns children
    
    fn free(self) {
        // parent pointer doesn't own, so don't free it
        self.children.__free();
    }
}
```

---

This memory model provides automatic memory management for the majority of use cases while allowing explicit control when performance demands it. The combination of reference counting with move semantics and compiler optimizations delivers both safety and performance.