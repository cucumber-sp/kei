import { describe, test } from "bun:test";
import { checkError, checkOk } from "./helpers.ts";

describe("Checker — Functions", () => {
  test("simple function call with correct args → ok", () => {
    checkOk(`
      fn add(a: int, b: int) -> int { return a + b; }
      fn main() -> int { return add(1, 2); }
    `);
  });

  test("wrong number of arguments → error", () => {
    checkError(
      `
        fn add(a: int, b: int) -> int { return a + b; }
        fn main() -> int { return add(1); }
      `,
      "expected 2 argument(s), got 1"
    );
  });

  test("wrong argument type → error", () => {
    checkError(
      `
        fn add(a: int, b: int) -> int { return a + b; }
        fn main() -> int { return add(1, "hello"); }
      `,
      "expected 'i32', got 'string'"
    );
  });

  test("return type matches → ok", () => {
    checkOk(`fn getInt() -> int { return 42; }`);
  });

  test("return type mismatch → error", () => {
    checkError(`fn getInt() -> int { return "hello"; }`, "return type mismatch");
  });

  test("missing return in non-void function → error", () => {
    checkError(`fn getInt() -> int { let x = 42; }`, "does not return a value on all paths");
  });

  test("return with value in void function → error", () => {
    checkError(`fn doStuff() { return 42; }`, "expects return type 'void', got");
  });

  test("return without value in non-void → error", () => {
    checkError(`fn getInt() -> int { return; }`, "expects return type 'i32', got void");
  });

  test("all paths return (if/else both return) → ok", () => {
    checkOk(`
      fn max(a: int, b: int) -> int {
        if a > b {
          return a;
        } else {
          return b;
        }
      }
    `);
  });

  test("not all paths return (if without else) → error", () => {
    checkError(
      `
        fn getVal(x: int) -> int {
          if x > 0 {
            return x;
          }
        }
      `,
      "does not return a value on all paths"
    );
  });

  test("mut param is mutable inside function", () => {
    checkOk(`
      fn increment(mut x: int) -> int {
        x += 1;
        return x;
      }
    `);
  });

  test("non-mut param is immutable", () => {
    checkError(
      `fn increment(x: int) -> int { x += 1; return x; }`,
      "cannot assign to immutable variable 'x'"
    );
  });

  test("recursive function → ok", () => {
    checkOk(`
      fn factorial(n: int) -> int {
        if n <= 1 { return 1; }
        return n * factorial(n - 1);
      }
    `);
  });

  test("extern fn registered correctly", () => {
    checkOk(`
      extern fn strlen(s: ptr<c_char>) -> usize;
      fn main() -> int { return 0; }
    `);
  });

  test("extern fn call outside unsafe → error", () => {
    checkError(
      `
        extern fn strlen(s: ptr<c_char>) -> usize;
        fn main() -> int { let n = strlen(null); return 0; }
      `,
      "cannot call extern function outside unsafe block"
    );
  });

  test("extern fn call inside unsafe → ok", () => {
    checkOk(`
      extern fn puts(s: ptr<c_char>) -> int;
      fn main() -> int {
        unsafe { puts(null); }
        return 0;
      }
    `);
  });

  test("function with throws — call without catch → error", () => {
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

  test("function without throws — can't use throw inside → error", () => {
    checkError(
      `
        struct E {}
        fn foo() -> int { throw E{}; return 0; }
      `,
      "does not declare 'throws'"
    );
  });

  test("generic function: identity → ok", () => {
    checkOk(`
      fn identity<T>(x: T) -> T { return x; }
      fn main() -> int { let x = identity(42); return 0; }
    `);
  });

  test("function with multiple return paths all correct", () => {
    checkOk(`
      fn classify(x: int) -> int {
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

  test("void function with no return statement → ok", () => {
    checkOk(`fn doStuff() { let x = 42; }`);
  });

  test("void function with return; → ok", () => {
    checkOk(`fn doStuff() { return; }`);
  });

  test("function call with too many arguments → error", () => {
    checkError(
      `
        fn add(a: int, b: int) -> int { return a + b; }
        fn main() -> int { return add(1, 2, 3); }
      `,
      "expected 2 argument(s), got 3"
    );
  });

  test("function call with correct types across widening", () => {
    checkOk(`
      fn takeLong(x: i64) -> i64 { return x; }
      fn main() -> int {
        let x: i32 = 42;
        let y = takeLong(x);
        return 0;
      }
    `);
  });

  test("function throws with catch handling all types → ok", () => {
    checkOk(`
      struct NotFound {}
      struct DbError { message: string; }
      fn getUser(id: int) -> int throws NotFound, DbError {
        if id < 0 { throw NotFound{}; }
        return id;
      }
      fn main() -> int {
        let x = getUser(1) catch {
          NotFound: return -1;
          DbError e: return -2;
        };
        return x;
      }
    `);
  });
});
