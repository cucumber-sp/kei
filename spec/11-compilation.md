# Compilation Model

## Pipeline

```
.kei source files
       ↓
     Lexer → Token stream
       ↓
     Parser → AST
       ↓
     Checker (type checking, lifecycle analysis, scope validation, exhaustiveness)
       ↓
     KIR Lower → KIR Module (SSA form)
       │  - Build CFG from AST control flow
       │  - Compute dominance tree & frontiers
       │  - Insert phi nodes, rename to SSA variables
       │  - Monomorphize generics
       │  - Generate lifecycle hooks (__destroy/__oncopy)
       │  - Insert debug checks (bounds, overflow, null, move)
       ↓
     KIR Passes (optimization pipeline)
       │  - Mandatory: lifecycle elision, dead code elimination
       │  - Release: constant folding, inlining, CSE, loop hoisting, ...
       ↓
     Backend
       ├── C Backend: de-SSA pass → C emitter → GCC/Clang → native binary
       └── LLVM Backend (future): direct SSA → LLVM IR → native binary
```

## Source-only compilation

All imports from `src/` and `deps/` are resolved at compile time. Everything is compiled into a single KIR module (and then a single `.c` file for the C backend).

**Benefits:**
- Whole-program visibility for monomorphization and optimization
- No ABI contracts, no header files, no precompiled libraries
- Compiler can eliminate unused code, inline aggressively, and elide lifecycle hook calls

## CLI

```bash
kei src/main.kei --build              # → binary (debug profile)
kei src/main.kei --build --release    # → binary (release profile)
kei src/main.kei --build --backend=clang   # pick the C compiler
kei src/main.kei --run                # build + execute
kei src/main.kei --emit-c             # generated C → stdout
kei src/main.kei --kir                # KIR text format (pre-mem2reg)
kei src/main.kei --kir-opt            # KIR after mem2reg
kei src/main.kei --check              # type-check only
kei src/main.kei --ast                # AST tree
kei src/main.kei                      # lex + dump tokens
```

The binary lives next to the source (`src/main.kei` → `src/main`). Custom
output names are not yet wired through the CLI.

## Debug vs Release

### Debug mode
- Array/slice bounds checking (`bounds_check`)
- Division by zero → panic
- Integer overflow detection (`overflow_check`)
- Null pointer dereference checks (`null_check`) in unsafe blocks
- Use-after-move detection (`move_check`)
- `assert` statements active (`assert_check`)
- `require` statements active (`require_check`)
- Full stack traces on panic

### Release mode
- All debug checks removed (except `require`)
- `assert` statements stripped entirely
- Lifecycle hook elision where compiler proves no-op or single ownership
- Aggressive inlining via KIR passes + C compiler optimizations (`-O2`/`-O3`)
- Dead code elimination at both KIR and C compiler level
- Equivalent performance to hand-written C

## Linking

External C libraries will be linked via a `--link` flag:

```bash
kei main.kei --build --link sqlite3
# → gcc output.c -lsqlite3 -o main

kei main.kei --build --link "openssl,zlib"
# → gcc output.c -lssl -lcrypto -lz -o main
```

`--link` is roadmap; today the C compiler invocation is fixed to
`-g -O0` (debug) or `-O2 -DNDEBUG` (release).

## C Backend Details

The C backend produces a single `.c` file from the de-SSA'd KIR:

- **SSA variables** → C local variables (`int _v0`, `float _v1`, ...)
- **Basic blocks** → C labels + goto
- **Phi nodes** → eliminated by de-SSA (copies inserted at predecessor block ends)
- **Lifecycle hooks** → inline C function calls
- **Structs** → C structs with matching layout
- **Enums (simple)** → C enums
- **Enums (data variants)** → tagged unions
- **Debug checks** → `if (!cond) kei_panic(...)` (debug) or omitted (release)
- **String/Array** → COW structs with refcount operations

### Generated C conventions
- All Kei functions prefixed: `kei_modulename_funcname`
- Mangled generic names: `kei_Vec_i32_push`
- Runtime header: `kei_runtime.h` (panic, refcount helpers, string/array ops)
- Entry point: `main()` calls `kei_main_main()`

## LLVM Backend (Future)

When implemented, the LLVM backend will:
- Skip de-SSA — LLVM IR is already SSA
- Map KIR types directly to LLVM types
- Map KIR instructions to LLVM instructions (mostly 1:1)
- Use LLVM's optimization pipeline instead of KIR passes
- Produce native binaries for any LLVM-supported target

The KIR design with SSA and typed instructions makes this transition straightforward.
