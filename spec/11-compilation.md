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
kei build src/main.kei              # → binary (debug)
kei build src/main.kei -o app       # custom output name
kei build src/main.kei --release    # release mode
kei emit-c src/main.kei             # → .c file only (inspect generated C)
kei emit-kir src/main.kei           # → KIR text format (inspect IR)
kei run src/main.kei                # build and execute
```

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

External C libraries are linked via the `--link` flag:

```bash
kei build main.kei --link sqlite3
# → gcc output.c -lsqlite3 -o main

kei build main.kei --link "openssl,zlib"
# → gcc output.c -lssl -lcrypto -lz -o main
```

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
