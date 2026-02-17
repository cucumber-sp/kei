/**
 * Edge case tests for declaration checking:
 * - Duplicate methods in structs
 * - Lifecycle hook signature validation
 * - Duplicate enum variants
 */

import { describe, test } from "bun:test";
import { checkError, checkOk, checkErrors } from "./helpers.ts";

describe("Checker — Duplicate Methods", () => {
  test("duplicate method name in struct → error", () => {
    checkError(
      `
        struct Foo {
          x: int;
          fn bar(self: Foo) -> int { return self.x; }
          fn bar(self: Foo) -> int { return self.x + 1; }
        }
        fn main() -> int { return 0; }
      `,
      "duplicate method 'bar' in struct 'Foo'"
    );
  });

  test("different method names → ok", () => {
    checkOk(`
      struct Foo {
        x: int;
        fn bar(self: Foo) -> int { return self.x; }
        fn baz(self: Foo) -> int { return self.x + 1; }
      }
      fn main() -> int { return 0; }
    `);
  });

  test("duplicate method in unsafe struct → error", () => {
    checkError(
      `
        unsafe struct Bar {
          x: int;
          fn do_thing(self: Bar) -> int { return self.x; }
          fn do_thing(self: Bar) -> int { return self.x + 1; }
        }
        fn main() -> int { return 0; }
      `,
      "duplicate method 'do_thing' in struct 'Bar'"
    );
  });
});

describe("Checker — Duplicate Enum Variants", () => {
  test("duplicate variant name in enum → error", () => {
    checkError(
      `
        enum Color { Red; Green; Red; }
        fn main() -> int { return 0; }
      `,
      "duplicate variant 'Red' in enum 'Color'"
    );
  });

  test("unique variant names → ok", () => {
    checkOk(`
      enum Color { Red; Green; Blue; }
      fn main() -> int { return 0; }
    `);
  });
});

describe("Checker — Lifecycle Hook Signatures", () => {
  test("__destroy with correct signature → ok", () => {
    checkOk(`
      extern fn malloc(size: int) -> ptr<void>;
      extern fn c_free(p: ptr<void>);
      unsafe struct Buffer {
        data: ptr<void>;
        fn __destroy(self: Buffer) {
          unsafe { c_free(self.data); }
        }
        fn __oncopy(self: Buffer) -> Buffer {
          unsafe {
            let new_data = malloc(1);
            return Buffer{ data: new_data };
          }
        }
      }
      fn main() -> int { return 0; }
    `);
  });

  test("__destroy with extra params → error", () => {
    checkError(
      `
        extern fn c_free(p: ptr<void>);
        unsafe struct Buffer {
          data: ptr<void>;
          fn __destroy(self: Buffer, extra: int) {
            unsafe { c_free(self.data); }
          }
          fn __oncopy(self: Buffer) -> Buffer {
            return Buffer{ data: self.data };
          }
        }
        fn main() -> int { return 0; }
      `,
      "lifecycle hook '__destroy' must take exactly 1 parameter"
    );
  });

  test("__destroy with no params → error", () => {
    checkError(
      `
        unsafe struct Buffer {
          data: ptr<void>;
          fn __destroy() {
          }
          fn __oncopy(self: Buffer) -> Buffer {
            return Buffer{ data: self.data };
          }
        }
        fn main() -> int { return 0; }
      `,
      "lifecycle hook '__destroy' must take exactly 1 parameter"
    );
  });

  test("__oncopy with wrong first param name → error", () => {
    checkError(
      `
        extern fn c_free(p: ptr<void>);
        unsafe struct Buffer {
          data: ptr<void>;
          fn __destroy(self: Buffer) {
            unsafe { c_free(self.data); }
          }
          fn __oncopy(other: Buffer) -> Buffer {
            return Buffer{ data: other.data };
          }
        }
        fn main() -> int { return 0; }
      `,
      "lifecycle hook '__oncopy' first parameter must be named 'self'"
    );
  });

  test("__destroy with non-void return type → error", () => {
    checkError(
      `
        extern fn c_free(p: ptr<void>);
        unsafe struct Buffer {
          data: ptr<void>;
          fn __destroy(self: Buffer) -> int {
            unsafe { c_free(self.data); }
            return 0;
          }
          fn __oncopy(self: Buffer) -> Buffer {
            return Buffer{ data: self.data };
          }
        }
        fn main() -> int { return 0; }
      `,
      "lifecycle hook '__destroy' must return void"
    );
  });
});
