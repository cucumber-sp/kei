# Spec Status

What's specified versus what the compiler implements today. The spec describes
the language we're designing; this file records how far the implementation has
caught up. Items here are roadmap candidates — pick one and open a PR.

Status tags:

- **WIP** — partial: parser/checker may be done, KIR or backend missing pieces.
- **PLANNED** — specified, no compiler work yet.
- **BLOCKED** — depends on another item that isn't done.

Anything not listed here is implemented end-to-end (source → KIR → C → binary)
and covered by tests.

## Type system

| Item                                      | Status   | Notes                                              |
|-------------------------------------------|----------|----------------------------------------------------|
| `T?` niche layout for pointers            | WIP      | Parser/checker accept `T?`; lowers to `ptr<T>`. Niche representation matches naturally. |
| `T?` tag-byte fallback for primitives     | PLANNED  | Today `i32?` etc. also lower to `ptr<T>` (heap-allocated). Native `{tag, value}` representation is the goal. |
| Tighten `null` assignability              | PLANNED  | Today `null` is assignable to any `ptr<T>`; once `T?` is the canonical absence story, `null` will be rejected on bare `ptr<T>` and only allowed on `T?`. |
| `ref T` / `ref mut T` (safe references)   | PLANNED  | `ref` reserved in lexer; no parser/checker work yet. Will compile to `const T*` / `T*`. |
| Traits / trait objects                    | PLANNED  | Fat-pointer layout `(data, vtable)` with size + destroy slot. |
| `string` / `array<T>` / `List<T>` as stdlib types | PLANNED | Currently `string` is compiler-known via `runtime.h`; `array<T>` is the inline-array shorthand. Migration needs an `unsafe struct` runtime in stdlib. |

## Memory model

| Item                                      | Status   | Notes                                              |
|-------------------------------------------|----------|----------------------------------------------------|
| Arena POD-only checker rule               | WIP      | `std/arena.kei` exists with bump-allocate API; the checker does not yet reject arena-allocating types with non-trivial `__destroy`. |
| String layout w/ offset (zero-copy substring) | PLANNED | Runtime `kei_string` is `{data, len, cap, ref}`; substring deep-copies. Spec target is `{ptr, offset, len, cap, count}` for refcount-only sub-ranges. |
| Optimization passes beyond mem2reg        | PLANNED  | Today only mem2reg + de-SSA run. No const fold, copy prop, CSE, inlining, or LICM. |

## Debug-mode runtime checks

| Check               | Status   | Notes                                              |
|---------------------|----------|----------------------------------------------------|
| Array bounds check  | done     | Emitted on every indexed access.                   |
| Division by zero    | PLANNED  | KIR has no `div_check`; runtime is C semantics.    |
| Integer overflow    | PLANNED  | `overflow_check` instruction unspec'd in lowering. |
| Null deref          | PLANNED  | `null_check` instruction unspec'd in lowering.     |
| Use-after-move      | WIP      | Caught in the checker; KIR `move_check` not emitted. |
| `assert` / `require`| PLANNED  | Parsed; no `assert_check` / `require_check` lowering yet. |

## Functions

| Item                                      | Status   | Notes                                              |
|-------------------------------------------|----------|----------------------------------------------------|
| Function-pointer type syntax `fn(…) -> …` | PLANNED  | Lexer has `fn`; parser doesn't accept it in type position. Plain 8-byte C pointer at runtime. |
| Variadic extern (`...`)                   | PLANNED  | Known parser limitation; `printf` cannot be spelled today. |
| No-nested-fn checker rule                 | PLANNED  | The parser only allows `fn` at module/struct level; an explicit error message would help diagnostics. |
| Migrate methods from `self: ptr<T>` → `self: ref mut T` | BLOCKED | Needs `ref T` first. `self: ptr<T>` is the only mutable-receiver form today. |

## Error handling

| Item                                      | Status   | Notes                                              |
|-------------------------------------------|----------|----------------------------------------------------|
| Generic-function `throws` propagation     | WIP      | Works for monomorphized cases; some edge cases still drop the throws set. |

## Concurrency

| Item                                      | Status   | Notes                                              |
|-------------------------------------------|----------|----------------------------------------------------|
| v1 single-threaded baseline               | current  | Stdlib refcounts are non-atomic; no threading API. |
| v2 `spawn` + `Mutex<T>` / `Atomic<T>`     | PLANNED  | Post-v1.                                           |
| v3 compile-time thread-safety check       | PLANNED  | Post-v2. Transitive type property (single bit), not a borrow check. |
| Async via compiler state machines         | PLANNED  | Deferred until `T?`, `move` elision, and traits land. |
