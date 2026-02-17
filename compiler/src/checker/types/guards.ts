// ─── Type Guards ─────────────────────────────────────────────────────────────

import { TypeKind } from "./kinds";
import type {
  Type,
  IntType,
  FloatType,
  BoolType,
  VoidType,
  StringType,
  PtrType,
  ArrayType,
  SliceType,
  StructType,
  EnumType,
  FunctionType,
  NullType,
  ErrorType,
  RangeType,
  ModuleType,
  TypeParamType,
} from "./definitions";

export function isErrorType(t: Type): t is ErrorType {
  return t.kind === TypeKind.Error;
}

export function isNumericType(t: Type): boolean {
  return t.kind === TypeKind.Int || t.kind === TypeKind.Float;
}

export function isIntegerType(t: Type): t is IntType {
  return t.kind === TypeKind.Int;
}

export function isFloatType(t: Type): t is FloatType {
  return t.kind === TypeKind.Float;
}

export function isBoolType(t: Type): t is BoolType {
  return t.kind === TypeKind.Bool;
}

export function isVoidType(t: Type): t is VoidType {
  return t.kind === TypeKind.Void;
}

export function isStringType(t: Type): t is StringType {
  return t.kind === TypeKind.String;
}

export function isPtrType(t: Type): t is PtrType {
  return t.kind === TypeKind.Ptr;
}

export function isArrayType(t: Type): t is ArrayType {
  return t.kind === TypeKind.Array;
}

export function isSliceType(t: Type): t is SliceType {
  return t.kind === TypeKind.Slice;
}

export function isStructType(t: Type): t is StructType {
  return t.kind === TypeKind.Struct;
}

export function isEnumType(t: Type): t is EnumType {
  return t.kind === TypeKind.Enum;
}

export function isFunctionType(t: Type): t is FunctionType {
  return t.kind === TypeKind.Function;
}

export function isNullType(t: Type): t is NullType {
  return t.kind === TypeKind.Null;
}

export function isRangeType(t: Type): t is RangeType {
  return t.kind === TypeKind.Range;
}

export function isModuleType(t: Type): t is ModuleType {
  return t.kind === TypeKind.Module;
}

export function isTypeParamType(t: Type): t is TypeParamType {
  return t.kind === TypeKind.TypeParam;
}
