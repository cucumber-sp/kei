import { describe, expect, test } from "bun:test";
import { checkError, checkOk } from "./helpers.ts";

describe("Checker: Generics (comprehensive)", () => {
  // ─── Generic struct with double fields ──────────────────────────────

  describe("generic struct with double fields", () => {
    test("Pair<double, double> explicit type args", () => {
      checkOk(`
        struct Pair<A, B> {
          first: A;
          second: B;
        }
        fn main() -> int {
          let p = Pair<double, double>{ first: 1.0, second: 2.0 };
          return 0;
        }
      `);
    });

    test("Pair<double, double> with int literals (implicit conversion)", () => {
      checkOk(`
        struct Pair<A, B> {
          first: A;
          second: B;
        }
        fn main() -> int {
          let p = Pair<double, double>{ first: 1, second: 2 };
          return 0;
        }
      `);
    });

    test("Box<double> with int literal field", () => {
      checkOk(`
        struct Box<T> {
          value: T;
        }
        fn main() -> int {
          let b = Box<double>{ value: 42 };
          return 0;
        }
      `);
    });

    test("Box<f32> with int literal field", () => {
      checkOk(`
        struct Box<T> {
          value: T;
        }
        fn main() -> int {
          let b = Box<f32>{ value: 10 };
          return 0;
        }
      `);
    });

    test("Box<f32> with float literal field", () => {
      checkOk(`
        struct Box<T> {
          value: T;
        }
        fn main() -> int {
          let b = Box<f32>{ value: 3.14 };
          return 0;
        }
      `);
    });

    test("generic struct field access on double instantiation", () => {
      checkOk(`
        struct Box<T> {
          value: T;
        }
        fn main() -> int {
          let b = Box<double>{ value: 42 };
          let v: double = b.value;
          return 0;
        }
      `);
    });
  });

  // ─── Generic function with implicit literal conversion ──────────────

  describe("generic function with implicit literal conversion", () => {
    test("generic identity with i32", () => {
      checkOk(`
        fn identity<T>(x: T) -> T {
          return x;
        }
        fn main() -> int {
          let val: i32 = identity<i32>(42);
          return 0;
        }
      `);
    });

    test("generic identity with double", () => {
      checkOk(`
        fn identity<T>(x: T) -> T {
          return x;
        }
        fn main() -> int {
          let val: double = identity<double>(1.0);
          return 0;
        }
      `);
    });

    test("generic identity with f32", () => {
      checkOk(`
        fn identity<T>(x: T) -> T {
          return x;
        }
        fn main() -> int {
          let val: f32 = identity<f32>(3.14);
          return 0;
        }
      `);
    });

    test("generic function inferred from bool argument", () => {
      checkOk(`
        fn identity<T>(x: T) -> T {
          return x;
        }
        fn main() -> int {
          let val = identity(true);
          return 0;
        }
      `);
    });

    test("generic function with two params, different types", () => {
      checkOk(`
        fn first<A, B>(a: A, b: B) -> A {
          return a;
        }
        fn main() -> int {
          let val = first<i32, bool>(42, true);
          return val;
        }
      `);
    });

    test("generic function inferred from two different types", () => {
      checkOk(`
        fn first<A, B>(a: A, b: B) -> A {
          return a;
        }
        fn main() -> int {
          let val: i32 = first(42, true);
          return val;
        }
      `);
    });
  });

  // ─── Generic struct used as field type ────────────────────────────────

  describe("generic struct as field type", () => {
    test("non-generic struct with concrete generic field", () => {
      checkOk(`
        struct Box<T> {
          value: T;
        }
        fn main() -> int {
          let b = Box<i32>{ value: 42 };
          let v: i32 = b.value;
          return v;
        }
      `);
    });

    test("two different generic instantiations used together", () => {
      checkOk(`
        struct Box<T> {
          value: T;
        }
        fn main() -> int {
          let a = Box<i32>{ value: 42 };
          let b = Box<bool>{ value: true };
          let va: i32 = a.value;
          let vb: bool = b.value;
          return va;
        }
      `);
    });
  });

  // ─── Same generic instantiated multiple times ───────────────────────

  describe("same generic instantiated multiple times", () => {
    test("Box<i32>, Box<bool>, Box<string> in same function", () => {
      checkOk(`
        struct Box<T> {
          value: T;
        }
        fn main() -> int {
          let a = Box<i32>{ value: 42 };
          let b = Box<bool>{ value: true };
          let c = Box<string>{ value: "hi" };
          return 0;
        }
      `);
    });

    test("Pair with different type arg combos", () => {
      checkOk(`
        struct Pair<A, B> {
          first: A;
          second: B;
        }
        fn main() -> int {
          let p1 = Pair<i32, bool>{ first: 1, second: true };
          let p2 = Pair<bool, i32>{ first: false, second: 99 };
          let p3 = Pair<string, string>{ first: "a", second: "b" };
          return 0;
        }
      `);
    });

    test("same Box<i32> used twice gives compatible types", () => {
      checkOk(`
        struct Box<T> {
          value: T;
        }
        fn takeBox(b: Box<i32>) -> i32 { return b.value; }
        fn main() -> int {
          let a = Box<i32>{ value: 1 };
          let b = Box<i32>{ value: 2 };
          let va = takeBox(a);
          let vb = takeBox(b);
          return 0;
        }
      `);
    });

    test("generic function instantiated multiple times", () => {
      checkOk(`
        fn identity<T>(x: T) -> T {
          return x;
        }
        fn main() -> int {
          let a = identity<i32>(42);
          let b = identity<bool>(true);
          let c = identity<string>("hi");
          return a;
        }
      `);
    });

    test("generic function inferred with different types", () => {
      checkOk(`
        fn identity<T>(x: T) -> T {
          return x;
        }
        fn main() -> int {
          let a = identity(42);
          let b = identity(true);
          let c = identity("hello");
          return a;
        }
      `);
    });
  });

  // ─── Generic struct with methods ────────────────────────────────────

  describe("generic struct with methods", () => {
    test("generic struct method call", () => {
      checkOk(`
        struct Container<T> {
          value: T;
          fn get(self: Container<T>) -> T {
            return self.value;
          }
        }
        fn main() -> int {
          let c = Container<i32>{ value: 99 };
          let v = c.get();
          return v;
        }
      `);
    });

    test("generic struct method with additional param", () => {
      checkOk(`
        struct Container<T> {
          value: T;
          fn set_if(self: Container<T>, new_val: T, flag: bool) -> T {
            return self.value;
          }
        }
        fn main() -> int {
          let c = Container<i32>{ value: 1 };
          let v = c.set_if(42, true);
          return v;
        }
      `);
    });
  });

  // ─── Generic struct operator overloading ────────────────────────────

  describe("generic struct with operator overloading", () => {
    test("generic Wrapper with op_add", () => {
      checkOk(`
        struct Wrapper<T> {
          value: T;
          fn op_add(self: Wrapper<T>, other: Wrapper<T>) -> Wrapper<T> {
            return other;
          }
        }
        fn main() -> int {
          let a = Wrapper<i32>{ value: 1 };
          let b = Wrapper<i32>{ value: 2 };
          let c = a + b;
          return 0;
        }
      `);
    });

    test("generic Wrapper with op_eq", () => {
      checkOk(`
        struct Wrapper<T> {
          value: T;
          fn op_eq(self: Wrapper<T>, other: Wrapper<T>) -> bool {
            return true;
          }
        }
        fn main() -> int {
          let a = Wrapper<i32>{ value: 1 };
          let b = Wrapper<i32>{ value: 1 };
          let same = a == b;
          return 0;
        }
      `);
    });

    test("generic Wrapper with op_neg", () => {
      checkOk(`
        struct Wrapper<T> {
          value: T;
          fn op_neg(self: Wrapper<T>) -> Wrapper<T> {
            return self;
          }
        }
        fn main() -> int {
          let a = Wrapper<i32>{ value: 5 };
          let b = -a;
          return 0;
        }
      `);
    });

    test("generic struct with op_index", () => {
      checkOk(`
        struct Container<T> {
          value: T;
          fn op_index(self: Container<T>, idx: i32) -> T {
            return self.value;
          }
        }
        fn main() -> int {
          let c = Container<i32>{ value: 42 };
          let v = c[0];
          return 0;
        }
      `);
    });

    test("chained op_add on generic struct", () => {
      checkOk(`
        struct Wrapper<T> {
          value: T;
          fn op_add(self: Wrapper<T>, other: Wrapper<T>) -> Wrapper<T> {
            return other;
          }
        }
        fn main() -> int {
          let a = Wrapper<i32>{ value: 1 };
          let b = Wrapper<i32>{ value: 2 };
          let c = Wrapper<i32>{ value: 3 };
          let d = a + b + c;
          return 0;
        }
      `);
    });
  });

  // ─── Monomorphization cache validation ──────────────────────────────

  describe("monomorphization cache", () => {
    test("monomorphizedStructs populated for generic struct", () => {
      const source = `
        struct Box<T> {
          value: T;
        }
        fn main() {
          let a = Box<i32>{ value: 42 };
          let b = Box<bool>{ value: true };
        }
      `;
      const { Checker } = require("../../src/checker/checker.ts");
      const { Lexer } = require("../../src/lexer/index.ts");
      const { Parser } = require("../../src/parser/index.ts");
      const { SourceFile } = require("../../src/utils/source.ts");

      const file = new SourceFile("test.kei", source);
      const lexer = new Lexer(file);
      const tokens = lexer.tokenize();
      const parser = new Parser(tokens);
      const program = parser.parse();
      const checker = new Checker(program, file);
      const result = checker.check();

      const errors = result.diagnostics.filter((d: any) => d.severity === "error");
      expect(errors.length).toBe(0);
      expect(result.monomorphizedStructs.has("Box_i32")).toBe(true);
      expect(result.monomorphizedStructs.has("Box_bool")).toBe(true);
    });

    test("monomorphizedFunctions populated for generic function", () => {
      const source = `
        fn identity<T>(x: T) -> T {
          return x;
        }
        fn main() -> i32 {
          let a = identity<i32>(42);
          let b = identity<bool>(true);
          return a;
        }
      `;
      const { Checker } = require("../../src/checker/checker.ts");
      const { Lexer } = require("../../src/lexer/index.ts");
      const { Parser } = require("../../src/parser/index.ts");
      const { SourceFile } = require("../../src/utils/source.ts");

      const file = new SourceFile("test.kei", source);
      const lexer = new Lexer(file);
      const tokens = lexer.tokenize();
      const parser = new Parser(tokens);
      const program = parser.parse();
      const checker = new Checker(program, file);
      const result = checker.check();

      const errors = result.diagnostics.filter((d: any) => d.severity === "error");
      expect(errors.length).toBe(0);
      expect(result.monomorphizedFunctions.has("identity_i32")).toBe(true);
      expect(result.monomorphizedFunctions.has("identity_bool")).toBe(true);
    });

    test("genericResolutions populated for generic calls", () => {
      const source = `
        fn identity<T>(x: T) -> T {
          return x;
        }
        fn main() -> i32 {
          return identity<i32>(42);
        }
      `;
      const { Checker } = require("../../src/checker/checker.ts");
      const { Lexer } = require("../../src/lexer/index.ts");
      const { Parser } = require("../../src/parser/index.ts");
      const { SourceFile } = require("../../src/utils/source.ts");

      const file = new SourceFile("test.kei", source);
      const lexer = new Lexer(file);
      const tokens = lexer.tokenize();
      const parser = new Parser(tokens);
      const program = parser.parse();
      const checker = new Checker(program, file);
      const result = checker.check();

      const errors = result.diagnostics.filter((d: any) => d.severity === "error");
      expect(errors.length).toBe(0);
      expect(result.genericResolutions.size).toBeGreaterThan(0);

      let foundIdentity = false;
      for (const [, mangledName] of result.genericResolutions) {
        if (mangledName === "identity_i32") foundIdentity = true;
      }
      expect(foundIdentity).toBe(true);
    });
  });

  // ─── Error cases ────────────────────────────────────────────────────

  describe("generic error cases", () => {
    test("type mismatch: Box<i32> field gets string", () => {
      checkError(
        `
        struct Box<T> {
          value: T;
        }
        fn main() {
          let b = Box<i32>{ value: "wrong" };
        }
        `,
        "expected 'i32', got 'string'"
      );
    });

    test("type mismatch: Box<bool> field gets int", () => {
      checkError(
        `
        struct Box<T> {
          value: T;
        }
        fn main() {
          let b = Box<bool>{ value: 42 };
        }
        `,
        "expected 'bool'"
      );
    });

    test("wrong arg count on generic function", () => {
      checkError(
        `
        fn identity<T>(x: T) -> T {
          return x;
        }
        fn main() {
          identity<i32, bool>(42);
        }
        `,
        "expects 1 type argument(s) <T>, got 2"
      );
    });

    test("non-generic struct with type args", () => {
      checkError(
        `
        struct Point {
          x: i32;
          y: i32;
        }
        fn main() {
          let p = Point<i32>{ x: 1, y: 2 };
        }
        `,
        "expects 0 type argument(s), got 1"
      );
    });

    test("undeclared type in type arg", () => {
      checkError(
        `
        struct Box<T> {
          value: T;
        }
        fn main() {
          let b = Box<Unknown>{ value: 42 };
        }
        `,
        "undeclared type 'Unknown'"
      );
    });

    test("generic function return type mismatch", () => {
      checkError(
        `
        fn identity<T>(x: T) -> T {
          return x;
        }
        fn main() {
          let x: i32 = identity<string>("hello");
        }
        `,
        "expected 'i32', got 'string'"
      );
    });
  });

  // ─── Generic body deferral ──────────────────────────────────────────

  describe("generic body deferral", () => {
    test("generic function body not checked at definition time", () => {
      checkOk(`
        fn max<T>(a: T, b: T) -> T {
          return a;
        }
        fn main() -> i32 {
          return max<i32>(10, 20);
        }
      `);
    });

    test("generic struct method body not checked until instantiation", () => {
      checkOk(`
        struct Container<T> {
          value: T;
          fn get(self: Container<T>) -> T {
            return self.value;
          }
        }
        fn main() -> i32 {
          let c = Container<i32>{ value: 99 };
          return c.get();
        }
      `);
    });
  });
});
