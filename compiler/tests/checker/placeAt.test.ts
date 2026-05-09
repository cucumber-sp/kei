import { describe, expect, test } from "bun:test";
import { lowerFunction } from "../kir/helpers";
import { checkOk } from "./helpers";

const PLACE_AT_DEFS = `
extern fn memcpy(dest: *u8, src: *u8, n: usize) -> *u8;

pub fn placeAt<T>(dest: *T, src: ref T) {
    unsafe {
        memcpy(dest as *u8, src as *u8, sizeof(T));
        onCopy(dest);
    }
}
`;

describe("placeAt<T> stdlib helper", () => {
  test("placeAt type-checks with a struct that has __oncopy", () => {
    checkOk(`${PLACE_AT_DEFS}
      unsafe struct Bag {
        n: i32;
        fn __destroy(self: ref Bag) {}
        fn __oncopy(self: ref Bag) {}
      }
      fn caller(p: *Bag, item: ref Bag) {
        unsafe { placeAt<Bag>(p, item); }
      }
      fn main() -> i32 { return 0; }
    `);
  });

  test("placeAt's body uses memcpy + onCopy", () => {
    const fn = lowerFunction(
      `${PLACE_AT_DEFS}
      unsafe struct Bag {
        n: i32;
        fn __destroy(self: ref Bag) {}
        fn __oncopy(self: ref Bag) {}
      }
      fn caller(p: *Bag, item: ref Bag) {
        unsafe { placeAt<Bag>(p, item); }
      }
      fn main() -> i32 { return 0; }
    `,
      "placeAt_Bag"
    );
    let memcpyCall = false;
    let oncopyCall = false;
    for (const block of fn.blocks) {
      for (const inst of block.instructions) {
        if (
          (inst.kind === "call" ||
            inst.kind === "call_void" ||
            inst.kind === "call_extern" ||
            inst.kind === "call_extern_void") &&
          "func" in inst
        ) {
          if (inst.func === "memcpy") memcpyCall = true;
          if (inst.func.endsWith("Bag___oncopy")) oncopyCall = true;
        }
      }
    }
    expect(memcpyCall).toBe(true);
    expect(oncopyCall).toBe(true);
  });
});
