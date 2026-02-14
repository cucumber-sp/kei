# Compilation Model

## Pipeline

```
.kei source files
       ↓
     Lexer → Tokens
       ↓
     Parser → AST
       ↓
     Type Checker (value/unsafe validation, lifecycle hook analysis, exhaustiveness)
       ↓
     KIR Lowering → KIR (monomorphization, __destroy/__oncopy generation, lifecycle ops, checks)
       ↓
     C Backend → .c file
       ↓
     GCC / Clang → native binary
```

## Source-only compilation

All imports from `src/` and `deps/` are resolved at compile time. Everything is compiled into a single `.c` file.

**Benefits:**
- Whole-program visibility for monomorphization and optimization
- No ABI contracts, no header files, no precompiled libraries
- Compiler can eliminate unused code, inline aggressively, and elide lifecycle hook calls

## CLI

```bash
kei build src/main.kei              # → binary (debug)
kei build src/main.kei -o app       # custom output name
kei build src/main.kei --release    # release mode
kei emit src/main.kei               # → .c file only (inspect generated C)
kei run src/main.kei                # build and execute
```

## Debug vs Release

### Debug mode
- Array/slice bounds checking
- Division by zero → panic
- Integer overflow detection
- Null pointer dereference checks (unsafe blocks)
- Use-after-move detection
- Lifecycle hook validation
- Full stack traces on panic

### Release mode
- All debug checks removed
- Lifecycle hook elision where compiler proves no-op or single ownership
- Aggressive inlining via C compiler optimizations (`-O2`/`-O3`)
- Dead code elimination
- Equivalent performance to hand-written C

## Linking

External C libraries are linked via the `--link` flag:

```bash
kei build main.kei --link sqlite3
# → gcc output.c -lsqlite3 -o main

kei build main.kei --link "openssl,zlib"
# → gcc output.c -lssl -lcrypto -lz -o main
```
