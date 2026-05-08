# Ref redesign: collapsing the pointer-type vocabulary

Status: **decisions captured** — design pinned via review pass; spec/tests/
compiler not yet updated. All sections previously marked **Open** are now
closed (see §6); the doc is the single source of truth subsequent commits
review against.

This document captures the redesign of Kei's reference / pointer / lifecycle
story. It is the result of a long design conversation that started from
"what optimizer passes would help most?" and ended at "the type system has
overlapping primitives and once we collapse them, most of the optimization
wins fall out for free."

The goal of this document is to be precise enough that subsequent commits
(spec edits, test fixtures, compiler changes) can be reviewed against a
single source of truth.

---

## 1. Motivation

The current type system carries four pointer-like things:

- `ref T` — safe, read-only, scope-bound (planned, not implemented).
- `mut T` — safe, read-write, scope-bound (planned, not implemented).
- `ptr<T>` — unsafe, read-write, no scope rule.
- `T?` — nullable wrapper that today lowers to `ptr<T>`.

Plus three lifecycle hooks (`__oncopy`, `__destroy`, `move`) that every
managed type must reason about. The `unsafe struct` lifecycle boilerplate
(refcount bump on copy, decrement-and-free on destroy) is hand-written
identically for `string`, `Shared<T>`, `array<T>`, with three opportunities
to get it wrong.

Two threads converge on the same simplification:

1. **Optimization side.** The C compiler (`-O2`) already handles scalar DCE,
   const-fold, scalar CSE, LICM, and inlining within a translation unit. The
   wins Kei can deliver that the C compiler can't are language-aware:
   eliding paired `__oncopy` / `__destroy`, eliminating refcount traffic on
   provably-unique values, and inlining the lifecycle primitives at the
   callsite. All of these benefit from a *smaller* set of distinct pointer
   shapes flowing through the IR.

2. **Design side.** `ref T` and `mut T` differ only in a write bit. `ptr<T>`
   and `mut T` differ only in a scope-bound check. Once auto-deref makes
   field access transparent through any pointer-like type, the user-visible
   distinctions collapse to "can this pointer escape its source's scope?"
   That is one bit, not three types.

The redesign collapses the surface, makes `shared<T>` self-hostable in
stdlib, and unlocks the lifecycle-elision optimizations that motivated the
investigation. It is a strictly larger change than expected, but it pays
off in both axes simultaneously.

---

## 2. The proposed model

### 2.1 Type vocabulary

The full set of pointer-like types user code can write:

| Type                | Where it appears                                                                    | Auto-deref | Use                                            |
|---------------------|-------------------------------------------------------------------------------------|------------|------------------------------------------------|
| `T`                 | anywhere                                                                            | n/a        | values                                         |
| `ref T`             | function/method parameter types; `unsafe struct` field types                        | yes        | safe mutable reference (≈ C# `ref`)            |
| `readonly ref T`    | function/method parameter types; `unsafe struct` field types                        | yes (read) | safe immutable reference (≈ C# `in`)           |
| `*T`                | `unsafe struct` field types; locals inside `unsafe` blocks; `extern fn` signatures  | no         | raw pointer for unsafe code                    |
| `shared<T>`         | anywhere                                                                            | **no**     | refcounted shared owner (regular unsafe struct) |

Removed (vs current spec): `mut T`, `ptr<T>`, `ref mut T`, the `mut` keyword
in all positions (no `let mut`, no `mut` parameter form). Mutability of
references is handled by `ref T` (mutable through the ref by default) vs
`readonly ref T` (immutable through the ref). Mutability of plain
fields/params is handled by absence/presence of the `readonly` modifier
(see §2.5).

`shared<T>` does **not** auto-deref. To touch the inner value you write
`s.value` explicitly; that field access auto-derefs because `shared<T>`
internally declares `value: ref T`. Auto-deref is a property of the `ref T`
type, not of `shared<T>` (see §2.2).

`ref T` is **never** legal in:

- Function or method return types.
- Local variable bindings (`let x: ref T = …` is rejected).
- Safe `struct` field types.
- Generic argument positions in safe code (i.e. `List<ref T>` is invalid).
- Array or slice element types.
- `static` global types.

This is enforced at the grammar / parser level. The restriction is
syntactic: there is no analysis pass needed to enforce it. Because `ref T`
cannot appear in any position that could outlive its source, it cannot be
made to dangle.

### 2.2 Auto-deref

Any access to a `ref T`-typed value automatically dereferences to T. This
applies to **values of type `ref T`** — i.e. to `ref T` parameters and to
`ref T` fields of `unsafe struct`s. It does **not** apply to `shared<T>`,
`*T`, or any other type. Auto-deref is a property of `ref T`, not a
general "wrapper" rule.

```kei
fn read(x: ref Item) -> i32 {
    return x.value;          // x.value reads from *x, returns i32
}
```

Auto-deref is **type-directed**: when the surrounding expression expects T,
the compiler inserts the dereference; when it expects `ref T`, the reference
is forwarded without dereferencing.

```kei
fn other(x: ref Item) { ... }

fn forward(x: ref Item) {
    other(x);                 // target type is `ref Item`, forwards as-is
    let v: Item = x;          // target type is Item, auto-derefs
    // `let r: ref Item = x` is REJECTED — `ref T` is not a legal local type.
}
```

For `shared<T>` and other regular types, **there is no auto-deref**. The
inner value is reached by going through the type's API surface — for
`shared<T>` that means `s.value` (which then auto-derefs because the
internal `value: ref T` field is itself `ref`):

```kei
let s: shared<i32> = ...;
let n: i32 = s.value;           // .value access triggers ref-field auto-deref
let v: i32 = s.value.value;     // for shared<shared<i32>>, peel by hand
// `let n: i32 = s` is REJECTED — shared<T> does not auto-deref to T.
```

There is **no operation in safe code that yields the pointer-value of a
`ref T`**. `&x` is unsafe; reading a `ref T` field of an `unsafe struct`
auto-derefs (returning T, not the pointer); methods returning `ref T`
auto-deref at the call site to T. Inside safe code, the pointer is a
compile-time abstraction — at runtime it is the C pointer the auto-deref
machinery uses, but it cannot be observed as a value.

Mental model: `ref T` is C# `ref`; `readonly ref T` is C# `in`. Adding
`ref` to a parameter or field doesn't change how user code reads or writes
it; it changes how the compiler lowers it (slot becomes a pointer) and what
positions it's legal in.

### 2.3 Construction operations

Three distinct forms, all with explicit syntax:

#### `field = value` — managed assignment

For already-initialized slots. Sequence:

1. Read the existing T at `*field`.
2. Run `__destroy` on it.
3. Write the new T into the slot.
4. Run `__oncopy` on the new T.

This is the only form available in safe code. It is correct after the slot
has been initialized; using it on uninitialized memory will run `__destroy`
on garbage (UB).

A field declared `readonly ref T` rejects this form (writes through the ref
are forbidden). A field declared `readonly T` rejects assignment because
the binding cannot be reassigned. Both diagnostics are produced by the
checker.

#### `init field = value` — initialization write

For uninitialized slots, used during construction. Sequence:

1. Skip the destroy step (slot is uninitialized garbage).
2. Write the new T into the slot.
3. Run `__oncopy` on the new T.

`init` is a keyword. It is only valid inside `unsafe` blocks.

(Struct-literal field initialization in safe code — `Foo{ name: "x" }` —
follows the same "skip destroy, write, oncopy" sequence implicitly; the
compiler emits init semantics for every field of a literal because the
slots are demonstrably uninitialized.)

#### `*addr(field) = value` — raw bitwise write

For advanced cases (in-place moves, hand-rolled lifecycle elision). Skips
**both** halves of lifecycle. The caller is responsible for ensuring the
source's destroy is suppressed and that the slot's prior state was already
torn down (or was uninitialized). Only valid inside `unsafe` blocks.

### 2.4 The `addr()` operator

To work with the raw pointer-value of a `ref T` field inside `unsafe`:

```kei
unsafe struct shared<T> {
    refcount: ref i64;
    value: ref T;
}

unsafe {
    addr(s.refcount) = block as *i64;     // sets WHERE refcount points
    *addr(s.refcount) = 1;                // writes the i64 at that address
}
```

`addr(field)` returns an lvalue of type `*T` aliasing the raw pointer slot
underlying the `ref T` field. Assigning to `addr(field)` sets where the
reference points; dereferencing it (`*addr(field)`) accesses the pointed-to
memory without firing lifecycle hooks.

Outside `unsafe`, `addr()` is a compile error. Inside `unsafe`, it is the
single supported way to manipulate `ref T` fields as pointer-values.

**Why a named operator instead of `&`.** `&` in C/C++ produces an rvalue
(`&x = y` is illegal). Overloading `&` to produce an lvalue when applied
to a `ref T` field would mean the same operator has different value
categories depending on operand type, plus it would interact awkwardly
with auto-deref (would `&s.value` mean address-of-the-T or address-of-the-
slot?). A named operator sidesteps both issues: it is lvalue-by-definition,
and it has no overlap with C's `&` reading.

### 2.5 `readonly` modifier

`readonly` is a modifier applicable to:

- Struct/enum field declarations.
- Function/method parameters.

It is **not** applicable to local bindings — locals use `let` (mutable) or
`const` (immutable binding), which is today's syntax unchanged.

The modifier has two meanings depending on whether the underlying type is
a `ref T` or a plain `T`. Both meanings collapse to "the slot cannot be
mutated through this name":

| Field/param spelling   | What's blocked                                                              | C# analogue            |
|------------------------|-----------------------------------------------------------------------------|------------------------|
| `name: T`              | nothing (default — mutable)                                                 | regular field/param    |
| `readonly name: T`     | reassigning the slot (`name = …` is rejected)                               | `readonly` field       |
| `name: ref T`          | nothing (default — mutable through the ref)                                 | `ref` parameter        |
| `readonly name: ref T` | writing through the ref (`name = …` is rejected; reads still auto-deref)    | `in` parameter         |

`readonly` says nothing about *transitive* contents reachable through other
fields. Replacing a `shared<T>` handle is blocked when the field is
`readonly`; mutating the inner value through `.value` is not, because
that goes through a separate (non-`readonly`) field of the inner type:

```kei
struct AppConfig {
    readonly db_url: string;                // the string itself is fixed
    readonly online: shared<bool>;          // the shared handle is fixed
}

cfg.db_url = "other";                       // ERROR: readonly
cfg.online = shared<bool>::wrap(false);     // ERROR: readonly (replaces handle)
cfg.online.value = false;                   // OK: writes through .value
```

`readonly` replaces every previous use of `mut`. There is no `mut` keyword
anywhere in the language: no `let mut`, no `mut` parameter form, no
`ref mut T` type. Mutability of *references* is controlled by the absence
or presence of `readonly` on a `ref T`; mutability of the *binding* is
controlled by the same modifier on a plain field/param.

### 2.6 Drop `->` arrow access

The `->` operator is removed from the grammar.

- For `ref T` values (params, `unsafe struct` fields), field access is
  spelled `obj.field` — auto-deref handles the indirection.
- For `*T` raw pointers (unsafe-only), field access is spelled
  `(*p).field` — explicit dereference, no auto-deref.

Migration: `self->field` patterns from today's `self: ptr<T>` receivers
become `self.field` once the receiver migrates to `self: ref T`. Raw-pointer
code keeps the explicit `(*p).field` form in `unsafe` blocks.

### 2.7 `&` and `*` operators

Both are unsafe-only. They operate on `*T` (the raw pointer type), not on
`ref T`. Inside `unsafe`:

- `&x` produces `*T` (raw address-of).
- `*p` dereferences a `*T` to T.

In safe code these operators do not exist. Auto-reference at the call site
(when passing a value into a `ref T` parameter) and auto-deref on access are
the only ways pointer values flow.

---

## 3. Worked examples

### 3.1 `shared<T>` in stdlib

Single-allocation layout, layout invariant entirely contained in stdlib:

```kei
unsafe struct shared<T> {
    refcount: ref i64;
    value: ref T;

    fn wrap(item: ref T) -> shared<T> {
        let s = shared<T>{};
        unsafe {
            // ONE allocation: [count: i64 | T payload]
            let block = alloc<u8>(sizeof(i64) + sizeof(T));
            addr(s.refcount) = block as *i64;
            addr(s.value)    = (block + sizeof(i64)) as *T;
            s.refcount = 1;                  // auto-deref through ref i64 field
            init s.value = item;             // single oncopy of *item into slot
        }
        return s;
    }

    fn __oncopy(self: ref shared<T>) {
        self.refcount += 1;                  // auto-deref through ref i64 field
    }

    fn __destroy(self: ref shared<T>) {
        self.refcount -= 1;
        if self.refcount == 0 {
            self.value.__destroy();          // recursive destroy of T
            unsafe { free(addr(self.refcount)); }  // frees the whole block
        }
    }
}
```

Notes:

- `wrap` takes `ref T` (not `T`) — avoids one round-trip oncopy/destroy.
  See §3.4 for the trace.
- `__oncopy` / `__destroy` take `self: ref shared<T>` — observing the handle
  without bumping its own count. Both return void; lifecycle hooks mutate
  through the ref in place rather than returning a new value (see §2.5
  ABI note).
- `self.refcount` is a `ref i64` field, so `self.refcount += 1` and
  `self.refcount == 0` auto-deref naturally. `addr(self.refcount)` is only
  needed when the *slot* itself is the target — e.g. setting where it
  points (in `wrap`) or freeing the underlying allocation (in `__destroy`).
- The single-allocation layout is invisible to consumers; it could change to
  two allocations (or a fat handle, or a different header) without affecting
  any caller.

### 3.2 String, post-redesign

```kei
struct string {
    buffer: shared<u8_buffer>;
    offset: usize;
    len: usize;
}

unsafe struct u8_buffer {
    data: *u8;
    fn __destroy(self: ref u8_buffer) {
        unsafe { free(self.data); }
    }
}
```

`string` is a plain `struct` (not `unsafe`). Auto-derived lifecycle: copying
a string recurses into the `shared<u8_buffer>` field, which bumps the
buffer's refcount; destroying recurses, drops the count, frees on zero.
`offset` and `len` are POD per-handle metadata — different substring views
of the same buffer get different offset/len, sharing the backing bytes.

`cap` is omitted: strings are immutable from outside per
`spec/03-types.md`, so there is no growth and no need for a capacity field.

This shape is the **target** for the stdlib migration. The current C
runtime (`runtime.h`) stays in place during the initial spec/checker/codegen
work; the actual port from `kei_string` to the Kei `struct string` form is
deferred to a follow-up phase (see §7).

### 3.3 Request handler

End-to-end example exercising `ref` parameters, auto-deref through
`shared<T>`, `readonly` fields, and lifecycle:

```kei
struct AppConfig {
    readonly db_url: string;
    readonly max_connections: shared<i32>;
    readonly online: shared<bool>;
}

struct Session {
    user_id: i32;
    token: string;
    created_at: i64;
}

struct SessionCache {
    entries: List<Session>;
}

fn create(cache: ref SessionCache, cfg: ref AppConfig, user_id: i32, token: ref string) {
    if cache.entries.len >= cfg.max_connections.value {  // explicit .value (no auto-deref of shared<T>)
        return;
    }
    cache.entries.push(Session{
        user_id,
        token,                                            // ref string -> string at struct field: auto-deref
        created_at: now(),
    });
}

fn handle(cfg: ref AppConfig, cache: ref SessionCache, body: ref string) -> string {
    if !cfg.online.value {                                // explicit .value
        return "offline";
    }
    // ...
    return "ok";
}

fn main() -> i32 {
    let cfg = AppConfig{
        db_url: "postgres://localhost",
        max_connections: shared<i32>::wrap(100),
        online: shared<bool>::wrap(true),
    };
    let cache = SessionCache{ entries: List::empty() };

    cfg.online.value = false;                             // write-through (alias-visible)

    let response = handle(cfg, cache, "request body");    // auto-reference at call
    return 0;
}
```

### 3.4 Lifecycle trace: `shared<T>::wrap(ref T) vs (T)`

Why the constructor takes `ref T`, with refcount accounting:

```kei
const s: Item = getItem()                  // s.string refcount = 1
const sharedS = shared<Item>::wrap(s)
// ... use s and sharedS ...
return s
```

**With `wrap(item: T)`** (by value):

- Pass `s` to `wrap`: oncopy at boundary → refcount = 2.
- Inside `wrap`, store into heap slot: must oncopy or move.
  - If we oncopy: refcount = 3. Then param destroys at function exit:
    refcount = 2. Caller's `s` and heap slot share refcount 2. Two ops total.
  - If we move: refcount stays at 2, no destroy at exit. Requires move-into-slot.

**With `wrap(item: ref T)`** (by ref):

- Pass `&s` to `wrap`: no oncopy, just reference.
- Inside `wrap`, `init s.value = item` derefs item, oncopies into slot:
  refcount = 2.
- Param is a ref, no destroy at exit.
- Caller's `s` and heap slot share refcount 2. **One op total**, no move needed.

The by-ref form is strictly cheaper and avoids needing a "move-into-slot"
operation. This is a usage convention worth documenting in stdlib style:
**factories and store-only functions take `ref T`; functions that consume take T**.

### 3.5 Auto-last-use elision

When the caller does not use a value after passing it:

```kei
const s = getItem()
const sharedS = shared<Item>::wrap(s)
// s never used again
```

The compiler's last-use analysis converts `wrap(s)` to `wrap(move s)` (the
caller gives up its claim). Inside `wrap`, the store can skip the oncopy
because no other owner exists. **Zero extra refcount ops**, the entire
copy-into-shared collapses to a bitwise transfer.

This is the same auto-last-use mechanism that subsumes most of the explicit
`move` keyword's value (see §6 — Open Questions).

---

## 4. Edge cases & invariants

Each invariant is paired with a snippet that should compile (positive) or
fail to compile (negative). These become regression fixtures during the
test-update commit.

### 4.1 `ref T` is not a return type

```kei
// MUST FAIL: `ref T` cannot appear in return position.
fn first(items: ref List<Item>) -> ref Item {
    return items[0];
}
```

Expected error: *"`ref T` is not allowed as a return type. Return `T` (which
copies) or `shared<T>` (which shares ownership)."*

### 4.2 `ref T` is not a struct field (in safe structs)

```kei
// MUST FAIL: `ref T` cannot appear in a safe struct field.
struct Holder {
    item: ref Item;
}
```

Expected error: *"`ref T` field types are only allowed in `unsafe struct`."*

### 4.3 `&` and `*` are unsafe

```kei
// MUST FAIL: `&` outside unsafe.
fn bad(x: i32) -> *i32 {
    return &x;
}
```

```kei
// MUST FAIL: `*` outside unsafe.
fn read(p: *i32) -> i32 {
    return *p;
}
```

### 4.4 `addr()` is unsafe

```kei
// MUST FAIL: `addr()` outside unsafe.
fn leak(s: shared<i32>) -> *i64 {
    return addr(s.refcount);
}
```

### 4.5 Auto-deref through `ref T` reads the pointed-to value

```kei
// MUST COMPILE.
struct Item { value: i32 }

fn read(x: ref Item) -> i32 {
    return x.value;          // auto-deref returns i32, not ref i32
}
```

### 4.6 Type mismatch on shared<T> field assignment

```kei
struct Cfg { online: shared<bool> }

fn turn_off(c: ref Cfg) {
    c.online = false;         // MUST FAIL: type mismatch (bool vs shared<bool>)
}
```

Expected error: *"Cannot assign `bool` to field of type `shared<bool>`. Use
`c.online.value = false` to write through (alias-visible), or
`c.online = shared<bool>::wrap(false)` to replace the handle."*

Note: there is no auto-deref of `shared<T>` to `T`. The two forms above are
the only ways to mutate.

### 4.7 `init` only valid in `unsafe`

```kei
// MUST FAIL: init outside unsafe.
fn build() -> Item {
    let i: Item = ???;
    init i.value = 42;
    return i;
}
```

### 4.8 `init` skips destroy

Specified by example — the snippet below must run without UB:

```kei
unsafe struct Box<T> {
    data: ref T;

    fn make(item: ref T) -> Box<T> {
        let b = Box<T>{};
        unsafe {
            addr(b.data) = alloc<T>(1);
            init b.data = item;          // must not call __destroy on garbage
        }
        return b;
    }
}
```

### 4.9 Construction-time oncopy preserves refcount balance

The trace from §3.4 must hold: a managed value passed into a `ref T`
constructor that stores it must end up with one extra reference (the heap
slot's). Caller and heap slot can independently outlive each other.

### 4.10 Nested `shared<T>` requires explicit unwrapping

```kei
// MUST FAIL: shared<T> does not auto-deref to T.
let s: shared<shared<i32>> = ...;
let v: i32 = s;                 // ERROR: cannot assign shared<shared<i32>> to i32
```

```kei
// MUST COMPILE: explicit .value chain peels one ref-field auto-deref per hop.
let s: shared<shared<i32>> = ...;
let v: i32 = s.value.value;     // s.value : shared<i32> ; .value : i32
```

### 4.11 `readonly` blocks reassignment but not write-through

```kei
struct Cfg { readonly online: shared<bool> }

fn f(c: ref Cfg) {
    c.online = shared<bool>::wrap(false); // MUST FAIL: readonly field (replaces handle)
    c.online.value = false;               // MUST COMPILE: writes through .value
}
```

For the `readonly ref T` (immutable-through-ref) form, write-through is
itself rejected:

```kei
fn f(x: readonly ref i32) {
    x = 1;                       // MUST FAIL: readonly ref forbids write-through
    let v: i32 = x;              // MUST COMPILE: read auto-derefs
}
```

### 4.12 Cannot construct a `ref T` from a stack local that escapes

The syntactic restriction (4.1, 4.2) is what prevents this; there is no
direct test, but the absence of any safe-code path that produces a stored,
returned, or captured `ref T` is the invariant. The closest direct test:

```kei
// MUST FAIL: returning what looks like a ref-to-local.
unsafe struct Container { data: *i32 }

fn dangle() -> Container {
    let x: i32 = 42;
    let c = Container{};
    unsafe { addr(c.data) = &x; }       // unsafe block — programmer's responsibility
    return c;                            // compiles; UB at runtime
}
```

This is allowed in unsafe code by design — once you opt in, you own the
lifetime. The invariant is that **no safe-code path produces this**, which
is enforced by 4.1–4.4.

---

## 5. Behaviour-preserving expected diff

What changes for existing programs after the redesign lands.

### 5.1 Programs that keep working unchanged

- Anything using only `T` value types and primitives.
- Method calls of the form `obj.method()` where `obj` is a value.
- `string` operations (immutable from outside, semantics unchanged).
- Arithmetic, control flow, struct literals, enums, generics, throws/catch.
- `unsafe { ... }` blocks doing `alloc`/`free` internally.

### 5.2 Programs that need a one-line edit

- `self: ptr<T>` method receivers → `self: ref T`. The C-level signature
  is identical; the source spelling changes.
- `self->field` access (when the receiver migrates to `ref T`) →
  `self.field`. Auto-deref handles it.
- Raw-pointer `p->field` access (in `unsafe` code where `p: *T`) →
  `(*p).field`. The `->` operator is gone; raw deref is explicit.
- Most `unsafe` blocks that exist today purely to call `ptr<T>` operations
  on `self` are no longer needed.
- `mut x: T` parameter form → drop the `mut` (parameters are mutable
  bindings by default; `readonly` opts out).
- `let mut x = …` → `let x = …` (`let` is mutable; `const` is immutable
  binding).

### 5.3 Programs that need real rework

- Code that explicitly takes raw addresses with `&x` outside unsafe — must
  move into an `unsafe` block, or be refactored to pass `ref T`.
- Code that returns `ptr<T>` from safe functions — must return `T` or
  `shared<T>` instead. Lookup-by-reference patterns are the most common
  example; they become copy-out (cheap for refcounted T) or shared-element
  (`List<shared<Item>>`).
- Hand-rolled `__oncopy` / `__destroy` for refcounted types — replaced by
  composing `shared<T>` as a field.

### 5.4 Programs that become hard errors

- `ref T` (or `mut T` / `ptr<T>`) in return position, struct field outside
  `unsafe struct`, array element type, generic argument, static type. (See
  §4.1, §4.2.)
- `field = value` where the field is `shared<U>` and `value` is `U` (not
  `shared<U>`). Must use explicit `field.value = value` or
  `field = shared<U>::wrap(value)`. (No auto-deref of `shared<T>`.)
- `&` or `*` outside `unsafe`.
- `mut` keyword anywhere — completely removed. `mut` parameter form, `let
  mut`, `&mut`, and `ref mut T` all gone. Replaced by `ref T` (mutable
  through ref by default), `readonly ref T` (immutable through ref),
  `readonly` modifier on plain fields/params.
- `ref T` in a local binding (e.g. `let r: ref T = …`) — there are no `ref`
  locals.

### 5.5 Stdlib changes

- `kei_string` runtime (currently in `runtime.h`) reimplemented as a Kei
  `struct string { buffer: shared<u8_buffer>; offset: usize; len: usize; }`.
  The C runtime functions become unsafe-struct method bodies.
- `Shared<T>` (planned) becomes `shared<T>` as a stdlib unsafe struct.
- `array<T>` (planned) and `List<T>` (planned) follow the same pattern:
  unsafe struct holding a `*T` field, manual `__destroy`, no `__oncopy`
  hand-written (recurse via auto-derive on a `shared<T>`-backed buffer).

---

## 6. Decisions

Items discussed during design and resolved. Each was an open question at
proposal time; all are now closed and the rest of this doc is consistent
with these decisions.

### 6.1 Auto-deref in unconstrained contexts — moot

The original question was whether `let max = cfg.max_connections` (where
`max_connections: shared<i32>`) should auto-deref to `i32` or preserve
`shared<i32>`. **Closed:** there is no auto-deref of `shared<T>` at all
(see §2.1, §2.2). Users write `let max = cfg.max_connections.value` to
get the `i32`, or `let max = cfg.max_connections` to get the `shared<i32>`
handle. Type-directed auto-deref applies only to `ref T` values, where
the source type's deref target is unambiguous.

### 6.2 `move` keyword scope — expression form only

Auto-last-use covers the common cases. `move` survives as an expression
form (`let b = move a`) for explicit consumption before last use. The
parameter form (`fn f(move x: T)`) is dropped — redundant with auto-last-
use detection.

### 6.3 `copy()` builtin — deferred

Not strictly needed for stdlib (everything's a ref or auto-handled). Add
if user code asks for it.

### 6.4 Mutation visibility through aliased `shared<T>` — alias-visible (explicit)

Mutation through `shared<T>` is **alias-visible**: every alias sees writes.
But there is no auto-deref shortcut — users must spell the operation out:

- `s.value = newT` → write-through. Fires `__destroy` on the old inner T,
  bitwise write of the new T into the slot, `__oncopy` on the new T.
  Refcount unchanged. All aliases see the new value.
- `s = shared<T>::wrap(newT)` → handle replacement. Fires `__destroy` on
  the old `shared<T>` (which decrements refcount, recursively destroys the
  inner T if last reference), bitwise write of the new handle, `__oncopy`
  on the new handle. The local `s` is rebound; other aliases keep the old
  payload until their refcount drops to zero.

This is simple, gives explicit control, and matches Rc<RefCell<T>>-style
semantics without the CoW machinery. CoW remains a possible future
optimization that the compiler can perform invisibly when last-use
analysis proves uniqueness.

### 6.5 Equality semantics for `shared<T>` — by-value

`==` on `shared<T>` does a recursive field compare (same as plain
structs). `same_handle(a, b)` is the identity primitive (pointer compare
on the underlying allocation).

### 6.6 Naming

- `ref T` — safe mutable reference (≈ C# `ref`).
- `readonly ref T` — safe immutable reference (≈ C# `in`).
- `*T` — raw pointer (unsafe-only).
- `addr()` — field-pointer accessor (slot lvalue, unsafe-only).
- `init` — initialization-write keyword (unsafe-only at field/struct
  level; implicit inside struct literals).
- `readonly` — field/param modifier.

Removed: `ptr<T>`, `mut T`, `ref mut T`, the `mut` keyword anywhere,
`&mut`, `->`.

### 6.7 Local binding mutability — unchanged

`let` is mutable. `const` is immutable binding. Today's local-binding
syntax stays. There is no `let mut`, no `let readonly`. The `readonly`
modifier is for fields and parameters only.

### 6.8 `weak<T>` for cycles — separate roadmap item

Reference counting cannot reclaim cycles. `weak<T>` (non-owning, non-
cycle-prolonging) is filed as a follow-up after `shared<T>` lands. Out of
scope for this redesign.

### 6.9 Default destruction order — reverse declaration order

Fields are destroyed in reverse declaration order (matches C++). To be
formalized in `spec/08-memory.md` while the spec is being rewritten.

### 6.10 `shared` keyword — un-reserved

Today's lexer reserves `shared` as a future-use keyword. Under this
redesign `shared<T>` is a normal stdlib `unsafe struct` — `shared` becomes
a regular identifier. The reserved-word entry is dropped; the lexer change
ships with the parser/checker work.

---

## 7. Implementation sequencing

After this doc lands (commit 1), the work is:

### Commit 2: Spec updates

- `spec/03-types.md` — replace pointer-types section. Document `ref T`,
  `*T`, `shared<T>`, removed types, `addr()`, `init`, `readonly`.
- `spec/08-memory.md` — rewrite lifecycle section around the three write
  forms. Document the construction protocol. Document `shared<T>` as the
  canonical refcount primitive.
- `spec/13-grammar.md` — remove `mut T`, `ptr<T>`, `->`. Add `ref T` (with
  position restrictions), `*T`, `addr(...)`, `init <lvalue> = <expr>`.
- `SPEC-STATUS.md` — close completed items, file new ones (universal
  auto-deref, `init`, `addr`, `readonly`, `shared<T>` stdlib impl).

### Commit 3: Test fixture updates

Each invariant in §4 becomes a test fixture under `compiler/tests/`. Both
positive and negative cases. Existing fixtures using `ptr<T>` parameters
update to `ref T`; existing `->` usage updates to `.`.

### Compiler work (multiple commits)

Rough order:

1. Grammar: parse `ref T` and `readonly ref T` (with position restrictions),
   `*T`, `addr(...)`, `init`, `readonly` modifier. Remove `mut` keyword
   everywhere (`let mut`, `mut` parameter, `&mut`, `ref mut T`), `ptr<T>`,
   `->`.
2. Lexer: un-reserve `shared`. Reserve `init`, `readonly`, `addr` as
   keywords.
3. Checker: position validation for `ref T`. Auto-deref insertion for
   `ref T` values (most complex single piece). `addr()` resolution.
   `init` checking. `readonly` enforcement (block reassignment for plain
   types; block write-through for `ref T`).
4. KIR lowering: `ref T` becomes a pointer in the IR (no semantic
   distinction from `*T` at the IR level — only the source language
   surface differs). Lifecycle hook ABI changes: `__oncopy` /
   `__destroy` lowered with `self: ref T` and void return (in-place
   mutation), replacing today's `__oncopy(self: T) -> T`. Auto-deref
   insertion happens before lowering.
5. Stdlib: implement `shared<T>` as `unsafe struct` in stdlib.
6. Optimization passes that the redesign enables: lifecycle elision via
   peephole on `__oncopy` / `__destroy` of inlined refcount primitives.
7. **(Deferred to a follow-up phase)** Rewrite `kei_string` runtime as a
   Kei `struct` using `shared<u8_buffer>`. The C runtime stays in place
   during the initial compiler work to keep the migration scope bounded;
   string layout is a separate, sequenced project once `shared<T>` is
   real and the lifecycle-elision pass is in.

The compiler work is comfortably multi-week and likely 5–10 PRs. The doc /
spec / fixture commits should be airtight before any of it begins, because
shifting decisions mid-implementation costs significantly more than
shifting them mid-doc.

---

## 8. Things this design does not address

For clarity, the redesign is scoped to the pointer / reference / lifecycle
story. The following are explicitly out of scope:

- Trait system (planned separately; will integrate cleanly).
- Async / coroutines (planned post-traits).
- Threading model (v2 spec; refcounts here remain non-atomic until then).
- Optimizer passes beyond lifecycle elision (separate roadmap item).
- `T?` representation (separate item; current placeholder lowering
  unaffected).

These items remain at their current spec status and are not blocked by or
blocking this redesign.
