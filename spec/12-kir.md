# KIR — Kei Intermediate Representation

## Purpose

AST = what the programmer wrote. KIR = what will actually execute.

All implicit behavior is made explicit during lowering:
- Lifecycle hook calls (`__destroy`/`__oncopy`) at scope exits and assignments
- Move semantics (ownership transfers)
- Debug checks (bounds, overflow, null)
- Monomorphization of generic types and functions

## KIR Lowering Transformations

| Source construct | KIR output |
|---|---|
| Variable declaration | `stack_alloc` |
| Assignment to variable with hooks | `call __destroy` on old + copy + `call __oncopy` on new |
| Scope exit | `call __destroy` on all live variables (reverse order) |
| `move` keyword | Direct copy, no `__oncopy`/`__destroy`, mark source invalid |
| Function param (copy) | `call __oncopy` on entry, `call __destroy` on exit |
| Function param (`move`) | No lifecycle ops |
| Return value | RVO: out-pointer, direct write |
| `defer` statement | Reordered to scope exit (LIFO) |
| Generic type usage | Monomorphized to concrete type |
| Debug bounds check | `bounds_check` instruction |
| Debug overflow | `overflow_check` instruction |

## KIR Opcodes

Flat, labeled instruction format with typed registers.

### Memory
- `stack_alloc <Type>` — allocate on stack frame
- `load <reg.field>` — load field from struct
- `store <reg.field>, <value>` — store into field
- `call_destroy <reg>` — call `__destroy` on value
- `call_oncopy <reg>` — call `__oncopy` on value

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
struct User {
    name: string;
    age: int;
}

fn createUser(n: string, a: int) -> User {
    return User{ name: n, age: a };
}

fn main() -> int {
    let user = createUser("Andrey", 21);
    let age = user.age;
    return age;
}
```

KIR output (debug):
```
func createUser(n: string, a: i32, __out: ptr<User>):
    call_oncopy n                ; n.count++
    store __out.name, n
    store __out.age, a
    ret_void

func main() -> i32:
    %0 = stack_alloc User
    %1 = string_literal "Andrey"
    call createUser(%1, 21, %0)
    %2 = load %0.age
    call_destroy %0              ; triggers User.__destroy
                                 ;   -> calls string.__destroy on name field
    ret %2
```

## Compiler Optimizations

The KIR pass can perform optimizations before C codegen:

- **No-op hook elimination**: If `__destroy`/`__oncopy` are no-ops (primitive-only struct), remove all calls
- **Last-use move**: Automatically convert last-use of a variable to move (skip `__oncopy`/`__destroy`)
- **Inline expansion**: Small functions inlined at KIR level
- **Dead store elimination**: Remove writes to variables that are never read
- **RVO**: Return values constructed directly at call site via out-pointer
