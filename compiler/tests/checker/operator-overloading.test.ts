import { describe, expect, test } from "bun:test";
import { Severity } from "../../src/errors/diagnostic.ts";
import { check, checkError, checkOk } from "./helpers.ts";

describe("Checker: Operator Overloading", () => {
  // ─── Binary Arithmetic Operators ────────────────────────────────────

  describe("binary arithmetic operators", () => {
    test("struct with op_add using + operator", () => {
      checkOk(`
        struct Vec2 {
          x: f64;
          y: f64;
          fn op_add(self: Vec2, other: Vec2) -> Vec2 {
            return Vec2{ x: self.x + other.x, y: self.y + other.y };
          }
        }
        fn main() -> int {
          let a = Vec2{ x: 1.0, y: 2.0 };
          let b = Vec2{ x: 3.0, y: 4.0 };
          let c = a + b;
          return 0;
        }
      `);
    });

    test("struct with op_sub using - operator", () => {
      checkOk(`
        struct Vec2 {
          x: f64;
          y: f64;
          fn op_sub(self: Vec2, other: Vec2) -> Vec2 {
            return Vec2{ x: self.x - other.x, y: self.y - other.y };
          }
        }
        fn main() -> int {
          let a = Vec2{ x: 5.0, y: 6.0 };
          let b = Vec2{ x: 1.0, y: 2.0 };
          let c = a - b;
          return 0;
        }
      `);
    });

    test("struct with op_mul using * operator", () => {
      checkOk(`
        struct Vec2 {
          x: f64;
          y: f64;
          fn op_mul(self: Vec2, other: Vec2) -> Vec2 {
            return Vec2{ x: self.x * other.x, y: self.y * other.y };
          }
        }
        fn main() -> int {
          let a = Vec2{ x: 2.0, y: 3.0 };
          let b = Vec2{ x: 4.0, y: 5.0 };
          let c = a * b;
          return 0;
        }
      `);
    });

    test("struct with op_div using / operator", () => {
      checkOk(`
        struct Vec2 {
          x: f64;
          y: f64;
          fn op_div(self: Vec2, other: Vec2) -> Vec2 {
            return Vec2{ x: self.x / other.x, y: self.y / other.y };
          }
        }
        fn main() -> int {
          let a = Vec2{ x: 10.0, y: 20.0 };
          let b = Vec2{ x: 2.0, y: 4.0 };
          let c = a / b;
          return 0;
        }
      `);
    });

    test("struct with op_mod using % operator", () => {
      checkOk(`
        struct MyInt {
          value: i32;
          fn op_mod(self: MyInt, other: MyInt) -> MyInt {
            return MyInt{ value: self.value % other.value };
          }
        }
        fn main() -> int {
          let a = MyInt{ value: 10 };
          let b = MyInt{ value: 3 };
          let c = a % b;
          return 0;
        }
      `);
    });
  });

  // ─── Error: Using operator on struct without method ──────────────────

  describe("error on missing operator method", () => {
    test("+ on struct without op_add → error", () => {
      checkError(
        `
        struct Vec2 {
          x: f64;
          y: f64;
        }
        fn main() -> int {
          let a = Vec2{ x: 1.0, y: 2.0 };
          let b = Vec2{ x: 3.0, y: 4.0 };
          let c = a + b;
          return 0;
        }
        `,
        "requires numeric operands"
      );
    });

    test("- (binary) on struct without op_sub → error", () => {
      checkError(
        `
        struct Vec2 {
          x: f64;
          y: f64;
        }
        fn main() -> int {
          let a = Vec2{ x: 1.0, y: 2.0 };
          let b = Vec2{ x: 3.0, y: 4.0 };
          let c = a - b;
          return 0;
        }
        `,
        "requires numeric operands"
      );
    });

    test("< on struct without op_lt → error", () => {
      checkError(
        `
        struct Point {
          x: i32;
          y: i32;
        }
        fn main() -> int {
          let a = Point{ x: 1, y: 2 };
          let b = Point{ x: 1, y: 2 };
          let lt = a < b;
          return 0;
        }
        `,
        "requires numeric operands"
      );
    });
  });

  // ─── Comparison Operators ───────────────────────────────────────────

  describe("comparison operators", () => {
    test("struct with op_eq using == operator → returns bool", () => {
      checkOk(`
        struct Point {
          x: i32;
          y: i32;
          fn op_eq(self: Point, other: Point) -> bool {
            return self.x == other.x;
          }
        }
        fn main() -> int {
          let a = Point{ x: 1, y: 2 };
          let b = Point{ x: 1, y: 3 };
          let eq = a == b;
          return 0;
        }
      `);
    });

    test("struct with op_neq using != operator → returns bool", () => {
      checkOk(`
        struct Point {
          x: i32;
          y: i32;
          fn op_neq(self: Point, other: Point) -> bool {
            return self.x != other.x;
          }
        }
        fn main() -> int {
          let a = Point{ x: 1, y: 2 };
          let b = Point{ x: 3, y: 4 };
          let neq = a != b;
          return 0;
        }
      `);
    });

    test("struct with op_lt using < operator", () => {
      checkOk(`
        struct MyInt {
          value: i32;
          fn op_lt(self: MyInt, other: MyInt) -> bool {
            return self.value < other.value;
          }
        }
        fn main() -> int {
          let a = MyInt{ value: 1 };
          let b = MyInt{ value: 2 };
          let lt = a < b;
          return 0;
        }
      `);
    });

    test("struct with op_gt using > operator", () => {
      checkOk(`
        struct MyInt {
          value: i32;
          fn op_gt(self: MyInt, other: MyInt) -> bool {
            return self.value > other.value;
          }
        }
        fn main() -> int {
          let a = MyInt{ value: 5 };
          let b = MyInt{ value: 2 };
          let gt = a > b;
          return 0;
        }
      `);
    });

    test("struct with op_le using <= operator", () => {
      checkOk(`
        struct MyInt {
          value: i32;
          fn op_le(self: MyInt, other: MyInt) -> bool {
            return self.value <= other.value;
          }
        }
        fn main() -> int {
          let a = MyInt{ value: 2 };
          let b = MyInt{ value: 2 };
          let le = a <= b;
          return 0;
        }
      `);
    });

    test("struct with op_ge using >= operator", () => {
      checkOk(`
        struct MyInt {
          value: i32;
          fn op_ge(self: MyInt, other: MyInt) -> bool {
            return self.value >= other.value;
          }
        }
        fn main() -> int {
          let a = MyInt{ value: 3 };
          let b = MyInt{ value: 2 };
          let ge = a >= b;
          return 0;
        }
      `);
    });
  });

  // ─── Return Type Inference ──────────────────────────────────────────

  describe("return type inference", () => {
    test("op_add return type correctly inferred", () => {
      checkOk(`
        struct Vec2 {
          x: f64;
          y: f64;
          fn op_add(self: Vec2, other: Vec2) -> Vec2 {
            return Vec2{ x: self.x + other.x, y: self.y + other.y };
          }
        }
        fn takeVec(v: Vec2) -> f64 { return v.x; }
        fn main() -> int {
          let a = Vec2{ x: 1.0, y: 2.0 };
          let b = Vec2{ x: 3.0, y: 4.0 };
          let c = takeVec(a + b);
          return 0;
        }
      `);
    });

    test("op_lt returns bool — can use in if condition", () => {
      checkOk(`
        struct MyInt {
          value: i32;
          fn op_lt(self: MyInt, other: MyInt) -> bool {
            return self.value < other.value;
          }
        }
        fn main() -> int {
          let a = MyInt{ value: 1 };
          let b = MyInt{ value: 2 };
          if a < b {
            return 1;
          }
          return 0;
        }
      `);
    });

    test("wrong rhs type for operator method → error", () => {
      checkError(
        `
        struct Vec2 {
          x: f64;
          y: f64;
          fn op_add(self: Vec2, other: Vec2) -> Vec2 {
            return Vec2{ x: self.x + other.x, y: self.y + other.y };
          }
        }
        fn main() -> int {
          let a = Vec2{ x: 1.0, y: 2.0 };
          let c = a + 42;
          return 0;
        }
        `,
        "operator method 'op_add'"
      );
    });
  });

  // ─── Unary Operators ────────────────────────────────────────────────

  describe("unary operators", () => {
    test("struct with op_neg using unary - operator", () => {
      checkOk(`
        struct Vec2 {
          x: f64;
          y: f64;
          fn op_neg(self: Vec2) -> Vec2 {
            return Vec2{ x: 0.0 - self.x, y: 0.0 - self.y };
          }
        }
        fn main() -> int {
          let a = Vec2{ x: 1.0, y: 2.0 };
          let b = -a;
          return 0;
        }
      `);
    });

    test("unary - on struct without op_neg → error", () => {
      checkError(
        `
        struct Vec2 {
          x: f64;
          y: f64;
        }
        fn main() -> int {
          let a = Vec2{ x: 1.0, y: 2.0 };
          let b = -a;
          return 0;
        }
        `,
        "unary '-' requires numeric operand"
      );
    });
  });

  // ─── Index Operators ────────────────────────────────────────────────

  describe("index operators", () => {
    test("struct with op_index using [] read", () => {
      checkOk(`
        struct MyList {
          len: i32;
          fn op_index(self: MyList, idx: i32) -> i32 {
            return self.len;
          }
        }
        fn main() -> int {
          let list = MyList{ len: 10 };
          let val = list[0];
          return 0;
        }
      `);
    });

    test("struct with op_index_set using [] write", () => {
      checkOk(`
        struct MyList {
          len: i32;
          fn op_index(self: MyList, idx: i32) -> i32 {
            return self.len;
          }
          fn op_index_set(self: MyList, idx: i32, val: i32) {
            return;
          }
        }
        fn main() -> int {
          let list = MyList{ len: 10 };
          list[0] = 42;
          return 0;
        }
      `);
    });

    test("op_index with wrong index type → error", () => {
      checkError(
        `
        struct MyList {
          len: i32;
          fn op_index(self: MyList, idx: i32) -> i32 {
            return self.len;
          }
        }
        fn main() -> int {
          let list = MyList{ len: 10 };
          let val = list[true];
          return 0;
        }
        `,
        "index type mismatch"
      );
    });

    test("[] on struct without op_index → error", () => {
      checkError(
        `
        struct MyList {
          len: i32;
        }
        fn main() -> int {
          let list = MyList{ len: 10 };
          let val = list[0];
          return 0;
        }
        `,
        "cannot index type"
      );
    });

    test("op_index return type correctly inferred", () => {
      checkOk(`
        struct Lookup {
          x: i32;
          fn op_index(self: Lookup, idx: i32) -> f64 {
            return 1.0;
          }
        }
        fn takeFloat(f: f64) -> f64 { return f; }
        fn main() -> int {
          let lk = Lookup{ x: 0 };
          let val = takeFloat(lk[0]);
          return 0;
        }
      `);
    });
  });

  // ─── Generic Struct Operator Overloading ────────────────────────────

  describe("generics with operator overloading", () => {
    test("generic struct with op_add — monomorphized", () => {
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

    test("generic struct with op_eq — monomorphized", () => {
      checkOk(`
        struct Box<T> {
          value: T;
          fn op_eq(self: Box<T>, other: Box<T>) -> bool {
            return true;
          }
        }
        fn main() -> int {
          let a = Box<i32>{ value: 42 };
          let b = Box<i32>{ value: 42 };
          let eq = a == b;
          return 0;
        }
      `);
    });
  });

  // ─── Operator method resolution info stored ─────────────────────────

  describe("operator method resolution info", () => {
    test("operatorMethods map populated for binary op", () => {
      const source = `
        struct Vec2 {
          x: f64;
          y: f64;
          fn op_add(self: Vec2, other: Vec2) -> Vec2 {
            return Vec2{ x: self.x + other.x, y: self.y + other.y };
          }
        }
        fn main() -> int {
          let a = Vec2{ x: 1.0, y: 2.0 };
          let b = Vec2{ x: 3.0, y: 4.0 };
          let c = a + b;
          return 0;
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
      expect(result.operatorMethods.size).toBeGreaterThan(0);

      // Find the entry with methodName "op_add"
      let foundOpAdd = false;
      for (const [, info] of result.operatorMethods) {
        if (info.methodName === "op_add") {
          foundOpAdd = true;
          expect(info.structType.name).toBe("Vec2");
        }
      }
      expect(foundOpAdd).toBe(true);
    });
  });

  // ─── Multiple operators on the same struct ──────────────────────────

  describe("multiple operators on same struct", () => {
    test("struct with add, sub, eq, lt all defined", () => {
      checkOk(`
        struct MyNum {
          value: i32;
          fn op_add(self: MyNum, other: MyNum) -> MyNum {
            return MyNum{ value: self.value + other.value };
          }
          fn op_sub(self: MyNum, other: MyNum) -> MyNum {
            return MyNum{ value: self.value - other.value };
          }
          fn op_eq(self: MyNum, other: MyNum) -> bool {
            return self.value == other.value;
          }
          fn op_lt(self: MyNum, other: MyNum) -> bool {
            return self.value < other.value;
          }
          fn op_neg(self: MyNum) -> MyNum {
            return MyNum{ value: 0 - self.value };
          }
        }
        fn main() -> int {
          let a = MyNum{ value: 10 };
          let b = MyNum{ value: 3 };
          let sum = a + b;
          let diff = a - b;
          let eq = a == b;
          let lt = a < b;
          let neg = -a;
          return 0;
        }
      `);
    });
  });

  // ─── Chained operator calls ─────────────────────────────────────────

  describe("chained operators", () => {
    test("a + b + c chains correctly", () => {
      checkOk(`
        struct Vec2 {
          x: f64;
          y: f64;
          fn op_add(self: Vec2, other: Vec2) -> Vec2 {
            return Vec2{ x: self.x + other.x, y: self.y + other.y };
          }
        }
        fn main() -> int {
          let a = Vec2{ x: 1.0, y: 2.0 };
          let b = Vec2{ x: 3.0, y: 4.0 };
          let c = Vec2{ x: 5.0, y: 6.0 };
          let d = a + b + c;
          return 0;
        }
      `);
    });
  });
});
