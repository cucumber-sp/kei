# Variables, Constants & Operators

This document covers variable declarations, constants, type inference, and the complete operator system in Kei.

## Variables

### `let` — mutable variables

Variables declared with `let` are mutable and can be reassigned after declaration:

```kei
let x = 10;         // type inferred as int
let y: int = 20;    // explicit type annotation
x = 30;             // ok - let variables are mutable
```

**Important:** Variables must be initialized at declaration. Uninitialized variables are not allowed:

```kei
let x: int;         // ERROR - no initializer
```

### `const` — immutable binding

Variables declared with `const` create an immutable binding - they cannot be reassigned:

```kei
const x = 10;
const y: int = getValue();   // runtime initialization is ok
// x = 20;                   // ERROR - cannot reassign const
```

**Note:** `const` does not imply compile-time evaluation. It only prevents reassignment of the binding. The value can be computed at runtime.

### `static` — compile-time constant

Static declarations create compile-time constants that are inlined at usage:

```kei
static PAGE_SIZE = 4096;
static PI = 3.14159;

fn allocatePage() -> ptr<u8> {
    return unsafe { alloc<u8>(PAGE_SIZE) };  // inlined as alloc<u8>(4096)
}
```

**Requirements:**
- Must be computable at compile time
- Value is inlined at every usage site
- Can only use compile-time expressions

## Type inference

Kei performs local type inference for variable declarations when the type can be unambiguously determined:

```kei
let x = 42;          // int (default integer type)
let y = 3.14;        // f64 (default float type)
let z = true;        // bool
let s = "hello";     // string
let arr = [1, 2, 3]; // array<int, 3>
```

### When explicit types are needed

```kei
let a: u32 = 42;     // specific integer size
let b: f32 = 3.14;   // specific float size
let c: array<int> = [1, 2, 3]; // specific collection type
```

## Shadowing

Variable shadowing is allowed in nested scopes, but not within the same scope:

```kei
let x = 10;
{
    let x = "hello";  // ok - different scope, shadows outer x
    print(x);         // prints "hello"
}
print(x);             // prints 10 - outer x visible again

// let x = 20;        // ERROR - redeclaration in same scope
```

## Operators

Kei provides a comprehensive set of operators with well-defined precedence and associativity.

### Arithmetic operators
```kei
+   -   *   /   %     // Basic arithmetic
```

**Division behavior:**
- Division by zero: panic in debug builds, undefined behavior in release builds
- Integer division truncates toward zero

```kei
let a = 10 / 3;       // 3 (integer division)
let b = 10.0 / 3.0;   // 3.333... (floating-point division)
let c = 10 % 3;       // 1 (modulo)
```

### Comparison operators
```kei
==  !=                // Equality
<   <=  >   >=        // Relational
```

### Logical operators
```kei
&&  ||  !             // Logical and, or, not
```

**Short-circuit evaluation:**
- `&&` only evaluates right operand if left is `true`
- `||` only evaluates right operand if left is `false`

```kei
if (ptr != null && ptr.*.value > 0) {
    // ptr.*.value only evaluated if ptr != null
}
```

### Bitwise operators
```kei
&   |   ^   ~         // AND, OR, XOR, NOT
<<  >>                // Left shift, right shift
```

### Assignment operators
```kei
=                     // Assignment
+=  -=  *=  /=  %=    // Compound arithmetic assignment
&=  |=  ^=            // Compound bitwise assignment
<<= >>=               // Compound shift assignment
```

```kei
let x = 10;
x += 5;               // equivalent to x = x + 5
x <<= 2;              // equivalent to x = x << 2
```

### Memory and access operators
```kei
&                     // Address-of
.*                    // Dereference
[]                    // Index access
.                     // Member access
```

```kei
let x = 42;
let p = &x;           // address-of
let val = p.*;        // dereference

let arr = [1, 2, 3];
let first = arr[0];   // index access

struct Point { x: f64; y: f64; }
let pt = Point{ x: 1.0, y: 2.0 };
let x_val = pt.x;     // member access
```

### Range operators
```kei
..                    // Exclusive range
..=                   // Inclusive range
```

```kei
let slice1 = arr[1..4];   // elements 1, 2, 3
let slice2 = arr[1..=4];  // elements 1, 2, 3, 4
```

## Operator precedence

From highest to lowest precedence:

1. `.` `.*` `[]` `()` (postfix operators)
2. `!` `~` `-` `&` (unary prefix operators)  
3. `*` `/` `%` (multiplicative)
4. `+` `-` (additive)
5. `<<` `>>` (shift)
6. `<` `<=` `>` `>=` (relational)
7. `==` `!=` (equality)
8. `&` (bitwise AND)
9. `^` (bitwise XOR)
10. `|` (bitwise OR)
11. `&&` (logical AND)
12. `||` (logical OR)
13. `=` `+=` `-=` etc. (assignment - right associative)

### Associativity
- Most operators are left-associative: `a + b + c` → `(a + b) + c`
- Assignment operators are right-associative: `a = b = c` → `a = (b = c)`

### Precedence examples
```kei
a + b * c          // a + (b * c)
a < b && c > d     // (a < b) && (c > d)  
a = b += c         // a = (b += c)
p.*.field          // (p.*).field
arr[i + 1]         // arr[(i + 1)]
!flag && condition // (!flag) && condition
```

## Type conversion behavior

### Implicit conversions
Some conversions happen automatically:
```kei
let small: i32 = 42;
let large: i64 = small;     // implicit widening
```

### Explicit conversions
Most conversions require explicit casts:
```kei
let large: i64 = 1000;
let small: i32 = large as i32;  // may truncate
let float_val: f64 = large as f64;
```

### Assignment semantics by type category
- **All types:** Assignment copies the value and calls `__oncopy` (no-op for primitive-only structs)
- **Move semantics:** Use `move` keyword for zero-cost transfer without `__oncopy`

```kei
// Primitive-only struct - copy (just memcpy, hooks are no-op)
struct Point { x: f64; y: f64; }
let p1 = Point{ x: 1.0, y: 2.0 };
let p2 = p1;  // p2 is independent copy

// Struct with managed fields - copy + lifecycle hooks
struct Data { name: string; value: int; }
let d1 = Data{ name: "hello", value: 42 };
let d2 = d1;        // __oncopy called (name refcount++)
let d3 = move d1;   // zero-cost transfer, d1 becomes invalid
```

---

This operator system provides familiar semantics while maintaining the performance characteristics needed for systems programming.