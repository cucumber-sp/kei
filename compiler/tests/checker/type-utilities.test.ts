/**
 * Unit tests for src/checker/types/utilities.ts and src/checker/types/guards.ts.
 *
 * These functions are foundational — used throughout the type checker for
 * equality comparison, assignability, literal coercion, and display. Tests
 * cover every type kind, all conversion rules, and boundary values for
 * literal coercion.
 */

import { describe, expect, test } from "bun:test";
import type { Expression } from "../../src/ast/nodes";
import {
  arrayType,
  BOOL_TYPE,
  C_CHAR_TYPE,
  ERROR_TYPE,
  F32_TYPE,
  F64_TYPE,
  functionType,
  I8_TYPE,
  I16_TYPE,
  I32_TYPE,
  I64_TYPE,
  NULL_TYPE,
  ptrType,
  rangeType,
  STRING_TYPE,
  U8_TYPE,
  U16_TYPE,
  U32_TYPE,
  U64_TYPE,
  VOID_TYPE,
} from "../../src/checker/types/constructors";
import type { EnumType, StructType, Type } from "../../src/checker/types/definitions";
import {
  isBoolType,
  isErrorType,
  isIntegerType,
  isNumericType,
  isPtrType,
  isStructType,
} from "../../src/checker/types/guards";
import { TypeKind } from "../../src/checker/types/kinds";
import {
  extractLiteralInfo,
  isAssignableTo,
  isLiteralAssignableTo,
  typesEqual,
  typeToString,
} from "../../src/checker/types/utilities";
import type { Span } from "../../src/lexer/token";

// ─── Shared test fixtures ─────────────────────────────────────────────────────

const DUMMY_SPAN: Span = { start: 0, end: 0 };

function makeStruct(name: string, genericParams: string[] = []): StructType {
  return {
    kind: TypeKind.Struct,
    name,
    fields: new Map(),
    methods: new Map(),
    isUnsafe: false,
    genericParams,
  };
}

function makeEnum(name: string): EnumType {
  return { kind: TypeKind.Enum, name, baseType: null, variants: [] };
}

function intLiteral(value: number, suffix?: string): Expression {
  return { kind: "IntLiteral", value, suffix, span: DUMMY_SPAN } as Expression;
}

function floatLiteral(value: number, suffix?: string): Expression {
  return { kind: "FloatLiteral", value, suffix, span: DUMMY_SPAN } as Expression;
}

function unaryMinus(operand: Expression): Expression {
  return { kind: "UnaryExpr", operator: "-", operand, span: DUMMY_SPAN } as Expression;
}

function identifier(name: string): Expression {
  return { kind: "Identifier", name, span: DUMMY_SPAN } as Expression;
}

// ─── typesEqual ───────────────────────────────────────────────────────────────

describe("typesEqual", () => {
  describe("same-kind reflexivity", () => {
    test("Bool equals Bool", () => {
      expect(typesEqual(BOOL_TYPE, BOOL_TYPE)).toBe(true);
    });

    test("Void equals Void", () => {
      expect(typesEqual(VOID_TYPE, VOID_TYPE)).toBe(true);
    });

    test("String equals String", () => {
      expect(typesEqual(STRING_TYPE, STRING_TYPE)).toBe(true);
    });

    test("Null equals Null", () => {
      expect(typesEqual(NULL_TYPE, NULL_TYPE)).toBe(true);
    });

    test("Error equals Error", () => {
      expect(typesEqual(ERROR_TYPE, ERROR_TYPE)).toBe(true);
    });

    test("CChar equals CChar", () => {
      expect(typesEqual(C_CHAR_TYPE, C_CHAR_TYPE)).toBe(true);
    });
  });

  describe("integer types", () => {
    test("same bits and signedness are equal", () => {
      expect(typesEqual(I32_TYPE, I32_TYPE)).toBe(true);
      expect(typesEqual(U8_TYPE, U8_TYPE)).toBe(true);
      expect(typesEqual(I64_TYPE, I64_TYPE)).toBe(true);
    });

    test("different bits are not equal", () => {
      expect(typesEqual(I32_TYPE, I64_TYPE)).toBe(false);
      expect(typesEqual(U8_TYPE, U16_TYPE)).toBe(false);
    });

    test("different signedness is not equal", () => {
      expect(typesEqual(I32_TYPE, U32_TYPE)).toBe(false);
      expect(typesEqual(I8_TYPE, U8_TYPE)).toBe(false);
    });

    test("all signed int sizes are distinct", () => {
      const signed = [I8_TYPE, I16_TYPE, I32_TYPE, I64_TYPE];
      for (let i = 0; i < signed.length; i++) {
        for (let j = 0; j < signed.length; j++) {
          expect(typesEqual(signed[i]!, signed[j]!)).toBe(i === j);
        }
      }
    });

    test("all unsigned int sizes are distinct", () => {
      const unsigned = [U8_TYPE, U16_TYPE, U32_TYPE, U64_TYPE];
      for (let i = 0; i < unsigned.length; i++) {
        for (let j = 0; j < unsigned.length; j++) {
          expect(typesEqual(unsigned[i]!, unsigned[j]!)).toBe(i === j);
        }
      }
    });
  });

  describe("float types", () => {
    test("f32 equals f32", () => {
      expect(typesEqual(F32_TYPE, F32_TYPE)).toBe(true);
    });

    test("f64 equals f64", () => {
      expect(typesEqual(F64_TYPE, F64_TYPE)).toBe(true);
    });

    test("f32 does not equal f64", () => {
      expect(typesEqual(F32_TYPE, F64_TYPE)).toBe(false);
    });
  });

  describe("pointer types", () => {
    test("ptr<i32> equals ptr<i32>", () => {
      expect(typesEqual(ptrType(I32_TYPE), ptrType(I32_TYPE))).toBe(true);
    });

    test("ptr<i32> does not equal ptr<bool>", () => {
      expect(typesEqual(ptrType(I32_TYPE), ptrType(BOOL_TYPE))).toBe(false);
    });

    test("nested ptr<ptr<i32>> equals ptr<ptr<i32>>", () => {
      expect(typesEqual(ptrType(ptrType(I32_TYPE)), ptrType(ptrType(I32_TYPE)))).toBe(true);
    });

    test("ptr<ptr<i32>> does not equal ptr<i32>", () => {
      expect(typesEqual(ptrType(ptrType(I32_TYPE)), ptrType(I32_TYPE))).toBe(false);
    });
  });

  describe("array types", () => {
    test("array<i32> equals array<i32>", () => {
      expect(typesEqual(arrayType(I32_TYPE), arrayType(I32_TYPE))).toBe(true);
    });

    test("array<i32> does not equal array<bool>", () => {
      expect(typesEqual(arrayType(I32_TYPE), arrayType(BOOL_TYPE))).toBe(false);
    });
  });

  describe("range types", () => {
    test("Range<i32> equals Range<i32>", () => {
      expect(typesEqual(rangeType(I32_TYPE), rangeType(I32_TYPE))).toBe(true);
    });

    test("Range<i32> does not equal Range<i64>", () => {
      expect(typesEqual(rangeType(I32_TYPE), rangeType(I64_TYPE))).toBe(false);
    });
  });

  describe("struct types", () => {
    test("structs with same name are equal", () => {
      const a = makeStruct("Point");
      const b = makeStruct("Point");
      expect(typesEqual(a, b)).toBe(true);
    });

    test("structs with different names are not equal", () => {
      expect(typesEqual(makeStruct("Point"), makeStruct("Vec"))).toBe(false);
    });
  });

  describe("enum types", () => {
    test("enums with same name are equal", () => {
      expect(typesEqual(makeEnum("Color"), makeEnum("Color"))).toBe(true);
    });

    test("enums with different names are not equal", () => {
      expect(typesEqual(makeEnum("Color"), makeEnum("Direction"))).toBe(false);
    });
  });

  describe("function types", () => {
    test("same params and return type are equal", () => {
      const a = functionType([{ name: "x", type: I32_TYPE, isReadonly: false }], BOOL_TYPE);
      const b = functionType([{ name: "x", type: I32_TYPE, isReadonly: false }], BOOL_TYPE);
      expect(typesEqual(a, b)).toBe(true);
    });

    test("different return types are not equal", () => {
      const a = functionType([], I32_TYPE);
      const b = functionType([], BOOL_TYPE);
      expect(typesEqual(a, b)).toBe(false);
    });

    test("different param counts are not equal", () => {
      const a = functionType([{ name: "x", type: I32_TYPE, isReadonly: false }], VOID_TYPE);
      const b = functionType([], VOID_TYPE);
      expect(typesEqual(a, b)).toBe(false);
    });

    test("different param types are not equal", () => {
      const a = functionType([{ name: "x", type: I32_TYPE, isReadonly: false }], VOID_TYPE);
      const b = functionType([{ name: "x", type: BOOL_TYPE, isReadonly: false }], VOID_TYPE);
      expect(typesEqual(a, b)).toBe(false);
    });

    test("zero-param functions with same return type are equal", () => {
      expect(typesEqual(functionType([], VOID_TYPE), functionType([], VOID_TYPE))).toBe(true);
    });
  });

  describe("type parameter types", () => {
    const T: Type = { kind: TypeKind.TypeParam, name: "T" };
    const U: Type = { kind: TypeKind.TypeParam, name: "U" };

    test("same name are equal", () => {
      expect(typesEqual(T, { kind: TypeKind.TypeParam, name: "T" })).toBe(true);
    });

    test("different names are not equal", () => {
      expect(typesEqual(T, U)).toBe(false);
    });
  });

  describe("module types", () => {
    const modA: Type = { kind: TypeKind.Module, name: "math", exports: new Map() };
    const modB: Type = { kind: TypeKind.Module, name: "io", exports: new Map() };

    test("same name are equal", () => {
      expect(typesEqual(modA, { kind: TypeKind.Module, name: "math", exports: new Map() })).toBe(
        true
      );
    });

    test("different names are not equal", () => {
      expect(typesEqual(modA, modB)).toBe(false);
    });
  });

  describe("cross-kind checks", () => {
    test("Int vs Bool is false", () => {
      expect(typesEqual(I32_TYPE, BOOL_TYPE)).toBe(false);
    });

    test("Bool vs Void is false", () => {
      expect(typesEqual(BOOL_TYPE, VOID_TYPE)).toBe(false);
    });

    test("Ptr vs Array with same element is false", () => {
      expect(typesEqual(ptrType(I32_TYPE), arrayType(I32_TYPE))).toBe(false);
    });

    test("Struct vs Enum with same name is false", () => {
      expect(typesEqual(makeStruct("Color"), makeEnum("Color"))).toBe(false);
    });

    test("Null vs Ptr is false", () => {
      expect(typesEqual(NULL_TYPE, ptrType(I32_TYPE))).toBe(false);
    });
  });
});

// ─── isAssignableTo ───────────────────────────────────────────────────────────

describe("isAssignableTo", () => {
  describe("exact match", () => {
    test("identical types are assignable", () => {
      expect(isAssignableTo(I32_TYPE, I32_TYPE)).toBe(true);
      expect(isAssignableTo(BOOL_TYPE, BOOL_TYPE)).toBe(true);
      expect(isAssignableTo(STRING_TYPE, STRING_TYPE)).toBe(true);
      expect(isAssignableTo(VOID_TYPE, VOID_TYPE)).toBe(true);
      expect(isAssignableTo(F64_TYPE, F64_TYPE)).toBe(true);
    });
  });

  describe("error type propagation", () => {
    test("error source is assignable to any target", () => {
      expect(isAssignableTo(ERROR_TYPE, I32_TYPE)).toBe(true);
      expect(isAssignableTo(ERROR_TYPE, BOOL_TYPE)).toBe(true);
      expect(isAssignableTo(ERROR_TYPE, makeStruct("Point"))).toBe(true);
    });

    test("any source is assignable to error target", () => {
      expect(isAssignableTo(I32_TYPE, ERROR_TYPE)).toBe(true);
      expect(isAssignableTo(BOOL_TYPE, ERROR_TYPE)).toBe(true);
    });
  });

  describe("null to pointer", () => {
    test("null is assignable to any ptr<T>", () => {
      expect(isAssignableTo(NULL_TYPE, ptrType(I32_TYPE))).toBe(true);
      expect(isAssignableTo(NULL_TYPE, ptrType(BOOL_TYPE))).toBe(true);
      expect(isAssignableTo(NULL_TYPE, ptrType(VOID_TYPE))).toBe(true);
    });

    test("null is not assignable to non-pointer types", () => {
      expect(isAssignableTo(NULL_TYPE, I32_TYPE)).toBe(false);
      expect(isAssignableTo(NULL_TYPE, BOOL_TYPE)).toBe(false);
      expect(isAssignableTo(NULL_TYPE, arrayType(I32_TYPE))).toBe(false);
    });
  });

  describe("ptr<void> to any ptr<T>", () => {
    test("ptr<void> is assignable to ptr<i32>", () => {
      expect(isAssignableTo(ptrType(VOID_TYPE), ptrType(I32_TYPE))).toBe(true);
    });

    test("ptr<void> is assignable to ptr<bool>", () => {
      expect(isAssignableTo(ptrType(VOID_TYPE), ptrType(BOOL_TYPE))).toBe(true);
    });

    test("ptr<i32> is NOT assignable to ptr<bool> (non-void pointee)", () => {
      expect(isAssignableTo(ptrType(I32_TYPE), ptrType(BOOL_TYPE))).toBe(false);
    });

    test("ptr<void> is assignable to ptr<void> (exact match takes priority)", () => {
      expect(isAssignableTo(ptrType(VOID_TYPE), ptrType(VOID_TYPE))).toBe(true);
    });
  });

  describe("integer widening — same signedness", () => {
    test("i8 is assignable to i16, i32, i64", () => {
      expect(isAssignableTo(I8_TYPE, I16_TYPE)).toBe(true);
      expect(isAssignableTo(I8_TYPE, I32_TYPE)).toBe(true);
      expect(isAssignableTo(I8_TYPE, I64_TYPE)).toBe(true);
    });

    test("i16 is assignable to i32, i64 but not i8", () => {
      expect(isAssignableTo(I16_TYPE, I32_TYPE)).toBe(true);
      expect(isAssignableTo(I16_TYPE, I64_TYPE)).toBe(true);
      expect(isAssignableTo(I16_TYPE, I8_TYPE)).toBe(false);
    });

    test("i32 is assignable to i64 but not i16 or i8", () => {
      expect(isAssignableTo(I32_TYPE, I64_TYPE)).toBe(true);
      expect(isAssignableTo(I32_TYPE, I16_TYPE)).toBe(false);
      expect(isAssignableTo(I32_TYPE, I8_TYPE)).toBe(false);
    });

    test("u8 is assignable to u16, u32, u64", () => {
      expect(isAssignableTo(U8_TYPE, U16_TYPE)).toBe(true);
      expect(isAssignableTo(U8_TYPE, U32_TYPE)).toBe(true);
      expect(isAssignableTo(U8_TYPE, U64_TYPE)).toBe(true);
    });

    test("u16 is assignable to u32, u64 but not u8", () => {
      expect(isAssignableTo(U16_TYPE, U32_TYPE)).toBe(true);
      expect(isAssignableTo(U16_TYPE, U64_TYPE)).toBe(true);
      expect(isAssignableTo(U16_TYPE, U8_TYPE)).toBe(false);
    });
  });

  describe("integer widening — unsigned to larger signed", () => {
    test("u8 is assignable to i16, i32, i64", () => {
      expect(isAssignableTo(U8_TYPE, I16_TYPE)).toBe(true);
      expect(isAssignableTo(U8_TYPE, I32_TYPE)).toBe(true);
      expect(isAssignableTo(U8_TYPE, I64_TYPE)).toBe(true);
    });

    test("u8 is NOT assignable to i8 (same size)", () => {
      expect(isAssignableTo(U8_TYPE, I8_TYPE)).toBe(false);
    });

    test("u16 is assignable to i32, i64 but not i16 or i8", () => {
      expect(isAssignableTo(U16_TYPE, I32_TYPE)).toBe(true);
      expect(isAssignableTo(U16_TYPE, I64_TYPE)).toBe(true);
      expect(isAssignableTo(U16_TYPE, I16_TYPE)).toBe(false);
      expect(isAssignableTo(U16_TYPE, I8_TYPE)).toBe(false);
    });

    test("u32 is assignable to i64 only", () => {
      expect(isAssignableTo(U32_TYPE, I64_TYPE)).toBe(true);
      expect(isAssignableTo(U32_TYPE, I32_TYPE)).toBe(false);
      expect(isAssignableTo(U32_TYPE, I16_TYPE)).toBe(false);
    });

    test("u64 is NOT assignable to any signed type", () => {
      expect(isAssignableTo(U64_TYPE, I8_TYPE)).toBe(false);
      expect(isAssignableTo(U64_TYPE, I16_TYPE)).toBe(false);
      expect(isAssignableTo(U64_TYPE, I32_TYPE)).toBe(false);
      expect(isAssignableTo(U64_TYPE, I64_TYPE)).toBe(false);
    });
  });

  describe("integer widening — signed to unsigned is never allowed", () => {
    test("i8 is NOT assignable to u8, u16, u32, u64", () => {
      expect(isAssignableTo(I8_TYPE, U8_TYPE)).toBe(false);
      expect(isAssignableTo(I8_TYPE, U16_TYPE)).toBe(false);
      expect(isAssignableTo(I8_TYPE, U32_TYPE)).toBe(false);
      expect(isAssignableTo(I8_TYPE, U64_TYPE)).toBe(false);
    });
  });

  describe("unrelated types are not assignable", () => {
    test("i32 is not assignable to bool", () => {
      expect(isAssignableTo(I32_TYPE, BOOL_TYPE)).toBe(false);
    });

    test("string is not assignable to i32", () => {
      expect(isAssignableTo(STRING_TYPE, I32_TYPE)).toBe(false);
    });

    test("f64 is not assignable to i64", () => {
      expect(isAssignableTo(F64_TYPE, I64_TYPE)).toBe(false);
    });

    test("different structs are not assignable", () => {
      expect(isAssignableTo(makeStruct("Point"), makeStruct("Vec"))).toBe(false);
    });
  });
});

// ─── isLiteralAssignableTo ────────────────────────────────────────────────────

describe("isLiteralAssignableTo", () => {
  describe("int literal to signed integer types", () => {
    test("i8: values in [-128, 127] fit", () => {
      expect(isLiteralAssignableTo("IntLiteral", 0, I8_TYPE)).toBe(true);
      expect(isLiteralAssignableTo("IntLiteral", 127, I8_TYPE)).toBe(true);
      expect(isLiteralAssignableTo("IntLiteral", -128, I8_TYPE)).toBe(true);
      expect(isLiteralAssignableTo("IntLiteral", 128, I8_TYPE)).toBe(false);
      expect(isLiteralAssignableTo("IntLiteral", -129, I8_TYPE)).toBe(false);
    });

    test("i16: values in [-32768, 32767] fit", () => {
      expect(isLiteralAssignableTo("IntLiteral", 32767, I16_TYPE)).toBe(true);
      expect(isLiteralAssignableTo("IntLiteral", -32768, I16_TYPE)).toBe(true);
      expect(isLiteralAssignableTo("IntLiteral", 32768, I16_TYPE)).toBe(false);
      expect(isLiteralAssignableTo("IntLiteral", -32769, I16_TYPE)).toBe(false);
    });

    test("i32: values in [-2^31, 2^31-1] fit", () => {
      const max = 2 ** 31 - 1;
      const min = -(2 ** 31);
      expect(isLiteralAssignableTo("IntLiteral", max, I32_TYPE)).toBe(true);
      expect(isLiteralAssignableTo("IntLiteral", min, I32_TYPE)).toBe(true);
      expect(isLiteralAssignableTo("IntLiteral", max + 1, I32_TYPE)).toBe(false);
      expect(isLiteralAssignableTo("IntLiteral", min - 1, I32_TYPE)).toBe(false);
    });

    test("i64: all reasonable integer values fit", () => {
      expect(isLiteralAssignableTo("IntLiteral", 1_000_000_000_000, I64_TYPE)).toBe(true);
      expect(isLiteralAssignableTo("IntLiteral", -1_000_000_000_000, I64_TYPE)).toBe(true);
    });
  });

  describe("int literal to unsigned integer types", () => {
    test("u8: values in [0, 255] fit", () => {
      expect(isLiteralAssignableTo("IntLiteral", 0, U8_TYPE)).toBe(true);
      expect(isLiteralAssignableTo("IntLiteral", 255, U8_TYPE)).toBe(true);
      expect(isLiteralAssignableTo("IntLiteral", 256, U8_TYPE)).toBe(false);
      expect(isLiteralAssignableTo("IntLiteral", -1, U8_TYPE)).toBe(false);
    });

    test("u16: values in [0, 65535] fit", () => {
      expect(isLiteralAssignableTo("IntLiteral", 0, U16_TYPE)).toBe(true);
      expect(isLiteralAssignableTo("IntLiteral", 65535, U16_TYPE)).toBe(true);
      expect(isLiteralAssignableTo("IntLiteral", 65536, U16_TYPE)).toBe(false);
      expect(isLiteralAssignableTo("IntLiteral", -1, U16_TYPE)).toBe(false);
    });

    test("u32: values in [0, 2^32-1] fit", () => {
      const max = 2 ** 32 - 1;
      expect(isLiteralAssignableTo("IntLiteral", 0, U32_TYPE)).toBe(true);
      expect(isLiteralAssignableTo("IntLiteral", max, U32_TYPE)).toBe(true);
      expect(isLiteralAssignableTo("IntLiteral", max + 1, U32_TYPE)).toBe(false);
      expect(isLiteralAssignableTo("IntLiteral", -1, U32_TYPE)).toBe(false);
    });

    test("u64: non-negative values fit", () => {
      expect(isLiteralAssignableTo("IntLiteral", 0, U64_TYPE)).toBe(true);
      expect(isLiteralAssignableTo("IntLiteral", 1_000_000_000_000, U64_TYPE)).toBe(true);
      expect(isLiteralAssignableTo("IntLiteral", -1, U64_TYPE)).toBe(false);
    });
  });

  describe("int literal to float types", () => {
    test("any integer value is assignable to f32", () => {
      expect(isLiteralAssignableTo("IntLiteral", 0, F32_TYPE)).toBe(true);
      expect(isLiteralAssignableTo("IntLiteral", 100, F32_TYPE)).toBe(true);
      expect(isLiteralAssignableTo("IntLiteral", -100, F32_TYPE)).toBe(true);
    });

    test("any integer value is assignable to f64", () => {
      expect(isLiteralAssignableTo("IntLiteral", 0, F64_TYPE)).toBe(true);
      expect(isLiteralAssignableTo("IntLiteral", 1_000_000, F64_TYPE)).toBe(true);
    });
  });

  describe("float literal to float types", () => {
    test("float literal is assignable to f32 and f64", () => {
      expect(isLiteralAssignableTo("FloatLiteral", 3.14, F32_TYPE)).toBe(true);
      expect(isLiteralAssignableTo("FloatLiteral", 3.14, F64_TYPE)).toBe(true);
      expect(isLiteralAssignableTo("FloatLiteral", -0.5, F32_TYPE)).toBe(true);
    });
  });

  describe("non-matching literal kinds", () => {
    test("int literal is not assignable to bool", () => {
      expect(isLiteralAssignableTo("IntLiteral", 1, BOOL_TYPE)).toBe(false);
    });

    test("int literal is not assignable to string", () => {
      expect(isLiteralAssignableTo("IntLiteral", 0, STRING_TYPE)).toBe(false);
    });

    test("float literal is not assignable to int types", () => {
      expect(isLiteralAssignableTo("FloatLiteral", 3.0, I32_TYPE)).toBe(false);
      expect(isLiteralAssignableTo("FloatLiteral", 3.0, U8_TYPE)).toBe(false);
    });

    test("float literal is not assignable to bool", () => {
      expect(isLiteralAssignableTo("FloatLiteral", 1.0, BOOL_TYPE)).toBe(false);
    });
  });
});

// ─── typeToString ─────────────────────────────────────────────────────────────

describe("typeToString", () => {
  describe("integer types", () => {
    test("signed integer names", () => {
      expect(typeToString(I8_TYPE)).toBe("i8");
      expect(typeToString(I16_TYPE)).toBe("i16");
      expect(typeToString(I32_TYPE)).toBe("i32");
      expect(typeToString(I64_TYPE)).toBe("i64");
    });

    test("unsigned integer names", () => {
      expect(typeToString(U8_TYPE)).toBe("u8");
      expect(typeToString(U16_TYPE)).toBe("u16");
      expect(typeToString(U32_TYPE)).toBe("u32");
      expect(typeToString(U64_TYPE)).toBe("u64");
    });

    test("all 8 integer types produce distinct strings", () => {
      const strings = [
        I8_TYPE,
        I16_TYPE,
        I32_TYPE,
        I64_TYPE,
        U8_TYPE,
        U16_TYPE,
        U32_TYPE,
        U64_TYPE,
      ].map(typeToString);
      const unique = new Set(strings);
      expect(unique.size).toBe(8);
    });
  });

  describe("float types", () => {
    test("f32", () => {
      expect(typeToString(F32_TYPE)).toBe("f32");
    });

    test("f64", () => {
      expect(typeToString(F64_TYPE)).toBe("f64");
    });
  });

  describe("scalar types", () => {
    test("bool", () => {
      expect(typeToString(BOOL_TYPE)).toBe("bool");
    });

    test("void", () => {
      expect(typeToString(VOID_TYPE)).toBe("void");
    });

    test("string", () => {
      expect(typeToString(STRING_TYPE)).toBe("string");
    });

    test("c_char", () => {
      expect(typeToString(C_CHAR_TYPE)).toBe("c_char");
    });

    test("null", () => {
      expect(typeToString(NULL_TYPE)).toBe("null");
    });

    test("error sentinel", () => {
      expect(typeToString(ERROR_TYPE)).toBe("<error>");
    });
  });

  describe("compound types", () => {
    test("ptr<i32>", () => {
      expect(typeToString(ptrType(I32_TYPE))).toBe("ptr<i32>");
    });

    test("ptr<ptr<bool>>", () => {
      expect(typeToString(ptrType(ptrType(BOOL_TYPE)))).toBe("ptr<ptr<bool>>");
    });

    test("array<f64>", () => {
      expect(typeToString(arrayType(F64_TYPE))).toBe("array<f64>");
    });

    test("Range<i32>", () => {
      expect(typeToString(rangeType(I32_TYPE))).toBe("Range<i32>");
    });
  });

  describe("named types", () => {
    test("struct uses its name", () => {
      expect(typeToString(makeStruct("Point"))).toBe("Point");
      expect(typeToString(makeStruct("Vec3"))).toBe("Vec3");
    });

    test("enum uses its name", () => {
      expect(typeToString(makeEnum("Color"))).toBe("Color");
    });
  });

  describe("function type", () => {
    test("no-arg void function", () => {
      expect(typeToString(functionType([], VOID_TYPE))).toBe("fn() -> void");
    });

    test("single param function", () => {
      const t = functionType([{ name: "x", type: I32_TYPE, isReadonly: false }], BOOL_TYPE);
      expect(typeToString(t)).toBe("fn(x: i32) -> bool");
    });

    test("multi-param function", () => {
      const t = functionType(
        [
          { name: "a", type: I32_TYPE, isReadonly: false },
          { name: "b", type: F64_TYPE, isReadonly: false },
        ],
        STRING_TYPE
      );
      expect(typeToString(t)).toBe("fn(a: i32, b: f64) -> string");
    });
  });

  describe("type parameter and module types", () => {
    test("TypeParam uses its name", () => {
      const t: Type = { kind: TypeKind.TypeParam, name: "T" };
      expect(typeToString(t)).toBe("T");
    });

    test("Module uses module(name) format", () => {
      const t: Type = { kind: TypeKind.Module, name: "math", exports: new Map() };
      expect(typeToString(t)).toBe("module(math)");
    });
  });
});

// ─── extractLiteralInfo ───────────────────────────────────────────────────────

describe("extractLiteralInfo", () => {
  describe("plain literals (no suffix)", () => {
    test("IntLiteral without suffix returns IntLiteral info", () => {
      expect(extractLiteralInfo(intLiteral(42))).toEqual({ kind: "IntLiteral", value: 42 });
    });

    test("IntLiteral with value 0", () => {
      expect(extractLiteralInfo(intLiteral(0))).toEqual({ kind: "IntLiteral", value: 0 });
    });

    test("negative IntLiteral value (rare, but valid node)", () => {
      expect(extractLiteralInfo(intLiteral(-5))).toEqual({ kind: "IntLiteral", value: -5 });
    });

    test("FloatLiteral without suffix returns FloatLiteral info", () => {
      expect(extractLiteralInfo(floatLiteral(3.14))).toEqual({
        kind: "FloatLiteral",
        value: 3.14,
      });
    });
  });

  describe("suffixed literals are rejected", () => {
    test("IntLiteral with suffix returns null", () => {
      expect(extractLiteralInfo(intLiteral(42, "i32"))).toBeNull();
    });

    test("IntLiteral with u8 suffix returns null", () => {
      expect(extractLiteralInfo(intLiteral(255, "u8"))).toBeNull();
    });

    test("FloatLiteral with f32 suffix returns null", () => {
      expect(extractLiteralInfo(floatLiteral(1.5, "f32"))).toBeNull();
    });
  });

  describe("unary minus over unsuffixed literals", () => {
    test("-(IntLiteral) negates the value", () => {
      expect(extractLiteralInfo(unaryMinus(intLiteral(10)))).toEqual({
        kind: "IntLiteral",
        value: -10,
      });
    });

    test("-(IntLiteral 0) gives -0 (which equals 0)", () => {
      expect(extractLiteralInfo(unaryMinus(intLiteral(0)))).toEqual({
        kind: "IntLiteral",
        value: -0,
      });
    });

    test("-(FloatLiteral) negates the value", () => {
      expect(extractLiteralInfo(unaryMinus(floatLiteral(2.5)))).toEqual({
        kind: "FloatLiteral",
        value: -2.5,
      });
    });

    test("-(suffixed IntLiteral) returns null", () => {
      expect(extractLiteralInfo(unaryMinus(intLiteral(5, "i8")))).toBeNull();
    });

    test("-(suffixed FloatLiteral) returns null", () => {
      expect(extractLiteralInfo(unaryMinus(floatLiteral(1.0, "f64")))).toBeNull();
    });
  });

  describe("non-literal expressions return null", () => {
    test("Identifier returns null", () => {
      expect(extractLiteralInfo(identifier("x"))).toBeNull();
    });

    test("unary minus over identifier returns null", () => {
      expect(extractLiteralInfo(unaryMinus(identifier("x")))).toBeNull();
    });

    test("binary expression returns null", () => {
      const expr: Expression = {
        kind: "BinaryExpr",
        left: intLiteral(1),
        operator: "+",
        right: intLiteral(2),
        span: DUMMY_SPAN,
      } as Expression;
      expect(extractLiteralInfo(expr)).toBeNull();
    });
  });
});

// ─── Type guards ──────────────────────────────────────────────────────────────

describe("type guards", () => {
  describe("isErrorType", () => {
    test("returns true for ERROR_TYPE", () => {
      expect(isErrorType(ERROR_TYPE)).toBe(true);
    });

    test("returns false for non-error types", () => {
      expect(isErrorType(I32_TYPE)).toBe(false);
      expect(isErrorType(BOOL_TYPE)).toBe(false);
      expect(isErrorType(NULL_TYPE)).toBe(false);
      expect(isErrorType(ptrType(I32_TYPE))).toBe(false);
    });
  });

  describe("isNumericType", () => {
    test("returns true for all integer types", () => {
      for (const t of [
        I8_TYPE,
        I16_TYPE,
        I32_TYPE,
        I64_TYPE,
        U8_TYPE,
        U16_TYPE,
        U32_TYPE,
        U64_TYPE,
      ]) {
        expect(isNumericType(t)).toBe(true);
      }
    });

    test("returns true for float types", () => {
      expect(isNumericType(F32_TYPE)).toBe(true);
      expect(isNumericType(F64_TYPE)).toBe(true);
    });

    test("returns false for non-numeric types", () => {
      expect(isNumericType(BOOL_TYPE)).toBe(false);
      expect(isNumericType(STRING_TYPE)).toBe(false);
      expect(isNumericType(VOID_TYPE)).toBe(false);
      expect(isNumericType(NULL_TYPE)).toBe(false);
      expect(isNumericType(ptrType(I32_TYPE))).toBe(false);
    });
  });

  describe("isIntegerType", () => {
    test("returns true for integer types only", () => {
      for (const t of [
        I8_TYPE,
        I16_TYPE,
        I32_TYPE,
        I64_TYPE,
        U8_TYPE,
        U16_TYPE,
        U32_TYPE,
        U64_TYPE,
      ]) {
        expect(isIntegerType(t)).toBe(true);
      }
    });

    test("returns false for floats and other types", () => {
      expect(isIntegerType(F32_TYPE)).toBe(false);
      expect(isIntegerType(F64_TYPE)).toBe(false);
      expect(isIntegerType(BOOL_TYPE)).toBe(false);
    });

    test("narrows type to IntType", () => {
      if (isIntegerType(I32_TYPE)) {
        expect(I32_TYPE.bits).toBe(32);
        expect(I32_TYPE.signed).toBe(true);
      }
    });
  });

  describe("isBoolType", () => {
    test("returns true for BOOL_TYPE", () => {
      expect(isBoolType(BOOL_TYPE)).toBe(true);
    });

    test("returns false for other types", () => {
      expect(isBoolType(I32_TYPE)).toBe(false);
      expect(isBoolType(VOID_TYPE)).toBe(false);
    });
  });

  describe("isPtrType", () => {
    test("returns true for pointer types", () => {
      expect(isPtrType(ptrType(I32_TYPE))).toBe(true);
      expect(isPtrType(ptrType(VOID_TYPE))).toBe(true);
    });

    test("returns false for non-pointer types", () => {
      expect(isPtrType(I32_TYPE)).toBe(false);
      expect(isPtrType(arrayType(I32_TYPE))).toBe(false);
      expect(isPtrType(NULL_TYPE)).toBe(false);
    });

    test("narrows type to PtrType", () => {
      const p = ptrType(BOOL_TYPE);
      if (isPtrType(p)) {
        expect(p.pointee).toEqual(BOOL_TYPE);
      }
    });
  });

  describe("isStructType", () => {
    test("returns true for struct types", () => {
      expect(isStructType(makeStruct("Point"))).toBe(true);
    });

    test("returns false for non-struct types", () => {
      expect(isStructType(I32_TYPE)).toBe(false);
      expect(isStructType(makeEnum("Color"))).toBe(false);
      expect(isStructType(BOOL_TYPE)).toBe(false);
    });

    test("narrows type to StructType", () => {
      const s = makeStruct("Vec");
      if (isStructType(s)) {
        expect(s.name).toBe("Vec");
        expect(s.fields).toBeDefined();
      }
    });
  });
});
