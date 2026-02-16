# Kei Compiler — Type Checker (Semantic Analysis)

## Overview

Implement the **checker** — the semantic analysis phase of the Kei compiler. The checker walks the AST produced by the parser and validates that the program is semantically correct: types match, variables exist, scopes are respected, lifecycle rules are enforced, and unsafe boundaries are checked.

**Compiler location:** `/Users/cucumbersp/.openclaw/workspace/kei/compiler`

The lexer (`src/lexer/`) and parser (`src/parser/`, `src/ast/`) are already implemented. The checker is the next phase.

## CRITICAL: Read everything first!

Before writing ANY code:

### 1. Read ALL spec files (the language definition)
- `/Users/cucumbersp/.openclaw/workspace/kei/spec/01-design.md` — Philosophy, two-tier memory model overview
- `/Users/cucumbersp/.openclaw/workspace/kei/spec/03-types.md` — ALL types: primitives, ptr<T>, generics, arrays, strings, type aliases, conversions
- `/Users/cucumbersp/.openclaw/workspace/kei/spec/04-variables.md` — let, const, static, operators, type inference
- `/Users/cucumbersp/.openclaw/workspace/kei/spec/05-control.md` — if/else, while, for, switch, defer, assert/require, break/continue
- `/Users/cucumbersp/.openclaw/workspace/kei/spec/06-functions.md` — fn, extern fn (requires unsafe to call!), params (mut/move), return types, throws
- `/Users/cucumbersp/.openclaw/workspace/kei/spec/07-structures.md` — struct, unsafe struct, methods, generics, lifecycle hooks (__destroy/__oncopy)
- `/Users/cucumbersp/.openclaw/workspace/kei/spec/08-memory.md` — Two-tier memory model, lifecycle hooks, move semantics, alloc/free (built-in, require unsafe), unsafe blocks
- `/Users/cucumbersp/.openclaw/workspace/kei/spec/09-errors.md` — throws/catch/throw, catch panic, catch throw, exhaustive handling, compile-time enforcement
- `/Users/cucumbersp/.openclaw/workspace/kei/spec/10-modules.md` — import, pub visibility, extern fn, FFI

### 2. Read the existing compiler code
- `src/ast/nodes.ts` — ALL AST node types (you're checking these)
- `src/ast/visitor.ts` — AstVisitor interface (use or extend this)
- `src/lexer/token.ts` — Token types, Span
- `src/errors/diagnostic.ts` — Diagnostic, Severity, SourceLocation
- `src/parser/parser.ts` — To understand what AST shapes the parser produces
- `src/utils/source.ts` — SourceFile
- `src/cli.ts` — To understand current CLI (you'll extend it)
- `tests/parser/helpers.ts` — Test helper patterns
- `biome.json`, `tsconfig.json` — Code quality rules

## File Structure

```
compiler/src/
├── checker/
│   ├── checker.ts          # Main Checker class — orchestrates all checking
│   ├── types.ts            # Internal type representation (resolved types, not AST TypeNodes)
│   ├── scope.ts            # Scope/symbol table (nested scopes, lookup)
│   ├── symbols.ts          # Symbol definitions (variables, functions, types, etc.)
│   ├── builtins.ts         # Built-in types and functions (int, string, alloc, free, sizeof, print, panic)
│   ├── type-resolver.ts    # Resolve AST TypeNode → internal Type (handle aliases, generics, primitives)
│   ├── expr-checker.ts     # Type-check expressions, return their resolved type
│   ├── stmt-checker.ts     # Type-check statements
│   ├── decl-checker.ts     # Type-check declarations (fn, struct, enum, etc.)
│   └── index.ts            # Re-exports
compiler/tests/
├── checker/
│   ├── helpers.ts           # Test utilities (check(), checkErrors(), expectType(), etc.)
│   ├── scopes.test.ts       # Variable resolution, shadowing, nested scopes
│   ├── types.test.ts        # Type checking: arithmetic, comparisons, assignments, inference
│   ├── functions.test.ts    # Function calls, params, return types, throws
│   ├── structs.test.ts      # Struct fields, methods, self types, generic structs
│   ├── enums.test.ts        # Enum variants, switch exhaustiveness
│   ├── errors.test.ts       # throws/catch/throw validation, exhaustive handling
│   ├── unsafe.test.ts       # Unsafe blocks, extern fn, alloc/free, ptr operations
│   ├── lifecycle.test.ts    # __destroy/__oncopy validation, move tracking
│   ├── control-flow.test.ts # Reachability, return checking, break/continue in loops
│   └── integration.test.ts  # Full programs that exercise multiple features together
```

## Type System Design

### Internal Type Representation

The checker needs its OWN type representation — separate from AST `TypeNode`. AST types are syntactic (`NamedType { name: "int" }`), internal types are semantic (resolved, concrete).

```typescript
// Core type kinds — discriminated union
type Type =
  | IntType          // { kind: "int", bits: 8|16|32|64, signed: boolean }
  | FloatType        // { kind: "float", bits: 32|64 }
  | BoolType         // { kind: "bool" }
  | VoidType         // { kind: "void" }
  | StringType       // { kind: "string" }
  | PtrType          // { kind: "ptr", pointee: Type }
  | ArrayType        // { kind: "array", element: Type }
  | SliceType        // { kind: "slice", element: Type }
  | StructType       // { kind: "struct", name: string, fields: Map<string, Type>, methods: Map<string, FunctionType>, isUnsafe: boolean, genericParams?: string[] }
  | EnumType         // { kind: "enum", name: string, baseType: Type | null, variants: EnumVariantInfo[] }
  | FunctionType     // { kind: "function", params: ParamInfo[], returnType: Type, throwsTypes: Type[] }
  | NullType         // { kind: "null" } — type of the null literal, assignable to ptr<T>
  | ErrorType        // { kind: "error" } — sentinel for cascading error recovery (don't report further errors)
  | RangeType        // { kind: "range", element: Type }
```

### Type Aliases

Type aliases are **transparent** — `type UserId = int` means `UserId` IS `int`. The resolver replaces aliases immediately. No wrapper type, no distinct type.

### Primitive Aliases

These are built-in aliases, NOT type declarations:
- `int` = `i32`, `long` = `i64`, `float` = `f32`, `double` = `f64`
- `byte` = `u8`, `short` = `i16`
- `isize` and `usize` = platform pointer-width (treat as 64-bit)

### Generic Monomorphization (for checking)

The checker doesn't actually monomorphize — that's KIR's job. But it needs to:
- Track generic parameters on struct/function declarations
- Validate generic argument counts match parameters
- Substitute type parameters when checking generic usage
- e.g., `Pair<int, string>` → check that `first: A` resolves to `int`, `second: B` to `string`

## Scope / Symbol Table

### Scope Structure

Nested lexical scopes. Each scope has a parent (except the global scope).

```typescript
class Scope {
  parent: Scope | null;
  symbols: Map<string, Symbol>;
  isUnsafe: boolean;      // true inside unsafe { } blocks
  isLoop: boolean;        // true inside while/for (for break/continue validation)
  functionContext: FunctionType | null;  // enclosing function (for return type checking, throws validation)
}
```

### Symbol Kinds

```typescript
type Symbol =
  | VariableSymbol     // let/const/static/param — { name, type, isMutable, isConst, isMoved }
  | FunctionSymbol     // fn/extern fn — { name, type: FunctionType, isExtern }
  | TypeSymbol         // struct/unsafe struct/enum/type alias — { name, type, declaration }
```

### Scope Nesting

```
Global Scope
├── type: Point (struct)
├── type: User (struct)
├── fn: main (function)
│   └── Function Scope (main)
│       ├── let x: int
│       ├── if-block scope
│       │   └── let y: int (shadowing allowed)
│       ├── while-loop scope (isLoop = true)
│       │   └── ...
│       └── unsafe-block scope (isUnsafe = true)
│           └── ...
└── fn: helper (function)
    └── Function Scope (helper)
```

## What the Checker Validates

### 1. Name Resolution
- Every identifier usage resolves to a declared symbol
- Variables declared before use (no forward references for variables)
- Types can forward-reference (struct A can have field of type B declared later)
- Shadowing is allowed (inner scope can redeclare a name)
- Error: "undeclared variable 'x'"
- Error: "undeclared type 'Foo'"
- Error: "undeclared function 'bar'"

### 2. Type Checking — Expressions
- **Arithmetic** (`+`, `-`, `*`, `/`, `%`): both operands must be numeric, same type. Result = same type
- **Comparison** (`<`, `>`, `<=`, `>=`): both operands must be numeric, same type. Result = bool
- **Equality** (`==`, `!=`): both operands must be same type. Result = bool
- **Logical** (`&&`, `||`): both must be bool. Result = bool
- **Logical NOT** (`!`): operand must be bool. Result = bool
- **Bitwise** (`&`, `|`, `^`, `~`, `<<`, `>>`): both must be integer type, same type. Result = same type
- **Unary minus** (`-`): must be numeric. Result = same type
- **Address-of** (`&`): result = ptr<T> where T is operand type. Only valid in unsafe context
- **Index** (`a[i]`): `a` must be array/slice type, `i` must be integer. Result = element type
- **Member access** (`a.b`): `a` must be struct/enum with field/method `b`
- **Deref** (`a.*`): `a` must be ptr<T>. Result = T. Only in unsafe context
- **Call** (`f(args)`): `f` must be function type, arg count and types must match params
- **Struct literal** (`Point{ x: 1.0, y: 2.0 }`): all fields must be provided, types must match
- **If expression**: both branches must have the same type, `else` required
- **Assign** (`x = v`): `x` must be mutable, types must match
- **Compound assign** (`+=`, `-=`, etc.): x must be mutable, types must be numeric
- **Increment/Decrement** (`x++`, `x--`): x must be mutable integer type
- **Range** (`0..10`): both operands must be integer, result = Range type
- **Move** (`move x`): x must be a variable, marks it as moved
- **Throw** (`throw E{}`): only inside function with `throws`, E must be one of the declared thrown types
- **Catch**: see error handling section below
- **Null literal**: type is `null`, assignable only to `ptr<T>`
- **Integer literal**: default type `i32` (alias `int`), can be inferred from context
- **Float literal**: default type `f64` (alias `double`), can be inferred from context
- **String literal**: type is `string`
- **Bool literal**: type is `bool`

### 3. Type Checking — Statements
- **let**: if type annotation, check initializer matches. If no annotation, infer type from initializer
- **const**: same as let, but marked immutable
- **return**: value type must match enclosing function's return type. `return;` only in void functions
- **if**: condition must be bool
- **while**: condition must be bool
- **for**: iterable must be array/slice/range. Loop variable gets element type. Index variable (if any) gets int type
- **switch**: subject type determines valid case values. With enums: check exhaustiveness
- **defer**: statement must be valid in current scope
- **break/continue**: must be inside a loop
- **assert/require**: condition must be bool, message (if present) must be string
- **expression statement**: just type-check the expression

### 4. Type Checking — Declarations
- **fn**: check body with params in scope. All code paths must return correct type (or void). If `throws`, validate throw statements match declared types
- **extern fn**: just register in scope (no body to check). Calls require unsafe
- **struct**: check for duplicate field names. Register type. Check methods — `self` param type must be `T` or `ptr<T>` where T is the struct
- **unsafe struct**: same as struct, plus: if has ptr<T> fields, MUST define `__destroy` AND `__oncopy` (compile error otherwise)
- **enum**: if simple (has baseType), check variant values match base type. If data enum, check variant field types
- **type alias**: resolve the target type, register alias
- **static**: check initializer is compile-time constant (for now: literals only)
- **import**: register imported names (no actual module system in v0.0.1 — just register names)

### 5. Unsafe Boundary Enforcement
- `alloc<T>(n)` and `free(ptr)` — only callable inside `unsafe { }` block
- `extern fn` calls — only inside `unsafe { }` block
- `ptr<T>` dereference (`p.*`) — only inside `unsafe { }` block
- Pointer arithmetic (`ptr + offset`) — only inside `unsafe { }` block
- Address-of (`&x`) — only inside `unsafe { }` block
- Error: "cannot call extern function outside unsafe block"
- Error: "cannot call 'alloc' outside unsafe block"
- Error: "pointer dereference requires unsafe block"

### 6. Error Handling Validation
- Calling a `throws` function WITHOUT `catch` is a compile error
- `catch` block must handle ALL declared error types (exhaustive) — OR use `default` clause
- `catch throw` — current function must declare `throws` with compatible error types
- `catch panic` — always valid (panics on any error)
- `throw E{}` — only inside functions that declare `throws E`
- `throw E{}` — E must be one of the declared thrown types
- Error: "unhandled error types: NotFound, DbError"
- Error: "cannot use 'catch throw' — function does not declare 'throws'"
- Error: "error type 'Foo' is not declared in function's throws clause"

### 7. Move Tracking
- After `move x`, any use of `x` is a compile error
- Move tracking is per-scope (if moved in one branch of if/else, conservative: treat as moved after)
- Function params with `move` keyword: mark as moved at call site
- Error: "use of moved variable 'x'"

### 8. Return Path Analysis
- Every non-void function must return on all code paths
- If an `if` has no `else`, only the `then` branch returns — the function may fall through
- While loops: assume they may not execute (condition could be false initially)
- Switch with `default`: if all cases + default return, function returns
- Error: "function 'foo' does not return a value on all paths"

### 9. Mutability Checking
- `let x = ...` — x is IMMUTABLE by default
- `let mut x = ...` — x is mutable (NOTE: check if parser supports `mut` on let — if not, all let are mutable for now)
- `const x = ...` — always immutable
- `static X = ...` — immutable
- Assignment to immutable variable is a compile error
- Error: "cannot assign to immutable variable 'x'"
- Params: immutable by default, `mut` param creates mutable copy

### 10. Implicit Conversions
- Integer widening: smaller int → larger int (i8 → i16 → i32 → i64, u8 → u16 → u32 → u64)
- Signed → unsigned: NOT implicit (must use `as`)
- Array → slice: implicit
- Everything else requires explicit `as` cast
- `null` assignable to any `ptr<T>` type

## Built-in Functions and Types

Register these in the global scope automatically:

### Built-in types
All primitive types: `i8`, `i16`, `i32`, `i64`, `u8`, `u16`, `u32`, `u64`, `f32`, `f64`, `bool`, `string`, `void`, `isize`, `usize`, `c_char`
Aliases: `int`=`i32`, `long`=`i64`, `float`=`f32`, `double`=`f64`, `byte`=`u8`, `short`=`i16`
Generic types: `ptr<T>`, `array<T>`, `slice<T>`, `Shared<T>`

### Built-in functions (require unsafe)
- `alloc<T>(count: usize) -> ptr<T>` — heap allocation
- `free<T>(p: ptr<T>)` — heap deallocation

### Built-in functions (safe)
- `sizeof(T) -> usize` — compile-time size of type (this is special — takes a type, not a value)
- `panic(message: string) -> void` — terminate program (noreturn)
- `print(value: string) -> void` — console output (placeholder for stdlib)

## Checker API

```typescript
class Checker {
  constructor(program: Program) { ... }

  // Main entry point — check entire program
  check(): CheckResult;

  // Result contains resolved type information + diagnostics
  // CheckResult: { diagnostics: Diagnostic[], typeMap: Map<AstNode, Type> }
}
```

The `typeMap` maps AST expression nodes to their resolved Type. This is used by later phases (KIR lowering) to know the type of every expression without re-inferring.

## Error Recovery

Like the parser, the checker should NOT stop at the first error:
- Use `ErrorType` as a sentinel — when an expression has type errors, give it ErrorType
- Don't report cascading errors: if something is ErrorType, don't report further type mismatches on it
- Continue checking the rest of the program
- Return ALL diagnostics at the end

## Testing Requirements — BE EXTREMELY THOROUGH

### helpers.ts
```typescript
// Parse + check, return diagnostics
function check(source: string): Diagnostic[];

// Parse + check, expect zero errors
function checkOk(source: string): void;

// Parse + check, expect specific error messages (substring match)
function checkErrors(source: string, expectedErrors: string[]): void;

// Parse + check, get resolved type of last expression statement
function typeOf(source: string): Type;
```

### scopes.test.ts (20+ tests)
- Variable declared and used
- Variable used before declaration → error
- Variable from outer scope accessible in inner scope
- Shadowing: inner variable shadows outer
- Variable not accessible after scope ends
- Function parameters in scope inside function body
- Nested function scopes don't leak
- Static variables in global scope
- Duplicate variable declaration in same scope → error
- For loop variable scoped to loop body
- For loop index variable scoped to loop body
- Switch case body has own scope
- Struct fields accessible via dot notation
- Method `self` parameter in scope
- Import names in scope (basic)

### types.test.ts (40+ tests)
- Integer arithmetic: `1 + 2` → int
- Float arithmetic: `1.0 + 2.0` → double
- Mixed numeric types: `1 + 1.0` → error (no implicit int↔float)
- Boolean logic: `true && false` → bool
- Comparison: `1 < 2` → bool
- String concatenation: `"a" + "b"` → string (if spec supports it, otherwise error)
- Type inference: `let x = 42;` → x is int
- Type annotation match: `let x: int = 42;` → ok
- Type annotation mismatch: `let x: string = 42;` → error
- Null type: `let p: ptr<int> = null;` → ok
- Null to non-ptr: `let x: int = null;` → error
- Integer widening: `let x: i64 = 42;` (i32 literal → i64) → ok
- No implicit signed↔unsigned: `let x: u32 = -1;` → error
- Explicit cast: `let x: i32 = someI64 as i32;` → ok (NOTE: check if `as` is in parser — if not, skip cast tests)
- Array element type: `let arr = [1, 2, 3]; let x = arr[0];` → x is int
- Struct field type: `p.x` where p: Point → f64
- Function return type: `let x = add(1, 2);` → int (from fn add return type)
- Void function in expression → error: "void value used in expression"
- If expression: both branches same type → ok
- If expression: different branch types → error
- Assign to immutable → error
- Compound assign type check: `x += 1.0` where x: int → error
- Increment on non-integer → error
- Bitwise on non-integer → error
- Logical on non-bool → error
- Unary minus on bool → error
- Address-of outside unsafe → error
- Deref outside unsafe → error
- Deref of non-pointer → error
- Index of non-array → error
- Index with non-integer → error
- Struct literal with missing fields → error
- Struct literal with wrong field type → error
- Struct literal with unknown field → error
- Range: `0..10` → Range type
- Range with non-integer → error
- Method call resolves correctly
- Static method call (Type.method()) resolves correctly
- Generic struct instantiation: `Pair<int, string>` → fields have correct types

### functions.test.ts (25+ tests)
- Simple function call with correct args → ok
- Wrong number of arguments → error
- Wrong argument type → error
- Return type matches → ok
- Return type mismatch → error
- Missing return in non-void function → error
- Return with value in void function → error
- Return without value in non-void function → error
- All paths return (if/else both return) → ok
- Not all paths return (if without else) → error
- `mut` param is mutable inside function
- Non-mut param is immutable
- `move` param: original marked as moved at call site
- Recursive function → ok (function visible in its own body)
- Extern fn registered correctly
- Extern fn call outside unsafe → error
- Extern fn call inside unsafe → ok
- Function with `throws` — call without catch → error
- Function without `throws` — can't use `throw` inside → error
- Generic function: `identity<int>(42)` → ok, returns int
- Function with multiple return paths all correct
- Void function with no return statement → ok
- Void function with `return;` → ok
- `panic()` is noreturn — code after panic is unreachable (warning)

### structs.test.ts (20+ tests)
- Access field of struct → correct type
- Access non-existent field → error
- Method call with `self: T` → ok
- Method call with `self: ptr<T>` → ok (auto address-of)
- Struct literal creates correct type
- Duplicate field names in struct → error
- Generic struct: field types substitute correctly
- Nested struct field access: `a.b.c`
- Method returning self type
- Constructor pattern (static method returning Self)
- Struct with string field → has lifecycle hooks (no explicit check needed, just validates)
- Assign struct with compatible types → ok
- Assign struct with wrong type → error

### enums.test.ts (15+ tests)
- Simple enum: variant values match base type
- Simple enum: duplicate values → error (or warning?)
- Data enum: variant fields have correct types
- Switch on enum: all variants covered → ok
- Switch on enum: missing variant, no default → error
- Switch on enum: missing variant, has default → ok
- Enum used as type annotation
- Enum variant construction
- Access enum variant (future: match/destructuring)

### errors.test.ts (25+ tests)
- Call throws function without catch → error
- Call throws function with catch handling all types → ok
- Catch missing an error type → error
- Catch with default clause covers remaining → ok
- `catch panic` → always ok
- `catch throw` in function that throws same types → ok
- `catch throw` in function that doesn't throw → error
- `catch throw` with incompatible throws types → error
- `throw E{}` inside function that throws E → ok
- `throw E{}` inside function that doesn't throw E → error
- `throw E{}` outside throws function → error
- Error type is a valid struct → ok
- Nested catch: inner function throws, outer catches
- Catch clause variable has correct error type
- Multiple throws types, all handled
- Mix of local handling and propagation
- catch throw propagates correctly through call chain
- Non-exhaustive catch without default → error

### unsafe.test.ts (20+ tests)
- `unsafe { }` block enters unsafe scope
- `alloc<u8>(1024)` inside unsafe → ok
- `alloc<u8>(1024)` outside unsafe → error
- `free(ptr)` inside unsafe → ok
- `free(ptr)` outside unsafe → error
- Extern fn call inside unsafe → ok
- Extern fn call outside unsafe → error
- `ptr.*` dereference inside unsafe → ok
- `ptr.*` dereference outside unsafe → error
- Pointer arithmetic inside unsafe → ok (if supported)
- `&x` (address-of) inside unsafe → ok, returns ptr<T>
- `&x` outside unsafe → error
- Nested unsafe blocks
- `ptr<T>` field only in unsafe struct → (this is a parser/decl check)
- Unsafe struct without __destroy when has ptr<T> → error
- Unsafe struct without __oncopy when has ptr<T> → error
- Unsafe struct with both hooks and ptr<T> → ok
- Unsafe struct without ptr<T> — hooks optional → ok
- `sizeof(int)` → usize (safe, no unsafe needed)

### lifecycle.test.ts (15+ tests)
- `move x` marks x as moved
- Use after move → error
- Move in one branch of if: conservative — treat as maybe moved → error on use after
- Move param at call site
- `move x` where x is not a variable → error (can't move a field access or literal)
- Struct with ptr<T> requires __destroy — error if missing
- Struct with ptr<T> requires __oncopy — error if missing
- Regular struct (no ptr) — hooks auto-generated, no error
- __destroy signature must be `fn __destroy(self: T)` 
- __oncopy signature must be `fn __oncopy(self: T) -> T`

### control-flow.test.ts (15+ tests)
- `break` inside while → ok
- `break` outside loop → error
- `continue` inside for → ok
- `continue` outside loop → error
- `return` in void function (no value) → ok
- `return value` in void function → error
- `return` (no value) in non-void → error
- If/else both return → function returns ok
- If without else: only then returns → function may not return
- While loop body: break/continue valid
- Nested loops: break/continue affect innermost
- Defer: valid statement
- Switch exhaustiveness with enums
- Unreachable code after return → warning

### integration.test.ts (10+ tests)
- Complete program: main function returns int
- Program with struct + methods + function calls
- Program with error handling (throws/catch)
- Program with unsafe block and extern fn
- Program with generics
- Program with enums and switch
- Program with loops, break, continue
- Program with move semantics
- Complex.kei fixture should pass checker with zero errors (adapt if needed)
- Multiple functions calling each other

## CLI Update

Add `--check` flag to CLI:
```bash
bun run src/cli.ts file.kei --check    # Run checker, print diagnostics
```

Output format:
```
error: undeclared variable 'x' at test.kei:5:12
error: type mismatch: expected 'int', got 'string' at test.kei:8:3
warning: unreachable code after return at test.kei:12:5
0 warnings, 2 errors
```

## Code Quality Rules (CRITICAL — same as lexer/parser)

- **NO `any`** — strict TypeScript, use proper discriminated unions
- **NO magic strings** — use enums or constants for type kinds, error messages templates, etc.
- **DRY** — helper methods for common patterns (e.g., `expectType()`, `isNumeric()`, `isAssignableTo()`)
- **Biome clean** — `bunx biome check --write`, zero errors
- **Descriptive names** — `checkBinaryExpression()` not `checkBinExpr()`
- **Error messages are clear and specific** — include expected type, got type, variable name, location
- **Each file < 500 lines** — split if larger (that's why there are separate checker files)
- **Consistent patterns** — if one check returns `Type`, they all return `Type`. If one reports via `this.error()`, they all do
- **Follow existing conventions** — look at how the parser handles diagnostics, error recovery, etc.

## Key Design Decisions

1. **Two-pass approach**: First pass registers all top-level declarations (types, functions, statics). Second pass checks function bodies. This allows forward references between functions and types.

2. **ErrorType sentinel**: When a type error is found, return `ErrorType` and don't cascade. If an expression is `ErrorType`, skip further checks involving it.

3. **Type compatibility function**: `isAssignableTo(source: Type, target: Type): boolean` — central function that handles exact match, integer widening, null→ptr, etc.

4. **Immutability by default**: In the current parser, `let` doesn't parse `mut`. Check the parser — if it doesn't support `let mut`, treat all `let` bindings as mutable for now (we'll tighten this later). Document this as a TODO.

5. **Generics**: For v0.0.1, simple substitution — replace type params with concrete type args. No constraints/bounds. Error if type arg count doesn't match param count.

6. **sizeof**: Special-cased — it takes a TYPE as argument, not a value. The parser may represent this as a regular call expression with an Identifier. Handle it specially in call checking.

## Final Verification

1. `cd /Users/cucumbersp/.openclaw/workspace/kei/compiler && bun test` — ALL tests pass (lexer + parser + checker)
2. `bunx biome check --write` — zero errors
3. `bun run src/cli.ts tests/fixtures/complex.kei --check` — should pass with 0 errors (or document what needs fixing in complex.kei)
4. Test count should be 450+ total (existing 282 + 170+ new checker tests)

DO NOT commit to git — the parent will review first.
