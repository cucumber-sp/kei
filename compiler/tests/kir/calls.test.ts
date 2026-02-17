import { describe, expect, test } from "bun:test";
import type { KirCall, KirCallVoid } from "../../src/kir/kir-types.ts";
import { getInstructions, lowerFunction } from "./helpers.ts";

describe("KIR: function calls", () => {
  test("void function call generates call_void", () => {
    const fn = lowerFunction(
      `
      fn bar() {}
      fn foo() {
        bar();
      }
    `,
      "foo"
    );
    const callVoids = getInstructions(fn, "call_void") as KirCallVoid[];
    expect(callVoids.length).toBeGreaterThanOrEqual(1);
    expect(callVoids[0].func).toBe("bar");
  });

  test("function call with return generates call", () => {
    const fn = lowerFunction(
      `
      fn bar() -> int { return 42; }
      fn foo() -> int {
        return bar();
      }
    `,
      "foo"
    );
    const calls = getInstructions(fn, "call") as KirCall[];
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0].func).toBe("bar");
  });

  test("function call with arguments", () => {
    const fn = lowerFunction(
      `
      fn add(a: int, b: int) -> int { return a + b; }
      fn foo() -> int {
        return add(1, 2);
      }
    `,
      "foo"
    );
    const calls = getInstructions(fn, "call") as KirCall[];
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0].args).toHaveLength(2);
  });

  test("nested function calls", () => {
    const fn = lowerFunction(
      `
      fn dbl(x: int) -> int { return x * 2; }
      fn foo() -> int {
        return dbl(dbl(5));
      }
    `,
      "foo"
    );
    const calls = getInstructions(fn, "call") as KirCall[];
    expect(calls).toHaveLength(2);
  });

  test("call result used in expression", () => {
    const fn = lowerFunction(
      `
      fn getVal() -> int { return 10; }
      fn foo() -> int {
        let x: int = getVal() + 1;
        return x;
      }
    `,
      "foo"
    );
    const calls = getInstructions(fn, "call") as KirCall[];
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const binOps = getInstructions(fn, "bin_op");
    expect(binOps.length).toBeGreaterThanOrEqual(1);
  });
});
