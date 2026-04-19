# Spec Status

Tracks what's spec'd versus what's actually implemented in the compiler. Replaces
the older `SPEC-AUDIT.md` — the spec has since been updated to match intent, so
most of that document's rows are no longer meaningful.

Anything spec'd but not implemented is listed below with a status tag:

- **PLANNED** — spec'd, not yet touched in the compiler.
- **WIP** — partially implemented (parser/checker done, backend missing, etc.).
- **BLOCKED** — depends on another item that isn't done yet.

## Type system

| Item                                      | Status   | Notes                                              |
|-------------------------------------------|----------|----------------------------------------------------|
| `T?` nullability (niche for pointers)     | PLANNED  | Lexer tokenises `?`; no parser/checker/KIR yet.    |
| `T?` tag-byte fallback for primitives     | PLANNED  | Do after pointer niche lands.                      |
| `ref T` / `ref mut T` (safe references)   | PLANNED  | Parser + checker scope rule; no borrow checker. Compiles to `const T*` / `T*`. |
| Traits / trait objects                    | PLANNED  | Fat-pointer layout `(data, vtable)` with size+destroy. |
| Arena allocator (`Arena` stdlib type)     | PLANNED  | POD-only restriction enforced by checker.          |
| `string` / `array<T>` / `List<T>` stdlib  | PLANNED  | Currently compiler-known; migrate to stdlib-defined. |

## Memory model

| Item                                      | Status   | Notes                                              |
|-------------------------------------------|----------|----------------------------------------------------|
| `move` elides scope-exit `__destroy`      | WIP      | Parsed + use-after-move checked; KIR still emits destroy. |
| `defer` lowering                          | WIP      | Parsed; not yet wired into KIR scope-exit emission. |
| Debug checks (overflow, null deref, move) | PLANNED  | Spec lists them; KIR doesn't emit them yet.        |
| Optimization passes (const-fold, inline)  | PLANNED  | mem2reg works; no other passes run.                |

## Functions

| Item                                      | Status   | Notes                                              |
|-------------------------------------------|----------|----------------------------------------------------|
| `main()` must return `int` (validation)   | PLANNED  | Small checker addition, ~5 lines.                  |
| Function-pointer type syntax `fn(…) -> …` | PLANNED  | Spec'd; parser + checker changes needed. Plain 8-byte C pointer. |
| Variadic extern (`...`)                   | PLANNED  | Known parser limitation; `printf` can't be spelled today. |
| No-nested-fn checker rule                 | PLANNED  | Reject `fn` inside block statements.               |
| Deprecate `self: ptr<T>` method receivers | PLANNED  | Migrate to `self: ref mut T`; add lint / error.    |

## Error handling

| Item                                      | Status   | Notes                                              |
|-------------------------------------------|----------|----------------------------------------------------|
| Generic-function throws propagation       | WIP      | Works for monomorphized cases; edge cases pending. |

## Concurrency

| Item                                      | Status   | Notes                                              |
|-------------------------------------------|----------|----------------------------------------------------|
| v1 single-threaded baseline               | current  | Non-atomic refcounts in stdlib; no threading API.  |
| v2 `spawn` + `Mutex<T>`, `Atomic<T>`      | PLANNED  | Post-v1.                                           |
| v3 compile-time thread-safety check       | PLANNED  | Post-v2. Transitive type property, not lifetimes.  |
| Async via compiler state machines         | PLANNED  | Deferred until `T?`, `move` elision, traits land.  |

## Compiler hygiene (not user-visible, but blocks features)

| Item                                      | Status   | Notes                                              |
|-------------------------------------------|----------|----------------------------------------------------|
| `KirLowerer` prototype-patching refactor  | PLANNED  | Convert to `LoweringCtx` + pure functions.         |
| `CheckResult` 9-map consolidation         | PLANNED  | Group into `types` / `generics` / `lifecycle`.     |
| `cli.ts` split                            | PLANNED  | `args.ts` + `driver.ts` + `diagnostics-format.ts`. |
| Embed `runtime.h` at build time           | PLANNED  | Remove fs lookup in c-emitter.                     |
| Delete unused `AstVisitor`                | PLANNED  | Nothing uses it.                                   |

## Spec cleanup applied in this revision

For reference — items recently **resolved** by rewriting the spec (not the compiler):

- `dynarray` removed (was in grammar, never implemented, duplicated `array<T>`).
- Postfix `++` / `--` removed from lexical spec (source of evaluation-order bugs).
- Array CoW moved from language types to stdlib section (it was never a compiler feature).
- Function overloading: spec said "not supported", compiler has tested support; spec updated.
- `as` cast operator formalised in keyword list + grammar (was an EXTRA item).
- Keyword list reconciled across `02-lexical.md`, `13-grammar.md` (they had drifted).
- **Closures rejected as a language feature.** Functions are module-level or
  struct-member only; no capture lists, no heap-promoted closure type. State is
  always passed explicitly, or (eventually) bundled via traits.
- **`ptr<T>` confirmed unsafe-only.** The old `self: ptr<T>` method pattern is
  deprecated in favour of `self: ref mut T`, which is safe and needs no `unsafe`
  block in the method body.
- **Substring of `string` returns `string`** (not `slice<u8>`). CoW heap types
  share their buffer via refcount; they do not produce views whose lifetime the
  compiler can't see.
