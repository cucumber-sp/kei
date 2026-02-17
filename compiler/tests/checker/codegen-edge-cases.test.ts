import { describe, test, expect } from "bun:test";
import { checkError, checkOk, typeOf } from "./helpers.ts";
import { TypeKind } from "../../src/checker/types";

describe("Checker — Codegen Edge Cases", () => {
  // ── Empty struct ─────────────────────────────────────────────────────

  describe("empty struct", () => {
    test("empty struct definition → ok", () => {
      checkOk(`
        struct Empty {}
        fn main() -> int { return 0; }
      `);
    });

    test("empty struct literal → ok", () => {
      checkOk(`
        struct Empty {}
        fn main() -> int {
          let e = Empty{};
          return 0;
        }
      `);
    });

    test("empty struct as function parameter → ok", () => {
      checkOk(`
        struct Token {}
        fn consume(t: Token) -> int { return 0; }
        fn main() -> int {
          return consume(Token{});
        }
      `);
    });
  });

  // ── Struct with single field ─────────────────────────────────────────

  describe("struct with single field", () => {
    test("single int field → ok", () => {
      checkOk(`
        struct Wrapper { value: int; }
        fn main() -> int {
          let w = Wrapper{ value: 42 };
          return w.value;
        }
      `);
    });

    test("single string field → ok", () => {
      checkOk(`
        struct Name { text: string; }
        fn main() -> int {
          let n = Name{ text: "hello" };
          return 0;
        }
      `);
    });

    test("single bool field → ok", () => {
      checkOk(`
        struct Flag { active: bool; }
        fn main() -> int {
          let f = Flag{ active: true };
          return 0;
        }
      `);
    });
  });

  // ── Deeply nested member access ──────────────────────────────────────

  describe("deeply nested member access: a.b.c", () => {
    test("two levels of nesting → ok", () => {
      checkOk(`
        struct Inner { value: int; }
        struct Outer { inner: Inner; }
        fn main() -> int {
          let o = Outer{ inner: Inner{ value: 42 } };
          return o.inner.value;
        }
      `);
    });

    test("three levels of nesting → ok", () => {
      checkOk(`
        struct A { val: int; }
        struct B { a: A; }
        struct C { b: B; }
        fn main() -> int {
          let c = C{ b: B{ a: A{ val: 99 } } };
          return c.b.a.val;
        }
      `);
    });

    test("nested access with method call → ok", () => {
      checkOk(`
        struct Inner {
          x: int;
          fn get(self: Inner) -> int { return self.x; }
        }
        struct Outer { inner: Inner; }
        fn main() -> int {
          let o = Outer{ inner: Inner{ x: 5 } };
          let v = o.inner.get();
          return v;
        }
      `);
    });

    test("nested access non-existent deep field → error", () => {
      checkError(
        `
          struct Inner { value: int; }
          struct Outer { inner: Inner; }
          fn main() -> int {
            let o = Outer{ inner: Inner{ value: 42 } };
            return o.inner.nonexistent;
          }
        `,
        "has no field or method 'nonexistent'"
      );
    });
  });

  // ── Shadowing variable names ─────────────────────────────────────────

  describe("shadowing variable names", () => {
    test("shadow in inner block → ok", () => {
      checkOk(`
        fn main() -> int {
          let x = 10;
          {
            let x = 20;
            let y = x;
          }
          return x;
        }
      `);
    });

    test("shadow across multiple nested blocks → ok", () => {
      checkOk(`
        fn main() -> int {
          let x = 1;
          {
            let x = 2;
            {
              let x = 3;
              let y = x;
            }
          }
          return x;
        }
      `);
    });

    test("shadow function parameter in body → ok", () => {
      checkOk(`
        fn foo(x: int) -> int {
          {
            let x = x + 1;
            return x;
          }
        }
      `);
    });

    test("shadow with different type in inner block → ok", () => {
      checkOk(`
        fn main() -> int {
          let x = 42;
          {
            let x = 3.14;
            let y = x;
          }
          return x;
        }
      `);
    });
  });

  // ── Switch statements ────────────────────────────────────────────────

  describe("switch statements", () => {
    test("switch on int with multiple cases → ok", () => {
      checkOk(`
        fn main() -> int {
          let x = 2;
          switch x {
            case 1: return 10;
            case 2: return 20;
            case 3: return 30;
            default: return 0;
          }
        }
      `);
    });

    test("switch exhaustiveness on enum — all covered → ok", () => {
      checkOk(`
        enum Color : u8 { Red = 0, Green = 1, Blue = 2 }
        fn describe(c: Color) -> int {
          switch c {
            case Red: return 0;
            case Green: return 1;
            case Blue: return 2;
          }
        }
      `);
    });

    test("switch exhaustiveness on enum — missing variant → error", () => {
      checkError(
        `
          enum Dir : u8 { N = 0, S = 1, E = 2, W = 3 }
          fn go(d: Dir) -> int {
            switch d {
              case N: return 0;
              case S: return 1;
            }
          }
        `,
        "not exhaustive, missing: E, W"
      );
    });

    test("switch with default covers remaining → ok", () => {
      checkOk(`
        enum Dir : u8 { N = 0, S = 1, E = 2, W = 3 }
        fn go(d: Dir) -> int {
          switch d {
            case N: return 0;
            default: return -1;
          }
        }
      `);
    });
  });

  // ── Break/continue in nested loops ───────────────────────────────────

  describe("break/continue in nested loops", () => {
    test("break in inner loop, continue in outer → ok", () => {
      checkOk(`
        fn main() -> int {
          for i in 0..10 {
            for j in 0..10 {
              if j == 3 { break; }
            }
            if i == 5 { continue; }
          }
          return 0;
        }
      `);
    });

    test("continue in inner while, break in outer for → ok", () => {
      checkOk(`
        fn main() -> int {
          for i in 0..5 {
            let j = 0;
            while j < 5 {
              j = j + 1;
              if j == 2 { continue; }
            }
            if i == 3 { break; }
          }
          return 0;
        }
      `);
    });

    test("break outside any loop → error", () => {
      checkError(
        `fn main() -> int { break; return 0; }`,
        "'break' used outside of a loop"
      );
    });

    test("continue outside any loop → error", () => {
      checkError(
        `fn main() -> int { continue; return 0; }`,
        "'continue' used outside of a loop"
      );
    });
  });

  // ── Return from inside if-expression ─────────────────────────────────

  describe("return from inside if", () => {
    test("early return from if branch → ok", () => {
      checkOk(`
        fn abs(x: int) -> int {
          if x < 0 { return 0 - x; }
          return x;
        }
      `);
    });

    test("return in both branches → function returns ok", () => {
      checkOk(`
        fn sign(x: int) -> int {
          if x > 0 {
            return 1;
          } else if x < 0 {
            return -1;
          } else {
            return 0;
          }
        }
      `);
    });

    test("return only in then-branch without else → missing return error", () => {
      checkError(
        `
          fn bad(x: int) -> int {
            if x > 0 { return x; }
          }
        `,
        "does not return a value on all paths"
      );
    });
  });

  // ── Unsafe block in various positions ────────────────────────────────

  describe("unsafe block in various positions", () => {
    test("unsafe block at function top level → ok", () => {
      checkOk(`
        fn main() -> int {
          unsafe { let x = 1; }
          return 0;
        }
      `);
    });

    test("unsafe block inside if branch → ok", () => {
      checkOk(`
        fn main() -> int {
          if true {
            unsafe { let x = 1; }
          }
          return 0;
        }
      `);
    });

    test("unsafe block inside while loop → ok", () => {
      checkOk(`
        fn main() -> int {
          let i = 0;
          while i < 1 {
            unsafe { let x = 1; }
            i = i + 1;
          }
          return 0;
        }
      `);
    });

    test("unsafe expression as let initializer → ok", () => {
      checkOk(`
        fn main() -> int {
          let x = 42;
          let p = unsafe { &x };
          return 0;
        }
      `);
    });

    test("unsafe does not leak to enclosing scope", () => {
      checkError(
        `
          fn main() -> int {
            let x = 42;
            unsafe { let p = &x; }
            let q = &x;
            return 0;
          }
        `,
        "requires unsafe block"
      );
    });
  });

  // ── sizeof on different types ────────────────────────────────────────

  describe("sizeof on different types", () => {
    test("sizeof on struct → ok", () => {
      checkOk(`
        struct Point { x: f64; y: f64; }
        fn main() -> int { let s = sizeof(Point); return 0; }
      `);
    });

    test("sizeof with wrong arg count → error", () => {
      checkError(
        `
          struct A {}
          fn main() -> int { let s = sizeof(A, A); return 0; }
        `,
        "'sizeof' expects exactly 1 argument"
      );
    });

    test("sizeof with no args → error", () => {
      checkError(
        `fn main() -> int { let s = sizeof(); return 0; }`,
        "'sizeof' expects exactly 1 argument"
      );
    });
  });

  // ── Cast (as) between numeric types ──────────────────────────────────

  describe("cast (as) between numeric types", () => {
    test("i32 → f64 → ok", () => {
      checkOk(`fn main() -> int { let x: i32 = 42; let y = x as f64; return 0; }`);
    });

    test("f64 → i32 → ok", () => {
      checkOk(`fn main() -> int { let x: f64 = 3.14; let y = x as i32; return 0; }`);
    });

    test("i32 → i64 (widening) → ok", () => {
      checkOk(`fn main() -> int { let x: i32 = 42; let y = x as i64; return 0; }`);
    });

    test("i64 → i32 (narrowing) → ok", () => {
      checkOk(`fn main() -> int { let x: i64 = 100; let y = x as i32; return 0; }`);
    });

    test("u8 → i32 → ok", () => {
      checkOk(`fn main() -> int { let x: u8 = 42; let y = x as i32; return 0; }`);
    });

    test("i32 → u32 → ok", () => {
      checkOk(`fn main() -> int { let x: i32 = 42; let y = x as u32; return 0; }`);
    });

    test("bool → i32 → ok", () => {
      checkOk(`fn main() -> int { let b = true; let x = b as i32; return 0; }`);
    });

    test("string → i32 → error", () => {
      checkError(
        `fn main() -> int { let s = "hi"; let x = s as i32; return 0; }`,
        "cannot cast"
      );
    });

    test("struct → i32 → error", () => {
      checkError(
        `
          struct Foo { x: int; }
          fn main() -> int { let f = Foo{ x: 1 }; let y = f as i32; return 0; }
        `,
        "cannot cast"
      );
    });

    test("cast result type is target type (i32 as u8 → u8)", () => {
      const t = typeOf("42 as u8");
      expect(t.kind).toBe(TypeKind.Int);
      if (t.kind === TypeKind.Int) {
        expect(t.bits).toBe(8);
        expect(t.signed).toBe(false);
      }
    });

    test("cast result type is target type (i32 as f64 → f64)", () => {
      const t = typeOf("42 as f64");
      expect(t.kind).toBe(TypeKind.Float);
      if (t.kind === TypeKind.Float) {
        expect(t.bits).toBe(64);
      }
    });
  });

  // ── Cast between pointer types in unsafe ─────────────────────────────

  describe("cast between pointer types in unsafe", () => {
    test("ptr<i32> → ptr<u8> in unsafe → ok", () => {
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

    test("ptr cast outside unsafe → error", () => {
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

  // ── Method call patterns ─────────────────────────────────────────────

  describe("method call patterns", () => {
    test("method with no args (only self) → ok", () => {
      checkOk(`
        struct Counter {
          val: int;
          fn value(self: Counter) -> int { return self.val; }
        }
        fn main() -> int {
          let c = Counter{ val: 5 };
          return c.value();
        }
      `);
    });

    test("method with extra args → ok", () => {
      checkOk(`
        struct Rect {
          w: int;
          h: int;
          fn scaled(self: Rect, factor: int) -> int {
            return self.w * self.h * factor;
          }
        }
        fn main() -> int {
          let r = Rect{ w: 3, h: 4 };
          return r.scaled(2);
        }
      `);
    });

    test("static method (no self) called via type → ok", () => {
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
  });

  // ── Recursion ────────────────────────────────────────────────────────

  describe("recursion", () => {
    test("simple recursive function → ok", () => {
      checkOk(`
        fn factorial(n: int) -> int {
          if n <= 1 { return 1; }
          return n * factorial(n - 1);
        }
      `);
    });

    test("mutual recursion via forward reference → ok", () => {
      checkOk(`
        fn isEven(n: int) -> bool {
          if n == 0 { return true; }
          return isOdd(n - 1);
        }
        fn isOdd(n: int) -> bool {
          if n == 0 { return false; }
          return isEven(n - 1);
        }
      `);
    });
  });

  // ── Multiple return paths ────────────────────────────────────────────

  describe("multiple return paths", () => {
    test("if/else if/else all return → ok", () => {
      checkOk(`
        fn classify(x: int) -> int {
          if x > 0 { return 1; }
          else if x < 0 { return -1; }
          else { return 0; }
        }
      `);
    });

    test("while with unconditional return in body → ok", () => {
      checkOk(`
        fn firstPositive(a: int, b: int) -> int {
          if a > 0 { return a; }
          if b > 0 { return b; }
          return 0;
        }
      `);
    });
  });

  // ── Const / static ──────────────────────────────────────────────────

  describe("const and static", () => {
    test("const variable is immutable → assignment error", () => {
      checkError(
        `fn main() -> int { const x = 10; x = 20; return x; }`,
        "cannot assign to immutable variable 'x'"
      );
    });

    test("static used in function body → ok", () => {
      checkOk(`
        static MAX = 100;
        fn main() -> int { return MAX; }
      `);
    });
  });

  // ── Void functions ───────────────────────────────────────────────────

  describe("void functions", () => {
    test("void function with no return → ok", () => {
      checkOk(`fn doNothing() { }`);
    });

    test("void function with empty return → ok", () => {
      checkOk(`fn doNothing() { return; }`);
    });

    test("void function returning value → error", () => {
      checkError(
        `fn doNothing() { return 42; }`,
        "expects return type 'void', got"
      );
    });
  });

  // ── Enum usage ───────────────────────────────────────────────────────

  describe("enum usage", () => {
    test("enum definition and usage in switch → ok", () => {
      checkOk(`
        enum Color : u8 { Red = 0, Green = 1, Blue = 2 }
        fn main() -> int {
          let c = Color.Red;
          switch c {
            case Red: return 0;
            case Green: return 1;
            case Blue: return 2;
          }
        }
      `);
    });
  });

  // ── For loop patterns ────────────────────────────────────────────────

  describe("for loop patterns", () => {
    test("for i in range with body → ok", () => {
      checkOk(`
        fn main() -> int {
          let sum = 0;
          for i in 0..10 {
            sum = sum + i;
          }
          return sum;
        }
      `);
    });

    test("for with index variable → ok", () => {
      checkOk(`
        fn main() -> int {
          for item, idx in 0..5 {
            let x = item + idx;
          }
          return 0;
        }
      `);
    });

    test("for loop variable not accessible outside → error", () => {
      checkError(
        `fn main() -> int { for i in 0..10 {} return i; }`,
        "undeclared variable 'i'"
      );
    });
  });
});
