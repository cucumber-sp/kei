# Ref-construction redesign — drop `addr()` and `init`

**Status.** Draft. Amends `docs/design/ref-redesign.md` §2.3 and §6;
supersedes the `addr()` and `init` story sketched there. No compiler
work has started; the language surface today still has both keywords.

## 1. Why

`addr()` and `init` exist solely to support construction and teardown
of `ref T` fields on `unsafe struct`s. They feel hacky because they
ARE hacky — both are bespoke operators that paper over a mismatch
between auto-deref ref fields and the underlying pointer slot.

What construction actually needs:

1. **Read** a ref field's bound pointer (e.g. inside `__destroy` to
   pass it to `dealloc`).
2. **Write** a ref field's bound pointer (during construction, to
   seat the binding).
3. **Place** a value at the location a ref points at, fire `__oncopy`,
   skip the `__destroy` that normal assignment would do for an
   "old value."

Today (1) is `addr(self.field) as *void`, (2) is `addr(s.field) =
ptr;`, (3) is `init s.field = value;`. Each is a special operator with
its own parser rule. Once you spell out what they actually do, every
step is just an existing primitive — a cast, a struct literal, a
function call. The keywords are duct tape over the ergonomic gap; they
don't earn their keep.

This doc replaces both with a smaller set of existing tools, keeps the
auto-deref-on-`ref T`-fields safety firewall completely intact, and
adds one new compile-time invariant that tightens the design instead of
loosening it.

## 2. Replacement vocabulary

### 2.1 Read the bound pointer — already works as `&(*field)`

For `param: ref T` (or `self.field` of type `ref T`):

```kei
unsafe {
    let p: *T = &(*self.refcount);     // bound pointer
    dealloc(p as *void);
}
```

`*self.refcount` auto-derefs to T (i64 in the Shared<T> case). `&` of
that auto-derefed value is `*T`. At runtime it's just the pointer bits
already stored in the slot — no extra load or store.

`&(*field)` reads cleanly as "address of the value behind the ref."
That's exactly what we want.

A future ergonomic patch can let `&field` desugar to `&(*field)` for
`ref T` values (today it returns `**T` — the slot's address — because
of the C-style "address of variable" interpretation). The desugar is a
**separate, additive** change; this redesign does NOT depend on it.

### 2.2 Write the bound pointer — struct literal

The struct literal IS the binding ceremony. In an `unsafe` block on an
`unsafe struct`, the field initializer for a `ref T` field accepts a
`*T` value and seats the binding:

```kei
unsafe {
    let block = alloc(sizeof(i64) + sizeof(T));
    let countPtr = block as *i64;
    let valuePtr = ((block as usize) + sizeof(i64)) as *T;
    return Shared<T>{ refcount: countPtr, value: valuePtr };
}
```

The literal either seats every binding or it doesn't compile (see §3).
There is no "empty struct then patch up later" path.

### 2.3 Place a value through a binding — `memcpy` + `onCopy`

```kei
unsafe {
    memcpy(valuePtr as *void, &item as *void, sizeof<T>());
    onCopy(valuePtr);
}
```

Three primitives, all with vocabulary that already exists or fits the
existing extern-fn / builtin shape:

- `memcpy` is a stdlib extern, not new.
- `&item` for `item: ref T` is `&(*item)` per §2.1, returning the source's
  bound pointer.
- `onCopy<T>(p: *T)` is a new compiler builtin that calls `T`'s
  `__oncopy(self: ref T)` on the value at `p`. Sibling builtin
  `onDestroy<T>(p: *T)` for symmetry — used by stdlib helpers and
  hand-rolled placement code.

The std library can wrap the common pattern as one helper:

```kei
// std/mem.kei
pub fn placeAt<T>(dest: *T, src: ref T) {
    unsafe {
        memcpy(dest as *void, &(*src) as *void, sizeof<T>());
        onCopy(dest);
    }
}
```

User code that just wants placement-init writes `placeAt(valuePtr,
item);`. User code that wants byte-level control writes the memcpy
itself. Either way, no new keywords.

## 3. New invariant — every `ref T` field initialized at construction

Today an empty struct literal `Shared<T>{}` is permitted on
`unsafe struct`s and leaves every slot zero. That worked under the
old design because `addr()` was supposed to seat the slots later. It
also let users forget — `let s = Shared<T>{}; init s.refcount = ...;`
without seating `s.value` was a UB time bomb the type system didn't
catch.

The replacement rule:

> A struct literal of an `unsafe struct` with one or more `ref T`
> fields **must** initialize every `ref T` field by name. Empty
> literals and partial literals are rejected at compile time.

Plain (non-ref) fields keep their existing behavior — omitting them
defaults to zero-init.

This converts a runtime-UB foot-gun into a checker error. It also kills
the "empty literal then patch up" anti-pattern — there is no longer a
way to observe a partially-initialized `unsafe struct`.

## 4. Worked example — `Shared<T>.wrap` end-to-end

```kei
pub unsafe struct Shared<T> {
    refcount: ref i64;
    value: ref T;

    fn wrap(item: ref T) -> Shared<T> {
        unsafe {
            // 1. Allocate the heap block.
            let block = alloc(sizeof(i64) + sizeof(T));
            let countPtr = block as *i64;
            let valuePtr = ((block as usize) + sizeof(i64)) as *T;

            // 2. Seed the refcount and place the user's value.
            *countPtr = 1;
            placeAt(valuePtr, item);    // memcpy + onCopy

            // 3. Construct via struct literal — seats both bindings
            //    in one step.
            return Shared<T>{ refcount: countPtr, value: valuePtr };
        }
    }

    fn __oncopy(self: ref Shared<T>) {
        self.refcount += 1;
    }

    fn __destroy(self: ref Shared<T>) {
        self.refcount -= 1;
        if self.refcount == 0 {
            unsafe {
                onDestroy(&(*self.value));        // run T's __destroy
                dealloc(&(*self.refcount) as *void);
            }
        }
    }
}
```

Every line is an arithmetic op, a cast, a regular call, or a struct
literal. No new operators. Auto-deref still hides pointers from safe
code: callers see `s.refcount` as i64, `s.value` as T.

## 5. What changes vs. today

| Topic                           | Today                              | After                              |
|---------------------------------|------------------------------------|------------------------------------|
| Read bound pointer              | `addr(field) as *void` (special)   | `&(*field) as *void` (ordinary)    |
| Write bound pointer             | `addr(field) = ptr;` (special)     | Struct literal field initializer   |
| Place value through binding     | `init field = value;` (special)    | `placeAt(ptr, value)` (stdlib)     |
| Empty `unsafe struct{}` literal | Allowed                            | Rejected if struct has `ref T`     |
| Lifecycle hook fire from raw ptr| n/a (no path)                      | `onCopy<T>(p)` / `onDestroy<T>(p)` |
| Safe-code surface               | unchanged                          | unchanged                          |
| Auto-deref on `ref T` fields    | unchanged                          | unchanged                          |

**Net language surface:** −2 keywords (`addr`, `init`), −1 statement
form (`init lvalue = expr`). +1 invariant (ref fields required in
literals). +2 compiler builtins (`onCopy<T>`, `onDestroy<T>`). Existing
casts, struct literals, and `&` cover the rest.

## 6. Migration sketch

Spec-only first; compiler work follows in its own PR(s).

1. **Spec PR (this doc + amendments).** Update
   `docs/design/ref-redesign.md` §2.3 and §6 to reference this
   redesign. Amend `spec/03-types.md`, `spec/07-structures.md` examples
   that use `addr()` / `init`. Add the "ref fields required in
   literals" rule to `spec/07-structures.md`.

2. **Stdlib PR.** Add `onCopy<T>`, `onDestroy<T>` as compiler builtins.
   Add `placeAt<T>` to `std/mem.kei`. Migrate `std/shared.kei` to the
   new vocabulary. Tests pin the new shapes.

3. **Checker PR.** Implement the "every `ref T` field must be
   initialized in literals" rule. Migrate marker tests in
   `tests/checker/ref-redesign.test.ts` that exercise empty-literal
   `unsafe struct{}` patterns.

4. **Parser/checker cleanup PR.** Drop `addr` keyword from the lexer
   and grammar. Drop `init` keyword and the `init lvalue = expr`
   statement form. Drop the corresponding AST nodes.

5. **(Optional) Ergonomic PR.** Make `&field` for `field: ref T` a
   sugar for `&(*field)` (returning the bound pointer instead of the
   slot's address). Self-contained, no spec dependency on the rest of
   this redesign.

Each step is independently mergeable. Stages 1–4 are required;
stage 5 is a nicety.

## 7. Open questions

- **Should `onCopy<T>` / `onDestroy<T>` accept `ref T` instead of
  `*T`?** Probably not — they're explicitly the unsafe lifecycle
  primitives, paired with raw memcpy. Pairing them with raw `*T` keeps
  the "you're operating on bytes, vouch for them" intent visible.

- **`placeAt` arg order?** Current draft is `(dest, src)` matching
  memcpy. Alternative `(src, dest)` reads "place item into dest" but
  diverges from memcpy. Sticking with `(dest, src)`.

- **Allow `*T → ref T` coercion outside `unsafe struct` literals?**
  No. The whole point is that the binding ceremony is gated behind
  `unsafe` and limited to construction. Allowing the coercion in
  arbitrary positions would re-open the leak/UAF surface auto-deref
  ref fields are designed to close.

## 8. References

- `docs/design/ref-redesign.md` §2.3 (current `addr()`/`init` story)
- `docs/design/ref-redesign.md` §6.4 (alias-visible mutation through
  Shared<T> — unchanged by this redesign)
- `compiler/std/shared.kei` (current implementation, to be migrated)
- Issue #21 (already closed) — surfaced the lifecycle wiring this
  redesign builds on.
