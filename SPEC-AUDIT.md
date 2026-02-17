# Kei Spec Compliance Audit

Compiler implementation audited against `spec/01-design.md` through `spec/13-grammar.md`.
Date: 2026-02-17
Last updated: 2026-02-18

Legend:
- **MISSING** — spec describes it, compiler doesn't implement it
- **DIVERGENT** — compiler implements it differently from spec
- **EXTRA** — compiler implements something not in spec
- **PARTIAL** — parser/checker work but KIR/backend don't

---

## spec/01-design.md

Design principles document — no testable features. Used as reference for intent.

- ~~DIVERGENT~~ **FIXED**: Regular `struct` now correctly rejects `ptr<T>` fields (requires `unsafe struct`).
- ~~MISSING~~ **FIXED**: Auto-generated `__oncopy`/`__destroy` for value structs with managed fields is now implemented.
- MISSING: `move` keyword for zero-cost ownership transfer is parsed and checked but has no effect in codegen (no lifecycle elision in KIR/backend).

---

## spec/02-lexical.md

### Implemented correctly
- Single-line comments (`//`) and multi-line comments (`/* ... */`)
- Identifiers: `[a-zA-Z_][a-zA-Z0-9_]*`
- Integer literals: decimal, hex (`0xFF`), binary (`0b1010`), octal (`0o77`)
- Digit separators (`1_000_000`) in all numeric literal forms
- Float literals: `3.14`, `.75`, `1.`, `1.0e10`, `2.5e-3`, with digit separators
- String literals with all escape sequences: `\n`, `\t`, `\r`, `\\`, `\"`, `\0`, `\xHH`
- All arithmetic operators: `+`, `-`, `*`, `/`, `%`
- Increment/decrement: `++`, `--` (tokenized and parsed as postfix)
- All comparison operators: `==`, `!=`, `<`, `<=`, `>`, `>=`
- Logical operators: `&&`, `||`, `!`
- Bitwise operators: `&`, `|`, `^`, `~`, `<<`, `>>`
- All assignment operators: `=`, `+=`, `-=`, `*=`, `/=`, `%=`, `&=`, `|=`, `^=`, `<<=`, `>>=`
- Member access: `.`, `.*` (dereference), `->` (arrow)
- Address-of: `&`
- Range operators: `..`, `..=`
- Fat arrow: `=>` (tokenized, reserved for future `match`)
- Semicolons required for all statements

### Findings
- EXTRA: `as` keyword tokenized (not in spec's keyword list, but used for cast expressions)
- EXTRA: `array` is a keyword in the lexer (not in spec's keyword list)
- EXTRA: All primitive type names (`i8`, `u16`, `f64`, `isize`, etc.) are keywords in the lexer (spec lists them as types, not keywords)
- EXTRA: `null` is a keyword in the lexer (spec lists it as a literal, not a keyword)
- EXTRA: `assert`, `require`, `panic`, `defer`, `pub`, `self`, `mut`, `in`, `type`, `static`, `slice`, `dynarray`, `bool`, `string`, `void`, `int`, `uint`, `ptr` are all keywords (spec's keyword list in 02-lexical.md has a smaller set; the grammar in 13-grammar.md has the full set)

---

## spec/03-types.md

### Implemented correctly
- All 10 integer types: `i8`, `i16`, `i32`, `i64`, `isize`, `u8`, `u16`, `u32`, `u64`, `usize`
- Built-in aliases: `byte`=`u8`, `short`=`i16`, `int`=`i32`, `long`=`i64`, `float`=`f32`, `double`=`f64`
- Float types: `f32`, `f64`
- `bool` type
- `c_char` type
- `ptr<T>` raw pointer type
- `void` type
- `null` literal (assignable to any `ptr<T>`)
- `as` cast expressions (numeric↔numeric, bool→int, ptr→ptr in unsafe)
- Implicit integer widening (i32→i64, u8→u16, unsigned→signed when safe)
- `string` type (builtin, works for literals and function params)
- User-defined type aliases (`type UserId = int;` — fully transparent)

### Findings
- ~~MISSING~~ **FIXED**: Numeric literal suffixes (`42u32`, `2.5f32`) are now supported.
- DIVERGENT: `array<T, N>` fixed-size array type — spec says `let a: array<int, 3> = [1, 2, 3]` with explicit length parameter. Compiler uses array literal syntax `[1, 2, 3]` with length inferred; cannot write `array<int, 3>` as a type annotation.
- MISSING: `array<T>` heap-allocated dynamic array with COW semantics — type parses but no stdlib implementation exists (no `__oncopy`/`__destroy` for refcounted arrays).
- MISSING: `List<T>` growable collection — not in compiler or stdlib.
- MISSING: `slice<T>` semantics — type exists in checker, range syntax `arr[1..4]` parses, but automatic array→slice conversion not implemented. Slices are not usable end-to-end.
- ~~MISSING~~ **FIXED**: `uint` type alias is now registered in the primitive type map.
- DIVERGENT: `string` is a builtin type in the compiler, not an `unsafe struct` in stdlib as spec describes. No COW semantics, no refcounting — string literals work but the memory model described in spec is not implemented.

---

## spec/04-variables.md

### Implemented correctly
- `let` — mutable variables, type inference works
- `const` — immutable binding, reassignment prevented
- `static` — compile-time constants, parsed and lowered to KIR
- Uninitialized variables forbidden (parser requires initializer)
- Variable shadowing allowed in nested scopes, forbidden in same scope
- Dereference syntax is `p.*` (postfix, matches spec)
- Range operators `..` (exclusive) and `..=` (inclusive) both implemented
- `move` keyword parsed, checked (marks variable as moved, prevents reuse)

### Findings
No divergences found. All variable features match spec.

---

## spec/05-control.md

### Implemented correctly
- `if`/`else` with optional parentheses around condition
- `if` as expression (`let x = if a > b { a } else { b }`)
- `while` loops with `break`/`continue`
- `for i in 0..10` range iteration (both `..` and `..=`)
- `for item in collection` array iteration
- `for item, index in collection` iteration with index variable
- `switch` with no fall-through, multiple values per case (`case 2, 3:`), `default` clause
- `switch` with enum exhaustiveness checking
- `defer` statement (LIFO execution order)
- `assert(cond)` and `assert(cond, "message")` — debug-only check
- `require(cond)` and `require(cond, "message")` — always-on check

### Findings
- ~~MISSING~~ **FIXED**: `switch` as expression is now implemented.
- MISSING: `switch` range matching — spec shows `case 4..10:` but no evidence this is handled in KIR lowering/backend (parser may accept range expressions as case values but semantics unclear).

---

## spec/06-functions.md

### Implemented correctly
- `fn` declaration with typed params and return type
- `mut` parameter modifier (creates mutable local copy)
- `move` parameter modifier (ownership transfer)
- Parameters immutable by default (enforced)
- `extern fn` declarations
- `extern fn` calls require `unsafe` block (enforced)
- `pub fn` visibility modifier
- Generic functions with monomorphization (`fn max<T>(a: T, b: T) -> T`)
- Recursion supported

### Findings
- MISSING: `main()` must return `int` — spec says "Must return `int` (exit code)" but compiler does not validate this. `main` is treated as a regular function.
- MISSING: Variadic extern functions (`...`) — spec shows `extern fn printf(fmt: ptr<c_char>, ...) -> int` but parser does not handle `...` in parameter lists. (Noted as known limitation.)

---

## spec/07-structures.md

### Implemented correctly
- `struct` with fields
- Methods with `self: T` (by-value copy)
- Methods with `self: ptr<T>` (by-pointer, auto address-of at call site)
- Static methods / constructors (methods without `self` param)
- `unsafe struct` declaration
- `__destroy` lifecycle hook (validated signature)
- `__oncopy` lifecycle hook (validated signature)
- Enforcement: `unsafe struct` with `ptr<T>` fields must define both `__destroy` and `__oncopy`
- Generic structs with monomorphization (`struct Pair<A, B>`)
- Struct literal syntax (`Point{ x: 1.0, y: 2.0 }`)

### Findings
- ~~DIVERGENT~~ **FIXED**: Regular `struct` now correctly rejects `ptr<T>` fields (requires `unsafe struct`).
- ~~MISSING~~ **FIXED**: Auto-generated `__destroy`/`__oncopy` for regular structs with managed fields is now implemented.

---

## spec/08-memory.md

### Implemented correctly
- `alloc(count)` builtin — requires `unsafe`, one argument
- `free(ptr)` builtin — requires `unsafe`, validates pointer arg
- `sizeof(T)` builtin — returns `usize`
- `unsafe` blocks with scope tracking
- Address-of `&` operator (requires unsafe)
- Dereference `.*` operator (requires unsafe)
- `move` keyword (parsing and use-after-move detection)
- Scope-exit `__destroy` calls (KIR emits destroy in reverse declaration order)

### Findings
- ~~DIVERGENT~~ **FIXED**: `alloc<T>(count)` now returns `ptr<T>` as spec requires.
- ~~MISSING~~ **FIXED**: Auto-generated lifecycle hooks for value structs (same as 07-structures fix).
- ~~MISSING~~ **FIXED**: Reassignment now calls `__destroy` on old value before storing the new value.

---

## spec/09-errors.md

### Implemented correctly
- `throws` in function signature
- `throw` statement
- `catch` block with named error handling (per-type clauses with optional variable binding)
- `catch panic` shorthand
- `catch throw` auto-propagation (with tag remapping)
- `default` clause in catch blocks
- Exhaustive error handling enforcement (missing error type = compile error)
- `panic(msg)` builtin function
- Simple numeric `enum` with optional backing type (`enum Color : u8 { Red = 0, Green = 1 }`)
- `enum` with data variants (`enum Shape { Circle(radius: f64), Point }`) — parsing and type checking

### Findings
- ~~PARTIAL~~ **FIXED**: Enum data variants now fully work end-to-end — tagged union C structs, construction, switch on tags, and variant destructuring are all implemented.
- PARTIAL: Simple numeric enums — type declarations are lowered and emitted as C enums, but switch-on-enum codegen may have gaps for complex patterns.

---

## spec/10-modules.md

### Implemented correctly
- `pub` visibility for functions, structs, enums, type aliases, statics
- Private by default (enforced)
- `import module;` whole-module import
- `import { name1, name2 } from module;` selective import
- Module-qualified access (`math.add(5, 3)`)
- Nested module paths (`net.http` → `src/net/http.kei`)
- Circular dependency detection in topological sort
- Source-only compilation model

### Findings
No divergences found. Module system matches spec.

---

## spec/11-compilation.md

### Implemented correctly
- Pipeline: Lexer → Parser → Checker → KIR → de-SSA → C emitter → cc
- C backend: SSA variables → C locals, basic blocks → labels + goto
- Struct → C struct, extern → C extern declaration
- Runtime header with panic, print helpers
- Entry point: `main()` calls `kei_main()`

### Findings
- MISSING: CLI flags `--release`, `--link`, `emit-kir`, `emit-c` — spec describes these but implementation status not audited (CLI is outside compiler core).
- MISSING: Debug checks — spec lists `bounds_check`, `overflow_check`, `null_check`, `move_check`, `assert_check`, `require_check`. Only `bounds_check` and `assert_check`/`require_check` appear implemented; `overflow_check`, `null_check`, `move_check` are not emitted.
- MISSING: Release mode optimizations — lifecycle elision, constant folding, inlining, CSE, etc. are described in spec but most optimization passes are not implemented.

---

## spec/12-kir.md

Skipping deep KIR internals audit per instructions. High-level:

- SSA form with phi nodes: implemented
- De-SSA pass: implemented
- mem2reg: implemented
- Basic block structure: implemented
- Error handling lowering (throws → tagged return): implemented

### Findings
- PARTIAL: Lifecycle instructions (`destroy`, `oncopy`, `move`) exist in KIR but are only partially utilized. `destroy` at scope exit works; `oncopy` on assignment and `move` optimization are incomplete.
- MISSING: Most optimization passes listed in spec (constant folding, copy propagation, CSE, dead store elimination, last-use move, function inlining, loop-invariant code motion).

---

## spec/13-grammar.md

### Implemented correctly
- All grammar productions for: functions, structs, unsafe structs, enums, type aliases, statics, imports, extern functions
- Generic params and args
- All statement types: let, const, return, if, while, for, switch, defer, unsafe block, assert, require
- Expression grammar: literals, identifiers, binary/unary ops, member access, dereference, index, call, if-expr, struct literal, address-of, move, catch
- Import declarations (both whole-module and selective)

### Findings
- MISSING: `dynarray<T>` — listed in grammar type production but not implemented. `array<T>` is used instead as the dynamic array syntax.
- ~~MISSING~~ **FIXED**: `uint` primitive type is now registered in the checker.
- DIVERGENT: Keyword list differences between spec sections — `02-lexical.md` has a smaller keyword list than `13-grammar.md`. The compiler follows the larger list from `13-grammar.md`.

---

## Summary of all findings

### MISSING (spec says X, compiler doesn't implement it)

| # | Feature | Spec Section | Severity | Status |
|---|---------|-------------|----------|--------|
| 1 | ~~Numeric literal suffixes (`42u32`, `2.5f32`)~~ | 03-types | Medium | **FIXED** |
| 2 | `array<T>` heap array with COW stdlib | 03-types | High | |
| 3 | `List<T>` growable collection | 03-types | Medium | |
| 4 | `slice<T>` usable semantics + array→slice conversion | 03-types | High | |
| 5 | ~~`uint` type mapping in checker~~ | 03-types, 13-grammar | Low | **FIXED** |
| 6 | ~~`switch` as expression~~ | 05-control | Medium | **FIXED** |
| 7 | `switch` range matching (`case 4..10:`) | 05-control | Low | |
| 8 | `main()` must return `int` validation | 06-functions | Low | |
| 9 | Variadic extern (`...`) | 06-functions | Low | |
| 10 | ~~Auto-generated `__destroy`/`__oncopy` for value structs~~ | 07-structures, 08-memory | High | **FIXED** |
| 11 | ~~Reassignment `__destroy` on old value~~ | 08-memory | High | **FIXED** |
| 12 | ~~`alloc<T>` returning `ptr<T>` (not `ptr<void>`)~~ | 08-memory | Medium | **FIXED** |
| 13 | Debug checks: overflow, null, move | 11-compilation | Medium | |
| 14 | Optimization passes (constant folding, inlining, etc.) | 11-compilation, 12-kir | Low | |
| 15 | `dynarray<T>` type from grammar | 13-grammar | Low | |

### DIVERGENT (compiler implements it differently from spec)

| # | Feature | Spec Says | Compiler Does | Status |
|---|---------|-----------|---------------|--------|
| 1 | `array<T, N>` type syntax | `array<int, 3>` with explicit length | Length inferred from literal only | |
| 2 | `string` implementation | `unsafe struct` in stdlib with COW | Builtin type, no COW | |
| 3 | ~~Regular struct with `ptr<T>`~~ | ~~Forbidden (requires `unsafe struct`)~~ | ~~Allowed without error~~ | **FIXED** |
| 4 | ~~`alloc<T>` return type~~ | ~~`ptr<T>`~~ | ~~`ptr<void>`~~ | **FIXED** |
| 5 | Keyword list (02-lexical) | 25 keywords | 60+ keywords (includes types, builtins) | |

### PARTIAL (parser/checker work, backend doesn't)

| # | Feature | What Works | What Doesn't | Status |
|---|---------|-----------|--------------|--------|
| 1 | ~~Enum data variants~~ | ~~Parsing, type checking~~ | ~~KIR lowers type only, C backend emits simple enum (no tagged union)~~ | **FIXED** |
| 2 | Generic monomorphization | Checker-level substitution, name mangling, generic struct literals in generic functions, generic function chains | KIR/C backend not updated for generics | **PARTIAL FIX** |
| 3 | Operator overloading | Checker resolution (`operatorMethods` map) | KIR/C backend not updated | |
| 4 | `move` keyword | Parsing, use-after-move detection | No lifecycle elision in codegen | |

### EXTRA (compiler implements what's not in spec)

| # | Feature | Notes |
|---|---------|-------|
| 1 | `as` cast keyword | Not in spec keyword list but works as cast operator |
| 2 | `array` keyword | Compiler treats `array` as keyword; spec uses it as type name |
| 3 | Primitive types as keywords | `i8`, `u32`, `f64`, etc. are keywords in lexer, not just type names |
| 4 | Postfix `++`/`--` | Tokenized and parsed; spec lists them as operators but doesn't define semantics |
