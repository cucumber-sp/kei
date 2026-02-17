// ─── Type Constructors ──────────────────────────────────────────────────────

import { TypeKind } from "./kinds";
import type {
  IntType,
  FloatType,
  BoolType,
  VoidType,
  StringType,
  CCharType,
  NullType,
  ErrorType,
  PtrType,
  ArrayType,
  SliceType,
  RangeType,
  FunctionType,
  Type,
  ParamInfo,
} from "./definitions";

export function intType(bits: 8 | 16 | 32 | 64, signed: boolean): IntType {
  return { kind: TypeKind.Int, bits, signed };
}

export function floatType(bits: 32 | 64): FloatType {
  return { kind: TypeKind.Float, bits };
}

export const BOOL_TYPE: BoolType = { kind: TypeKind.Bool };
export const VOID_TYPE: VoidType = { kind: TypeKind.Void };
export const STRING_TYPE: StringType = { kind: TypeKind.String };
export const C_CHAR_TYPE: CCharType = { kind: TypeKind.CChar };
export const NULL_TYPE: NullType = { kind: TypeKind.Null };
export const ERROR_TYPE: ErrorType = { kind: TypeKind.Error };

export function ptrType(pointee: Type): PtrType {
  return { kind: TypeKind.Ptr, pointee };
}

export function arrayType(element: Type, length?: number): ArrayType {
  return { kind: TypeKind.Array, element, length };
}

export function sliceType(element: Type): SliceType {
  return { kind: TypeKind.Slice, element };
}

export function rangeType(element: Type): RangeType {
  return { kind: TypeKind.Range, element };
}

export function functionType(
  params: ParamInfo[],
  returnType: Type,
  throwsTypes: Type[] = [],
  genericParams: string[] = [],
  isExtern = false
): FunctionType {
  return {
    kind: TypeKind.Function,
    params,
    returnType,
    throwsTypes,
    genericParams,
    isExtern,
  };
}

// ─── Commonly Used Int Types ────────────────────────────────────────────────

export const I8_TYPE: IntType = intType(8, true);
export const I16_TYPE: IntType = intType(16, true);
export const I32_TYPE: IntType = intType(32, true);
export const I64_TYPE: IntType = intType(64, true);
export const U8_TYPE: IntType = intType(8, false);
export const U16_TYPE: IntType = intType(16, false);
export const U32_TYPE: IntType = intType(32, false);
export const U64_TYPE: IntType = intType(64, false);
export const ISIZE_TYPE: IntType = intType(64, true);
export const USIZE_TYPE: IntType = intType(64, false);
export const F32_TYPE: FloatType = floatType(32);
export const F64_TYPE: FloatType = floatType(64);
