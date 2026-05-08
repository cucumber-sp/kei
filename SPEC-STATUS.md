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

| Item                                                          | Status   | Notes                                              |
|---------------------------------------------------------------|----------|----------------------------------------------------|
| `Optional<T>` replaces `T?` and the `null` literal             | PLANNED  | Spec target: drop the `?` suffix and the `null` keyword; absence is the regular generic enum `Optional<T>`. Today the parser/checker still accept `T?` and `null`; both are deprecated until the migration lands. |
| `Optional<T>` niche layout for pointer-shaped types           | PLANNED  | One-word representation when `T` is `*T`, `Shared<T>`, `Weak<T>`, or other pointer-niched types; `None` reuses the zero/null bit pattern. |
| `Optional<T>` tag-byte fallback for non-niched primitives     | PLANNED  | `Optional<i32>`, `Optional<struct>` etc. carry an explicit tag byte. |
| `ref T` / `readonly ref T` (safe references)                  | PLANNED  | `ref` reserved in lexer; no parser/checker work yet. Will compile to `T*` / `const T*`. |
| Auto-deref insertion for `ref T` values                       | PLANNED  | Type-directed: applies only to values of type `ref T` (param or unsafe-struct field), not to `Shared<T>` or other wrapper types. |
| `addr(field)` operator                                        | PLANNED  | Slot lvalue for a `ref T` field; unsafe-only. |
| `init field = value` initialization-write                     | PLANNED  | Unsafe-only at field level; emitted implicitly inside struct literals. |
| `readonly` modifier on fields/params                          | PLANNED  | Two senses: blocks reassignment for plain types; blocks write-through for `ref T`. |
| Lifecycle hook ABI flip (`fn __oncopy(self: ref T)`, void)    | PLANNED  | Today `__oncopy(self: T) -> T`. New ABI mutates the slot in place via the ref. |
| Drop `mut` keyword everywhere                                 | PLANNED  | Removes `mut` parameter form, `let mut`, `&mut`, `ref mut T`. |
| Drop `ptr<T>` / `slice<T>` keywords                           | PLANNED  | `ptr<T>` replaced by `*T` (unsafe) and `ref T` (safe). `slice<T>` removed entirely. |
| Un-reserve `shared`                                           | PLANNED  | `shared` is no longer a keyword; `Shared<T>` is a regular stdlib unsafe struct. |
| Traits / trait objects                                        | PLANNED  | Fat-pointer layout `(data, vtable)` with size + destroy slot. |
| `Shared<T>` stdlib                                            | PLANNED  | Canonical refcount primitive. Single-allocation layout via two `ref` fields. |
| `String` / `Array<T>` / `List<T>` as stdlib types             | PLANNED  | `String` migration deferred — runtime currently in C (`runtime.h`). `Array<T>` and `List<T>` follow once `Shared<T>` is real. |

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
| Migrate methods from `self: ptr<T>` → `self: ref T` | BLOCKED | Needs `ref T` first. `self: ptr<T>` is the only mutable-receiver form today. |

## Error handling

| Item                                      | Status   | Notes                                              |
|-------------------------------------------|----------|----------------------------------------------------|
| Generic-function `throws` propagation     | WIP      | Works for monomorphized cases; some edge cases still drop the throws set. |

## Concurrency

| Item                                              | Status   | Notes                                              |
|---------------------------------------------------|----------|----------------------------------------------------|
| v1 single-threaded baseline                       | current  | Stdlib refcounts are non-atomic; no threading API. |
| v2 `spawn` + `Mutex<T>` / `Atomic<T>` / `AtomicShared<T>` | PLANNED  | Post-v1.                                  |
| v3 compile-time thread-safety check               | PLANNED  | Post-v2. Transitive type property (single bit), not a borrow check. |
| Async via compiler state machines                 | PLANNED  | Deferred until `Optional<T>`, `move` elision, and traits land. |
