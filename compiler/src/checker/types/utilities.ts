// ─── Type Utilities ─────────────────────────────────────────────────────────

import type {
  ArrayType,
  EnumType,
  FloatType,
  FunctionType,
  IntType,
  ModuleType,
  PtrType,
  RangeType,
  SliceType,
  StructType,
  Type,
  TypeParamType,
} from "./definitions";
import { isErrorType } from "./guards";
import { TypeKind } from "./kinds";

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
export function extractLiteralInfo(expr: {
  kind: string;
  value?: number;
  suffix?: string;
  operator?: string;
  operand?: { kind: string; value?: number; suffix?: string };
}): { kind: "IntLiteral" | "FloatLiteral"; value: number } | null {
  if (expr.kind === "IntLiteral" || expr.kind === "FloatLiteral") {
    // Suffixed literals have an explicit type — don't allow implicit conversion
    if (expr.suffix) return null;
    return { kind: expr.kind, value: expr.value as number };
  }
  // Handle unary minus: -(IntLiteral) or -(FloatLiteral)
  if (expr.kind === "UnaryExpr" && expr.operator === "-" && expr.operand) {
    if (expr.operand.suffix) return null;
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
