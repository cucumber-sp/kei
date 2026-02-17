import type { BaseNode } from "./base.ts";

export enum TypeNodeKind {
  Named = "NamedType",
  Generic = "GenericType",
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

/** Any type annotation in surface syntax. */
export type TypeNode = NamedType | GenericType;
