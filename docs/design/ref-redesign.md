# Ref redesign: collapsing the pointer-type vocabulary

Status: **proposal** — design captured, spec/tests/compiler not yet updated.

This document captures a proposed redesign of Kei's reference / pointer /
lifecycle story. It is the result of a long design conversation that started
from "what optimizer passes would help most?" and ended at "the type system has
overlapping primitives and once we collapse them, most of the optimization wins
fall out for free."

The goal of this document is to be precise enough that subsequent commits
(spec edits, test fixtures, compiler changes) can be reviewed against a single
source of truth. Sections marked **Decided** are committed for the spec phase;
**Open** items will be resolved during spec drafting.

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

### 2.1 Type vocabulary (Decided)

The full set of pointer-like types user code can write:

| Type        | Where it appears                                  | Auto-deref | Use                                       |
|-------------|---------------------------------------------------|------------|-------------------------------------------|
| `T`         | anywhere                                          | n/a        | values                                    |
| `ref T`     | function/method parameter types; `unsafe struct` field types | yes (universal) | safe transparent reference        |
| `*T`        | `unsafe struct` field types; locals inside `unsafe` blocks; `extern fn` signatures | no | raw pointer for unsafe code        |
| `shared<T>` | anywhere                                          | yes (via field auto-deref to T) | refcounted shared owner       |

Removed (vs current spec): `mut T`, `ptr<T>`. Both subsumed by `ref T` + the
`readonly` modifier (see §2.4).

`ref T` is **never** legal in:

- Function or method return types.
- Local variable bindings.
- Safe `struct` field types.
- Generic argument positions in safe code (i.e. `List<ref T>` is invalid).
- Array or slice element types.
- `static` global types.

This is enforced at the grammar / parser level. The restriction is
syntactic: there is no analysis pass needed to enforce it. Because `ref T`
cannot appear in any position that could outlive its source, it cannot be
made to dangle.

### 2.2 Universal auto-deref (Decided)

Any access to a `ref T`-typed value automatically dereferences to T:

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
    let r: ref Item = x;      // target type is ref Item, forwards as-is
}
```

There is **no operation in safe code that yields the pointer-value of a
`ref T`**. `&x` is unsafe; reading a `ref T` field of an `unsafe struct`
auto-derefs (returning T, not the pointer); methods returning `ref T`
auto-deref at the call site to T. Inside safe code, the pointer is a
compile-time abstraction — at runtime it is the C pointer the auto-deref
machinery uses, but it cannot be observed as a value.

### 2.3 Construction operations (Decided)

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

#### `init field = value` — initialization write

For uninitialized slots, used during construction. Sequence:

1. Skip the destroy step (slot is uninitialized garbage).
2. Write the new T into the slot.
3. Run `__oncopy` on the new T.

`init` is a keyword. It is only valid inside `unsafe` blocks.

#### `*address(field) = value` — raw bitwise write

For advanced cases (in-place moves, hand-rolled lifecycle elision). Skips
**both** halves of lifecycle. The caller is responsible for ensuring the
source's destroy is suppressed and that the slot's prior state was already
torn down (or was uninitialized). Only valid inside `unsafe` blocks.

### 2.4 The `address()` operator (Decided)

To work with the raw pointer-value of a `ref T` field inside `unsafe`:

```kei
unsafe struct shared<T> {
    refcount: ref i64;
    value: ref T;
}

unsafe {
    address(s.refcount) = block as *i64;     // sets WHERE refcount points
    *address(s.refcount) = 1;                // writes the i64 at that address
}
```

`address(field)` returns a `*T` — the raw pointer slot underlying the
`ref T` field. Assigning to `address(field)` sets where the reference
points; dereferencing it (`*address(field)`) accesses the pointed-to memory
without firing lifecycle hooks.

Outside `unsafe`, `address()` is a compile error. Inside `unsafe`, it is the
single supported way to manipulate `ref T` fields as pointer-values.

### 2.5 `readonly` modifier (Decided)

`readonly` is a modifier applicable to:

- Struct/enum field declarations.
- Local bindings (subsumes today's `let` / `let mut` distinction; see §5).
- Function parameters (rare, but legal).

A `readonly` slot's binding cannot be reassigned post-construction. It says
nothing about the contents of what is stored — for `ref T` or `shared<T>`
fields, the handle is fixed but the inner value can still mutate via
`field.set(...)` or write-through chains.

```kei
struct AppConfig {
    readonly db_url: string;                // string itself is fixed
    readonly online: shared<bool>;          // handle fixed; inner bool mutates
}

cfg.db_url = "other";                       // ERROR: readonly
cfg.online = shared::wrap(false);           // ERROR: readonly
cfg.online.set(false);                      // OK: writes through handle
```

`readonly` replaces the `mut T` parameter form. Mutability of *contents* is
controlled by whether the function calls write methods on the value;
mutability of the *binding* is controlled by `readonly`.

### 2.6 Drop `->` arrow access (Decided)

Auto-deref subsumes pointer-field-access. `p->field` becomes `p.field`. The
arrow syntax is removed from the grammar.

### 2.7 `&` and `*` operators (Decided)

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
            address(s.refcount) = block as *i64;
            address(s.value)    = (block + sizeof(i64)) as *T;
            s.refcount = 1;
            init s.value = item;             // single oncopy of *item into slot
        }
        return s;
    }

    fn __oncopy(self: ref shared<T>) -> shared<T> {
        unsafe { *address(self.refcount) += 1; }
        return *self;
    }

    fn __destroy(self: ref shared<T>) {
        unsafe {
            *address(self.refcount) -= 1;
            if *address(self.refcount) == 0 {
                self.value.__destroy();      // recursive destroy of T
                free(address(self.refcount));// frees the whole block
            }
        }
    }
}
```

Notes:

- `wrap` takes `ref T` (not `T`) — avoids one round-trip oncopy/destroy.
  See §3.4 for the trace.
- `__oncopy` / `__destroy` take `self: ref shared<T>` — observing the handle
  without bumping its own count.
- The single-allocation layout is invisible to consumers; it could change to
  two allocations (or a fat handle, or a different header) without affecting
  any caller.

### 3.2 String, post-redesign

```kei
shared struct string {
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
    if cache.entries.len >= cfg.max_connections {     // auto-deref shared<i32>
        return;
    }
    cache.entries.push(Session{
        user_id,
        token,                                         // oncopy on store
        created_at: now(),
    });
}

fn handle(cfg: ref AppConfig, cache: ref SessionCache, body: ref string) -> string {
    if !cfg.online {                                   // auto-deref shared<bool>
        return "offline";
    }
    // ...
    return "ok";
}

fn main() -> i32 {
    let cfg = AppConfig{
        db_url: "postgres://localhost",
        max_connections: shared::wrap(100),
        online: shared::wrap(true),
    };
    let cache = SessionCache{ entries: List::empty() };

    cfg.online.set(false);                             // write-through

    let response = handle(cfg, cache, "request body"); // auto-reference at call
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

### 4.4 `address()` is unsafe

```kei
// MUST FAIL: `address()` outside unsafe.
fn leak(s: shared<i32>) -> *i64 {
    return address(s.refcount);
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
`c.online.set(false)` to write through, or `c.online = shared::wrap(false)`
to replace the handle."*

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
            address(b.data) = alloc<T>(1);
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

### 4.10 Universal auto-deref recurses through nesting

```kei
// MUST COMPILE.
let s: shared<shared<i32>> = ...;
let v: i32 = s;              // double auto-deref
```

### 4.11 `readonly` blocks reassignment but not write-through

```kei
struct Cfg { readonly online: shared<bool> }

fn f(c: ref Cfg) {
    c.online = shared::wrap(false);   // MUST FAIL: readonly field
    c.online.set(false);              // MUST COMPILE: writes through
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
    unsafe { address(c.data) = &x; }    // unsafe block — programmer's responsibility
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
- `obj->field` access → `obj.field`. Auto-deref handles it.
- Most `unsafe` blocks that exist today purely to call `ptr<T>` operations
  on `self` are no longer needed.

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
  `shared<U>`). Must use explicit `field.set(value)` or `field = shared::wrap(value)`.
- `&` or `*` outside `unsafe`.
- `mut T` keyword anywhere — replaced by `ref T` + `readonly` modifiers.

### 5.5 Stdlib changes

- `kei_string` runtime (currently in `runtime.h`) reimplemented as a Kei
  `struct string { buffer: shared<u8_buffer>; offset: usize; len: usize; }`.
  The C runtime functions become unsafe-struct method bodies.
- `Shared<T>` (planned) becomes `shared<T>` as a stdlib unsafe struct.
- `array<T>` (planned) and `List<T>` (planned) follow the same pattern:
  unsafe struct holding a `*T` field, manual `__destroy`, no `__oncopy`
  hand-written (recurse via auto-derive on a `shared<T>`-backed buffer).

---

## 6. Open questions

Items discussed but not finalized. Each needs a position before the spec
phase begins.

### 6.1 Auto-deref in unconstrained contexts

```kei
let max = cfg.max_connections;     // type of max?
```

- **Auto-deref:** `max: i32`, copy of the value. Loses access to the
  `shared` handle.
- **Preserve:** `max: shared<i32>`. Can still call `.set()`. Auto-deref
  fires only at use sites against a known target type.

Lean: **preserve**. Auto-deref should fire when the target type is known
(parameter, comparison against a typed expression, explicit annotation). In
unconstrained `let` bindings, the field's declared type is preserved.

### 6.2 `move` keyword scope

The auto-last-use optimization handles most cases. Keep `move` as:

- (a) Expression form only (`let b = move a`) for explicit consumption
  before last use.
- (b) Drop entirely; rely on auto-last-use plus a hypothetical move-only
  type marker.
- (c) Keep as-is (expression + parameter form).

Lean: **(a)**. Expression form is rare-but-useful; parameter form is
redundant with auto-last-use.

### 6.3 `copy()` builtin

A builtin `copy(x)` that explicitly fires `__oncopy`. Not strictly needed
for stdlib (everything's a ref or auto-handled), but useful for user code
that wants explicit duplication without ambiguity.

Lean: **defer**. Add if user code asks for it; the auto-last-use rule means
explicit copy is rarely needed.

### 6.4 Mutation visibility through aliased `shared<T>`

```kei
let a: shared<User> = ...;
let b = a;                  // refcount++, b aliases a
b.name = "Bob";             // does a.name see this change?
```

Three answers:

- **Yes, aliasing-visible.** Like `Rc<RefCell<T>>`. Simple, but breaks
  value-type intuition for copies.
- **No, copy-on-write.** Compiler emits `make_unique` before write; `b`
  splits off. Predictable, more machinery.
- **Forbidden.** `shared<T>` is read-only from outside; mutation requires
  explicit `make_unique` first.

Lean: **CoW (option 2)** for stdlib refcounted types. Preserves value
semantics on copies, matches the `string`/`array<T>` direction. May start
as **forbidden (option 3)** if CoW is too much work for v1.

### 6.5 Equality semantics for `shared<T>`

`a == b` where both are `shared<User>`:

- By-value (recursive field compare).
- By-handle (same allocation pointer).

Lean: **by-value, with `same_handle()` for identity**. Matches struct
equality everywhere else.

### 6.6 Naming finalization

Confirmed in this design:

- `ref T` for the safe reference type.
- `*T` for the raw pointer type.
- `address()` as the field-pointer accessor (replaces earlier `raw()`).
- `init` keyword for initialization-write.

`ptr<T>` is removed entirely. `mut T` is removed entirely.

### 6.7 `let mut` vs parameter `mut` collision

The current grammar has `let mut x` for locally mutable bindings. Under
this redesign, the type-level `mut T` is gone, so the local binding form
no longer collides with anything. Two reasonable spellings:

- Keep `let mut x` (today's syntax).
- Replace with `let x` for mutable, `let readonly x` for immutable
  bindings (symmetric with the field modifier).

Lean: **keep `let mut x`** for now. Bindings default to immutable; `mut`
opts in. `readonly` is the field/parameter modifier.

### 6.8 `weak<T>` for cycles

Reference counting cannot reclaim cycles. Once `shared<T>` is in stdlib, a
`weak<T>` companion (non-owning, non-cycle-prolonging reference to a
shared payload) is the natural follow-up. Out of scope for this redesign;
file as a separate roadmap item.

### 6.9 Default destruction order

Today's spec doesn't pin destruction order for fields within a struct. This
matters when one field's destroy depends on another being alive (e.g., a
file handle that flushes a buffer). Reverse-declaration-order is the C++
convention and a reasonable default.

Lean: **reverse declaration order**, formalized in spec. Out of scope for
the redesign itself but worth pinning while the spec is being rewritten.

---

## 7. Implementation sequencing

After this doc lands (commit 1), the work is:

### Commit 2: Spec updates

- `spec/03-types.md` — replace pointer-types section. Document `ref T`,
  `*T`, `shared<T>`, removed types, `address()`, `init`, `readonly`.
- `spec/08-memory.md` — rewrite lifecycle section around the three write
  forms. Document the construction protocol. Document `shared<T>` as the
  canonical refcount primitive.
- `spec/13-grammar.md` — remove `mut T`, `ptr<T>`, `->`. Add `ref T` (with
  position restrictions), `*T`, `address(...)`, `init <lvalue> = <expr>`.
- `SPEC-STATUS.md` — close completed items, file new ones (universal
  auto-deref, `init`, `address`, `readonly`, `shared<T>` stdlib impl).

### Commit 3: Test fixture updates

Each invariant in §4 becomes a test fixture under `compiler/tests/`. Both
positive and negative cases. Existing fixtures using `ptr<T>` parameters
update to `ref T`; existing `->` usage updates to `.`.

### Compiler work (multiple commits)

Rough order:

1. Grammar: parse `ref T` (with position restrictions), `*T`,
   `address(...)`, `init`. Remove `mut T`, `ptr<T>`, `->`.
2. Checker: position validation for `ref T`. Auto-deref insertion (most
   complex single piece). `address()` resolution. `init` checking.
3. KIR lowering: `ref T` becomes a pointer in the IR (no semantic
   distinction from `*T` at the IR level — only the source language
   surface differs). Auto-deref insertion happens before lowering.
4. Stdlib: rewrite `kei_string` runtime as a Kei `struct` using
   `shared<u8_buffer>`. Implement `shared<T>` as `unsafe struct`.
5. Optimization passes that the redesign enables: lifecycle elision via
   peephole on `__oncopy` / `__destroy` of inlined refcount primitives.

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
