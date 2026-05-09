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
