import { describe, test } from "bun:test";
import { checkError, checkOk } from "./helpers.ts";

describe("Checker — Lifecycle", () => {
  test("move x marks x as moved", () => {
    checkOk(`
      struct Data { value: int; }
      fn main() -> int {
        let a = Data{ value: 42 };
        let b = move a;
        return 0;
      }
    `);
  });

  test("use after move → error", () => {
    checkError(
      `
        struct Data { value: int; }
        fn main() -> int {
          let a = Data{ value: 42 };
          let b = move a;
          let c = a;
          return 0;
        }
      `,
      "use of moved variable 'a'"
    );
  });

  test("move in one branch: conservative treatment", () => {
    // After move in one branch, variable is considered moved
    checkError(
      `
        struct Data { value: int; }
        fn main() -> int {
          let a = Data{ value: 42 };
          if true {
            let b = move a;
          }
          let c = a;
          return 0;
        }
      `,
      "use of moved variable 'a'"
    );
  });

  test("move with non-variable → error", () => {
    checkError(
      `fn main() -> int { let x = move 42; return 0; }`,
      "'move' can only be applied to a variable"
    );
  });

  test("struct with ptr<T> requires __destroy — error if missing", () => {
    checkError(
      `
        unsafe struct Bad { data: ptr<u8>; }
        fn main() -> int { return 0; }
      `,
      "must define '__destroy'"
    );
  });

  test("struct with ptr<T> requires __oncopy — error if missing", () => {
    checkError(
      `
        unsafe struct Bad {
          data: ptr<u8>;
          fn __destroy(self: Bad) { }
        }
        fn main() -> int { return 0; }
      `,
      "must define '__oncopy'"
    );
  });

  test("regular struct (no ptr) — no hooks needed", () => {
    checkOk(`
      struct Point { x: f64; y: f64; }
      fn main() -> int { return 0; }
    `);
  });

  test("unsafe struct with both hooks → ok", () => {
    checkOk(`
      unsafe struct Buffer {
        data: ptr<u8>;
        fn __destroy(self: Buffer) { }
        fn __oncopy(self: Buffer) -> Buffer {
          return Buffer{ data: self.data };
        }
      }
      fn main() -> int { return 0; }
    `);
  });

  test("move integer variable", () => {
    checkOk(`
      fn main() -> int {
        let x = 42;
        let y = move x;
        return y;
      }
    `);
  });

  test("use after move of integer → error", () => {
    checkError(
      `
        fn main() -> int {
          let x = 42;
          let y = move x;
          return x;
        }
      `,
      "use of moved variable 'x'"
    );
  });

  test("move expression with field access → error", () => {
    checkError(
      `
        struct Point { x: f64; y: f64; }
        fn main() -> int {
          let p = Point{ x: 1.0, y: 2.0 };
          let x = move p.x;
          return 0;
        }
      `,
      "'move' can only be applied to a variable"
    );
  });

  test("move param at call site", () => {
    checkOk(`
      struct Data { value: int; }
      fn consume(move d: Data) -> int {
        return d.value;
      }
      fn main() -> int {
        let d = Data{ value: 42 };
        return consume(move d);
      }
    `);
  });

  test("double move → error", () => {
    checkError(
      `
        fn main() -> int {
          let x = 42;
          let y = move x;
          let z = move x;
          return y;
        }
      `,
      "use of moved variable 'x'"
    );
  });

  test("unsafe struct without ptr fields — hooks optional", () => {
    checkOk(`
      unsafe struct Flags { bits: u32; }
      fn main() -> int { return 0; }
    `);
  });
});
