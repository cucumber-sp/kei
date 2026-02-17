// ─── Type Guards ─────────────────────────────────────────────────────────────

import { TypeKind } from "./kinds";
import type {
  Type,
  IntType,
  BoolType,
  PtrType,
  StructType,
  ErrorType,
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

export function isBoolType(t: Type): t is BoolType {
  return t.kind === TypeKind.Bool;
}

export function isPtrType(t: Type): t is PtrType {
  return t.kind === TypeKind.Ptr;
}

export function isStructType(t: Type): t is StructType {
  return t.kind === TypeKind.Struct;
}
