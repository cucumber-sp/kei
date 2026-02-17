/**
 * Internal type representations for the Kei type checker.
 * These are semantic types — resolved and concrete — distinct from AST TypeNode.
 */

import type { TypeKind } from "./kinds";

// ─── Type Definitions ───────────────────────────────────────────────────────

/** Fixed-width integer type (signed or unsigned, 8/16/32/64 bits). */
export interface IntType {
  kind: typeof TypeKind.Int;
  bits: 8 | 16 | 32 | 64;
  signed: boolean;
}

/** IEEE 754 floating-point type (32 or 64 bits). */
export interface FloatType {
  kind: typeof TypeKind.Float;
  bits: 32 | 64;
}

/** Boolean type. */
export interface BoolType {
  kind: typeof TypeKind.Bool;
}

/** Void type — used for functions that return nothing. */
export interface VoidType {
  kind: typeof TypeKind.Void;
}

/** UTF-8 string type (pointer + length). */
export interface StringType {
  kind: typeof TypeKind.String;
}

/** C-compatible `char` type for FFI interop. */
export interface CCharType {
  kind: typeof TypeKind.CChar;
}

/** Pointer type (`ptr<T>`). */
export interface PtrType {
  kind: typeof TypeKind.Ptr;
  pointee: Type;
}

/** Fixed-length array type (`[T; N]`). Length is optional during inference. */
export interface ArrayType {
  kind: typeof TypeKind.Array;
  element: Type;
  length?: number;
}

/** Dynamically-sized slice type (`slice<T>`). */
export interface SliceType {
  kind: typeof TypeKind.Slice;
  element: Type;
}

/** Named field within a struct. */
export interface StructFieldInfo {
  name: string;
  type: Type;
}

/** Struct type with named fields and optional methods. */
export interface StructType {
  kind: typeof TypeKind.Struct;
  name: string;
  fields: Map<string, Type>;
  methods: Map<string, FunctionType>;
  isUnsafe: boolean;
  genericParams: string[];
  /** Original base name for generic instantiations (e.g. "Pair" for "Pair_A_B"). */
  genericBaseName?: string;
  /** Original type args for generic instantiations (needed for re-mangling after substitution). */
  genericTypeArgs?: Type[];
  /** True if __destroy was auto-generated (not defined in source). */
  autoDestroy?: boolean;
  /** True if __oncopy was auto-generated (not defined in source). */
  autoOncopy?: boolean;
}

/** Variant info for an enum — name, optional fields, optional explicit discriminant. */
export interface EnumVariantInfo {
  name: string;
  fields: StructFieldInfo[];
  value: number | null;
}

/** Enum type with named variants and an optional underlying base type. */
export interface EnumType {
  kind: typeof TypeKind.Enum;
  name: string;
  /** Underlying integer type, or null for default. */
  baseType: Type | null;
  variants: EnumVariantInfo[];
}

/** Metadata for a function parameter. */
export interface ParamInfo {
  name: string;
  type: Type;
  isMut: boolean;
  isMove: boolean;
}

/** Function type — parameters, return type, throws clause, generics, extern flag. */
export interface FunctionType {
  kind: typeof TypeKind.Function;
  params: ParamInfo[];
  returnType: Type;
  /** Error types this function may throw (empty for non-throwing). */
  throwsTypes: Type[];
  genericParams: string[];
  isExtern: boolean;
}

/** The null literal type — assignable to any `ptr<T>`. */
export interface NullType {
  kind: typeof TypeKind.Null;
}

/** Sentinel type representing a type-checking error (propagates silently). */
export interface ErrorType {
  kind: typeof TypeKind.Error;
}

/** Range type for `start..end` expressions. */
export interface RangeType {
  kind: typeof TypeKind.Range;
  element: Type;
}

/** Unresolved generic type parameter placeholder (e.g. `T`). */
export interface TypeParamType {
  kind: typeof TypeKind.TypeParam;
  name: string;
}

/** Module type — represents an imported module with its public exports. */
export interface ModuleType {
  kind: typeof TypeKind.Module;
  name: string;
  /** Public symbols exported by this module. */
  exports: Map<string, Type>;
}

/** Union of all semantic type representations. */
export type Type =
  | IntType
  | FloatType
  | BoolType
  | VoidType
  | StringType
  | CCharType
  | PtrType
  | ArrayType
  | SliceType
  | StructType
  | EnumType
  | FunctionType
  | NullType
  | ErrorType
  | RangeType
  | TypeParamType
  | ModuleType;
