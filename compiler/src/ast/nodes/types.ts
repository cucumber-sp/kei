import type { BaseNode } from "./base";

export enum TypeNodeKind {
  Named = "NamedType",
  Generic = "GenericType",
  Nullable = "NullableType",
  Ref = "RefType",
  RawPtr = "RawPtrType",
}

/** A simple named type reference, e.g. `i32`, `MyStruct`. */
export interface NamedType extends BaseNode {
  kind: "NamedType";
  name: string;
}

/** A generic type with type arguments, e.g. `Pair<i32, bool>`. */
export interface GenericType extends BaseNode {
  kind: "GenericType";
  name: string;
  typeArgs: TypeNode[];
}

/** A nullable type suffix, e.g. `MyStruct?`. */
export interface NullableType extends BaseNode {
  kind: "NullableType";
  inner: TypeNode;
}

/**
 * A safe reference type, `ref T` or `readonly ref T`.
 *
 * Position-restricted by the checker: legal only as function/method
 * parameter types and as `unsafe struct` field types. Auto-derefs at
 * use sites to look like the underlying T.
 *
 * `readonly: true` corresponds to C# `in` (no write-through). The
 * default form is C# `ref` (mutable through the reference).
 */
export interface RefType extends BaseNode {
  kind: "RefType";
  pointee: TypeNode;
  readonly: boolean;
}

/**
 * A raw pointer type, `*T`.
 *
 * Unsafe-only: legal in `unsafe struct` field types, locals inside
 * `unsafe` blocks, and `extern fn` signatures. No auto-deref; field
 * access is `(*p).field`.
 */
export interface RawPtrType extends BaseNode {
  kind: "RawPtrType";
  pointee: TypeNode;
}

/** Any type annotation in surface syntax. */
export type TypeNode = NamedType | GenericType | NullableType | RefType | RawPtrType;
