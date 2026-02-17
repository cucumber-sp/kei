import { describe, test } from "bun:test";
import { checkError, checkErrors, checkOk } from "./helpers.ts";

describe("Checker — Implicit Literal Conversions (comprehensive)", () => {
  // ── Int literal → double (f64) in struct fields ──────────────────────

  describe("int literal → double struct fields", () => {
    test("int literal → double field (keyword alias)", () => {
      checkOk(`
        struct Vector { x: double; y: double; }
        fn main() -> int {
          let v = Vector{ x: 1, y: 2 };
          return 0;
        }
      `);
    });

    test("negative int literal → double field", () => {
      checkOk(`
        struct Temp { value: double; }
        fn main() -> int {
          let t = Temp{ value: -42 };
          return 0;
        }
      `);
    });

    test("zero literal → double field", () => {
      checkOk(`
        struct Origin { x: double; y: double; }
        fn main() -> int {
          let o = Origin{ x: 0, y: 0 };
          return 0;
        }
      `);
    });

    test("large int literal → double field", () => {
      checkOk(`
        struct BigVal { n: double; }
        fn main() -> int {
          let b = BigVal{ n: 1000000 };
          return 0;
        }
      `);
    });

    test("mixed int and float literals in double fields", () => {
      checkOk(`
        struct Rect { x: double; y: double; w: double; h: double; }
        fn main() -> int {
          let r = Rect{ x: 0, y: 1, w: 10, h: 20 };
          return 0;
        }
      `);
    });
  });

  // ── Int literal → float (f32) in struct fields ───────────────────────

  describe("int literal → f32 struct fields", () => {
    test("int literal → f32 field", () => {
      checkOk(`
        struct Color { r: f32; g: f32; b: f32; }
        fn main() -> int {
          let c = Color{ r: 1, g: 0, b: 0 };
          return 0;
        }
      `);
    });

    test("negative int literal → f32 field", () => {
      checkOk(`
        struct Offset { dx: f32; }
        fn main() -> int {
          let o = Offset{ dx: -5 };
          return 0;
        }
      `);
    });
  });

  // ── Int literal → i64 in struct fields ───────────────────────────────

  describe("int literal → i64 struct fields", () => {
    test("int literal → i64 field", () => {
      checkOk(`
        struct Timestamp { epoch: i64; }
        fn main() -> int {
          let ts = Timestamp{ epoch: 42 };
          return 0;
        }
      `);
    });

    test("negative int literal → i64 field", () => {
      checkOk(`
        struct Offset { value: i64; }
        fn main() -> int {
          let o = Offset{ value: -100 };
          return 0;
        }
      `);
    });

    test("zero literal → i64 field", () => {
      checkOk(`
        struct Counter { count: i64; }
        fn main() -> int {
          let c = Counter{ count: 0 };
          return 0;
        }
      `);
    });
  });

  // ── Int literal → u8/u16/u32/u64 in struct fields ───────────────────

  describe("int literal → unsigned int struct fields", () => {
    test("int literal → u8 field (within range)", () => {
      checkOk(`
        struct Byte { val: u8; }
        fn main() -> int {
          let b = Byte{ val: 200 };
          return 0;
        }
      `);
    });

    test("int literal → u16 field", () => {
      checkOk(`
        struct Port { num: u16; }
        fn main() -> int {
          let p = Port{ num: 8080 };
          return 0;
        }
      `);
    });

    test("int literal → u32 field", () => {
      checkOk(`
        struct ID { val: u32; }
        fn main() -> int {
          let id = ID{ val: 100000 };
          return 0;
        }
      `);
    });

    test("int literal → u64 field", () => {
      checkOk(`
        struct Handle { val: u64; }
        fn main() -> int {
          let h = Handle{ val: 42 };
          return 0;
        }
      `);
    });

    test("u8 field boundary: 0 ok", () => {
      checkOk(`
        struct B { val: u8; }
        fn main() -> int { let b = B{ val: 0 }; return 0; }
      `);
    });

    test("u8 field boundary: 255 ok", () => {
      checkOk(`
        struct B { val: u8; }
        fn main() -> int { let b = B{ val: 255 }; return 0; }
      `);
    });

    test("u16 field boundary: 65535 ok", () => {
      checkOk(`
        struct W { val: u16; }
        fn main() -> int { let w = W{ val: 65535 }; return 0; }
      `);
    });
  });

  // ── Float literal → f32 in struct fields ─────────────────────────────

  describe("float literal → f32 struct fields", () => {
    test("float literal → f32 field", () => {
      checkOk(`
        struct Coord { lat: f32; lon: f32; }
        fn main() -> int {
          let c = Coord{ lat: 3.14, lon: 2.71 };
          return 0;
        }
      `);
    });

    test("negative float literal → f32 field", () => {
      checkOk(`
        struct Temp { celsius: f32; }
        fn main() -> int {
          let t = Temp{ celsius: -40.0 };
          return 0;
        }
      `);
    });
  });

  // ── Implicit literal conversions in function calls ───────────────────

  describe("function call argument conversions", () => {
    test("int literal → double param", () => {
      checkOk(`
        fn scale(factor: double) -> double { return factor; }
        fn main() -> int { scale(5); return 0; }
      `);
    });

    test("int literal → f32 param", () => {
      checkOk(`
        fn clamp(v: f32) -> f32 { return v; }
        fn main() -> int { clamp(10); return 0; }
      `);
    });

    test("float literal → f32 param", () => {
      checkOk(`
        fn clamp(v: f32) -> f32 { return v; }
        fn main() -> int { clamp(1.5); return 0; }
      `);
    });

    test("int literal → i64 param", () => {
      checkOk(`
        fn timestamp(t: i64) -> i64 { return t; }
        fn main() -> int { timestamp(100); return 0; }
      `);
    });

    test("int literal → u8 param (in range)", () => {
      checkOk(`
        fn byte_val(b: u8) -> u8 { return b; }
        fn main() -> int { byte_val(200); return 0; }
      `);
    });

    test("multiple args with different conversions", () => {
      checkOk(`
        fn mix(a: double, b: f32, c: u8) -> double { return a; }
        fn main() -> int { mix(1, 2, 3); return 0; }
      `);
    });

    test("int literal → double param: negative value", () => {
      checkOk(`
        fn negate(x: double) -> double { return x; }
        fn main() -> int { negate(-7); return 0; }
      `);
    });
  });

  // ── Implicit literal conversions in let/const ────────────────────────

  describe("let/const declarations", () => {
    test("let x: double = 1", () => {
      checkOk(`fn main() -> int { let x: double = 1; return 0; }`);
    });

    test("let x: f32 = 1", () => {
      checkOk(`fn main() -> int { let x: f32 = 1; return 0; }`);
    });

    test("const x: i64 = 42", () => {
      checkOk(`fn main() -> int { const x: i64 = 42; return 0; }`);
    });

    test("let x: double = -10", () => {
      checkOk(`fn main() -> int { let x: double = -10; return 0; }`);
    });

    test("let x: double = 0", () => {
      checkOk(`fn main() -> int { let x: double = 0; return 0; }`);
    });

    test("let x: f32 = 3.14", () => {
      checkOk(`fn main() -> int { let x: f32 = 3.14; return 0; }`);
    });

    test("const x: u8 = 255", () => {
      checkOk(`fn main() -> int { const x: u8 = 255; return 0; }`);
    });

    test("const x: u16 = 1000", () => {
      checkOk(`fn main() -> int { const x: u16 = 1000; return 0; }`);
    });

    test("const x: u32 = 100000", () => {
      checkOk(`fn main() -> int { const x: u32 = 100000; return 0; }`);
    });

    test("const x: u64 = 42", () => {
      checkOk(`fn main() -> int { const x: u64 = 42; return 0; }`);
    });

    test("let x: i8 = -128", () => {
      checkOk(`fn main() -> int { let x: i8 = -128; return 0; }`);
    });

    test("let x: i16 = -32768", () => {
      checkOk(`fn main() -> int { let x: i16 = -32768; return 0; }`);
    });
  });

  // ── Error cases ──────────────────────────────────────────────────────

  describe("error cases", () => {
    test("int literal overflow for u8 field", () => {
      checkError(
        `
        struct Pixel { r: u8; }
        fn main() -> int { let p = Pixel{ r: 256 }; return 0; }
        `,
        "field 'r'"
      );
    });

    test("negative int literal in u8 field", () => {
      checkError(
        `
        struct Pixel { r: u8; }
        fn main() -> int { let p = Pixel{ r: -1 }; return 0; }
        `,
        "field 'r'"
      );
    });

    test("int literal overflow for i8 field", () => {
      checkError(
        `
        struct Narrow { val: i8; }
        fn main() -> int { let n = Narrow{ val: 128 }; return 0; }
        `,
        "field 'val'"
      );
    });

    test("int literal underflow for i8 field", () => {
      checkError(
        `
        struct Narrow { val: i8; }
        fn main() -> int { let n = Narrow{ val: -129 }; return 0; }
        `,
        "field 'val'"
      );
    });

    test("int literal overflow for u16 field", () => {
      checkError(
        `
        struct Port { num: u16; }
        fn main() -> int { let p = Port{ num: 65536 }; return 0; }
        `,
        "field 'num'"
      );
    });

    test("variable (not literal) i32 → double should NOT convert", () => {
      checkError(
        `
        fn main() -> int {
          let a: i32 = 5;
          let b: double = a;
          return 0;
        }
        `,
        "type mismatch"
      );
    });

    test("variable (not literal) i32 → f32 should NOT convert", () => {
      checkError(
        `
        fn main() -> int {
          let a: i32 = 5;
          let b: f32 = a;
          return 0;
        }
        `,
        "type mismatch"
      );
    });

    test("variable (not literal) i32 → u8 should NOT convert", () => {
      checkError(
        `
        fn main() -> int {
          let a: i32 = 5;
          let b: u8 = a;
          return 0;
        }
        `,
        "type mismatch"
      );
    });

    test("string literal in numeric field", () => {
      checkError(
        `
        struct Data { x: double; }
        fn main() -> int { let d = Data{ x: "hello" }; return 0; }
        `,
        "field 'x'"
      );
    });

    test("string literal in i32 field", () => {
      checkError(
        `
        struct Data { x: i32; }
        fn main() -> int { let d = Data{ x: "hello" }; return 0; }
        `,
        "field 'x'"
      );
    });

    test("bool literal in double field", () => {
      checkError(
        `
        struct Data { x: double; }
        fn main() -> int { let d = Data{ x: true }; return 0; }
        `,
        "field 'x'"
      );
    });

    test("float literal → i32 let: error", () => {
      checkError(
        `fn main() -> int { let x: i32 = 2.5; return 0; }`,
        "type mismatch"
      );
    });

    test("float literal → u8 let: error", () => {
      checkError(
        `fn main() -> int { let x: u8 = 1.0; return 0; }`,
        "type mismatch"
      );
    });

    test("float literal → i64 let: error", () => {
      checkError(
        `fn main() -> int { let x: i64 = 3.14; return 0; }`,
        "type mismatch"
      );
    });

    test("int literal overflow in let: u8 = 256", () => {
      checkError(
        `fn main() -> int { let x: u8 = 256; return 0; }`,
        "type mismatch"
      );
    });

    test("int literal overflow in let: i8 = 200", () => {
      checkError(
        `fn main() -> int { let x: i8 = 200; return 0; }`,
        "type mismatch"
      );
    });

    test("int literal overflow in function arg", () => {
      checkError(
        `
        fn take_byte(b: u8) -> u8 { return b; }
        fn main() -> int { take_byte(999); return 0; }
        `,
        "argument 1"
      );
    });

    test("variable i32 → double function param: error", () => {
      checkError(
        `
        fn take_double(x: double) -> double { return x; }
        fn main() -> int {
          let v: i32 = 10;
          take_double(v);
          return 0;
        }
        `,
        "argument 1"
      );
    });

    test("int literal overflow in return: u8 = 300", () => {
      checkError(
        `fn foo() -> u8 { return 300; }`,
        "return type mismatch"
      );
    });

    test("float literal in i32 return: error", () => {
      checkError(
        `fn foo() -> i32 { return 3.14; }`,
        "return type mismatch"
      );
    });
  });

  // ── Return statement conversions ─────────────────────────────────────

  describe("return statement conversions", () => {
    test("return int literal as double", () => {
      checkOk(`fn foo() -> double { return 42; }`);
    });

    test("return int literal as f32", () => {
      checkOk(`fn foo() -> f32 { return 10; }`);
    });

    test("return float literal as f32", () => {
      checkOk(`fn foo() -> f32 { return 2.5; }`);
    });

    test("return int literal as i64", () => {
      checkOk(`fn foo() -> i64 { return 100; }`);
    });

    test("return int literal as u8 (in range)", () => {
      checkOk(`fn foo() -> u8 { return 127; }`);
    });

    test("return negative int literal as double", () => {
      checkOk(`fn foo() -> double { return -99; }`);
    });

    test("return zero as double", () => {
      checkOk(`fn foo() -> double { return 0; }`);
    });
  });

  // ── Assignment conversions ───────────────────────────────────────────

  describe("assignment to typed variables", () => {
    test("assign int literal to double variable", () => {
      checkOk(`
        fn main() -> int {
          let x: double = 0.0;
          x = 5;
          return 0;
        }
      `);
    });

    test("assign int literal to f32 variable", () => {
      checkOk(`
        fn main() -> int {
          let x: f32 = 0.0;
          x = 10;
          return 0;
        }
      `);
    });

    test("assign float literal to f32 variable", () => {
      checkOk(`
        fn main() -> int {
          let x: f32 = 0.0;
          x = 2.5;
          return 0;
        }
      `);
    });

    test("assign int literal to u8 variable (in range)", () => {
      checkOk(`
        fn main() -> int {
          let x: u8 = 0;
          x = 200;
          return 0;
        }
      `);
    });

    test("assign int literal to u8 variable: overflow error", () => {
      checkError(
        `
        fn main() -> int {
          let x: u8 = 0;
          x = 300;
          return 0;
        }
        `,
        "type mismatch"
      );
    });
  });

  // ── Multiple struct fields with different literal types ──────────────

  describe("struct with mixed typed fields", () => {
    test("struct with double and i32 fields, int literals everywhere", () => {
      checkOk(`
        struct Mixed { a: double; b: i32; c: f32; d: u8; }
        fn main() -> int {
          let m = Mixed{ a: 1, b: 2, c: 3, d: 4 };
          return 0;
        }
      `);
    });

    test("nested struct with implicit conversions", () => {
      checkOk(`
        struct Inner { x: double; }
        struct Outer { val: i32; inner: Inner; }
        fn main() -> int {
          let o = Outer{ val: 5, inner: Inner{ x: 10 } };
          return 0;
        }
      `);
    });
  });
});
