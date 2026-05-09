import { describe, expect, test } from "bun:test";
import { lowerFunction } from "../kir/helpers";
import { checkError, checkOk } from "./helpers";

const STRUCT_DEFS = `
unsafe struct Bag {
  n: i32;
  fn __destroy(self: ref Bag) {}
  fn __oncopy(self: ref Bag) {}
}
`;

describe("`*T → ref T` coercion in unsafe-struct literals", () => {
  test("literal accepts *T for a ref T field inside unsafe", () => {
    checkOk(`
      unsafe struct Bag {
        payload: ref i32;
        fn __destroy(self: ref Bag) {}
        fn __oncopy(self: ref Bag) {}
      }
      fn build(p: *i32) -> Bag {
        unsafe {
          return Bag{ payload: p };
        }
      }
      fn main() -> i32 { return 0; }
    `);
  });

  test("literal accepts *T for a ref T field on a generic unsafe struct", () => {
    checkOk(`
      unsafe struct Holder<T> {
        value: ref T;
        fn __destroy(self: ref Holder<T>) {}
        fn __oncopy(self: ref Holder<T>) {}
      }
      fn build(p: *i32) -> Holder<i32> {
        unsafe {
          return Holder<i32>{ value: p };
        }
      }
      fn main() -> i32 { return 0; }
    `);
  });

  test("`*T` in a `ref T` slot is rejected outside unsafe", () => {
    checkError(
      `
      unsafe struct Bag {
        payload: ref i32;
        fn __destroy(self: ref Bag) {}
        fn __oncopy(self: ref Bag) {}
      }
      fn build(p: *i32) -> Bag {
        return Bag{ payload: p };
      }
      fn main() -> i32 { return 0; }
      `,
      "expected 'ref i32', got '*i32'"
    );
  });

  test("`*U` (mismatched pointee) in a `ref T` slot is rejected even inside unsafe", () => {
    checkError(
      `
      unsafe struct Bag {
        payload: ref i32;
        fn __destroy(self: ref Bag) {}
        fn __oncopy(self: ref Bag) {}
      }
      fn build(p: *bool) -> Bag {
        unsafe {
          return Bag{ payload: p };
        }
      }
      fn main() -> i32 { return 0; }
      `,
      "expected 'ref i32', got '*bool'"
    );
  });
});

describe("onCopy / onDestroy compiler builtins", () => {
  test("`onCopy(ptr)` type-checks when ptr is *T and T has __oncopy", () => {
    checkOk(`${STRUCT_DEFS}
      fn caller(p: *Bag) {
        unsafe { onCopy(p); }
      }
      fn main() -> i32 { return 0; }
    `);
  });

  test("`onDestroy(ptr)` type-checks when ptr is *T and T has __destroy", () => {
    checkOk(`${STRUCT_DEFS}
      fn caller(p: *Bag) {
        unsafe { onDestroy(p); }
      }
      fn main() -> i32 { return 0; }
    `);
  });

  test("`onCopy` outside `unsafe` is rejected", () => {
    checkError(
      `${STRUCT_DEFS}
        fn caller(p: *Bag) {
          onCopy(p);
        }
        fn main() -> i32 { return 0; }
      `,
      "'onCopy' requires unsafe"
    );
  });

  test("`onDestroy` outside `unsafe` is rejected", () => {
    checkError(
      `${STRUCT_DEFS}
        fn caller(p: *Bag) {
          onDestroy(p);
        }
        fn main() -> i32 { return 0; }
      `,
      "'onDestroy' requires unsafe"
    );
  });

  test("`onCopy(ptr)` where ptr's pointee has no __oncopy is rejected", () => {
    checkError(
      `
        struct Plain { n: i32; }
        fn caller(p: *Plain) {
          unsafe { onCopy(p); }
        }
        fn main() -> i32 { return 0; }
      `,
      "no '__oncopy' hook"
    );
  });

  test("`onCopy(ptr)` on a non-struct pointer is rejected", () => {
    checkError(
      `
        fn caller(p: *i32) {
          unsafe { onCopy(p); }
        }
        fn main() -> i32 { return 0; }
      `,
      "expects a pointer to a struct"
    );
  });

  test("`onCopy` lowers to a direct call to T___oncopy", () => {
    const fn = lowerFunction(
      `${STRUCT_DEFS}
      fn caller(p: *Bag) {
        unsafe { onCopy(p); }
      }
      fn main() -> i32 { return 0; }
    `,
      "caller"
    );
    let foundCall = false;
    for (const block of fn.blocks) {
      for (const inst of block.instructions) {
        if ((inst.kind === "call" || inst.kind === "call_void") && "func" in inst) {
          if (inst.func.endsWith("Bag___oncopy")) foundCall = true;
        }
      }
    }
    expect(foundCall).toBe(true);
  });

  test("`onDestroy` lowers to a direct call to T___destroy", () => {
    const fn = lowerFunction(
      `${STRUCT_DEFS}
      fn caller(p: *Bag) {
        unsafe { onDestroy(p); }
      }
      fn main() -> i32 { return 0; }
    `,
      "caller"
    );
    let foundCall = false;
    for (const block of fn.blocks) {
      for (const inst of block.instructions) {
        if ((inst.kind === "call" || inst.kind === "call_void") && "func" in inst) {
          if (inst.func.endsWith("Bag___destroy")) foundCall = true;
        }
      }
    }
    expect(foundCall).toBe(true);
  });
});
