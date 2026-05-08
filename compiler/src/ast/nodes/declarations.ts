import type { BaseNode } from "./base";
import type { Expression } from "./expressions";
import type { BlockStmt } from "./statements";
import type { TypeNode } from "./types";

export enum DeclKind {
  Function = "FunctionDecl",
  ExternFunction = "ExternFunctionDecl",
  Struct = "StructDecl",
  UnsafeStruct = "UnsafeStructDecl",
  Enum = "EnumDecl",
  TypeAlias = "TypeAlias",
  Import = "ImportDecl",
  Static = "StaticDecl",
}

/**
 * Function parameter.
 *
 * Bindings are mutable by default; `readonly` opts out (blocks
 * reassignment for plain types, blocks write-through for `ref T`).
 * The previous `mut`/`move` parameter forms are removed; use
 * `move` as an expression at the call site for ownership transfer.
 */
export interface Param extends BaseNode {
  kind: "Param";
  name: string;
  typeAnnotation: TypeNode;
  isReadonly: boolean;
}

/**
 * Struct field declaration.
 *
 * `readonly` is the same modifier the parser accepts on params: it
 * blocks reassignment (and, for `ref T` fields, write-through).
 */
export interface Field extends BaseNode {
  kind: "Field";
  name: string;
  typeAnnotation: TypeNode;
  isReadonly: boolean;
}

/** Named function declaration, possibly generic and/or throwing. */
export interface FunctionDecl extends BaseNode {
  kind: "FunctionDecl";
  name: string;
  isPublic: boolean;
  genericParams: string[];
  params: Param[];
  returnType: TypeNode | null;
  /** Error types this function may throw (empty if non-throwing). */
  throwsTypes: TypeNode[];
  body: BlockStmt;
}

/** Foreign function declaration (`extern fn`). No body. */
export interface ExternFunctionDecl extends BaseNode {
  kind: "ExternFunctionDecl";
  name: string;
  params: Param[];
  returnType: TypeNode | null;
}

/** Struct type declaration with fields and methods. */
export interface StructDecl extends BaseNode {
  kind: "StructDecl";
  name: string;
  isPublic: boolean;
  genericParams: string[];
  fields: Field[];
  methods: FunctionDecl[];
}

/** Unsafe struct — fields accessed without safety checks, permits raw layout. */
export interface UnsafeStructDecl extends BaseNode {
  kind: "UnsafeStructDecl";
  name: string;
  isPublic: boolean;
  genericParams: string[];
  fields: Field[];
  methods: FunctionDecl[];
}

/** A single variant within an enum declaration. */
export interface EnumVariant extends BaseNode {
  kind: "EnumVariant";
  name: string;
  /** Named fields (empty for C-style variants). */
  fields: Field[];
  /** Explicit discriminant value, if provided. */
  value: Expression | null;
}

/** Enum type declaration with variants and an optional base type. */
export interface EnumDecl extends BaseNode {
  kind: "EnumDecl";
  name: string;
  isPublic: boolean;
  /** Underlying integer type (e.g. `i32`), null for default. */
  baseType: TypeNode | null;
  variants: EnumVariant[];
}

/** Type alias (`type Name = ExistingType`). */
export interface TypeAlias extends BaseNode {
  kind: "TypeAlias";
  name: string;
  isPublic: boolean;
  typeValue: TypeNode;
}

/** Module import declaration. `items` is empty for whole-module imports. */
export interface ImportDecl extends BaseNode {
  kind: "ImportDecl";
  path: string;
  /** Specific names to import; empty means import entire module. */
  items: string[];
}

/** Top-level static variable declaration. */
export interface StaticDecl extends BaseNode {
  kind: "StaticDecl";
  name: string;
  isPublic: boolean;
  typeAnnotation: TypeNode | null;
  initializer: Expression;
}

/** Union of all top-level declaration nodes. */
export type Declaration =
  | FunctionDecl
  | ExternFunctionDecl
  | StructDecl
  | UnsafeStructDecl
  | EnumDecl
  | TypeAlias
  | ImportDecl
  | StaticDecl;
