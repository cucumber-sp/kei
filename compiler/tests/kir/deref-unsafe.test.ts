import { describe, expect, test } from "bun:test";
import { getInstructions, lowerFunction } from "./helpers";

describe.skip("KIR: deref and unsafe expressions", () => {
  test("*p emits load with the pointee type", () => {
    const fn = lowerFunction(
      `
      fn read(p: ptr<i32>) -> i32 {
        return unsafe { *p };
      }
    `,
      "read"
    );

    const loads = getInstructions(fn, "load");
    expect(loads).toHaveLength(1);

    const [load] = loads;
    expect(load).toBeDefined();
    if (!load || load.kind !== "load") {
      throw new Error("expected a load instruction");
    }

    expect(load.ptr).toBe("%p");
    expect(load.type).toEqual({ kind: "int", bits: 32, signed: true });
  });

  test("unsafe { expr } lowers like the bare expression", () => {
    const bare = lowerFunction(
      `
      fn bare(x: i32) -> i32 {
        return x;
      }
    `,
      "bare"
    );
    const wrapped = lowerFunction(
      `
      fn wrapped(x: i32) -> i32 {
        return unsafe { x };
      }
    `,
      "wrapped"
    );

    expect(bare.blocks).toHaveLength(1);
    expect(wrapped.blocks).toHaveLength(1);

    expect(bare.blocks[0]?.instructions).toEqual(wrapped.blocks[0]?.instructions);
    expect(bare.blocks[0]?.terminator).toEqual(wrapped.blocks[0]?.terminator);
  });

  test("unsafe { *p } emits the nested dereference load", () => {
    const fn = lowerFunction(
      `
      fn read_nested(p: ptr<i32>) -> i32 {
        return unsafe { *p };
      }
    `,
      "read_nested"
    );

    const loads = getInstructions(fn, "load");
    expect(loads).toHaveLength(1);

    const [load] = loads;
    expect(load).toBeDefined();
    if (!load || load.kind !== "load") {
      throw new Error("expected a load instruction");
    }

    expect(load.ptr).toBe("%p");
  });
});
