import { describe, test } from "bun:test";
import { checkError, checkOk, checkWarning } from "./helpers.ts";

describe("Checker — Control Flow", () => {
  test("break inside while → ok", () => {
    checkOk(`
      fn main() -> int {
        while true { break; }
        return 0;
      }
    `);
  });

  test("break outside loop → error", () => {
    checkError(`fn main() -> int { break; return 0; }`, "'break' used outside of a loop");
  });

  test("continue inside for → ok", () => {
    checkOk(`
      fn main() -> int {
        for i in 0..10 { continue; }
        return 0;
      }
    `);
  });

  test("continue outside loop → error", () => {
    checkError(`fn main() -> int { continue; return 0; }`, "'continue' used outside of a loop");
  });

  test("return in void function (no value) → ok", () => {
    checkOk(`fn doStuff() { return; }`);
  });

  test("return value in void function → error", () => {
    checkError(`fn doStuff() { return 42; }`, "expects return type 'void', got");
  });

  test("return no value in non-void → error", () => {
    checkError(`fn getInt() -> int { return; }`, "expects return type 'i32', got void");
  });

  test("if/else both return → function returns ok", () => {
    checkOk(`
      fn max(a: int, b: int) -> int {
        if a > b { return a; } else { return b; }
      }
    `);
  });

  test("if without else: only then returns → function may not return", () => {
    checkError(
      `
        fn getVal(x: int) -> int {
          if x > 0 { return x; }
        }
      `,
      "does not return a value on all paths"
    );
  });

  test("while loop body: break/continue valid", () => {
    checkOk(`
      fn main() -> int {
        let x = 0;
        while x < 10 {
          x = x + 1;
          if x == 5 { continue; }
          if x == 8 { break; }
        }
        return x;
      }
    `);
  });

  test("nested loops: break/continue affect innermost", () => {
    checkOk(`
      fn main() -> int {
        for i in 0..10 {
          for j in 0..10 {
            if j == 5 { break; }
          }
        }
        return 0;
      }
    `);
  });

  test("defer: valid statement", () => {
    checkOk(`
      fn cleanup() { }
      fn main() -> int {
        defer cleanup();
        return 0;
      }
    `);
  });

  test("switch exhaustiveness with enums", () => {
    checkError(
      `
        enum Dir : u8 { Up = 0, Down = 1, Left = 2, Right = 3 }
        fn describe(d: Dir) -> int {
          switch d {
            case Up: return 0;
            case Down: return 1;
          }
        }
      `,
      "not exhaustive, missing: Left, Right"
    );
  });

  test("switch expression: valid with default", () => {
    checkOk(`
      fn main() -> int {
        let code = 200;
        let msg = switch code {
          case 200: "OK";
          case 404: "Not Found";
          default: "Unknown";
        };
        return 0;
      }
    `);
  });

  test("switch expression: type mismatch between branches", () => {
    checkError(
      `
        fn main() -> int {
          let code = 200;
          let msg = switch code {
            case 200: "OK";
            case 404: 42;
            default: "Unknown";
          };
          return 0;
        }
      `,
      "switch expression branches have different types"
    );
  });

  test("switch expression: missing default case", () => {
    checkError(
      `
        fn main() -> int {
          let code = 200;
          let msg = switch code {
            case 200: "OK";
            case 404: "Not Found";
          };
          return 0;
        }
      `,
      "switch expression must have a default case"
    );
  });

  test("switch expression: exhaustive enum without default", () => {
    checkOk(`
      enum Color : u8 { Red = 0, Green = 1, Blue = 2 }
      fn main() -> int {
        let c = Color.Red;
        let val = switch c {
          case Red: 1;
          case Green: 2;
          case Blue: 3;
        };
        return 0;
      }
    `);
  });

  test("switch expression: non-exhaustive enum without default", () => {
    checkError(
      `
        enum Color : u8 { Red = 0, Green = 1, Blue = 2 }
        fn main() -> int {
          let c = Color.Red;
          let val = switch c {
            case Red: 1;
            case Green: 2;
          };
          return 0;
        }
      `,
      "not exhaustive, missing: Blue"
    );
  });

  test("unreachable code after return → warning", () => {
    checkWarning(
      `
        fn main() -> int {
          return 0;
          let x = 42;
        }
      `,
      "unreachable code after return"
    );
  });

  test("while condition must be bool", () => {
    checkError(
      `fn main() -> int { while 42 { break; } return 0; }`,
      "while condition must be bool"
    );
  });

  test("if condition must be bool", () => {
    checkError(`fn main() -> int { if 42 { let x = 1; } return 0; }`, "if condition must be bool");
  });

  test("for loop over range → ok", () => {
    checkOk(`
      fn main() -> int {
        for i in 0..10 { let x = i; }
        return 0;
      }
    `);
  });

  test("for loop over non-iterable → error", () => {
    checkError(
      `fn main() -> int { for i in 42 { let x = i; } return 0; }`,
      "cannot iterate over type"
    );
  });

  test("assert condition must be bool", () => {
    checkError(`fn main() -> int { assert(42); return 0; }`, "assert condition must be bool");
  });

  test("require condition must be bool", () => {
    checkError(`fn main() -> int { require(42); return 0; }`, "require condition must be bool");
  });

  test("assert with string message → ok", () => {
    checkOk(`fn main() -> int { assert(true, "ok"); return 0; }`);
  });

  test("require with string message → ok", () => {
    checkOk(`fn main() -> int { require(true, "ok"); return 0; }`);
  });

  test("if/else if/else all return → ok", () => {
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

  test("unreachable code after break → warning", () => {
    checkWarning(
      `
        fn main() -> int {
          while true {
            break;
            let x = 42;
          }
          return 0;
        }
      `,
      "unreachable code after return"
    );
  });

  test("unreachable code after continue → warning", () => {
    checkWarning(
      `
        fn main() -> int {
          for i in 0..10 {
            continue;
            let x = 42;
          }
          return 0;
        }
      `,
      "unreachable code after return"
    );
  });

  test("break in if branch does not make outer code unreachable", () => {
    checkOk(`
      fn main() -> int {
        while true {
          if true { break; }
          let x = 1;
        }
        return 0;
      }
    `);
  });
});
