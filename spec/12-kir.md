# KIR — Kei Intermediate Representation

## Purpose

KIR is the compiler's internal representation of a Kei program. It bridges the gap between the AST (what the programmer wrote) and the output code (C, LLVM IR, or binary).

**Design goals:**
- **SSA form** — every variable assigned exactly once, enabling powerful optimizations
- **Typed in-memory graph** — not text; serializable to text (debug), JSON (tooling), or binary (caching)
- **Explicit semantics** — all implicit behavior made visible: lifecycle hooks, moves, debug checks
- **Backend-agnostic** — the same KIR feeds into C codegen, future LLVM backend, or a debug interpreter

## Architecture

```
AST
 ↓
KIR Lower (insert phis via dominance frontiers, monomorphize generics,
           generate lifecycle hooks, insert debug checks)
 ↓
KIR Module (in-memory typed graph)
 ↓
KIR Passes (optimization pipeline — each pass: KirModule → KirModule)
 ↓
De-SSA Pass (eliminate phi nodes for C backend)
 ↓
C Emitter / LLVM Emitter / Debug Printer
```

## Structure

### Module

A KIR module is the top-level compilation unit — one per program.

```
KirModule
├── globals: KirGlobal[]        — global/static variables
├── functions: KirFunction[]    — all functions (including monomorphized generics)
├── types: KirTypeDecl[]        — struct/enum type declarations
└── externs: KirExtern[]        — extern function declarations
```

### Function

```
KirFunction
├── name: string                — mangled name (e.g. "Vec_i32_push")
├── params: KirParam[]          — typed parameters
├── returnType: KirType         — return type (Void for void)
├── blocks: KirBlock[]          — basic blocks; blocks[0] = entry
└── localCount: number          — total number of SSA variables used
```

### Basic Block

A basic block is a straight-line sequence of instructions with:
- **Phi nodes** at the top (if any) — resolve values from predecessor blocks
- **Instructions** in the middle — compute, load, store, call
- **Terminator** at the end — exactly one; controls where execution goes next

```
KirBlock
├── id: BlockId                 — unique label ("entry", "loop.header", "if.then", ...)
├── phis: KirPhi[]              — φ-nodes (always at block start)
├── instructions: KirInst[]     — body
└── terminator: KirTerminator   — exit (branch, jump, ret, switch, unreachable)
```

**Invariants:**
- Every block ends with exactly one terminator
- Phi nodes only appear at block start, before any instructions
- Entry block has no phi nodes (function params are its inputs)
- Every variable is assigned exactly once (SSA property)

### Phi Node

A phi node selects a value based on which predecessor block execution came from.

```
KirPhi
├── dest: VarId                 — SSA variable being defined
├── type: KirType               — type of the value
└── incoming: { value: VarId, from: BlockId }[]
```

Example: after an if/else that both assign to `result`:
```
φ %result.2 = [%result.0 from if.then, %result.1 from if.else]
```

### Instructions

Every instruction produces at most one value (assigned to `dest`). Instructions are typed discriminated unions.

#### Memory
| Instruction | Description |
|---|---|
| `stack_alloc dest, Type` | Allocate space on stack frame |
| `load dest, ptr` | Load value from pointer |
| `store ptr, value` | Store value to pointer |
| `field_ptr dest, base, fieldName` | Get pointer to struct field |
| `index_ptr dest, base, index` | Get pointer to array element |

#### Arithmetic & Comparison
| Instruction | Description |
|---|---|
| `add dest, lhs, rhs` | Addition |
| `sub dest, lhs, rhs` | Subtraction |
| `mul dest, lhs, rhs` | Multiplication |
| `div dest, lhs, rhs` | Division |
| `mod dest, lhs, rhs` | Modulo |
| `neg dest, operand` | Negation |
| `eq dest, lhs, rhs` | Equal |
| `neq dest, lhs, rhs` | Not equal |
| `lt dest, lhs, rhs` | Less than |
| `gt dest, lhs, rhs` | Greater than |
| `lte dest, lhs, rhs` | Less or equal |
| `gte dest, lhs, rhs` | Greater or equal |

#### Bitwise
| Instruction | Description |
|---|---|
| `bit_and dest, lhs, rhs` | Bitwise AND |
| `bit_or dest, lhs, rhs` | Bitwise OR |
| `bit_xor dest, lhs, rhs` | Bitwise XOR |
| `bit_not dest, operand` | Bitwise NOT |
| `shl dest, lhs, rhs` | Shift left |
| `shr dest, lhs, rhs` | Shift right |

#### Logical
| Instruction | Description |
|---|---|
| `and dest, lhs, rhs` | Logical AND |
| `or dest, lhs, rhs` | Logical OR |
| `not dest, operand` | Logical NOT |

#### Constants
| Instruction | Description |
|---|---|
| `const_int dest, type, value` | Integer constant |
| `const_float dest, type, value` | Float constant |
| `const_bool dest, value` | Boolean constant |
| `const_string dest, value` | String literal |
| `const_null dest, type` | Null pointer |

#### Functions
| Instruction | Description |
|---|---|
| `call dest, func, args[]` | Function call |
| `call_void func, args[]` | Void function call (no dest) |

#### Lifecycle
| Instruction | Description |
|---|---|
| `destroy value` | Call `__destroy` on value |
| `oncopy value` | Call `__oncopy` on value |
| `move dest, source` | Move ownership (no lifecycle ops) |

#### Type operations
| Instruction | Description |
|---|---|
| `cast dest, value, targetType` | Type cast |
| `sizeof dest, type` | Size of type in bytes |

#### Debug (debug mode only, stripped in release)
| Instruction | Description |
|---|---|
| `bounds_check index, length` | Panic if index ≥ length |
| `overflow_check op, lhs, rhs` | Panic if arithmetic overflows |
| `null_check ptr` | Panic if pointer is null |
| `move_check var` | Panic if use-after-move |
| `assert_check cond, message` | `assert` — removed in release |
| `require_check cond, message` | `require` — kept in release |

### Terminators

Every block ends with exactly one terminator.

| Terminator | Description |
|---|---|
| `ret value` | Return value from function |
| `ret_void` | Return void |
| `jump target` | Unconditional jump to block |
| `br cond, thenBlock, elseBlock` | Conditional branch |
| `switch value, cases[], defaultBlock` | Multi-way branch |
| `unreachable` | Marks provably unreachable code |

## Type System

KIR types mirror Kei types but are fully resolved (no aliases, no generics).

```
KirType =
  | { kind: "int", bits: 8|16|32|64, signed: boolean }
  | { kind: "float", bits: 32|64 }
  | { kind: "bool" }
  | { kind: "void" }
  | { kind: "ptr", pointee: KirType }
  | { kind: "struct", name: string, fields: KirField[] }
  | { kind: "enum", name: string, variants: KirVariant[] }
  | { kind: "array", element: KirType, length: number }
  | { kind: "function", params: KirType[], returnType: KirType }
```

All generic types are monomorphized before KIR — `array<i32>` becomes a concrete `Array_i32` struct type.

## SSA Construction

### Lowering from AST

The KIR lowerer converts the type-checked AST to SSA form using the standard algorithm:

1. **Build CFG** — create basic blocks from control flow (if/else, while, for, match)
2. **Compute dominance tree** — which blocks dominate which
3. **Compute dominance frontiers** — where phi nodes are needed
4. **Insert phi nodes** — at dominance frontier boundaries for each variable
5. **Rename variables** — walk dominator tree, assign fresh SSA names

This is the Cytron et al. (1991) algorithm — well-studied, efficient, standard in every SSA compiler.

### De-SSA (for C backend)

Before C codegen, phi nodes are eliminated:

```
// SSA:
L3:
  φ %x.3 = [%x.1 from L1, %x.2 from L2]

// After de-SSA — insert copies at end of predecessors:
L1:
  ...
  %x.3 = %x.1    // ← inserted
  jump L3
L2:
  ...
  %x.3 = %x.2    // ← inserted
  jump L3
L3:
  // use %x.3 directly
```

In C output, SSA variables become local variables. The C compiler handles register allocation.

LLVM backend skips de-SSA entirely — LLVM IR is already SSA.

## KIR Lowering Transformations

These transformations happen during AST → KIR lowering:

| Source construct | KIR output |
|---|---|
| Variable declaration | `stack_alloc` + `store` |
| Assignment with hooks | `destroy` old → copy → `oncopy` new |
| Scope exit | `destroy` all live variables (reverse declaration order) |
| `move` keyword | `move` instruction, mark source invalid |
| Function param (copy) | `oncopy` on entry, `destroy` on exit |
| Function param (`move`) | No lifecycle ops |
| Return value | RVO: out-pointer, direct store |
| `defer` statement | Reordered to scope exit (LIFO) |
| Generic type usage | Monomorphized to concrete type |
| `assert(cond, msg)` | `assert_check` (debug only) |
| `require(cond, msg)` | `require_check` (always) |
| `throws`/`catch` | Branch-based error paths |
| Array access `a[i]` | `bounds_check` (debug) + `index_ptr` + `load` |

## Optimization Passes

Each pass takes a `KirModule` and returns a (possibly modified) `KirModule`. Passes are composable and order-independent where possible.

### Mandatory passes (always run)
| Pass | Description |
|---|---|
| **Lifecycle elision** | Remove `destroy`/`oncopy` calls for primitive-only structs (no-op hooks) |
| **Dead code elimination** | Remove instructions whose results are never used |
| **De-SSA** | Eliminate phi nodes (C backend only) |

### Optimization passes (release mode)
| Pass | Description |
|---|---|
| **Constant folding** | Evaluate constant expressions at compile time |
| **Constant propagation** | Replace variable uses with known constant values |
| **Copy propagation** | Replace `%b = %a` with direct use of `%a` |
| **Common subexpression elimination** | Deduplicate identical computations |
| **Dead store elimination** | Remove writes to variables that are never read |
| **Last-use move** | Auto-convert last use of a variable to `move` (skip `oncopy`/`destroy`) |
| **Function inlining** | Inline small functions at call sites |
| **Loop-invariant code motion** | Hoist invariant computations out of loops |
| **Debug check removal** | Strip all `assert_check`, `bounds_check`, `overflow_check`, etc. |

## Text Format (Debug)

Human-readable text representation for debugging and testing. Not the canonical format — just a pretty-printer.

```
module main

type User = struct {
  name: string
  age: i32
}

extern fn print(s: string): void

fn createUser(n: string, a: i32, __out: ptr<User>): void {
entry:
  %0 = field_ptr __out, "name"
  oncopy n
  store %0, n
  %1 = field_ptr __out, "age"
  store %1, a
  ret_void
}

fn main(): i32 {
entry:
  %user = stack_alloc User
  %0 = const_string "Andrey"
  call_void createUser(%0, const_int i32 21, %user)
  %1 = field_ptr %user, "age"
  %age = load %1
  destroy %user
  ret %age
}
```

### SSA with phi nodes:

```
fn fibonacci(n: i32): i32 {
entry:
  %cond = lt n, const_int i32 2
  br %cond, base, loop.init

base:
  ret n

loop.init:
  %init.a = const_int i32 0
  %init.b = const_int i32 1
  %init.i = const_int i32 2
  jump loop.header

loop.header:
  %a = φ [%init.a from loop.init, %b from loop.body]
  %b = φ [%init.b from loop.init, %sum from loop.body]
  %i = φ [%init.i from loop.init, %i.next from loop.body]
  %done = gte %i, n
  br %done, loop.exit, loop.body

loop.body:
  %sum = add %a, %b
  %i.next = add %i, const_int i32 1
  jump loop.header

loop.exit:
  ret %b
}
```

## Binary Format (Future)

A compact binary serialization of KIR for:
- **Incremental compilation** — cache KIR per module, recompile only changed files
- **Pre-compiled libraries** — distribute KIR instead of source
- **Cross-compilation** — serialize on one machine, codegen on another

Not specified in v0.0.1 — text format and in-memory representation are sufficient.
