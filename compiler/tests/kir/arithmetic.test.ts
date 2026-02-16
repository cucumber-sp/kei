import { test, expect, describe } from "bun:test";
import { lowerFunction, getInstructions } from "./helpers.ts";
import type { KirBinOp, KirNeg, KirNot } from "../../src/kir/kir-types.ts";

describe("KIR: arithmetic expressions", () => {
  test("addition", () => {
    const fn = lowerFunction(`
      fn foo(a: int, b: int) -> int { return a + b; }
    `, "foo");
    const binOps = getInstructions(fn, "bin_op") as KirBinOp[];
    expect(binOps.length).toBeGreaterThanOrEqual(1);
    expect(binOps.some((op) => op.op === "add")).toBe(true);
  });

  test("subtraction", () => {
    const fn = lowerFunction(`
      fn foo(a: int, b: int) -> int { return a - b; }
    `, "foo");
    const binOps = getInstructions(fn, "bin_op") as KirBinOp[];
    expect(binOps.some((op) => op.op === "sub")).toBe(true);
  });

  test("multiplication", () => {
    const fn = lowerFunction(`
      fn foo(a: int, b: int) -> int { return a * b; }
    `, "foo");
    const binOps = getInstructions(fn, "bin_op") as KirBinOp[];
    expect(binOps.some((op) => op.op === "mul")).toBe(true);
  });

  test("division", () => {
    const fn = lowerFunction(`
      fn foo(a: int, b: int) -> int { return a / b; }
    `, "foo");
    const binOps = getInstructions(fn, "bin_op") as KirBinOp[];
    expect(binOps.some((op) => op.op === "div")).toBe(true);
  });

  test("modulo", () => {
    const fn = lowerFunction(`
      fn foo(a: int, b: int) -> int { return a % b; }
    `, "foo");
    const binOps = getInstructions(fn, "bin_op") as KirBinOp[];
    expect(binOps.some((op) => op.op === "mod")).toBe(true);
  });

  test("negation", () => {
    const fn = lowerFunction(`
      fn foo(x: int) -> int { return -x; }
    `, "foo");
    const negs = getInstructions(fn, "neg") as KirNeg[];
    expect(negs).toHaveLength(1);
  });

  test("nested arithmetic", () => {
    const fn = lowerFunction(`
      fn foo(a: int, b: int, c: int) -> int { return (a + b) * c; }
    `, "foo");
    const binOps = getInstructions(fn, "bin_op") as KirBinOp[];
    expect(binOps).toHaveLength(2);
    expect(binOps[0].op).toBe("add");
    expect(binOps[1].op).toBe("mul");
  });
});

describe("KIR: comparison expressions", () => {
  test("equal", () => {
    const fn = lowerFunction(`
      fn foo(a: int, b: int) -> bool { return a == b; }
    `, "foo");
    const binOps = getInstructions(fn, "bin_op") as KirBinOp[];
    expect(binOps.some((op) => op.op === "eq")).toBe(true);
  });

  test("not equal", () => {
    const fn = lowerFunction(`
      fn foo(a: int, b: int) -> bool { return a != b; }
    `, "foo");
    const binOps = getInstructions(fn, "bin_op") as KirBinOp[];
    expect(binOps.some((op) => op.op === "neq")).toBe(true);
  });

  test("less than", () => {
    const fn = lowerFunction(`
      fn foo(a: int, b: int) -> bool { return a < b; }
    `, "foo");
    const binOps = getInstructions(fn, "bin_op") as KirBinOp[];
    expect(binOps.some((op) => op.op === "lt")).toBe(true);
  });

  test("greater than", () => {
    const fn = lowerFunction(`
      fn foo(a: int, b: int) -> bool { return a > b; }
    `, "foo");
    const binOps = getInstructions(fn, "bin_op") as KirBinOp[];
    expect(binOps.some((op) => op.op === "gt")).toBe(true);
  });

  test("less or equal", () => {
    const fn = lowerFunction(`
      fn foo(a: int, b: int) -> bool { return a <= b; }
    `, "foo");
    const binOps = getInstructions(fn, "bin_op") as KirBinOp[];
    expect(binOps.some((op) => op.op === "lte")).toBe(true);
  });

  test("greater or equal", () => {
    const fn = lowerFunction(`
      fn foo(a: int, b: int) -> bool { return a >= b; }
    `, "foo");
    const binOps = getInstructions(fn, "bin_op") as KirBinOp[];
    expect(binOps.some((op) => op.op === "gte")).toBe(true);
  });
});

describe("KIR: logical expressions", () => {
  test("logical not", () => {
    const fn = lowerFunction(`
      fn foo(x: bool) -> bool { return !x; }
    `, "foo");
    const nots = getInstructions(fn, "not") as KirNot[];
    expect(nots).toHaveLength(1);
  });

  test("logical AND creates short-circuit blocks", () => {
    const fn = lowerFunction(`
      fn foo(a: bool, b: bool) -> bool { return a && b; }
    `, "foo");
    // Should create additional blocks for short-circuit
    expect(fn.blocks.length).toBeGreaterThan(1);
  });

  test("logical OR creates short-circuit blocks", () => {
    const fn = lowerFunction(`
      fn foo(a: bool, b: bool) -> bool { return a || b; }
    `, "foo");
    expect(fn.blocks.length).toBeGreaterThan(1);
  });
});

describe("KIR: bitwise expressions", () => {
  test("bitwise AND", () => {
    const fn = lowerFunction(`
      fn foo(a: int, b: int) -> int { return a & b; }
    `, "foo");
    const binOps = getInstructions(fn, "bin_op") as KirBinOp[];
    expect(binOps.some((op) => op.op === "bit_and")).toBe(true);
  });

  test("bitwise OR", () => {
    const fn = lowerFunction(`
      fn foo(a: int, b: int) -> int { return a | b; }
    `, "foo");
    const binOps = getInstructions(fn, "bin_op") as KirBinOp[];
    expect(binOps.some((op) => op.op === "bit_or")).toBe(true);
  });

  test("bitwise XOR", () => {
    const fn = lowerFunction(`
      fn foo(a: int, b: int) -> int { return a ^ b; }
    `, "foo");
    const binOps = getInstructions(fn, "bin_op") as KirBinOp[];
    expect(binOps.some((op) => op.op === "bit_xor")).toBe(true);
  });

  test("shift left", () => {
    const fn = lowerFunction(`
      fn foo(a: int, b: int) -> int { return a << b; }
    `, "foo");
    const binOps = getInstructions(fn, "bin_op") as KirBinOp[];
    expect(binOps.some((op) => op.op === "shl")).toBe(true);
  });

  test("shift right", () => {
    const fn = lowerFunction(`
      fn foo(a: int, b: int) -> int { return a >> b; }
    `, "foo");
    const binOps = getInstructions(fn, "bin_op") as KirBinOp[];
    expect(binOps.some((op) => op.op === "shr")).toBe(true);
  });

  test("bitwise NOT", () => {
    const fn = lowerFunction(`
      fn foo(x: int) -> int { return ~x; }
    `, "foo");
    const bitNots = getInstructions(fn, "bit_not");
    expect(bitNots).toHaveLength(1);
  });
});
