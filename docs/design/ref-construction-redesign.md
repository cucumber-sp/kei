# Ref-construction redesign — drop `addr()` and `init`

**Status.** Implemented. Amends `docs/design/ref-redesign.md` §2.3 and
§6; supersedes the `addr()` and `init` story sketched there. The
keywords are gone from the lexer, parser, AST, checker, and KIR.
Construction primitives (`onCopy<T>` / `onDestroy<T>` builtins, the
`*T → ref T` literal coercion, `std/mem.kei`'s `placeAt<T>`) are
shipped. The required-init rule on `unsafe struct` literals is
enforced by the checker. Stages 1–4 of §6's migration sketch are all
merged.

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

Previously (1) was `addr(self.field) as *void`, (2) was
`addr(s.field) = ptr;`, (3) was `init s.field = value;`. Each was a
special operator with its own parser rule. Once you spell out what
they actually do, every step is just an existing primitive — a cast,
a struct literal, a function call. The keywords were duct tape over
the ergonomic gap; they didn't earn their keep.

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

A separate ergonomic patch (stage 5 in §6) can let `&field` desugar
to `&(*field)` for `ref T` values; today `&field` returns `**T` (the
slot's address) because of the C-style "address of variable"
interpretation. The desugar is **additive** and self-contained — this
redesign does NOT depend on it.

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

Under the old design an empty struct literal `Shared<T>{}` was
permitted on `unsafe struct`s and left every slot zero — `addr()`
was supposed to seat the slots later. It also let users forget —
`let s = Shared<T>{}; init s.refcount = ...;` without seating
`s.value` was a UB time bomb the type system didn't catch.

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

## 5. Old vs. new

| Topic                           | Old                                | New                                |
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

## 6. Rollout

Each stage shipped as its own PR.

| Stage | PR | What it landed |
|-------|----|----------------|
| 1 | #25 | Spec sweep — `addr` / `init` removed from `spec/`, examples migrated, "spec describes current state" policy added to `CLAUDE.md`. |
| 2 | #26 | Foundation — `onCopy<T>` / `onDestroy<T>` compiler builtins, `*T → ref T` coercion in `unsafe struct` literals, `placeAt<T>` in `std/mem.kei`, `std/shared.kei` migrated to the new vocabulary. |
| 3 | #27 | Checker rule — every field of an `unsafe struct` literal must be initialized by name. Empty / partial literals are a compile error. |
| 4 | #28 | Cleanup — `addr` and `init` removed from the lexer, parser, AST, checker, and KIR. |

**Not done:** the `&field → &(*field)` sugar for `ref T` values stays
as an additive ergonomic patch. It's self-contained and can land any
time without depending on the rest of this redesign.

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
