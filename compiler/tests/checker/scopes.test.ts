import { describe, test } from "bun:test";
import { checkError, checkOk } from "./helpers.ts";

describe("Checker — Scopes", () => {
  test("variable declared and used", () => {
    checkOk(`fn main() -> int { let x = 42; return x; }`);
  });

  test("variable used before declaration", () => {
    checkError(`fn main() -> int { let y = x; let x = 10; return y; }`, "undeclared variable 'x'");
  });

  test("variable from outer scope accessible in inner scope", () => {
    checkOk(`fn main() -> int { let x = 10; { let y = x; } return x; }`);
  });

  test("shadowing: inner variable shadows outer", () => {
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

  test("variable not accessible after scope ends", () => {
    checkError(`fn main() -> int { { let x = 10; } return x; }`, "undeclared variable 'x'");
  });

  test("function parameters in scope inside function body", () => {
    checkOk(`fn add(a: int, b: int) -> int { return a + b; }`);
  });

  test("nested function scopes don't leak", () => {
    checkOk(`
      fn foo() -> int {
        let x = 10;
        return x;
      }
      fn bar() -> int {
        let y = 20;
        return y;
      }
    `);
  });

  test("nested function scope variables don't leak", () => {
    checkError(
      `
        fn foo() -> int { let x = 10; return x; }
        fn bar() -> int { return x; }
      `,
      "undeclared variable 'x'"
    );
  });

  test("static variables in global scope", () => {
    checkOk(`
      static MAX = 100;
      fn main() -> int { return MAX; }
    `);
  });

  test("duplicate variable declaration in same scope", () => {
    checkError(`fn main() -> int { let x = 1; let x = 2; return x; }`, "duplicate variable 'x'");
  });

  test("for loop variable scoped to loop body", () => {
    checkError(
      `fn main() -> int { for i in 0..10 { let x = i; } return i; }`,
      "undeclared variable 'i'"
    );
  });

  test("for loop index variable scoped to loop body", () => {
    checkOk(`
      fn main() -> int {
        for item, idx in 0..10 {
          let x = item;
        }
        return 0;
      }
    `);
  });

  test("switch case body has own scope", () => {
    checkOk(`
      fn main() -> int {
        let x = 1;
        switch x {
          case 1: let y = 10;
          case 2: let y = 20;
          default: let y = 30;
        }
        return 0;
      }
    `);
  });

  test("struct fields accessible via dot notation", () => {
    checkOk(`
      struct Point { x: f64; y: f64; }
      fn main() -> int {
        let p = Point{ x: 1.0, y: 2.0 };
        let xval = p.x;
        return 0;
      }
    `);
  });

  test("method self parameter in scope", () => {
    checkOk(`
      struct Point {
        x: f64;
        y: f64;
        fn length(self: Point) -> f64 {
          return self.x + self.y;
        }
      }
      fn main() -> int { return 0; }
    `);
  });

  test("import names in scope", () => {
    checkOk(`
      import { HashMap } from collections;
      fn main() -> int { return 0; }
    `);
  });

  test("function visible in its own body (recursion)", () => {
    checkOk(`
      fn factorial(n: int) -> int {
        if n <= 1 { return 1; }
        return n * factorial(n - 1);
      }
    `);
  });

  test("forward reference to function from another function", () => {
    checkOk(`
      fn main() -> int { return helper(); }
      fn helper() -> int { return 42; }
    `);
  });

  test("forward reference to struct type", () => {
    checkOk(`
      fn main() -> int {
        let p = Point{ x: 1.0, y: 2.0 };
        return 0;
      }
      struct Point { x: f64; y: f64; }
    `);
  });

  test("const variables are immutable in scope", () => {
    checkError(
      `fn main() -> int { const x = 10; x = 20; return x; }`,
      "cannot assign to immutable variable 'x'"
    );
  });

  // ─── Shadowing edge cases ──────────────────────────────────────────────

  test("shadowing across three nested block levels", () => {
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

  test("inner mutable variable shadows outer const", () => {
    checkOk(`
      fn main() -> int {
        const x = 10;
        {
          let x = 20;
          x = 30;
        }
        return x;
      }
    `);
  });

  test("variable shadows function parameter", () => {
    checkOk(`
      fn foo(x: int) -> int {
        {
          let x = 99;
        }
        return x;
      }
    `);
  });

  test("variable with same name as function → ok in inner scope", () => {
    checkOk(`
      fn helper() -> int { return 42; }
      fn main() -> int {
        let helper = 10;
        return helper;
      }
    `);
  });

  test("variable with same name as struct type → ok in inner scope", () => {
    checkOk(`
      struct Point { x: f64; y: f64; }
      fn main() -> int {
        let Point = 5;
        return Point;
      }
    `);
  });

  // ─── Scope isolation edge cases ────────────────────────────────────────

  test("for loop index variable not accessible after loop", () => {
    checkError(
      `
        fn main() -> int {
          for item, idx in 0..5 { let x = idx; }
          return idx;
        }
      `,
      "undeclared variable 'idx'"
    );
  });

  test("if-block variable not accessible after if", () => {
    checkError(
      `
        fn main() -> int {
          if true { let x = 10; }
          return x;
        }
      `,
      "undeclared variable 'x'"
    );
  });

  test("while-block variable not accessible after while", () => {
    checkError(
      `
        fn main() -> int {
          while false { let x = 10; }
          return x;
        }
      `,
      "undeclared variable 'x'"
    );
  });

  test("switch case variables don't leak between cases", () => {
    checkError(
      `
        fn main() -> int {
          switch 1 {
            case 1: let x = 10;
            case 2: return x;
            default: return 0;
          }
        }
      `,
      "undeclared variable 'x'"
    );
  });

  // ─── Redeclaration edge cases ──────────────────────────────────────────

  test("duplicate const in same scope → error", () => {
    checkError(
      `fn main() -> int { const x = 1; const x = 2; return x; }`,
      "duplicate variable 'x'"
    );
  });

  test("let and const with same name in same scope → error", () => {
    checkError(`fn main() -> int { let x = 1; const x = 2; return x; }`, "duplicate variable 'x'");
  });

  test("duplicate parameter name → error", () => {
    checkError(`fn foo(x: int, x: int) -> int { return x; }`, "duplicate variable 'x'");
  });
});
