# KIR — Kei Intermediate Representation

## Purpose

AST = what the programmer wrote. KIR = what will actually execute.

All implicit behavior is made explicit during lowering:
- Reference count increments/decrements
- `__free` calls at scope exits
- Move semantics (ownership transfers)
- Debug checks (bounds, overflow, null)
- Monomorphization of generic-like built-in types

## KIR Lowering Transformations

| Source construct | KIR output |
|---|---|
| `ref struct` assignment | `refcount_inc` + copy pointer |
| Scope exit of `ref struct` | `refcount_dec` + conditional `__free` |
| `move` keyword | Direct pointer transfer, no refcount |
| `ref struct` function param | `refcount_inc` on entry, `refcount_dec` on exit |
| `move` function param | No refcount operations |
| `ref struct` return | RVO: out-pointer, direct write |
| `defer` statement | Reordered to scope exit (LIFO) |
| Debug bounds check | `bounds_check` instruction |
| Debug overflow | `overflow_check` instruction |

## KIR Opcodes

Flat, labeled instruction format with typed registers.

### Memory
- `heap_alloc <Type>` — allocate on heap
- `heap_free <reg>` — deallocate
- `stack_alloc <Type>` — allocate on stack frame
- `load <reg.field>` — load field from struct
- `store <reg.field>, <value>` — store into field
- `refcount_inc <reg>` — increment reference count
- `refcount_dec <reg>` — decrement, free if zero

### Functions
- `call <func>(<args>)` — function call
- `call_method <reg>.<method>(<args>)` — method call
- `ret <value>` — return value
- `ret_void` — return void

### Arithmetic & Logic
`add`, `sub`, `mul`, `div`, `mod`, `eq`, `neq`, `lt`, `gt`, `lte`, `gte`, `and`, `or`, `not`, `bit_and`, `bit_or`, `bit_xor`, `bit_not`, `shl`, `shr`

### Control Flow
- `jump <label>` — unconditional jump
- `branch <cond>, <label_true>, <label_false>` — conditional branch
- `label <name>:` — jump target
- `switch <reg>, [cases]` — multi-way branch

### Debug (debug mode only)
- `bounds_check <index>, <length>` — panic if out of bounds
- `overflow_check <op>, <a>, <b>` — panic if overflow
- `null_check <reg>` — panic if null pointer
- `move_check <reg>` — panic if use-after-move

## Example

Kei source:
```kei
ref struct User {
    name: String;
    age: int;
}

fn createUser(n: String, a: int) -> User {
    return User { name: n, age: a };
}

fn main() -> int {
    let user = createUser(String.from("Andrey"), 21);
    let age = user.age;
    return age;
}
```

KIR output (debug):
```
method User.__free(self: ptr<User>):
    %0 = load self.name
    call_method %0.__free()
    call heap_free(self)
    ret_void

func createUser(n: String, a: i32, __out: ptr<User>):
    store __out.name, n
    store __out.age, a
    ret_void

func main() -> i32:
    %0 = heap_alloc User
    %1 = call String.from("Andrey")
    call createUser(%1, 21, %0)
    %2 = load %0.age
    refcount_dec %0          ; triggers __free if count == 0
    ret %2
```

## Compiler Optimizations

The KIR pass can perform optimizations before C codegen:

- **Refcount elision**: If a value is created, used, and destroyed without sharing, skip all refcount operations
- **Inline expansion**: Small functions inlined at KIR level
- **Dead store elimination**: Remove writes to variables that are never read
- **Move detection**: Automatically convert last-use assignments to moves (no refcount overhead)
