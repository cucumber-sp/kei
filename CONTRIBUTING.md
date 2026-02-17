# Contributing to Kei

## Project Structure

```
kei/
├── compiler/
│   ├── src/
│   │   ├── lexer/        # Tokenization (lexer.ts, token.ts)
│   │   ├── parser/       # Recursive descent parser (parser.ts, expr/stmt/decl/catch parsers)
│   │   ├── ast/          # AST node definitions
│   │   ├── checker/      # Type checking, semantic analysis, generics, operator overloading
│   │   ├── kir/          # KIR lowering, mem2reg, de-SSA, CFG, dominance
│   │   ├── backend/      # C code emission (c-emitter*.ts, de-ssa.ts)
│   │   ├── modules/      # Module resolution, topological sort, cycle detection
│   │   ├── errors/       # Diagnostics
│   │   ├── runtime/      # Runtime support
│   │   ├── utils/        # Source tracking utilities
│   │   └── cli.ts        # Entry point
│   ├── tests/
│   │   ├── lexer/        # 6 test files
│   │   ├── parser/       # 8 test files
│   │   ├── checker/      # 30 test files
│   │   ├── kir/          # 17 test files
│   │   ├── backend/      # 6 test files
│   │   ├── modules/      # 4 test files
│   │   ├── e2e/          # End-to-end tests
│   │   ├── stress/       # Stress tests
│   │   └── fixtures/     # .kei and .c test data
│   └── std/              # Standard library (io.kei, mem.kei)
├── spec/                 # Language specification (01-design.md … 13-grammar.md)
├── docs/                 # Getting started guide, language reference
└── SPEC-AUDIT.md         # Audit of spec compliance — good first issues live here
```

## Getting Started

```bash
# Install dependencies
cd compiler
bun install

# Run all tests
bun test

# Run a specific test file
bun test tests/checker/arrays.test.ts

# Compile and run a .kei file
bun src/cli.ts examples/hello.kei --run

# Other useful flags
bun src/cli.ts file.kei --ast       # Print AST
bun src/cli.ts file.kei --check     # Type check only
bun src/cli.ts file.kei --kir       # Print KIR
bun src/cli.ts file.kei --kir-opt   # Print KIR after mem2reg + de-SSA
bun src/cli.ts file.kei --emit-c    # Emit C code
bun src/cli.ts file.kei --build     # Compile to binary
```

## Code Style

[Biome](https://biomejs.dev/) enforces formatting and linting:

```bash
# Check for issues
bunx biome check src/ tests/

# Auto-fix
bunx biome check --write src/ tests/
```

Key rules: 2-space indents, double quotes, semicolons always, 100-char line width, `const` over `let`, template literals over concatenation, no `any`, no unused variables.

TypeScript is strict (`strict: true`, `noUncheckedIndexedAccess`). Relative imports use `.ts` extensions.

## Architecture

```
.kei source
  → Lexer        (src/lexer/)     → Token stream
  → Parser       (src/parser/)    → AST
  → Checker      (src/checker/)   → Typed AST + diagnostics
  → KIR lowering (src/kir/)       → SSA-form IR
  → mem2reg      (src/kir/)       → Optimized SSA
  → de-SSA       (src/backend/)   → Register-allocated IR
  → C emitter    (src/backend/)   → C source
  → cc                            → Binary
```

**Lexer** scans source into tokens. **Parser** is a hand-written recursive descent parser producing AST nodes. **Checker** runs multiple passes: pass 1 registers declarations, pass 1.5 auto-generates lifecycle hooks (`__destroy`/`__oncopy`), pass 2 type-checks function bodies. **KIR lowering** converts the typed AST into a block-based SSA intermediate representation. **mem2reg** promotes stack allocations to SSA values. **de-SSA** eliminates phi nodes for C emission. **C emitter** produces C code that `cc` compiles to a binary.

## How to Add a Feature

### New keyword / syntax

1. **Lexer** — add token type to `src/lexer/token.ts`, scanning logic to `src/lexer/lexer.ts`
2. **Parser** — add AST node to `src/ast/`, parse logic to the appropriate parser file (`expr-parser.ts`, `stmt-parser.ts`, `decl-parser.ts`)
3. **Checker** — add type checking to the corresponding checker file (`expr-checker.ts`, `stmt-checker.ts`, `decl-checker.ts`)
4. **KIR** — add lowering in `src/kir/lowering-expr.ts`, `lowering-stmt.ts`, or `lowering-decl.ts`
5. **Backend** — emit C in `src/backend/c-emitter-insts.ts` or `c-emitter-fn.ts`

### New type

1. Add the type definition to `src/checker/types/`
2. Handle it in the checker's type resolution (`type-resolver.ts`)
3. Add KIR type mapping in `src/kir/lowering-types.ts`
4. Add C emission in `src/backend/c-emitter-types.ts`

### New KIR instruction

1. Define the instruction type in `src/kir/kir-types/`
2. Emit it during lowering (`lowering-*.ts`)
3. Handle it in mem2reg if it touches memory (`mem2reg.ts`)
4. Handle it in de-SSA if needed (`de-ssa.ts`)
5. Emit C for it in `c-emitter-insts.ts`

## Testing Conventions

Tests use **Bun's built-in test runner** (`bun:test`). Each test directory has a `helpers.ts` with common utilities:

**Checker tests** — `tests/checker/helpers.ts`:
- `checkOk(source)` — assert no errors
- `checkError(source, expectedError)` — assert specific error message
- `typeOf(expr)` / `typeOfLet(source, varName)` — inspect resolved types

**KIR tests** — `tests/kir/helpers.ts`:
- `lower(source)` — parse + check + lower to KIR module
- `lowerFunction(source, name)` — get a specific function's KIR
- `getInstructions(fn, kind)` / `countInstructions(fn, kind)` — inspect KIR output

**Parser tests** — `tests/parser/helpers.ts`:
- `parse(source)` — parse source, return AST

**Backend tests** — compare emitted C against expected `.c` files in `tests/fixtures/`.

**E2E tests** — compile and run `.kei` programs, assert output.

Write tests for every change. Match existing naming style (`describe("Checker — Feature", ...)`) and keep one assertion per test where practical.

## Finding Things to Work On

Check **[SPEC-AUDIT.md](./SPEC-AUDIT.md)** — it lists every gap between the language spec and the current implementation, marked as `MISSING`, `PARTIAL`, or `DIVERGENT`. Items marked `MISSING` are good candidates for contribution.

## PR Process

1. Fork and branch from `main`
2. Make your changes, add tests
3. Run `bun test` and `bunx biome check src/ tests/` — both must pass
4. Open a PR with a short description of what changed and why
