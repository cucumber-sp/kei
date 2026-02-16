import { describe, test } from "bun:test";
import { checkError, checkOk } from "./helpers.ts";

describe("Checker — Enums", () => {
  test("simple enum with base type → ok", () => {
    checkOk(`
      enum Color : u8 { Red = 0, Green = 1, Blue = 2 }
      fn main() -> int { return 0; }
    `);
  });

  test("simple enum variant values match base type", () => {
    checkOk(`
      enum Priority : int { Low = 0, Medium = 1, High = 2 }
      fn main() -> int { return 0; }
    `);
  });

  test("data enum: variant fields have correct types", () => {
    checkOk(`
      enum Shape {
        Circle(radius: f64),
        Rectangle(width: f64, height: f64),
        Point
      }
      fn main() -> int { return 0; }
    `);
  });

  test("switch on enum: all variants covered → ok", () => {
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

  test("switch on enum: missing variant, no default → error", () => {
    checkError(
      `
        enum Color : u8 { Red = 0, Green = 1, Blue = 2 }
        fn describe(c: Color) -> int {
          switch c {
            case Red: return 1;
            case Green: return 2;
          }
        }
      `,
      "not exhaustive, missing: Blue"
    );
  });

  test("switch on enum: missing variant, has default → ok", () => {
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

  test("enum used as type annotation", () => {
    checkOk(`
      enum Color : u8 { Red = 0, Green = 1, Blue = 2 }
      fn main() -> int {
        let c: Color = Color.Red;
        return 0;
      }
    `);
  });

  test("duplicate enum declaration → error", () => {
    checkError(
      `
        enum Color : u8 { Red = 0 }
        enum Color : u8 { Blue = 0 }
        fn main() -> int { return 0; }
      `,
      "duplicate declaration 'Color'"
    );
  });

  test("enum with no variants → ok", () => {
    checkOk(`
      enum Empty : u8 {}
      fn main() -> int { return 0; }
    `);
  });

  test("enum used in function parameter", () => {
    checkOk(`
      enum Color : u8 { Red = 0, Green = 1, Blue = 2 }
      fn getCode(c: Color) -> int { return 0; }
      fn main() -> int { return 0; }
    `);
  });

  test("switch on non-enum integer value → ok (no exhaustiveness)", () => {
    checkOk(`
      fn main() -> int {
        let x = 5;
        switch x {
          case 1: let y = 10;
          case 2: let y = 20;
          default: let y = 0;
        }
        return 0;
      }
    `);
  });

  test("switch on enum: non-existent variant in case → error", () => {
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

  test("enum multiple variants in same case → ok", () => {
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

  test("enum forward reference → ok", () => {
    checkOk(`
      fn main() -> int {
        let c: Color = Color.Red;
        return 0;
      }
      enum Color : u8 { Red = 0, Green = 1, Blue = 2 }
    `);
  });

  test("two enums with same variant name → no conflict", () => {
    checkOk(`
      enum Color : u8 { Red = 0, Green = 1, Blue = 2 }
      enum Priority : u8 { Red = 0, Yellow = 1, Green = 2 }
      fn main() -> int { return 0; }
    `);
  });

  test("enum variant accessed via qualified name → ok", () => {
    checkOk(`
      enum Color : u8 { Red = 0, Green = 1, Blue = 2 }
      fn main() -> int {
        let c: Color = Color.Green;
        return 0;
      }
    `);
  });

  test("bare enum variant outside switch → error", () => {
    checkError(
      `
        enum Color : u8 { Red = 0, Green = 1, Blue = 2 }
        fn main() -> int {
          let c: Color = Red;
          return 0;
        }
      `,
      "undeclared variable 'Red'"
    );
  });

  test("two enums same variant name: qualified access works", () => {
    checkOk(`
      enum Color : u8 { Red = 0, Blue = 1 }
      enum Alert : u8 { Red = 0, Yellow = 1 }
      fn main() -> int {
        let c: Color = Color.Red;
        let a: Alert = Alert.Red;
        return 0;
      }
    `);
  });
});
