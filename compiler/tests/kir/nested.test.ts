import { test, expect, describe } from "bun:test";
import { lowerFunction, getInstructions, getTerminators, countInstructions } from "./helpers.ts";
import type { KirBinOp } from "../../src/kir/kir-types.ts";

describe("KIR: nested expressions", () => {
  test("deeply nested arithmetic", () => {
    const fn = lowerFunction(`
      fn foo(a: int, b: int, c: int, d: int) -> int {
        return ((a + b) * (c - d)) / (a + 1);
      }
    `, "foo");
    const binOps = getInstructions(fn, "bin_op") as KirBinOp[];
    // a+b, c-d, multiply, a+1, divide = 5 ops
    expect(binOps).toHaveLength(5);
    expect(binOps[0].op).toBe("add"); // a + b
    expect(binOps[1].op).toBe("sub"); // c - d
    expect(binOps[2].op).toBe("mul"); // *
    expect(binOps[3].op).toBe("add"); // a + 1
    expect(binOps[4].op).toBe("div"); // /
  });

  test("expression with function call and arithmetic", () => {
    const fn = lowerFunction(`
      fn dbl(x: int) -> int { return x * 2; }
      fn foo(a: int) -> int {
        return dbl(a) + dbl(a + 1);
      }
    `, "foo");
    const calls = getInstructions(fn, "call");
    expect(calls).toHaveLength(2);
    const binOps = getInstructions(fn, "bin_op") as KirBinOp[];
    expect(binOps.length).toBeGreaterThanOrEqual(1);
  });

  test("compound assignment", () => {
    const fn = lowerFunction(`
      fn foo() -> int {
        let x: int = 10;
        x += 5;
        return x;
      }
    `, "foo");
    const binOps = getInstructions(fn, "bin_op") as KirBinOp[];
    expect(binOps.some((op) => op.op === "add")).toBe(true);
    const stores = getInstructions(fn, "store");
    expect(stores.length).toBeGreaterThanOrEqual(2); // initial + compound assign
  });

  test("multiple compound assignments", () => {
    const fn = lowerFunction(`
      fn foo() -> int {
        let x: int = 100;
        x += 10;
        x -= 5;
        x *= 2;
        return x;
      }
    `, "foo");
    const binOps = getInstructions(fn, "bin_op") as KirBinOp[];
    const ops = binOps.map((op) => op.op);
    expect(ops).toContain("add");
    expect(ops).toContain("sub");
    expect(ops).toContain("mul");
  });

  test("if inside while loop", () => {
    const fn = lowerFunction(`
      fn foo() -> int {
        let x: int = 0;
        let sum: int = 0;
        while x < 10 {
          if x % 2 == 0 {
            sum += x;
          }
          x += 1;
        }
        return sum;
      }
    `, "foo");
    // Should have while blocks and if blocks
    const whileHeader = fn.blocks.find((b) => b.id.startsWith("while.header"));
    const ifThen = fn.blocks.find((b) => b.id.startsWith("if.then"));
    expect(whileHeader).toBeDefined();
    expect(ifThen).toBeDefined();
  });
});

describe("KIR: extern declarations", () => {
  test("extern function creates extern entry", () => {
    const mod = require("./helpers.ts").lower(`
      extern fn c_puts(s: string) -> void;
      fn foo() {}
    `);
    expect(mod.externs).toHaveLength(1);
    expect(mod.externs[0].name).toBe("c_puts");
    expect(mod.externs[0].params).toHaveLength(1);
    expect(mod.externs[0].returnType).toEqual({ kind: "void" });
  });
});

describe("KIR: enum declarations", () => {
  test("enum generates type decl", () => {
    const mod = require("./helpers.ts").lower(`
      enum Color {
        Red;
        Green;
        Blue;
      }
      fn foo() {}
    `);
    expect(mod.types).toHaveLength(1);
    expect(mod.types[0].name).toBe("Color");
    expect(mod.types[0].type.kind).toBe("enum");
  });
});

describe("KIR: printer output", () => {
  test("basic function prints correctly", () => {
    const output = require("./helpers.ts").lowerAndPrint(`
      fn main() -> int {
        return 0;
      }
    `);
    expect(output).toContain("module main");
    expect(output).toContain("fn main(): i32 {");
    expect(output).toContain("entry:");
    expect(output).toContain("const_int");
    expect(output).toContain("ret ");
  });

  test("struct type prints correctly", () => {
    const output = require("./helpers.ts").lowerAndPrint(`
      struct Point {
        x: int;
        y: int;
      }
      fn foo() {}
    `);
    expect(output).toContain("type Point = struct {");
    expect(output).toContain("x: i32");
    expect(output).toContain("y: i32");
  });

  test("extern prints correctly", () => {
    const output = require("./helpers.ts").lowerAndPrint(`
      extern fn puts(s: string) -> void;
      fn foo() {}
    `);
    expect(output).toContain("extern fn puts(s: string): void");
  });
});
