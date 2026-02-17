import { describe, expect, test } from "bun:test";
import {
  countInstructions,
  getInstructions,
  getTerminators,
  lower,
  lowerAndPrint,
  lowerFunction,
} from "./helpers.ts";

describe("KIR: basic function lowering", () => {
  test("empty void function", () => {
    const fn = lowerFunction(`fn foo() {}`, "foo");
    expect(fn.name).toBe("foo");
    expect(fn.params).toHaveLength(0);
    expect(fn.returnType).toEqual({ kind: "void" });
    expect(fn.blocks).toHaveLength(1);
    expect(fn.blocks[0].id).toBe("entry");
    expect(fn.blocks[0].terminator.kind).toBe("ret_void");
  });

  test("function with int return", () => {
    const fn = lowerFunction(`fn foo() -> int { return 42; }`, "foo");
    expect(fn.returnType).toEqual({ kind: "int", bits: 32, signed: true });
    expect(fn.blocks[0].terminator.kind).toBe("ret");
  });

  test("function with parameters", () => {
    const fn = lowerFunction(`fn add(a: int, b: int) -> int { return a + b; }`, "add");
    expect(fn.params).toHaveLength(2);
    expect(fn.params[0].name).toBe("a");
    expect(fn.params[0].type).toEqual({ kind: "int", bits: 32, signed: true });
    expect(fn.params[1].name).toBe("b");
  });

  test("entry block is first", () => {
    const fn = lowerFunction(`fn main() -> int { return 0; }`, "main");
    expect(fn.blocks[0].id).toBe("entry");
  });

  test("module contains all functions", () => {
    const mod = lower(`
      fn foo() {}
      fn bar() -> int { return 1; }
      fn baz(x: int) -> int { return x; }
    `);
    expect(mod.functions).toHaveLength(3);
    expect(mod.functions.map((f) => f.name)).toEqual(["foo", "bar", "baz"]);
  });

  test("module name", () => {
    const mod = lower(`fn main() {}`);
    expect(mod.name).toBe("main");
  });
});

describe("KIR: return statements", () => {
  test("return void", () => {
    const fn = lowerFunction(`fn foo() {}`, "foo");
    const rets = getTerminators(fn, "ret_void");
    expect(rets.length).toBeGreaterThanOrEqual(1);
  });

  test("return integer constant", () => {
    const fn = lowerFunction(`fn foo() -> int { return 42; }`, "foo");
    const rets = getTerminators(fn, "ret");
    expect(rets).toHaveLength(1);
    // Should have a const_int instruction
    const constInts = getInstructions(fn, "const_int");
    expect(constInts.length).toBeGreaterThanOrEqual(1);
  });

  test("return expression", () => {
    const fn = lowerFunction(`fn foo(x: int) -> int { return x + 1; }`, "foo");
    const binOps = getInstructions(fn, "bin_op");
    expect(binOps.length).toBeGreaterThanOrEqual(1);
  });
});
