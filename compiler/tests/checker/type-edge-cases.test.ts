import { describe, test } from "bun:test";
import { checkError, checkOk } from "./helpers.ts";

describe("Checker — Type Edge Cases", () => {
  describe("const assignment errors", () => {
    test("assign to const variable → error", () => {
      checkError(
        `fn main() -> int { const x = 5; x = 10; return x; }`,
        "cannot assign to immutable"
      );
    });

    test("compound assign to const → error", () => {
      checkError(
        `fn main() -> int { const x = 5; x += 1; return x; }`,
        "cannot assign to immutable"
      );
    });

    test("increment const → error", () => {
      checkError(`fn main() -> int { const x = 5; x++; return x; }`, "cannot assign to immutable");
    });

    test("const in nested scope still immutable", () => {
      checkError(
        `fn main() -> int {
          const x = 5;
          {
            x = 10;
          }
          return x;
        }`,
        "cannot assign to immutable"
      );
    });
  });

  describe("variable use before declaration", () => {
    test("use before let → error", () => {
      checkError(
        `fn main() -> int { let y = x; let x = 10; return y; }`,
        "undeclared variable 'x'"
      );
    });

    test("use undeclared in expression → error", () => {
      checkError(`fn main() -> int { return foo + 1; }`, "undeclared variable 'foo'");
    });

    test("use undeclared in condition → error", () => {
      checkError(
        `fn main() -> int { if unknown { return 1; } return 0; }`,
        "undeclared variable 'unknown'"
      );
    });
  });

  describe("function return type errors", () => {
    test("non-void function with no return → error", () => {
      checkError(`fn getInt() -> int { let x = 42; }`, "does not return a value on all paths");
    });

    test("return wrong type → error", () => {
      checkError(`fn getInt() -> int { return "hello"; }`, "return type mismatch");
    });

    test("return value in void function → error", () => {
      checkError(`fn doStuff() { return 42; }`, "expects return type 'void', got");
    });

    test("void return in non-void function → error", () => {
      checkError(`fn getInt() -> int { return; }`, "expects return type 'i32', got void");
    });

    test("function returning struct with wrong struct type → error", () => {
      checkError(
        `
          struct A { x: int; }
          struct B { x: int; }
          fn getA() -> A { return B{ x: 1 }; }
        `,
        "return type mismatch"
      );
    });
  });

  describe("type mismatch in if-else branches", () => {
    test("if-expression with int/float branches → error", () => {
      checkError(
        `fn main() -> int { let x = if true { 1 } else { 2.0 }; return 0; }`,
        "different types"
      );
    });

    test("if-expression with int/string branches → error", () => {
      checkError(
        `fn main() -> int { let x = if true { 1 } else { "hello" }; return 0; }`,
        "different types"
      );
    });

    test("if-expression with bool/int branches → error", () => {
      checkError(
        `fn main() -> int { let x = if true { true } else { 0 }; return 0; }`,
        "different types"
      );
    });

    test("matching if-expression branches → ok", () => {
      checkOk(`
        fn main() -> int {
          let x = if true { 10 } else { 20 };
          return x;
        }
      `);
    });
  });

  describe("comparing different types", () => {
    test("int == string → error", () => {
      checkError(`fn main() -> int { let x = 1 == "hello"; return 0; }`, "requires same types");
    });

    test("bool < int → error", () => {
      checkError(`fn main() -> int { let x = true < 1; return 0; }`, "requires numeric operands");
    });

    test("int == int → ok", () => {
      checkOk(`fn main() -> int { let x = 1 == 2; return 0; }`);
    });
  });

  describe("arithmetic on invalid types", () => {
    test("bool + bool → error", () => {
      checkError(
        `fn main() -> int { let x = true + false; return 0; }`,
        "requires numeric operands"
      );
    });

    test("bool - bool → error", () => {
      checkError(
        `fn main() -> int { let x = true - false; return 0; }`,
        "requires numeric operands"
      );
    });

    test("bool * int → error", () => {
      checkError(`fn main() -> int { let x = true * 1; return 0; }`, "requires numeric operands");
    });

    test("string - string → error", () => {
      checkError(`fn main() -> int { let x = "a" - "b"; return 0; }`, "requires numeric operands");
    });

    test("string * int → error", () => {
      checkError(`fn main() -> int { let x = "a" * 2; return 0; }`, "requires numeric operands");
    });

    test("unary minus on bool → error", () => {
      checkError(`fn main() -> int { let x = -true; return 0; }`, "requires numeric operand");
    });

    test("unary minus on string → error", () => {
      checkError(`fn main() -> int { let x = -"hello"; return 0; }`, "requires numeric operand");
    });
  });

  describe("calling non-function", () => {
    test("call integer variable → error", () => {
      checkError(`fn main() -> int { let x = 42; let y = x(1); return 0; }`, "is not callable");
    });

    test("call string variable → error", () => {
      checkError(
        `fn main() -> int { let x = "hello"; let y = x(1); return 0; }`,
        "is not callable"
      );
    });

    test("call bool variable → error", () => {
      checkError(`fn main() -> int { let x = true; let y = x(); return 0; }`, "is not callable");
    });
  });

  describe("argument count errors", () => {
    test("too few arguments → error", () => {
      checkError(
        `
          fn add(a: int, b: int) -> int { return a + b; }
          fn main() -> int { return add(1); }
        `,
        "expected 2 argument(s), got 1"
      );
    });

    test("too many arguments → error", () => {
      checkError(
        `
          fn add(a: int, b: int) -> int { return a + b; }
          fn main() -> int { return add(1, 2, 3); }
        `,
        "expected 2 argument(s), got 3"
      );
    });

    test("zero arguments to function expecting one → error", () => {
      checkError(
        `
          fn negate(x: int) -> int { return -x; }
          fn main() -> int { return negate(); }
        `,
        "expected 1 argument(s), got 0"
      );
    });

    test("method call with wrong extra args → error", () => {
      checkError(
        `
          struct Point {
            x: f64;
            y: f64;
            fn length(self: Point) -> f64 { return self.x; }
          }
          fn main() -> int {
            let p = Point{ x: 1.0, y: 2.0 };
            let len = p.length(1.0);
            return 0;
          }
        `,
        "expected 0 argument(s), got 1"
      );
    });
  });

  describe("duplicate declarations", () => {
    test("duplicate function names → error", () => {
      checkError(
        `
          fn foo() -> int { return 1; }
          fn foo() -> int { return 2; }
        `,
        "duplicate declaration 'foo'"
      );
    });

    test("duplicate struct field names → error", () => {
      checkError(
        `
          struct Bad { x: int; x: int; }
          fn main() -> int { return 0; }
        `,
        "duplicate field 'x'"
      );
    });

    test("duplicate struct names → error", () => {
      checkError(
        `
          struct A { x: int; }
          struct A { y: int; }
          fn main() -> int { return 0; }
        `,
        "duplicate declaration 'A'"
      );
    });

    test("duplicate variable in same scope → error", () => {
      checkError(`fn main() -> int { let x = 1; let x = 2; return x; }`, "duplicate variable 'x'");
    });

    test("same name in different scopes → ok (shadowing)", () => {
      checkOk(`
        fn main() -> int {
          let x = 1;
          {
            let x = 2;
          }
          return x;
        }
      `);
    });
  });

  describe("struct literal edge cases", () => {
    test("empty struct literal → ok", () => {
      checkOk(`
        struct Empty {}
        fn main() -> int { let e = Empty{}; return 0; }
      `);
    });

    test("struct with field type mismatch → error", () => {
      checkError(
        `
          struct Point { x: f64; y: f64; }
          fn main() -> int {
            let p = Point{ x: "hello", y: 2.0 };
            return 0;
          }
        `,
        "expected 'f64'"
      );
    });

    test("struct literal with extra field → error", () => {
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

    test("struct literal with missing required field → error", () => {
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

    test("undeclared struct type → error", () => {
      checkError(
        `fn main() -> int { let p = Nonexistent{ x: 1 }; return 0; }`,
        "undeclared type 'Nonexistent'"
      );
    });

    test("duplicate field in struct literal → error", () => {
      checkError(
        `
          struct Point { x: f64; y: f64; }
          fn main() -> int {
            let p = Point{ x: 1.0, x: 2.0 };
            return 0;
          }
        `,
        "duplicate field 'x'"
      );
    });
  });

  describe("type widening and narrowing", () => {
    test("i32 to i64 widening → ok", () => {
      checkOk(`
        fn main() -> int {
          let x: i32 = 42;
          let y: i64 = x;
          return 0;
        }
      `);
    });

    test("i64 to i32 narrowing → error", () => {
      checkError(
        `fn main() -> int {
          let x: i64 = 42;
          let y: i32 = x;
          return 0;
        }`,
        "type mismatch"
      );
    });

    test("signed to unsigned → error", () => {
      checkError(
        `fn main() -> int { let x: i32 = 42; let y: u32 = x; return 0; }`,
        "type mismatch"
      );
    });

    test("f32 to f64 assignment → error (no implicit float widening)", () => {
      checkError(
        `fn main() -> int {
          let x: f32 = 1.0;
          let y: f64 = x;
          return 0;
        }`,
        "type mismatch"
      );
    });
  });

  describe("nested struct and method access", () => {
    test("nested struct field access → ok", () => {
      checkOk(`
        struct Inner { value: int; }
        struct Outer { inner: Inner; }
        fn main() -> int {
          let o = Outer{ inner: Inner{ value: 42 } };
          let v = o.inner.value;
          return v;
        }
      `);
    });

    test("access nonexistent nested field → error", () => {
      checkError(
        `
          struct Inner { value: int; }
          struct Outer { inner: Inner; }
          fn main() -> int {
            let o = Outer{ inner: Inner{ value: 42 } };
            let v = o.inner.missing;
            return 0;
          }
        `,
        "has no field or method 'missing'"
      );
    });

    test("access field on non-struct → error", () => {
      checkError(`fn main() -> int { let x = 42; let y = x.foo; return 0; }`, "has no property");
    });
  });

  describe("miscellaneous type checks", () => {
    test("assign struct of different type → error", () => {
      checkError(
        `
          struct A { x: int; }
          struct B { x: int; }
          fn main() -> int {
            let a = A{ x: 1 };
            let b: B = a;
            return 0;
          }
        `,
        "type mismatch"
      );
    });

    test("null assignable to ptr → ok", () => {
      checkOk(`fn main() -> int { let p: ptr<int> = null; return 0; }`);
    });

    test("null assignable to non-ptr → error", () => {
      checkError(`fn main() -> int { let x: int = null; return 0; }`, "type mismatch");
    });

    test("static used as constant → ok", () => {
      checkOk(`
        static MAX = 100;
        fn main() -> int { return MAX; }
      `);
    });

    test("forward reference to function → ok", () => {
      checkOk(`
        fn main() -> int { return helper(); }
        fn helper() -> int { return 42; }
      `);
    });

    test("forward reference to struct → ok", () => {
      checkOk(`
        fn main() -> int {
          let p = Point{ x: 1.0, y: 2.0 };
          return 0;
        }
        struct Point { x: f64; y: f64; }
      `);
    });

    test("recursive function → ok", () => {
      checkOk(`
        fn factorial(n: int) -> int {
          if n <= 1 { return 1; }
          return n * factorial(n - 1);
        }
      `);
    });

    test("generic function infers type from argument → ok", () => {
      checkOk(`
        fn identity<T>(x: T) -> T { return x; }
        fn main() -> int { let x = identity(42); return x; }
      `);
    });

    test("throw in non-throws function → error", () => {
      checkError(
        `
          struct E {}
          fn foo() -> int { throw E{}; return 0; }
        `,
        "does not declare 'throws'"
      );
    });

    test("throws function called without catch → error", () => {
      checkError(
        `
          struct NotFound {}
          fn getUser(id: int) -> int throws NotFound {
            if id < 0 { throw NotFound{}; }
            return id;
          }
          fn main() -> int { let x = getUser(1); return 0; }
        `,
        "must use 'catch'"
      );
    });
  });
});
