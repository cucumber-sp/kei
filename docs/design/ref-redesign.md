# References, pointers, and ownership

Kei separates a safe, scope-bound reference from an unsafe raw pointer and an owning shared handle. The [type specification](../../spec/03-types.md) defines the language rules; this note explains the implementation choices that connect references to construction and lifecycle.

## 1. Type vocabulary

| Form | Meaning | Automatic dereference |
| --- | --- | --- |
| `T` | Value of type `T` | None |
| `ref T` | Mutable reference to an existing value | Yes |
| `readonly ref T` | Reference that forbids write-through | Yes, for reads |
| `*T` | Raw pointer used in unsafe code | No |
| `Shared<T>` | Refcounted owner implemented in the standard library | No |

`ref T` and `readonly ref T` are accepted as function or method parameter types and as fields of an `unsafe struct`. They cannot be returned, stored in a local binding, placed in a safe struct or collection element, or used as a safe generic argument. These position rules keep references tied to a caller or an owning unsafe struct without requiring a general borrow checker.

An expression of type `ref T` behaves like `T` at normal use sites: reading and field access dereference it, while a mutable reference permits write-through. At a call site requiring `ref T`, the compiler takes the address implicitly. `Shared<T>` remains an ordinary value; users access its payload explicitly through `.value`.

Raw address-of (`&`) and dereference (`*`) require unsafe code. A raw `*T` does not auto-dereference for field access; write `(*p).field`. `readonly` on a field or parameter restricts reassignment or write-through as defined by its type. Plain `let` bindings are mutable, and `const` bindings are immutable.

## 2. Construction and lifecycle

An `unsafe struct` literal establishes each `ref T` field binding from a `*T` value. All reference fields must be present in the literal. Placement into raw storage uses `placeAt<T>` or the underlying copy plus `onCopy<T>` operation. See [constructing reference fields](ref-construction-redesign.md) for the exact operations.

Managed values can define `__oncopy(self: ref Self)` and `__destroy(self: ref Self)`. Copies and replacements invoke lifecycle hooks. Scope exit destroys remaining owned values. A move transfers ownership and suppresses destruction of the source binding. Automatic destruction of fields and locals follows reverse declaration order. User `defer` code runs before automatic destruction at scope exit.

`move x` transfers ownership explicitly and invalidates the source binding. Automatic last-use move elision is not implemented; see [implementation status](../../SPEC-STATUS.md).

## 3. Shared<T>

### 3.1 Layout and lifecycle

The standard library implements `Shared<T>` as a one-word handle containing `value: ref T`. One allocation holds a count followed by the payload. The count address is derived from the payload pointer.

- `Shared<T>.wrap` allocates the block, initializes its count, places the payload, and binds the handle with an `unsafe struct` literal.
- `__oncopy` increments the count.
- `__destroy` decrements the count and, on zero, runs `onDestroy<T>` for the payload and frees the allocation.

The implementation is in [std/shared.kei](../../compiler/std/shared.kei). Reference counts are non-atomic under the current single-threaded model.

Writing `s.value = newValue` changes the shared payload seen by every handle to that allocation. Assigning a new `Shared<T>` to `s` replaces that handle; other handles still refer to the previous allocation. `Shared<T>` itself never auto-dereferences.

## 4. Optional values

Absence is spelled with the generic enum `Optional<T>`. For raw pointers and one-word `Shared<T>` handles, the compiler uses a null pointer carrier for `None`. The source language still constructs and matches `Some` and `None` rather than exposing the carrier. Other layouts and `Weak<T>` remain tracked in [SPEC-STATUS.md](../../SPEC-STATUS.md).

The checker, KIR lowering, and runtime must agree on these representations; changing a carrier requires tests for construction, matching, copying, and destruction.
