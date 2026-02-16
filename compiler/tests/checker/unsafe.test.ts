import { describe, test } from "bun:test";
import { checkError, checkOk } from "./helpers.ts";

describe("Checker — Unsafe", () => {
  test("unsafe block enters unsafe scope", () => {
    checkOk(`fn main() -> int { unsafe { let x = 1; } return 0; }`);
  });

  test("alloc inside unsafe → ok", () => {
    checkOk(`fn main() -> int { unsafe { let p = alloc(1024); free(p); } return 0; }`);
  });

  test("alloc outside unsafe → error", () => {
    checkError(
      `fn main() -> int { let p = alloc(1024); return 0; }`,
      "cannot call 'alloc' outside unsafe block"
    );
  });

  test("free inside unsafe → ok", () => {
    checkOk(`
      fn main() -> int {
        unsafe {
          let p = alloc(1024);
          free(p);
        }
        return 0;
      }
    `);
  });

  test("free outside unsafe → error", () => {
    checkError(
      `fn main() -> int { let p: ptr<int> = null; free(p); return 0; }`,
      "cannot call 'free' outside unsafe block"
    );
  });

  test("extern fn call inside unsafe → ok", () => {
    checkOk(`
      extern fn puts(s: ptr<c_char>) -> int;
      fn main() -> int { unsafe { puts(null); } return 0; }
    `);
  });

  test("extern fn call outside unsafe → error", () => {
    checkError(
      `
        extern fn puts(s: ptr<c_char>) -> int;
        fn main() -> int { puts(null); return 0; }
      `,
      "cannot call extern function outside unsafe block"
    );
  });

  test("ptr dereference inside unsafe → ok", () => {
    checkOk(`
      fn main() -> int {
        let p: ptr<int> = null;
        unsafe { let x = p.*; }
        return 0;
      }
    `);
  });

  test("ptr dereference outside unsafe → error", () => {
    checkError(
      `fn main() -> int { let p: ptr<int> = null; let x = p.*; return 0; }`,
      "pointer dereference requires unsafe block"
    );
  });

  test("address-of inside unsafe → ok, returns ptr<T>", () => {
    checkOk(`
      fn main() -> int {
        let x = 42;
        unsafe { let p = &x; }
        return 0;
      }
    `);
  });

  test("address-of outside unsafe → error", () => {
    checkError(`fn main() -> int { let x = 42; let p = &x; return 0; }`, "requires unsafe block");
  });

  test("nested unsafe blocks", () => {
    checkOk(`
      fn main() -> int {
        unsafe {
          let p = alloc(100);
          unsafe {
            free(p);
          }
        }
        return 0;
      }
    `);
  });

  test("unsafe struct without __destroy when has ptr<T> → error", () => {
    checkError(
      `
        unsafe struct Bad { data: ptr<u8>; }
        fn main() -> int { return 0; }
      `,
      "must define '__destroy'"
    );
  });

  test("unsafe struct without __oncopy when has ptr<T> → error", () => {
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

  test("unsafe struct with both hooks and ptr<T> → ok", () => {
    checkOk(`
      unsafe struct Buffer {
        data: ptr<u8>;
        size: usize;
        fn __destroy(self: Buffer) {
          unsafe { free(self.data); }
        }
        fn __oncopy(self: Buffer) -> Buffer {
          unsafe {
            let new_data = alloc(self.size);
            return Buffer{ data: new_data, size: self.size };
          }
        }
      }
      fn main() -> int { return 0; }
    `);
  });

  test("unsafe struct without ptr<T> — hooks optional → ok", () => {
    checkOk(`
      unsafe struct Simple { value: int; }
      fn main() -> int { return 0; }
    `);
  });

  test("sizeof is safe (no unsafe needed)", () => {
    // sizeof takes a type identifier; 'int' is a keyword so use a struct name
    checkOk(`
      struct Point { x: f64; y: f64; }
      fn main() -> int { let s = sizeof(Point); return 0; }
    `);
  });

  test("free with non-pointer → error", () => {
    checkError(`fn main() -> int { unsafe { free(42); } return 0; }`, "expects a pointer argument");
  });

  test("alloc with wrong number of args → error", () => {
    checkError(
      `fn main() -> int { unsafe { let p = alloc(1, 2); } return 0; }`,
      "expects exactly 1 argument"
    );
  });

  test("unsafe block with return → ok", () => {
    checkOk(`
      fn main() -> int {
        unsafe {
          let p = alloc(100);
          free(p);
          return 0;
        }
      }
    `);
  });

  test("unsafe expression: let x = unsafe { alloc(size) }", () => {
    checkOk(`
      fn main() -> int {
        let size = 1024;
        let p = unsafe { alloc(size) };
        unsafe { free(p); }
        return 0;
      }
    `);
  });

  test("unsafe expression: address-of", () => {
    checkOk(`
      fn main() -> int {
        let x = 42;
        let addr = unsafe { &x };
        return 0;
      }
    `);
  });

  test("unsafe expression does not leak unsafe to outer scope", () => {
    checkError(
      `fn main() -> int {
        let x = 42;
        let addr = unsafe { &x };
        let addr2 = &x;
        return 0;
      }`,
      "requires unsafe block"
    );
  });
});
