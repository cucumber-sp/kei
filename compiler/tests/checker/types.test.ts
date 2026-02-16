import { describe, expect, test } from "bun:test";
import { TypeKind } from "../../src/checker/types.ts";
import { checkError, checkOk, typeOf } from "./helpers.ts";

describe("Checker — Types", () => {
  test("integer literal has type i32", () => {
    const t = typeOf("42");
    expect(t.kind).toBe(TypeKind.Int);
    if (t.kind === TypeKind.Int) {
      expect(t.bits).toBe(32);
      expect(t.signed).toBe(true);
    }
  });

  test("float literal has type f64", () => {
    const t = typeOf("3.14");
    expect(t.kind).toBe(TypeKind.Float);
    if (t.kind === TypeKind.Float) {
      expect(t.bits).toBe(64);
    }
  });

  test("string literal has type string", () => {
    const t = typeOf(`"hello"`);
    expect(t.kind).toBe(TypeKind.String);
  });

  test("bool literal has type bool", () => {
    const t = typeOf("true");
    expect(t.kind).toBe(TypeKind.Bool);
  });

  test("integer arithmetic: 1 + 2 → i32", () => {
    const t = typeOf("1 + 2");
    expect(t.kind).toBe(TypeKind.Int);
  });

  test("float arithmetic: 1.0 + 2.0 → f64", () => {
    const t = typeOf("1.0 + 2.0");
    expect(t.kind).toBe(TypeKind.Float);
  });

  test("mixed numeric types: int + float → error", () => {
    checkError(`fn main() -> int { let x = 1 + 1.0; return 0; }`, "requires same types");
  });

  test("boolean logic: true && false → bool", () => {
    const t = typeOf("true && false");
    expect(t.kind).toBe(TypeKind.Bool);
  });

  test("comparison: 1 < 2 → bool", () => {
    const t = typeOf("1 < 2");
    expect(t.kind).toBe(TypeKind.Bool);
  });

  test("string concatenation: string + string → string", () => {
    const t = typeOf(`"a" + "b"`);
    expect(t.kind).toBe(TypeKind.String);
  });

  test("type inference: let x = 42 → x is int", () => {
    checkOk(`fn main() -> int { let x = 42; return x; }`);
  });

  test("type annotation match: let x: int = 42 → ok", () => {
    checkOk(`fn main() -> int { let x: int = 42; return x; }`);
  });

  test("type annotation mismatch: let x: string = 42 → error", () => {
    checkError(`fn main() -> int { let x: string = 42; return 0; }`, "type mismatch");
  });

  test("null type: let p: ptr<int> = null → ok", () => {
    checkOk(`fn main() -> int { let p: ptr<int> = null; return 0; }`);
  });

  test("null to non-ptr: let x: int = null → error", () => {
    checkError(`fn main() -> int { let x: int = null; return 0; }`, "type mismatch");
  });

  test("integer widening: i32 → i64", () => {
    checkOk(`
      fn main() -> int {
        let x: i32 = 42;
        let y: i64 = x;
        return 0;
      }
    `);
  });

  test("no implicit signed↔unsigned: i32 to u32 → error", () => {
    checkError(`fn main() -> int { let x: i32 = 42; let y: u32 = x; return 0; }`, "type mismatch");
  });

  test("void function used in expression → check works", () => {
    checkOk(`
      fn doStuff() { }
      fn main() -> int { doStuff(); return 0; }
    `);
  });

  test("if expression: both branches same type → ok", () => {
    checkOk(`
      fn main() -> int {
        let x = if true { 1 } else { 2 };
        return x;
      }
    `);
  });

  test("if expression: different branch types → error", () => {
    checkError(
      `fn main() -> int { let x = if true { 1 } else { 2.0 }; return 0; }`,
      "different types"
    );
  });

  test("assign to immutable → error", () => {
    checkError(`fn main() -> int { const x = 5; x = 10; return x; }`, "cannot assign to immutable");
  });

  test("compound assign type check: x += 1.0 where x: int → error", () => {
    checkError(`fn main() -> int { let x = 42; x += 1.0; return x; }`, "requires same types");
  });

  test("increment on non-integer → error", () => {
    checkError(
      `fn main() -> int { let x = 1.0; x++; return 0; }`,
      "increment operator requires integer"
    );
  });

  test("bitwise on non-integer → error", () => {
    checkError(`fn main() -> int { let x = 1.0 & 2.0; return 0; }`, "requires integer operands");
  });

  test("logical on non-bool → error", () => {
    checkError(`fn main() -> int { let x = 1 && 2; return 0; }`, "requires bool operands");
  });

  test("unary minus on bool → error", () => {
    checkError(`fn main() -> int { let x = -true; return 0; }`, "requires numeric operand");
  });

  test("address-of outside unsafe → error", () => {
    checkError(`fn main() -> int { let x = 42; let p = &x; return 0; }`, "requires unsafe block");
  });

  test("deref outside unsafe → error", () => {
    checkError(
      `fn main() -> int { let p: ptr<int> = null; let x = p.*; return 0; }`,
      "requires unsafe block"
    );
  });

  test("deref of non-pointer → error", () => {
    checkError(
      `fn main() -> int { unsafe { let x = 42; let y = x.*; } return 0; }`,
      "cannot dereference non-pointer"
    );
  });

  test("index of non-array → error", () => {
    checkError(`fn main() -> int { let x = 42; let y = x[0]; return 0; }`, "cannot index type");
  });

  test("index with non-integer → error", () => {
    // Parser doesn't support array literals [1, 2, 3], so we use a string for indexing test
    checkError(
      `fn main() -> int { let s = "hello"; let y = s[1.0]; return 0; }`,
      "index must be an integer"
    );
  });

  test("struct literal with wrong field type → error", () => {
    checkError(
      `
        struct Point { x: f64; y: f64; }
        fn main() -> int {
          let p = Point{ x: 1, y: 2 };
          return 0;
        }
      `,
      "expected 'f64'"
    );
  });

  test("struct literal with unknown field → error", () => {
    checkError(
      `
        struct Point { x: f64; y: f64; }
        fn main() -> int {
          let p = Point{ x: 1.0, y: 2.0, z: 3.0 };
          return 0;
        }
      `,
      "has no field 'z'"
    );
  });

  test("struct literal with missing fields → error", () => {
    checkError(
      `
        struct Point { x: f64; y: f64; }
        fn main() -> int {
          let p = Point{ x: 1.0 };
          return 0;
        }
      `,
      "missing field 'y'"
    );
  });

  test("range: 0..10 → Range type", () => {
    const t = typeOf("0..10");
    expect(t.kind).toBe(TypeKind.Range);
  });

  test("range with non-integer → error", () => {
    checkError(`fn main() -> int { let r = 1.0..10.0; return 0; }`, "range start must be integer");
  });

  test("method call resolves correctly", () => {
    checkOk(`
      struct Point {
        x: f64;
        y: f64;
        fn length(self: Point) -> f64 {
          return self.x + self.y;
        }
      }
      fn main() -> int {
        let p = Point{ x: 1.0, y: 2.0 };
        let len = p.length();
        return 0;
      }
    `);
  });

  test("static method call resolves correctly", () => {
    checkOk(`
      struct Point {
        x: f64;
        y: f64;
        fn origin() -> Point {
          return Point{ x: 0.0, y: 0.0 };
        }
      }
      fn main() -> int {
        let p = Point.origin();
        return 0;
      }
    `);
  });

  test("generic struct instantiation: Pair<int, string>", () => {
    checkOk(`
      struct Pair<A, B> { first: A; second: B; }
      fn main() -> int {
        let p = Pair{ first: 42, second: "hello" };
        return 0;
      }
    `);
  });

  test("bitwise NOT on non-integer → error", () => {
    checkError(`fn main() -> int { let x = ~true; return 0; }`, "requires integer operand");
  });

  test("equality comparison between same types → ok", () => {
    checkOk(`fn main() -> int { let x = 1 == 2; return 0; }`);
  });

  test("equality comparison between different types → error", () => {
    checkError(`fn main() -> int { let x = 1 == "hello"; return 0; }`, "requires same types");
  });

  test("let variables are mutable", () => {
    checkOk(`fn main() -> int { let x = 1; x = 2; return x; }`);
  });

  test("compound assign on integers works", () => {
    checkOk(`fn main() -> int { let x = 10; x += 5; return x; }`);
  });

  test("compound bitwise assign works", () => {
    checkOk(`fn main() -> int { let x = 10; x <<= 2; return x; }`);
  });

  test("ptr equality with null → ok", () => {
    checkOk(`
      fn main() -> int {
        let p: ptr<int> = null;
        let x = p != null;
        return 0;
      }
    `);
  });
});
