# Constructing reference fields

An `unsafe struct` may store a `ref T` field. Its binding points to separately managed storage; construction must establish that binding before the value can be used. The rules below complement the [reference model](ref-redesign.md) and [struct specification](../../spec/07-structures.md).

## Operations

| Need | Current operation |
| --- | --- |
| Read the pointer bound to a reference | In an unsafe block, `&self.field` produces the bound `*T` pointer |
| Establish a reference field binding | Supply a `*T` value for the field in an `unsafe struct` literal |
| Initialize the value at raw storage | Use `placeAt<T>(dest, src)`, or copy bytes and call `onCopy<T>` |
| Destroy a value at raw storage | Call `onDestroy<T>` before releasing the allocation |

For a `ref T` field, address-of yields the pointer to the referred value, not the address of the struct field slot. Safe code still sees the field as `T` through automatic dereference.

## Construction invariant

Every `ref T` field must be initialized by name in an `unsafe struct` literal. The checker rejects an empty or partial literal that leaves a reference field unbound. Other omitted fields follow their usual initialization rules.

`std/mem.kei` provides `placeAt<T>` for placement into raw storage. It copies the source bytes to the destination and calls `onCopy<T>` on the placed value. This matters for managed values whose copied representation needs lifecycle work.

`Shared<T>.wrap` in [std/shared.kei](../../compiler/std/shared.kei) shows the complete pattern: allocate a block, initialize the count, place the payload, and return a struct literal that binds its `value: ref T` field. Its hooks use the bound pointer to increment the count or destroy and free the payload.
