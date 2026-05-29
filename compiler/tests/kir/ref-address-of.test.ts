import { describe, expect, test } from "bun:test";
import type { KirFieldPtr, KirLoad } from "../../src/kir/kir-types";
import { getInstructions, lowerFunction } from "./helpers";

describe("KIR: address-of on ref values", () => {
  test("`&item` for a ref parameter returns the bound pointer without loading the value", () => {
    const fn = lowerFunction(
      `
      fn raw(item: ref i32) -> *i32 {
        unsafe { return &item; }
      }
      fn main() -> int { return 0; }
    `,
      "raw"
    );

    expect(fn.blocks[0]?.instructions).toEqual([]);
    expect(fn.blocks[0]?.terminator).toEqual({ kind: "ret", value: "%item" });
  });

  test("`&self.field` for a ref field loads only the bound pointer", () => {
    const fn = lowerFunction(
      `
      unsafe struct Bag {
        payload: ref i32;
        fn __destroy(self: ref Bag) {}
        fn __oncopy(self: ref Bag) {}
        fn raw(self: ref Bag) -> *i32 {
          unsafe { return &self.payload; }
        }
      }
      fn main() -> int { return 0; }
    `,
      "Bag_raw"
    );

    const fieldPtrs = getInstructions(fn, "field_ptr") as KirFieldPtr[];
    expect(fieldPtrs).toEqual([
      {
        kind: "field_ptr",
        dest: "%0",
        base: "%self",
        field: "payload",
        type: { kind: "ptr", pointee: { kind: "int", bits: 32, signed: true } },
      },
    ]);

    const loads = getInstructions(fn, "load") as KirLoad[];
    expect(loads).toEqual([
      {
        kind: "load",
        dest: "%1",
        ptr: "%0",
        type: { kind: "ptr", pointee: { kind: "int", bits: 32, signed: true } },
      },
    ]);
    expect(fn.blocks[0]?.terminator).toEqual({ kind: "ret", value: "%1" });
  });
});
