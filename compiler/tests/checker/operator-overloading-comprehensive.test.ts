import { describe, expect, test } from "bun:test";
import { Severity } from "../../src/errors/diagnostic.ts";
import { check, checkError, checkOk } from "./helpers.ts";

describe("Checker: Operator Overloading (comprehensive)", () => {
  // ─── op_add returning same struct type ──────────────────────────────

  describe("op_add returning same struct type", () => {
    test("op_add returns Vec2 and result is usable as Vec2", () => {
      checkOk(`
        struct Vec2 {
          x: f64;
          y: f64;
          fn op_add(self: Vec2, other: Vec2) -> Vec2 {
            return Vec2{ x: self.x + other.x, y: self.y + other.y };
          }
        }
        fn consume(v: Vec2) -> f64 { return v.x; }
        fn main() -> int {
          let a = Vec2{ x: 1.0, y: 2.0 };
          let b = Vec2{ x: 3.0, y: 4.0 };
          let result = consume(a + b);
          return 0;
        }
      `);
    });

    test("op_add result field access", () => {
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
          let val: f64 = c.x;
          return 0;
        }
      `);
    });

    test("op_sub returning same struct type", () => {
      checkOk(`
        struct Point {
          x: i32;
          y: i32;
          fn op_sub(self: Point, other: Point) -> Point {
            return Point{ x: self.x - other.x, y: self.y - other.y };
          }
        }
        fn main() -> int {
          let a = Point{ x: 10, y: 20 };
          let b = Point{ x: 3, y: 5 };
          let c = a - b;
          let xval: i32 = c.x;
          return 0;
        }
      `);
    });
  });

  // ─── Chained operators: a + b + c ───────────────────────────────────

  describe("chained operators", () => {
    test("a + b + c chains correctly (three operands)", () => {
      checkOk(`
        struct Vec2 {
          x: f64;
          y: f64;
          fn op_add(self: Vec2, other: Vec2) -> Vec2 {
            return Vec2{ x: self.x + other.x, y: self.y + other.y };
          }
        }
        fn main() -> int {
          let a = Vec2{ x: 1.0, y: 0.0 };
          let b = Vec2{ x: 2.0, y: 0.0 };
          let c = Vec2{ x: 3.0, y: 0.0 };
          let d = a + b + c;
          return 0;
        }
      `);
    });

    test("a + b + c + d chains four operands", () => {
      checkOk(`
        struct Num {
          val: i32;
          fn op_add(self: Num, other: Num) -> Num {
            return Num{ val: self.val + other.val };
          }
        }
        fn main() -> int {
          let a = Num{ val: 1 };
          let b = Num{ val: 2 };
          let c = Num{ val: 3 };
          let d = Num{ val: 4 };
          let e = a + b + c + d;
          return 0;
        }
      `);
    });

    test("a * b + c mixed operators chain", () => {
      checkOk(`
        struct Num {
          val: i32;
          fn op_mul(self: Num, other: Num) -> Num {
            return Num{ val: self.val * other.val };
          }
          fn op_add(self: Num, other: Num) -> Num {
            return Num{ val: self.val + other.val };
          }
        }
        fn main() -> int {
          let a = Num{ val: 2 };
          let b = Num{ val: 3 };
          let c = Num{ val: 4 };
          let d = a * b + c;
          return 0;
        }
      `);
    });

    test("chained subtraction: a - b - c", () => {
      checkOk(`
        struct Num {
          val: i32;
          fn op_sub(self: Num, other: Num) -> Num {
            return Num{ val: self.val - other.val };
          }
        }
        fn main() -> int {
          let a = Num{ val: 10 };
          let b = Num{ val: 3 };
          let c = Num{ val: 2 };
          let d = a - b - c;
          return 0;
        }
      `);
    });
  });

  // ─── Operator on struct with double fields initialized from int literals ──

  describe("operators on struct with double fields from int literals", () => {
    test("op_add on struct initialized with int literals in double fields", () => {
      checkOk(`
        struct Vec2 {
          x: double;
          y: double;
          fn op_add(self: Vec2, other: Vec2) -> Vec2 {
            return Vec2{ x: self.x + other.x, y: self.y + other.y };
          }
        }
        fn main() -> int {
          let a = Vec2{ x: 1, y: 2 };
          let b = Vec2{ x: 3, y: 4 };
          let c = a + b;
          return 0;
        }
      `);
    });

    test("op_sub on struct initialized with int literals in double fields", () => {
      checkOk(`
        struct Vec2 {
          x: double;
          y: double;
          fn op_sub(self: Vec2, other: Vec2) -> Vec2 {
            return Vec2{ x: self.x - other.x, y: self.y - other.y };
          }
        }
        fn main() -> int {
          let a = Vec2{ x: 10, y: 20 };
          let b = Vec2{ x: 3, y: 5 };
          let c = a - b;
          return 0;
        }
      `);
    });

    test("op_neg on struct initialized with int literals in double fields", () => {
      checkOk(`
        struct Vec2 {
          x: double;
          y: double;
          fn op_neg(self: Vec2) -> Vec2 {
            return Vec2{ x: 0.0 - self.x, y: 0.0 - self.y };
          }
        }
        fn main() -> int {
          let a = Vec2{ x: 5, y: 10 };
          let b = -a;
          return 0;
        }
      `);
    });

    test("chained op_add with int-literal-initialized double fields", () => {
      checkOk(`
        struct Vec2 {
          x: double;
          y: double;
          fn op_add(self: Vec2, other: Vec2) -> Vec2 {
            return Vec2{ x: self.x + other.x, y: self.y + other.y };
          }
        }
        fn main() -> int {
          let a = Vec2{ x: 1, y: 2 };
          let b = Vec2{ x: 3, y: 4 };
          let c = Vec2{ x: 5, y: 6 };
          let d = a + b + c;
          return 0;
        }
      `);
    });
  });

  // ─── op_index with i32 index vs i64 index ───────────────────────────

  describe("op_index index type variations", () => {
    test("op_index with i32 index", () => {
      checkOk(`
        struct List {
          len: i32;
          fn op_index(self: List, idx: i32) -> i32 {
            return self.len;
          }
        }
        fn main() -> int {
          let l = List{ len: 5 };
          let v = l[0];
          return 0;
        }
      `);
    });

    test("op_index with i64 index", () => {
      checkOk(`
        struct BigList {
          len: i64;
          fn op_index(self: BigList, idx: i64) -> i32 {
            return 0;
          }
        }
        fn main() -> int {
          let l = BigList{ len: 100 };
          let idx: i64 = 5;
          let v = l[idx];
          return 0;
        }
      `);
    });

    test("op_index with u8 index", () => {
      checkOk(`
        struct TinyList {
          size: u8;
          fn op_index(self: TinyList, idx: u8) -> i32 {
            return 0;
          }
        }
        fn main() -> int {
          let l = TinyList{ size: 10 };
          let idx: u8 = 3;
          let v = l[idx];
          return 0;
        }
      `);
    });

    test("op_index returning double", () => {
      checkOk(`
        struct FloatArray {
          len: i32;
          fn op_index(self: FloatArray, idx: i32) -> double {
            return 0.0;
          }
        }
        fn takeDouble(d: double) -> double { return d; }
        fn main() -> int {
          let a = FloatArray{ len: 5 };
          let v = takeDouble(a[0]);
          return 0;
        }
      `);
    });

    test("op_index_set with different value type", () => {
      checkOk(`
        struct FloatArray {
          len: i32;
          fn op_index(self: FloatArray, idx: i32) -> double {
            return 0.0;
          }
          fn op_index_set(self: FloatArray, idx: i32, val: double) {
            return;
          }
        }
        fn main() -> int {
          let a = FloatArray{ len: 5 };
          a[0] = 3.14;
          return 0;
        }
      `);
    });

    test("op_index_set wrong value type → error", () => {
      checkError(
        `
        struct IntArray {
          len: i32;
          fn op_index(self: IntArray, idx: i32) -> i32 {
            return 0;
          }
          fn op_index_set(self: IntArray, idx: i32, val: i32) {
            return;
          }
        }
        fn main() -> int {
          let a = IntArray{ len: 5 };
          a[0] = "hello";
          return 0;
        }
        `,
        "type mismatch"
      );
    });
  });

  // ─── op_eq returning bool ───────────────────────────────────────────

  describe("op_eq returning bool", () => {
    test("op_eq returns bool and can be used in if", () => {
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
          if a == b {
            return 1;
          }
          return 0;
        }
      `);
    });

    test("op_neq returns bool and can be used in if", () => {
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
          if a != b {
            return 1;
          }
          return 0;
        }
      `);
    });

    test("op_eq result stored in bool variable", () => {
      checkOk(`
        struct Val {
          n: i32;
          fn op_eq(self: Val, other: Val) -> bool {
            return self.n == other.n;
          }
        }
        fn main() -> int {
          let a = Val{ n: 42 };
          let b = Val{ n: 42 };
          let same: bool = a == b;
          return 0;
        }
      `);
    });

    test("op_lt result used in conditional", () => {
      checkOk(`
        struct Score {
          val: i32;
          fn op_lt(self: Score, other: Score) -> bool {
            return self.val < other.val;
          }
        }
        fn main() -> int {
          let low = Score{ val: 10 };
          let high = Score{ val: 90 };
          if low < high {
            return 1;
          }
          return 0;
        }
      `);
    });
  });

  // ─── Multiple operators on same struct ──────────────────────────────

  describe("multiple operators on same struct", () => {
    test("struct with all arithmetic ops", () => {
      checkOk(`
        struct Num {
          val: i32;
          fn op_add(self: Num, other: Num) -> Num {
            return Num{ val: self.val + other.val };
          }
          fn op_sub(self: Num, other: Num) -> Num {
            return Num{ val: self.val - other.val };
          }
          fn op_mul(self: Num, other: Num) -> Num {
            return Num{ val: self.val * other.val };
          }
          fn op_div(self: Num, other: Num) -> Num {
            return Num{ val: self.val / other.val };
          }
          fn op_mod(self: Num, other: Num) -> Num {
            return Num{ val: self.val % other.val };
          }
        }
        fn main() -> int {
          let a = Num{ val: 10 };
          let b = Num{ val: 3 };
          let sum = a + b;
          let diff = a - b;
          let prod = a * b;
          let quot = a / b;
          let rem = a % b;
          return 0;
        }
      `);
    });

    test("struct with all comparison ops", () => {
      checkOk(`
        struct Num {
          val: i32;
          fn op_eq(self: Num, other: Num) -> bool {
            return self.val == other.val;
          }
          fn op_neq(self: Num, other: Num) -> bool {
            return self.val != other.val;
          }
          fn op_lt(self: Num, other: Num) -> bool {
            return self.val < other.val;
          }
          fn op_gt(self: Num, other: Num) -> bool {
            return self.val > other.val;
          }
          fn op_le(self: Num, other: Num) -> bool {
            return self.val <= other.val;
          }
          fn op_ge(self: Num, other: Num) -> bool {
            return self.val >= other.val;
          }
        }
        fn main() -> int {
          let a = Num{ val: 5 };
          let b = Num{ val: 10 };
          let eq = a == b;
          let neq = a != b;
          let lt = a < b;
          let gt = a > b;
          let le = a <= b;
          let ge = a >= b;
          return 0;
        }
      `);
    });

    test("struct with arithmetic + comparison + unary ops", () => {
      checkOk(`
        struct Num {
          val: i32;
          fn op_add(self: Num, other: Num) -> Num {
            return Num{ val: self.val + other.val };
          }
          fn op_neg(self: Num) -> Num {
            return Num{ val: 0 - self.val };
          }
          fn op_eq(self: Num, other: Num) -> bool {
            return self.val == other.val;
          }
          fn op_lt(self: Num, other: Num) -> bool {
            return self.val < other.val;
          }
        }
        fn main() -> int {
          let a = Num{ val: 5 };
          let b = Num{ val: 3 };
          let c = a + b;
          let d = -a;
          let eq = c == a;
          let lt = b < a;
          return 0;
        }
      `);
    });

    test("struct with index + arithmetic ops", () => {
      checkOk(`
        struct Collection {
          size: i32;
          fn op_index(self: Collection, idx: i32) -> i32 {
            return idx;
          }
          fn op_add(self: Collection, other: Collection) -> Collection {
            return Collection{ size: self.size + other.size };
          }
        }
        fn main() -> int {
          let a = Collection{ size: 5 };
          let b = Collection{ size: 3 };
          let elem = a[0];
          let merged = a + b;
          return 0;
        }
      `);
    });
  });

  // ─── Operator overloading: error cases ──────────────────────────────

  describe("operator error cases", () => {
    test("wrong rhs type for op_add", () => {
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

    test("wrong rhs type for op_eq", () => {
      checkError(
        `
        struct Val {
          n: i32;
          fn op_eq(self: Val, other: Val) -> bool {
            return self.n == other.n;
          }
        }
        fn main() -> int {
          let a = Val{ n: 1 };
          let eq = a == 42;
          return 0;
        }
        `,
        "operator method 'op_eq'"
      );
    });

    test("using * on struct without op_mul", () => {
      checkError(
        `
        struct Foo { x: i32; }
        fn main() -> int {
          let a = Foo{ x: 1 };
          let b = Foo{ x: 2 };
          let c = a * b;
          return 0;
        }
        `,
        "requires numeric operands"
      );
    });

    test("using / on struct without op_div", () => {
      checkError(
        `
        struct Foo { x: i32; }
        fn main() -> int {
          let a = Foo{ x: 10 };
          let b = Foo{ x: 2 };
          let c = a / b;
          return 0;
        }
        `,
        "requires numeric operands"
      );
    });

    test("using % on struct without op_mod", () => {
      checkError(
        `
        struct Foo { x: i32; }
        fn main() -> int {
          let a = Foo{ x: 10 };
          let b = Foo{ x: 3 };
          let c = a % b;
          return 0;
        }
        `,
        "requires numeric operands"
      );
    });

    test("== on struct without op_eq is allowed (structural equality)", () => {
      checkOk(`
        struct Foo { x: i32; }
        fn main() -> int {
          let a = Foo{ x: 1 };
          let b = Foo{ x: 1 };
          let eq = a == b;
          return 0;
        }
      `);
    });

    test("using unary - on struct without op_neg", () => {
      checkError(
        `
        struct Foo { x: i32; }
        fn main() -> int {
          let a = Foo{ x: 1 };
          let b = -a;
          return 0;
        }
        `,
        "unary '-' requires numeric operand"
      );
    });
  });

  // ─── Operator method resolution map ─────────────────────────────────

  describe("operatorMethods map population", () => {
    test("multiple operator usages all tracked", () => {
      const source = `
        struct Num {
          val: i32;
          fn op_add(self: Num, other: Num) -> Num {
            return Num{ val: self.val + other.val };
          }
          fn op_eq(self: Num, other: Num) -> bool {
            return self.val == other.val;
          }
          fn op_neg(self: Num) -> Num {
            return Num{ val: 0 - self.val };
          }
        }
        fn main() -> int {
          let a = Num{ val: 1 };
          let b = Num{ val: 2 };
          let c = a + b;
          let eq = a == b;
          let d = -a;
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

      const methods = new Set<string>();
      for (const [, info] of result.operatorMethods) {
        methods.add(info.methodName);
      }
      expect(methods.has("op_add")).toBe(true);
      expect(methods.has("op_eq")).toBe(true);
      expect(methods.has("op_neg")).toBe(true);
    });

    test("op_index tracked in operatorMethods", () => {
      const source = `
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

      let foundIndex = false;
      for (const [, info] of result.operatorMethods) {
        if (info.methodName === "op_index") {
          foundIndex = true;
        }
      }
      expect(foundIndex).toBe(true);
    });
  });
});
