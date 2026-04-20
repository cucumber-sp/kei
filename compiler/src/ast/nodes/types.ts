import type { BaseNode } from "./base";

export enum TypeNodeKind {
  Named = "NamedType",
  Generic = "GenericType",
  Nullable = "NullableType",
}

/** A simple named type reference, e.g. `i32`, `MyStruct`. */
export interface NamedType extends BaseNode {
  kind: "NamedType";
  name: string;
}

/** A generic type with type arguments, e.g. `ptr<i32>`, `Pair<i32, bool>`. */
export interface GenericType extends BaseNode {
  kind: "GenericType";
  name: string;
  typeArgs: TypeNode[];
}

/** A nullable type suffix, e.g. `MyStruct?`. Lowers to `ptr<inner>`. */
export interface NullableType extends BaseNode {
  kind: "NullableType";
  inner: TypeNode;
}

/** Any type annotation in surface syntax. */
export type TypeNode = NamedType | GenericType | NullableType;
