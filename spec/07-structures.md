# Structures

Structures are Kei's primary mechanism for organizing related data. They implement the two-tier memory model through two distinct structure types: `struct` and `unsafe struct`.

## Structure types overview

| Type | Location | Assignment | Lifecycle Hooks | Raw Pointers |
|------|----------|-----------|-----------------|--------------|
| `struct` | Stack | Copy (auto `__oncopy`) | Auto-generated | No |
| `unsafe struct` | Stack | Custom (`__oncopy`) | User-defined | Yes |

Both types live on the stack. The key difference is that `unsafe struct` can contain raw pointers and requires user-defined lifecycle management.

---

## `struct` — Value types

Value types are stack-allocated and copied on assignment. The compiler auto-generates lifecycle hooks.

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

    fn Point(x: f64, y: f64) -> Point {
        return Point{ x: x, y: y };
    }
}
```

### Method self types

- **`self: T`** — Receives a copy of the struct
- **`self: ptr<T>`** — Receives a mutable pointer (auto address-of at call site)

```kei
let mut point = Point{ x: 1.0, y: 2.0 };
let len = point.length();     // copies point to method
point.translate(5.0, 3.0);    // passes &point to method
```

### Auto-generated lifecycle hooks

The compiler generates `__destroy` and `__oncopy` for every `struct`. For structs with only primitive fields, these are no-ops (optimized away). For structs containing fields with hooks, the compiler generates recursive calls:

```kei
struct User {
    name: string;    // has __oncopy/__destroy
    age: int;        // primitive, no-op
}

// Compiler auto-generates:
// fn __oncopy(self: User) -> User {
//     self.name.__oncopy();  // increment string refcount
//     return self;           // age is just copied
// }
//
// fn __destroy(self: User) {
//     self.name.__destroy(); // decrement string refcount
//     // age — nothing to do
// }
```

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

## `unsafe struct` — Managed resource types

Unsafe structs provide manual lifecycle management and can contain raw pointers. They are used to build managed abstractions like `string`, `Shared<T>`, `array<T>`.

```kei
unsafe struct FileHandle {
    fd: int;
    buffer: ptr<u8>;
    buf_size: usize;

    fn __destroy(self: FileHandle) {
        if (self.buffer != null) {
            c_free(self.buffer);
        }
        if (self.fd >= 0) {
            close_fd(self.fd);
        }
    }

    fn __oncopy(self: FileHandle) -> FileHandle {
        let new_buf = c_malloc(self.buf_size);
        c_memcpy(new_buf, self.buffer, self.buf_size);
        return FileHandle{
            fd: dup(self.fd),
            buffer: new_buf,
            buf_size: self.buf_size
        };
    }
}
```

### Lifecycle hooks

`unsafe struct` supports two lifecycle hooks:

| Hook | Signature | Called when |
|------|-----------|------------|
| `__destroy` | `fn __destroy(self: T)` | Value goes out of scope or is overwritten |
| `__oncopy` | `fn __oncopy(self: T) -> T` | Value is copied (assignment, parameter passing) |

**Rules:**
- `__destroy` is **required** when the struct contains `ptr<T>` fields (compile error if missing)
- `__oncopy` is **required** when the struct contains `ptr<T>` fields (compile error if missing — bitwise copy of pointers leads to double-free)
- For `unsafe struct` without `ptr<T>` fields, both hooks are optional (bitwise copy is safe)
- Hooks cannot throw errors

### When hooks are called

```kei
let a = FileHandle{ fd: 5, buffer: malloc(1024), buf_size: 1024 };
let b = a;              // __oncopy called
b = other_handle;       // __destroy on old b, __oncopy on new value
```

At scope exit:
```kei
fn example() {
    let handle = FileHandle{ ... };
    // ...
} // __destroy called on handle
```

On field reassignment:
```kei
user.name = "new name";
// 1. __destroy on old user.name
// 2. assign new value
// 3. __oncopy on new user.name
```

### Move semantics (opt-in)

Use the `move` keyword to transfer ownership without calling `__oncopy`:

```kei
let a = FileHandle{ fd: 5, buffer: malloc(1024), buf_size: 1024 };
let b = move a;     // no __oncopy, a becomes invalid
// a.fd              // ERROR - a was moved
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

// Usage
let a = Shared<User>.create(User{ name: "Alice", age: 25 });
let b = a;           // __oncopy → count++
// both a and b point to same User
```

### Compile-time errors

The compiler enforces safety rules:

```kei
struct BadValue { data: ptr<u8>; }               // ERROR: ptr<T> requires unsafe struct
unsafe struct BadUnsafe { data: ptr<u8>; }       // ERROR: must define __destroy and __oncopy
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
struct Counter {
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

// Struct with managed fields
let user = User{
    name: "Alice",
    age: 25
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
