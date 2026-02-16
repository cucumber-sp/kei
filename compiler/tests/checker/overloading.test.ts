import { describe, test } from "bun:test";
import { checkError, checkOk } from "./helpers.ts";

describe("Checker — Function Overloading", () => {
  // ─── Basic overloading ─────────────────────────────────────────────────

  test("two functions same name, different param types → ok", () => {
    checkOk(`
      fn greet(name: string) -> string { return name; }
      fn greet(id: i32) -> i32 { return id; }
      fn main() -> int { greet("hello"); greet(42); return 0; }
    `);
  });

  test("two functions same name, different param count → ok", () => {
    checkOk(`
      fn add(a: i32) -> i32 { return a; }
      fn add(a: i32, b: i32) -> i32 { return a + b; }
      fn main() -> int { add(1); add(1, 2); return 0; }
    `);
  });

  test("overload resolution picks correct one by type", () => {
    checkOk(`
      fn process(x: i32) -> i32 { return x; }
      fn process(x: string) -> string { return x; }
      fn main() -> int {
        let a: i32 = process(42);
        let b: string = process("hello");
        return 0;
      }
    `);
  });

  test("overload resolution picks correct one by count", () => {
    checkOk(`
      fn make(a: i32) -> i32 { return a; }
      fn make(a: i32, b: i32) -> i32 { return a + b; }
      fn main() -> int {
        let a = make(1);
        let b = make(1, 2);
        return 0;
      }
    `);
  });

  // ─── Error cases ───────────────────────────────────────────────────────

  test("duplicate signature (same param types) → error", () => {
    checkError(
      `
        fn dup(x: i32) -> i32 { return x; }
        fn dup(y: i32) -> i32 { return y; }
      `,
      "duplicate declaration"
    );
  });

  test("no matching overload → error", () => {
    checkError(
      `
        fn handle(x: i32) -> i32 { return x; }
        fn handle(x: string) -> string { return x; }
        fn main() -> int { handle(true); return 0; }
      `,
      "no matching overload"
    );
  });

  // ─── User-defined multi-type overloads ──────────────────────────────────

  test("overload with i32 → ok", () => {
    checkOk(`
      fn log(value: i32) {}
      fn log(value: string) {}
      fn main() -> int { log(42); return 0; }
    `);
  });

  test("overload with string → ok", () => {
    checkOk(`
      fn log(value: i32) {}
      fn log(value: string) {}
      fn main() -> int { log("hello"); return 0; }
    `);
  });

  test("overload with f64 → ok", () => {
    checkOk(`
      fn log(value: f64) {}
      fn log(value: string) {}
      fn main() -> int { log(3.14); return 0; }
    `);
  });

  test("overload with bool → ok", () => {
    checkOk(`
      fn log(value: bool) {}
      fn log(value: string) {}
      fn main() -> int { log(true); return 0; }
    `);
  });

  test("overload with i64 → ok", () => {
    checkOk(`
      fn log(value: i64) {}
      fn log(value: string) {}
      fn main() -> int {
        let x: i64 = 100;
        log(x);
        return 0;
      }
    `);
  });

  test("overload with all types in one function → ok", () => {
    checkOk(`
      fn log(value: i32) {}
      fn log(value: string) {}
      fn log(value: f64) {}
      fn log(value: bool) {}
      fn main() -> int {
        log(42);
        log("hello");
        log(3.14);
        log(true);
        return 0;
      }
    `);
  });

  // ─── Three or more overloads ───────────────────────────────────────────

  test("three overloads with different types → ok", () => {
    checkOk(`
      fn show(x: i32) -> i32 { return x; }
      fn show(x: string) -> string { return x; }
      fn show(x: bool) -> bool { return x; }
      fn main() -> int {
        show(1);
        show("hi");
        show(true);
        return 0;
      }
    `);
  });

  // ─── Overloading with different return types ───────────────────────────

  test("overloads can have different return types", () => {
    checkOk(`
      fn convert(x: i32) -> string { return "int"; }
      fn convert(x: string) -> i32 { return 0; }
      fn main() -> int {
        let a: string = convert(42);
        let b: i32 = convert("hello");
        return 0;
      }
    `);
  });
});
