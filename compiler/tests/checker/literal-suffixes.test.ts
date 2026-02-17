import { describe, expect, test } from "bun:test";
import { TypeKind } from "../../src/checker/types";
import { checkError, checkOk, typeOf } from "./helpers.ts";

describe("Checker — numeric literal suffixes", () => {
  test("42u32 has type u32", () => {
    const t = typeOf("42u32");
    expect(t.kind).toBe(TypeKind.Int);
    if (t.kind === TypeKind.Int) {
      expect(t.bits).toBe(32);
      expect(t.signed).toBe(false);
    }
  });

  test("100i64 has type i64", () => {
    const t = typeOf("100i64");
    expect(t.kind).toBe(TypeKind.Int);
    if (t.kind === TypeKind.Int) {
      expect(t.bits).toBe(64);
      expect(t.signed).toBe(true);
    }
  });

  test("255u8 has type u8", () => {
    const t = typeOf("255u8");
    expect(t.kind).toBe(TypeKind.Int);
    if (t.kind === TypeKind.Int) {
      expect(t.bits).toBe(8);
      expect(t.signed).toBe(false);
    }
  });

  test("0i8 has type i8", () => {
    const t = typeOf("0i8");
    expect(t.kind).toBe(TypeKind.Int);
    if (t.kind === TypeKind.Int) {
      expect(t.bits).toBe(8);
      expect(t.signed).toBe(true);
    }
  });

  test("1000i16 has type i16", () => {
    const t = typeOf("1000i16");
    expect(t.kind).toBe(TypeKind.Int);
    if (t.kind === TypeKind.Int) {
      expect(t.bits).toBe(16);
      expect(t.signed).toBe(true);
    }
  });

  test("10u16 has type u16", () => {
    const t = typeOf("10u16");
    expect(t.kind).toBe(TypeKind.Int);
    if (t.kind === TypeKind.Int) {
      expect(t.bits).toBe(16);
      expect(t.signed).toBe(false);
    }
  });

  test("10usize has type usize", () => {
    const t = typeOf("10usize");
    expect(t.kind).toBe(TypeKind.Int);
    if (t.kind === TypeKind.Int) {
      expect(t.bits).toBe(64);
      expect(t.signed).toBe(false);
    }
  });

  test("10isize has type isize", () => {
    const t = typeOf("10isize");
    expect(t.kind).toBe(TypeKind.Int);
    if (t.kind === TypeKind.Int) {
      expect(t.bits).toBe(64);
      expect(t.signed).toBe(true);
    }
  });

  test("42f32 (int with float suffix) has type f32", () => {
    const t = typeOf("42f32");
    expect(t.kind).toBe(TypeKind.Float);
    if (t.kind === TypeKind.Float) {
      expect(t.bits).toBe(32);
    }
  });

  test("42f64 (int with float suffix) has type f64", () => {
    const t = typeOf("42f64");
    expect(t.kind).toBe(TypeKind.Float);
    if (t.kind === TypeKind.Float) {
      expect(t.bits).toBe(64);
    }
  });

  test("2.5f32 has type f32", () => {
    const t = typeOf("2.5f32");
    expect(t.kind).toBe(TypeKind.Float);
    if (t.kind === TypeKind.Float) {
      expect(t.bits).toBe(32);
    }
  });

  test("3.14f64 has type f64", () => {
    const t = typeOf("3.14f64");
    expect(t.kind).toBe(TypeKind.Float);
    if (t.kind === TypeKind.Float) {
      expect(t.bits).toBe(64);
    }
  });

  test("float literal with integer suffix is an error", () => {
    checkError(
      `fn main() -> int { let x = 2.5u32; return 0; }`,
      "integer suffix 'u32' cannot be applied to a float literal"
    );
  });

  test("suffixed literals used in let bindings", () => {
    checkOk(`fn main() -> int {
      let a = 42u32;
      let b = 100i64;
      let c = 255u8;
      let d = 2.5f32;
      let e = 3.14f64;
      return 0;
    }`);
  });

  test("suffixed integer used in same-type arithmetic", () => {
    checkOk(`fn main() -> int {
      let a: u32 = 10u32 + 20u32;
      return 0;
    }`);
  });
});
