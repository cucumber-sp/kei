import { describe, expect, test } from "bun:test";
import { checkError, checkOk } from "./helpers.ts";

describe("Checker — Implicit Literal Conversions", () => {
  // ── Int literal → sized int types ──────────────────────────────────────

  test("int literal → u8: value fits", () => {
    checkOk(`fn main() -> int { let x: u8 = 42; return 0; }`);
  });

  test("int literal → u8: value doesn't fit", () => {
    checkError(`fn main() -> int { let x: u8 = 300; return 0; }`, "type mismatch");
  });

  test("int literal → u8: zero ok", () => {
    checkOk(`fn main() -> int { let x: u8 = 0; return 0; }`);
  });

  test("int literal → u8: max 255 ok", () => {
    checkOk(`fn main() -> int { let x: u8 = 255; return 0; }`);
  });

  test("int literal → u16 ok", () => {
    checkOk(`fn main() -> int { let x: u16 = 1000; return 0; }`);
  });

  test("int literal → i8 ok", () => {
    checkOk(`fn main() -> int { let x: i8 = 100; return 0; }`);
  });

  test("int literal → i8: negative ok", () => {
    checkOk(`fn main() -> int { let x: i8 = -128; return 0; }`);
  });

  test("int literal → i8: too large", () => {
    checkError(`fn main() -> int { let x: i8 = 128; return 0; }`, "type mismatch");
  });

  test("int literal → i16 ok", () => {
    checkOk(`fn main() -> int { let x: i16 = 1000; return 0; }`);
  });

  test("int literal → u64 ok", () => {
    checkOk(`fn main() -> int { let x: u64 = 42; return 0; }`);
  });

  test("int literal → negative value to unsigned: error", () => {
    checkError(`fn main() -> int { let x: u8 = -1; return 0; }`, "type mismatch");
  });

  // ── Int literal → float types ──────────────────────────────────────────

  test("int literal → f64 ok", () => {
    checkOk(`fn main() -> int { let y: f64 = 2; return 0; }`);
  });

  test("int literal → f32 ok", () => {
    checkOk(`fn main() -> int { let y: f32 = 2; return 0; }`);
  });

  // ── Float literal → f32 ────────────────────────────────────────────────

  test("float literal → f32 ok", () => {
    checkOk(`fn main() -> int { let z: f32 = 3.14; return 0; }`);
  });

  // ── Const statements ───────────────────────────────────────────────────

  test("const: int literal → u8 ok", () => {
    checkOk(`fn main() -> int { const x: u8 = 42; return 0; }`);
  });

  test("const: int literal → f64 ok", () => {
    checkOk(`fn main() -> int { const y: f64 = 10; return 0; }`);
  });

  // ── Variables NOT ok ───────────────────────────────────────────────────

  test("variable i32 → f64: error (not a literal)", () => {
    checkError(
      `fn main() -> int { let a: i32 = 5; let b: f64 = a; return 0; }`,
      "type mismatch"
    );
  });

  test("variable i32 → u8: error (not a literal)", () => {
    checkError(
      `fn main() -> int { let a: i32 = 5; let b: u8 = a; return 0; }`,
      "type mismatch"
    );
  });

  // ── Struct field literals ──────────────────────────────────────────────

  test("struct field: int literal → f64 ok", () => {
    checkOk(`
      struct Point { x: f64; y: f64; }
      fn main() -> int { let p = Point { x: 1, y: 2 }; return 0; }
    `);
  });

  test("struct field: int literal → u8 ok", () => {
    checkOk(`
      struct Pixel { r: u8; g: u8; b: u8; }
      fn main() -> int { let p = Pixel { r: 255, g: 128, b: 0 }; return 0; }
    `);
  });

  test("struct field: int literal → u8 overflow error", () => {
    checkError(
      `
      struct Pixel { r: u8; g: u8; b: u8; }
      fn main() -> int { let p = Pixel { r: 256, g: 0, b: 0 }; return 0; }
      `,
      "field 'r'"
    );
  });

  // ── Function arguments ─────────────────────────────────────────────────

  test("function arg: int literal → f64 ok", () => {
    checkOk(`
      fn foo(x: f64) -> f64 { return x; }
      fn main() -> int { foo(42); return 0; }
    `);
  });

  test("function arg: int literal → u8 ok", () => {
    checkOk(`
      fn bar(x: u8) -> u8 { return x; }
      fn main() -> int { bar(100); return 0; }
    `);
  });

  test("function arg: int literal → u8 overflow error", () => {
    checkError(
      `
      fn bar(x: u8) -> u8 { return x; }
      fn main() -> int { bar(300); return 0; }
      `,
      "argument 1"
    );
  });

  // ── Return statements ──────────────────────────────────────────────────

  test("return: int literal → f64 ok", () => {
    checkOk(`fn foo() -> f64 { return 42; }`);
  });

  test("return: int literal → u8 ok", () => {
    checkOk(`fn foo() -> u8 { return 200; }`);
  });

  test("return: int literal → u8 overflow error", () => {
    checkError(`fn foo() -> u8 { return 256; }`, "return type mismatch");
  });

  test("return: float literal → f32 ok", () => {
    checkOk(`fn foo() -> f32 { return 3.14; }`);
  });

  // ── Float literal to int: NOT ok ───────────────────────────────────────

  test("float literal → int: error", () => {
    checkError(`fn main() -> int { let x: i32 = 3.14; return 0; }`, "type mismatch");
  });

  test("float literal → u8: error", () => {
    checkError(`fn main() -> int { let x: u8 = 1.5; return 0; }`, "type mismatch");
  });
});
