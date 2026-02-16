import { describe, expect, test } from "bun:test";
import { TypeKind } from "../../src/checker/types.ts";
import { checkError, checkOk, typeOf } from "./helpers.ts";

describe("Checker — as cast", () => {
  // ── Valid numeric casts ────────────────────────────────────────────────

  test("i32 → f64", () => {
    checkOk(`fn main() -> int { let x: i32 = 42; let y = x as f64; return 0; }`);
  });

  test("f64 → i32", () => {
    checkOk(`fn main() -> int { let x: f64 = 2.5; let y = x as i32; return 0; }`);
  });

  test("i32 → i64 (widening)", () => {
    checkOk(`fn main() -> int { let x: i32 = 42; let y = x as i64; return 0; }`);
  });

  test("i64 → i32 (narrowing)", () => {
    checkOk(`fn main() -> int { let x: i64 = 1000; let y = x as i32; return 0; }`);
  });

  test("i32 → u32 (signed → unsigned)", () => {
    checkOk(`fn main() -> int { let x: i32 = 42; let y = x as u32; return 0; }`);
  });

  test("u32 → i32 (unsigned → signed)", () => {
    checkOk(`fn main() -> int { let x: u32 = 42; let y = x as i32; return 0; }`);
  });

  test("u8 → i32 (widening unsigned → signed)", () => {
    checkOk(`fn main() -> int { let x: u8 = 255; let y = x as i32; return 0; }`);
  });

  test("f32 → f64 (float widening)", () => {
    checkOk(`fn main() -> int { let x: f32 = 1.0 as f32; let y = x as f64; return 0; }`);
  });

  test("f64 → f32 (float narrowing)", () => {
    checkOk(`fn main() -> int { let x: f64 = 1.0; let y = x as f32; return 0; }`);
  });

  // ── Same type cast (no-op) ────────────────────────────────────────────

  test("i32 → i32 (same type, no-op)", () => {
    checkOk(`fn main() -> int { let x: i32 = 42; let y = x as i32; return 0; }`);
  });

  // ── bool → int ────────────────────────────────────────────────────────

  test("bool → i32", () => {
    checkOk(`fn main() -> int { let x = true; let y = x as i32; return 0; }`);
  });

  // ── Result type is correct ────────────────────────────────────────────

  test("cast result type is target type (i32 → f64)", () => {
    const t = typeOf("42 as f64");
    expect(t.kind).toBe(TypeKind.Float);
    if (t.kind === TypeKind.Float) {
      expect(t.bits).toBe(64);
    }
  });

  test("cast result type is target type (f64 → i32)", () => {
    const t = typeOf("3.14 as i32");
    expect(t.kind).toBe(TypeKind.Int);
    if (t.kind === TypeKind.Int) {
      expect(t.bits).toBe(32);
      expect(t.signed).toBe(true);
    }
  });

  test("cast result type is target type (i32 → u8)", () => {
    const t = typeOf("42 as u8");
    expect(t.kind).toBe(TypeKind.Int);
    if (t.kind === TypeKind.Int) {
      expect(t.bits).toBe(8);
      expect(t.signed).toBe(false);
    }
  });

  // ── Invalid casts ─────────────────────────────────────────────────────

  test("string → i32 (error)", () => {
    checkError(
      `fn main() -> int { let x = "hello"; let y = x as i32; return 0; }`,
      "cannot cast"
    );
  });

  test("i32 → bool (error)", () => {
    checkError(
      `fn main() -> int { let x: i32 = 1; let y = x as bool; return 0; }`,
      "cannot cast"
    );
  });

  test("struct → i32 (error)", () => {
    checkError(
      `struct Foo { x: i32; } fn main() -> int { let f = Foo { x: 1 }; let y = f as i32; return 0; }`,
      "cannot cast"
    );
  });

  test("bool → f64 (error)", () => {
    checkError(
      `fn main() -> int { let x = true; let y = x as f64; return 0; }`,
      "cannot cast"
    );
  });

  // ── Pointer casts ─────────────────────────────────────────────────────

  test("ptr cast in unsafe block", () => {
    checkOk(`
      fn main() -> int {
        let x: i32 = 42;
        unsafe {
          let p = &x;
          let q = p as ptr<u8>;
        }
        return 0;
      }
    `);
  });

  test("ptr cast outside unsafe (error)", () => {
    checkError(
      `
      extern fn get_ptr() -> ptr<i32>;
      fn main() -> int {
        let p = unsafe { get_ptr() };
        let q = p as ptr<u8>;
        return 0;
      }
      `,
      "pointer cast requires unsafe"
    );
  });
});
