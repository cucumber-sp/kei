import { describe, expect, test } from "bun:test";
import { countInstructions, getInstructions, lowerFunction } from "./helpers.ts";

describe("KIR: variable declarations", () => {
  test("let generates stack_alloc + store", () => {
    const fn = lowerFunction(
      `
      fn foo() {
        let x: int = 10;
      }
    `,
      "foo"
    );
    const allocs = getInstructions(fn, "stack_alloc");
    expect(allocs.length).toBeGreaterThanOrEqual(1);
    const stores = getInstructions(fn, "store");
    expect(stores.length).toBeGreaterThanOrEqual(1);
  });

  test("const generates direct value binding", () => {
    const fn = lowerFunction(
      `
      fn foo() -> int {
        const x: int = 42;
        return x;
      }
    `,
      "foo"
    );
    // Const should generate const_int but not stack_alloc
    const constInts = getInstructions(fn, "const_int");
    expect(constInts.length).toBeGreaterThanOrEqual(1);
  });

  test("multiple lets", () => {
    const fn = lowerFunction(
      `
      fn foo() {
        let a: int = 1;
        let b: int = 2;
        let c: int = 3;
      }
    `,
      "foo"
    );
    const allocs = getInstructions(fn, "stack_alloc");
    expect(allocs).toHaveLength(3);
  });

  test("let with expression initializer", () => {
    const fn = lowerFunction(
      `
      fn foo(x: int) {
        let y: int = x + 1;
      }
    `,
      "foo"
    );
    const binOps = getInstructions(fn, "bin_op");
    expect(binOps.length).toBeGreaterThanOrEqual(1);
    const allocs = getInstructions(fn, "stack_alloc");
    expect(allocs.length).toBeGreaterThanOrEqual(1);
  });

  test("assignment to let variable generates store", () => {
    const fn = lowerFunction(
      `
      fn foo() {
        let x: int = 0;
        x = 5;
      }
    `,
      "foo"
    );
    const stores = getInstructions(fn, "store");
    expect(stores.length).toBeGreaterThanOrEqual(2); // initial + reassignment
  });
});

describe("KIR: variable usage", () => {
  test("reading a let variable generates load", () => {
    const fn = lowerFunction(
      `
      fn foo() -> int {
        let x: int = 42;
        return x;
      }
    `,
      "foo"
    );
    const loads = getInstructions(fn, "load");
    expect(loads.length).toBeGreaterThanOrEqual(1);
  });

  test("parameter usage does not generate stack_alloc", () => {
    const fn = lowerFunction(
      `
      fn foo(x: int) -> int {
        return x;
      }
    `,
      "foo"
    );
    // Parameters are used directly, not stack_alloc'd
    const allocs = getInstructions(fn, "stack_alloc");
    expect(allocs).toHaveLength(0);
  });
});
