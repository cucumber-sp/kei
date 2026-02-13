# Structures

Structures are Kei's primary mechanism for organizing related data. They implement the three-tier memory model through three distinct structure types: `struct`, `ref struct`, and `unsafe struct`.

## Structure types overview

| Type | Memory | Assignment | Cleanup | Raw Pointers |
|------|--------|-----------|---------|--------------|
| `struct` | Stack | Copy | None | ❌ |
| `ref struct` | Heap | Reference count | Automatic | ❌ |
| `unsafe struct` | Heap | Move | Manual | ✅ |

Each structure type has different memory management semantics and field restrictions.

---

## `struct` — Value types

Value types are stack-allocated and copied on assignment. They provide zero-overhead data organization.

```kei
struct Point {
    x: f64;
    y: f64;

    fn length(self: Point) -> f64 {
        return sqrt(self.x * self.x + self.y * self.y);
    }

    fn translate(self: ptr<Point>, dx: f64, dy: f64) {
        self.*.x += dx;
        self.*.y += dy;
    }

    // Constructor (optional - struct literals work too)
    fn Point(x: f64, y: f64) -> Point {
        return Point { x: x, y: y };
    }
}
```

### Method self types

- **`self: T`** — Receives an immutable copy of the struct
- **`self: ptr<T>`** — Receives a mutable pointer (auto address-of at call site)

```kei
let mut point = Point{ x: 1.0, y: 2.0 };
let len = point.length();     // copies point to method
point.translate(5.0, 3.0);    // passes &point to method
```

### Field restrictions

Value structs can only contain:
- Primitive types (`int`, `f64`, `bool`, etc.)
- Other value structs
- `str` (string views)
- `slice<T>` (array slices)
- `array<T, N>` (fixed-size arrays)

**Cannot contain:**
- `ref struct` types
- `unsafe struct` types
- `String` (owning strings)
- `dynarray<T>` (dynamic arrays)
- `ptr<T>` (raw pointers)

```kei
struct ValidValueStruct {
    id: int;
    position: Point;        // ok - other value struct
    name: str;              // ok - string view
    data: array<u8, 32>;    // ok - fixed-size array
}

struct InvalidValueStruct {
    user: User;             // ERROR - User is ref struct
    buffer: dynarray<u8>;   // ERROR - dynamic array
    handle: ptr<File>;      // ERROR - raw pointer
}
```

---

## `ref struct` — Reference types

Reference types are heap-allocated with automatic reference counting. They support complex data structures with automatic memory management.

```kei
ref struct User {
    name: string;           // owning string
    age: int;
    posts: dynarray<Post>;  // dynamic array of posts
    profile: ProfileData;   // other ref struct
}
```

### Reference counting semantics

**Updated for new memory model:** `ref struct` types use automatic reference counting by default:

```kei
let user1 = User{ name: "Alice", age: 25, posts: [] };
let user2 = user1;        // Reference count increment (not move!)
let user3 = user1;        // Another reference count increment

// All three variables are valid and point to the same data
print(user1.name);        // "Alice" - still accessible
print(user2.name);        // "Alice" - same data
print(user3.name);        // "Alice" - same data
```

### Move semantics (opt-in)

Use the `move` keyword for zero-cost ownership transfer:

```kei
let user1 = User{ name: "Alice", age: 25, posts: [] };
let user2 = move user1;   // Zero-cost transfer, user1 becomes invalid

print(user2.name);        // "Alice" - ok
// print(user1.name);     // ERROR - user1 moved
```

### Compiler-generated `__free`

The compiler automatically generates a cleanup function:

```kei
// Compiler-generated for the User struct above
fn __free(self: ptr<User>) {
    self.*.name.__free();       // cleanup string
    self.*.posts.__free();      // cleanup dynamic array
    self.*.profile.__free();    // cleanup ref struct field
    heap_free(self);            // free the struct itself
}
```

The `__free` function:
- Recursively calls cleanup on all fields that need it
- Deallocates the heap memory for the struct
- Is called automatically when reference count reaches zero

### Allowed field types

`ref struct` can contain:
- All types allowed in value structs
- `string` (owning strings)
- `dynarray<T>` (dynamic arrays)
- Other `ref struct` types
- `unsafe struct` types (will call their `free` method)

**Cannot contain:**
- `ptr<T>` (raw pointers) - use `unsafe struct` for this

### Reference counting overhead

- **Assignment:** O(1) reference count increment
- **Function calls:** May increment/decrement based on parameter passing
- **Compiler optimizations:** Many refcount operations optimized away
- **Move semantics:** Zero cost when explicitly requested

---

## `unsafe struct` — Raw resource types

Unsafe structs provide manual memory management and can contain raw pointers. They require explicit cleanup methods.

```kei
unsafe struct FileHandle {
    fd: int;
    buffer: ptr<u8>;
    buf_size: uint;
    
    // REQUIRED - must define cleanup
    fn free(self) {
        if (self.buffer != null) {
            heap_free(self.buffer);
        }
        if (self.fd >= 0) {
            close_fd(self.fd);
        }
    }
}
```

### Requirements

1. **Only struct type that can contain `ptr<T>` fields**
2. **Must define `fn free(self)` method** - compile error if missing
3. **Parent `ref struct.__free` automatically calls `.free()` on unsafe fields**
4. **Move semantics** - assignment transfers ownership (same as old `ref struct`)

```kei
let handle1 = FileHandle{ fd: 5, buffer: malloc(1024), buf_size: 1024 };
let handle2 = handle1;    // MOVE - handle1 becomes invalid
// handle1.fd              // ERROR - handle1 was moved
```

### Compile-time errors

The compiler enforces safety rules:

```kei
struct BadValue { data: ptr<u8>; }          // ERROR: use unsafe struct
ref struct BadRef { handle: ptr<void>; }    // ERROR: use unsafe struct  
unsafe struct BadUnsafe { data: ptr<u8>; } // ERROR: must define fn free(self)
```

---

## Method definitions

All struct types support method definitions within the struct body:

### Static methods (constructors)
```kei
struct Point {
    x: f64;
    y: f64;
    
    fn Point(x: f64, y: f64) -> Point {
        return Point{ x: x, y: y };
    }
    
    fn origin() -> Point {
        return Point{ x: 0.0, y: 0.0 };
    }
}

let p1 = Point.Point(1.0, 2.0);    // constructor
let p2 = Point.origin();           // static method
```

### Instance methods
```kei
ref struct Counter {
    value: int;
    
    fn increment(self: ptr<Counter>) {
        self.*.value += 1;
    }
    
    fn get(self: Counter) -> int {
        return self.value;
    }
}

let mut counter = Counter{ value: 0 };
counter.increment();              // modifies counter
let val = counter.get();          // reads counter (copy)
```

## Structure literals

All struct types use the same literal syntax:

```kei
// Value struct
let point = Point{ x: 1.0, y: 2.0 };

// Reference struct  
let user = User{ 
    name: string.from("Alice"), 
    age: 25, 
    posts: [] 
};

// Unsafe struct
let handle = FileHandle{ 
    fd: open_file("data.txt"), 
    buffer: malloc(4096), 
    buf_size: 4096 
};
```

## Performance characteristics

### Value structs (`struct`)
- **Assignment:** Copy all fields (stack-to-stack)
- **Method calls:** Pass by value (copy) or by pointer (address)
- **Memory:** No heap allocation, no cleanup overhead
- **Compilation:** Direct C struct equivalent

### Reference structs (`ref struct`)  
- **Assignment:** Reference count increment (default) or move (explicit)
- **Method calls:** Pointer passing with refcount management
- **Memory:** Heap allocation with automatic cleanup
- **Compilation:** Pointer + reference counting metadata

### Unsafe structs (`unsafe struct`)
- **Assignment:** Move semantics (ownership transfer)
- **Method calls:** Pointer passing, no refcount
- **Memory:** Manual management via `free` method
- **Compilation:** Direct pointer, manual cleanup calls

---

This structure system provides a clear separation of concerns: value types for simple data, reference types for complex managed data, and unsafe types for raw resource management. The updated reference counting semantics make `ref struct` more predictable while maintaining performance through explicit move semantics when needed.