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
  Module: "module",
} as const;

export type TypeKindValue = (typeof TypeKind)[keyof typeof TypeKind];

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

// ─── Type Guards ─────────────────────────────────────────────────────────────

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

// ─── Type Utilities ─────────────────────────────────────────────────────────

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
    case TypeKind.Module:
      return a.name === (b as ModuleType).name;
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

/**
 * Extract literal info from an expression, handling unary negation.
 * Returns { kind, value } if the expression is a literal (or -literal), else null.
 */
export function extractLiteralInfo(
  expr: { kind: string; value?: number; operator?: string; operand?: { kind: string; value?: number } }
): { kind: "IntLiteral" | "FloatLiteral"; value: number } | null {
  if (expr.kind === "IntLiteral" || expr.kind === "FloatLiteral") {
    return { kind: expr.kind, value: expr.value as number };
  }
  // Handle unary minus: -(IntLiteral) or -(FloatLiteral)
  if (expr.kind === "UnaryExpr" && expr.operator === "-" && expr.operand) {
    if (expr.operand.kind === "IntLiteral") {
      return { kind: "IntLiteral", value: -(expr.operand.value as number) };
    }
    if (expr.operand.kind === "FloatLiteral") {
      return { kind: "FloatLiteral", value: -(expr.operand.value as number) };
    }
  }
  return null;
}

/**
 * Check if a literal value can be implicitly converted to the target type.
 * - Int literal → any int type if the value fits in the range
 * - Int literal → any float type (always ok)
 * - Float literal → f32 (always ok, precision loss acceptable)
 */
export function isLiteralAssignableTo(
  literalKind: "IntLiteral" | "FloatLiteral",
  literalValue: number,
  target: Type
): boolean {
  if (literalKind === "IntLiteral") {
    // Int literal → any int type if value fits
    if (target.kind === TypeKind.Int) {
      const { bits, signed } = target;
      if (signed) {
        const min = -(2 ** (bits - 1));
        const max = 2 ** (bits - 1) - 1;
        return literalValue >= min && literalValue <= max;
      } else {
        const max = 2 ** bits - 1;
        return literalValue >= 0 && literalValue <= max;
      }
    }
    // Int literal → any float type (always ok)
    if (target.kind === TypeKind.Float) {
      return true;
    }
  }

  if (literalKind === "FloatLiteral") {
    // Float literal → f32 (always ok)
    if (target.kind === TypeKind.Float) {
      return true;
    }
  }

  return false;
}

/** Format a Type as a human-readable string. */
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
    case TypeKind.Module:
      return `module(${t.name})`;
  }
}
