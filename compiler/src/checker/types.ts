/**
 * Internal type representations for the Kei type checker.
 * These are semantic types — resolved and concrete — distinct from AST TypeNode.
 */

// ─── Type Kind Constants ────────────────────────────────────────────────────

export const TypeKind = {
  Int: "int",
  Float: "float",
  Bool: "bool",
  Void: "void",
  String: "string",
  Ptr: "ptr",
  Array: "array",
  Slice: "slice",
  Struct: "struct",
  Enum: "enum",
  Function: "function",
  Null: "null",
  Error: "error",
  Range: "range",
  CChar: "c_char",
  TypeParam: "type_param",
} as const;

export type TypeKindValue = (typeof TypeKind)[keyof typeof TypeKind];

// ─── Type Definitions ───────────────────────────────────────────────────────

export interface IntType {
  kind: typeof TypeKind.Int;
  bits: 8 | 16 | 32 | 64;
  signed: boolean;
}

export interface FloatType {
  kind: typeof TypeKind.Float;
  bits: 32 | 64;
}

export interface BoolType {
  kind: typeof TypeKind.Bool;
}

export interface VoidType {
  kind: typeof TypeKind.Void;
}

export interface StringType {
  kind: typeof TypeKind.String;
}

export interface CCharType {
  kind: typeof TypeKind.CChar;
}

export interface PtrType {
  kind: typeof TypeKind.Ptr;
  pointee: Type;
}

export interface ArrayType {
  kind: typeof TypeKind.Array;
  element: Type;
}

export interface SliceType {
  kind: typeof TypeKind.Slice;
  element: Type;
}

export interface StructFieldInfo {
  name: string;
  type: Type;
}

export interface StructType {
  kind: typeof TypeKind.Struct;
  name: string;
  fields: Map<string, Type>;
  methods: Map<string, FunctionType>;
  isUnsafe: boolean;
  genericParams: string[];
}

export interface EnumVariantInfo {
  name: string;
  fields: StructFieldInfo[];
  value: number | null;
}

export interface EnumType {
  kind: typeof TypeKind.Enum;
  name: string;
  baseType: Type | null;
  variants: EnumVariantInfo[];
}

export interface ParamInfo {
  name: string;
  type: Type;
  isMut: boolean;
  isMove: boolean;
}

export interface FunctionType {
  kind: typeof TypeKind.Function;
  params: ParamInfo[];
  returnType: Type;
  throwsTypes: Type[];
  genericParams: string[];
  isExtern: boolean;
}

export interface NullType {
  kind: typeof TypeKind.Null;
}

export interface ErrorType {
  kind: typeof TypeKind.Error;
}

export interface RangeType {
  kind: typeof TypeKind.Range;
  element: Type;
}

export interface TypeParamType {
  kind: typeof TypeKind.TypeParam;
  name: string;
}

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
  | TypeParamType;

// ─── Type Constructors ──────────────────────────────────────────────────────

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

export function arrayType(element: Type): ArrayType {
  return { kind: TypeKind.Array, element };
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

export function typeParamType(name: string): TypeParamType {
  return { kind: TypeKind.TypeParam, name };
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

// ─── Type Utilities ─────────────────────────────────────────────────────────

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

export function isPtrType(t: Type): t is PtrType {
  return t.kind === TypeKind.Ptr;
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

/** Check if two types are structurally equal */
export function typesEqual(a: Type, b: Type): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case TypeKind.Int:
      return a.bits === (b as IntType).bits && a.signed === (b as IntType).signed;
    case TypeKind.Float:
      return a.bits === (b as FloatType).bits;
    case TypeKind.Bool:
    case TypeKind.Void:
    case TypeKind.String:
    case TypeKind.Null:
    case TypeKind.Error:
    case TypeKind.CChar:
      return true;
    case TypeKind.Ptr:
      return typesEqual(a.pointee, (b as PtrType).pointee);
    case TypeKind.Array:
      return typesEqual(a.element, (b as ArrayType).element);
    case TypeKind.Slice:
      return typesEqual(a.element, (b as SliceType).element);
    case TypeKind.Range:
      return typesEqual(a.element, (b as RangeType).element);
    case TypeKind.Struct:
      return a.name === (b as StructType).name;
    case TypeKind.Enum:
      return a.name === (b as EnumType).name;
    case TypeKind.Function: {
      const bf = b as FunctionType;
      if (a.params.length !== bf.params.length) return false;
      if (!typesEqual(a.returnType, bf.returnType)) return false;
      for (let i = 0; i < a.params.length; i++) {
        if (!typesEqual(a.params[i]?.type, bf.params[i]?.type)) return false;
      }
      return true;
    }
    case TypeKind.TypeParam:
      return a.name === (b as TypeParamType).name;
    default:
      return false;
  }
}

/**
 * Check if `source` is assignable to `target`.
 * Handles exact match, integer widening, null → ptr, array → slice.
 */
export function isAssignableTo(source: Type, target: Type): boolean {
  if (isErrorType(source) || isErrorType(target)) return true;
  if (typesEqual(source, target)) return true;

  // null assignable to any ptr<T>
  if (source.kind === TypeKind.Null && target.kind === TypeKind.Ptr) return true;

  // ptr<void> assignable to any ptr<T> (generic pointer, like C's void*)
  if (source.kind === TypeKind.Ptr && target.kind === TypeKind.Ptr) {
    if (source.pointee.kind === TypeKind.Void) return true;
  }

  // Integer widening: smaller signed → larger signed, smaller unsigned → larger unsigned
  if (source.kind === TypeKind.Int && target.kind === TypeKind.Int) {
    if (source.signed === target.signed && source.bits < target.bits) return true;
    // unsigned to larger signed (u8 → i16, u16 → i32, etc)
    if (!source.signed && target.signed && source.bits < target.bits) return true;
  }

  // Array → slice implicit conversion (same element type)
  if (source.kind === TypeKind.Array && target.kind === TypeKind.Slice) {
    return typesEqual(source.element, target.element);
  }

  return false;
}

/** Format a Type as a human-readable string */
export function typeToString(t: Type): string {
  switch (t.kind) {
    case TypeKind.Int: {
      if (t.signed) {
        switch (t.bits) {
          case 8:
            return "i8";
          case 16:
            return "i16";
          case 32:
            return "i32";
          case 64:
            return "i64";
        }
      }
      switch (t.bits) {
        case 8:
          return "u8";
        case 16:
          return "u16";
        case 32:
          return "u32";
        case 64:
          return "u64";
      }
      break;
    }
    case TypeKind.Float:
      return t.bits === 32 ? "f32" : "f64";
    case TypeKind.Bool:
      return "bool";
    case TypeKind.Void:
      return "void";
    case TypeKind.String:
      return "string";
    case TypeKind.CChar:
      return "c_char";
    case TypeKind.Ptr:
      return `ptr<${typeToString(t.pointee)}>`;
    case TypeKind.Array:
      return `array<${typeToString(t.element)}>`;
    case TypeKind.Slice:
      return `slice<${typeToString(t.element)}>`;
    case TypeKind.Range:
      return `Range<${typeToString(t.element)}>`;
    case TypeKind.Struct:
      return t.name;
    case TypeKind.Enum:
      return t.name;
    case TypeKind.Function: {
      const params = t.params.map((p) => `${p.name}: ${typeToString(p.type)}`).join(", ");
      const ret = typeToString(t.returnType);
      return `fn(${params}) -> ${ret}`;
    }
    case TypeKind.Null:
      return "null";
    case TypeKind.Error:
      return "<error>";
    case TypeKind.TypeParam:
      return t.name;
  }
}
