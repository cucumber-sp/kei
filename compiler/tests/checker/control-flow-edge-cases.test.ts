import { describe, test } from "bun:test";
import { checkError, checkOk, checkWarning } from "./helpers.ts";

describe("Checker — Control Flow Edge Cases", () => {
  describe("nested loops with break/continue", () => {
    test("break in inner loop doesn't affect outer → ok", () => {
      checkOk(`
        fn main() -> int {
          for i in 0..10 {
            for j in 0..10 {
              if j == 3 { break; }
            }
          }
          return 0;
        }
      `);
    });

    test("continue in inner loop doesn't affect outer → ok", () => {
      checkOk(`
        fn main() -> int {
          for i in 0..5 {
            for j in 0..5 {
              if j == 2 { continue; }
            }
          }
          return 0;
        }
      `);
    });

    test("break in while inside for → ok", () => {
      checkOk(`
        fn main() -> int {
          for i in 0..10 {
            let x = 0;
            while x < 5 {
              if x == 3 { break; }
              x = x + 1;
            }
          }
          return 0;
        }
      `);
    });

    test("deeply nested break → ok", () => {
      checkOk(`
        fn main() -> int {
          while true {
            while true {
              while true {
                break;
              }
              break;
            }
            break;
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

    test("break inside if but outside loop → error", () => {
      checkError(
        `fn main() -> int { if true { break; } return 0; }`,
        "'break' used outside of a loop"
      );
    });
  });

  describe("while loop edge cases", () => {
    test("while with complex condition → ok", () => {
      checkOk(`
        fn main() -> int {
          let x = 0;
          let y = 10;
          while x < y && y > 0 {
            x = x + 1;
            y = y - 1;
          }
          return x;
        }
      `);
    });

    test("while true with break → ok", () => {
      checkOk(`
        fn main() -> int {
          let x = 0;
          while true {
            x = x + 1;
            if x >= 10 { break; }
          }
          return x;
        }
      `);
    });

    test("while with non-bool condition → error", () => {
      checkError(
        `fn main() -> int { while 42 { break; } return 0; }`,
        "while condition must be bool"
      );
    });

    test("while with string condition → error", () => {
      checkError(
        `fn main() -> int { while "true" { break; } return 0; }`,
        "while condition must be bool"
      );
    });

    test("empty while body → ok", () => {
      checkOk(`
        fn main() -> int {
          while false { }
          return 0;
        }
      `);
    });
  });

  describe("for loop edge cases", () => {
    test("for over range → ok", () => {
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
          for item, idx in 0..10 {
            let x = idx;
          }
          return 0;
        }
      `);
    });

    test("for over non-iterable → error", () => {
      checkError(
        `fn main() -> int { for i in 42 { let x = i; } return 0; }`,
        "cannot iterate over type"
      );
    });

    test("for loop variable not accessible after loop", () => {
      checkError(
        `fn main() -> int { for i in 0..10 { } return i; }`,
        "undeclared variable 'i'"
      );
    });

    test("nested for loops → ok", () => {
      checkOk(`
        fn main() -> int {
          let sum = 0;
          for i in 0..5 {
            for j in 0..5 {
              sum = sum + 1;
            }
          }
          return sum;
        }
      `);
    });
  });

  describe("switch edge cases", () => {
    test("switch with all enum variants covered → ok", () => {
      checkOk(`
        enum Color : u8 { Red = 0, Green = 1, Blue = 2 }
        fn describe(c: Color) -> int {
          switch c {
            case Red: return 1;
            case Green: return 2;
            case Blue: return 3;
          }
        }
      `);
    });

    test("switch with missing variant and no default → error", () => {
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

    test("switch with default covers missing → ok", () => {
      checkOk(`
        enum Color : u8 { Red = 0, Green = 1, Blue = 2 }
        fn describe(c: Color) -> int {
          switch c {
            case Red: return 1;
            default: return 0;
          }
        }
      `);
    });

    test("switch on integer with default → ok", () => {
      checkOk(`
        fn main() -> int {
          let x = 5;
          switch x {
            case 1: return 10;
            case 2: return 20;
            default: return 0;
          }
        }
      `);
    });

    test("switch with multiple values per case → ok", () => {
      checkOk(`
        enum Color : u8 { Red = 0, Green = 1, Blue = 2 }
        fn describe(c: Color) -> int {
          switch c {
            case Red, Green: return 1;
            case Blue: return 2;
          }
        }
      `);
    });

    test("switch with nonexistent enum variant → error", () => {
      checkError(
        `
          enum Color : u8 { Red = 0, Green = 1, Blue = 2 }
          fn main() -> int {
            let c: Color = Color.Red;
            switch c {
              case Red: return 1;
              case Green: return 2;
              case Blue: return 3;
              case Yellow: return 4;
            }
          }
        `,
        "has no variant 'Yellow'"
      );
    });

    test("switch cases have own scope → ok (same var name)", () => {
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
  });

  describe("early return from nested blocks", () => {
    test("return from inside if block → ok", () => {
      checkOk(`
        fn check(x: int) -> int {
          if x > 0 {
            return 1;
          }
          return 0;
        }
      `);
    });

    test("return from inside while → ok", () => {
      checkOk(`
        fn findFirst() -> int {
          let i = 0;
          while i < 100 {
            if i == 42 { return i; }
            i = i + 1;
          }
          return -1;
        }
      `);
    });

    test("return from nested blocks → ok", () => {
      checkOk(`
        fn complex(x: int) -> int {
          {
            {
              if x > 0 { return x; }
            }
          }
          return 0;
        }
      `);
    });

    test("if/else if/else all returning → ok", () => {
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

    test("if without else, only then returns → error", () => {
      checkError(
        `
          fn getVal(x: int) -> int {
            if x > 0 { return x; }
          }
        `,
        "does not return a value on all paths"
      );
    });
  });

  describe("if-expression in various positions", () => {
    test("if-expression as let initializer → ok", () => {
      checkOk(`
        fn main() -> int {
          let x = if true { 10 } else { 20 };
          return x;
        }
      `);
    });

    test("if-expression as return value → ok", () => {
      checkOk(`
        fn choose(b: bool) -> int {
          return if b { 1 } else { 0 };
        }
      `);
    });

    test("if-expression as function argument → ok", () => {
      checkOk(`
        fn negate(x: int) -> int { return -x; }
        fn main() -> int {
          let result = negate(if true { 5 } else { 10 });
          return result;
        }
      `);
    });

    test("nested if-expression → ok", () => {
      checkOk(`
        fn main() -> int {
          let x = if true {
            if false { 1 } else { 2 }
          } else {
            3
          };
          return x;
        }
      `);
    });
  });

  describe("unreachable code warnings", () => {
    test("unreachable after return → warning", () => {
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

    test("unreachable after break → warning", () => {
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

    test("unreachable after continue → warning", () => {
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

    test("code after if with return is reachable if no else → ok", () => {
      checkOk(`
        fn main() -> int {
          if true { return 0; }
          return 1;
        }
      `);
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

  describe("condition type checking", () => {
    test("if condition must be bool: int → error", () => {
      checkError(
        `fn main() -> int { if 42 { } return 0; }`,
        "if condition must be bool"
      );
    });

    test("if condition must be bool: string → error", () => {
      checkError(
        `fn main() -> int { if "hello" { } return 0; }`,
        "if condition must be bool"
      );
    });

    test("assert condition must be bool → error", () => {
      checkError(
        `fn main() -> int { assert(42); return 0; }`,
        "assert condition must be bool"
      );
    });

    test("require condition must be bool → error", () => {
      checkError(
        `fn main() -> int { require(42); return 0; }`,
        "require condition must be bool"
      );
    });

    test("assert with string message → ok", () => {
      checkOk(`fn main() -> int { assert(true, "invariant"); return 0; }`);
    });

    test("require with string message → ok", () => {
      checkOk(`fn main() -> int { require(true, "precondition"); return 0; }`);
    });
  });

  describe("defer statement", () => {
    test("defer valid function call → ok", () => {
      checkOk(`
        fn cleanup() { }
        fn main() -> int {
          defer cleanup();
          return 0;
        }
      `);
    });

    test("multiple defers → ok", () => {
      checkOk(`
        fn cleanup1() { }
        fn cleanup2() { }
        fn main() -> int {
          defer cleanup1();
          defer cleanup2();
          return 0;
        }
      `);
    });
  });

  describe("scope edge cases in control flow", () => {
    test("variable in while body not accessible outside → error", () => {
      checkError(
        `fn main() -> int {
          while false {
            let x = 42;
          }
          return x;
        }`,
        "undeclared variable 'x'"
      );
    });

    test("variable in if body not accessible outside → error", () => {
      checkError(
        `fn main() -> int {
          if true {
            let x = 42;
          }
          return x;
        }`,
        "undeclared variable 'x'"
      );
    });

    test("variable in nested block not accessible outside → error", () => {
      checkError(
        `fn main() -> int { { let x = 1; } return x; }`,
        "undeclared variable 'x'"
      );
    });

    test("outer variable accessible in while body → ok", () => {
      checkOk(`
        fn main() -> int {
          let x = 0;
          while x < 10 {
            x = x + 1;
          }
          return x;
        }
      `);
    });

    test("outer variable accessible in for body → ok", () => {
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
  });
});
