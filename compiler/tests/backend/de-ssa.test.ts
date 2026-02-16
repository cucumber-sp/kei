import { test, expect, describe } from "bun:test";
import { runDeSsa } from "../../src/backend/de-ssa.ts";
import { runMem2Reg } from "../../src/kir/mem2reg.ts";
import type { KirModule, KirFunction, KirBlock, KirPhi } from "../../src/kir/kir-types.ts";
import { lower } from "../kir/helpers.ts";

/** Lower source, run mem2reg (to get phis), then run de-ssa */
function lowerAndDeSsa(source: string): KirModule {
  let mod = lower(source);
  mod = runMem2Reg(mod);
  mod = runDeSsa(mod);
  return mod;
}

function getFunction(mod: KirModule, name: string): KirFunction {
  const fn = mod.functions.find((f) => f.name === name);
  if (!fn) throw new Error(`Function '${name}' not found`);
  return fn;
}

describe("de-ssa", () => {
  test("removes all phi nodes", () => {
    const source = `
      fn test(x: int) -> int {
        let result: int = 0;
        if x > 0 {
          result = x;
        } else {
          result = -x;
        }
        return result;
      }
    `;
    const mod = lowerAndDeSsa(source);
    const fn = getFunction(mod, "test");

    // No block should have phi nodes
    for (const block of fn.blocks) {
      expect(block.phis.length).toBe(0);
    }
  });

  test("inserts copy instructions in predecessor blocks", () => {
    const source = `
      fn test(x: int) -> int {
        let result: int = 0;
        if x > 0 {
          result = 1;
        } else {
          result = 2;
        }
        return result;
      }
    `;

    // First get the mem2reg'd version to see if there are phis
    let mod = lower(source);
    mod = runMem2Reg(mod);
    const fnWithPhis = getFunction(mod, "test");
    const totalPhis = fnWithPhis.blocks.reduce((sum, b) => sum + b.phis.length, 0);

    // Run de-ssa
    const deSsaMod = runDeSsa(mod);
    const fn = getFunction(deSsaMod, "test");

    // All phis should be gone
    for (const block of fn.blocks) {
      expect(block.phis.length).toBe(0);
    }

    // If there were phis, there should be cast (copy) instructions added
    if (totalPhis > 0) {
      const totalCasts = fn.blocks.reduce(
        (sum, b) => sum + b.instructions.filter((i) => i.kind === "cast").length,
        0,
      );
      expect(totalCasts).toBeGreaterThan(0);
    }
  });

  test("handles function with no phi nodes (no-op)", () => {
    const source = `
      fn simple() -> int {
        return 42;
      }
    `;
    const mod = lowerAndDeSsa(source);
    const fn = getFunction(mod, "simple");

    // Should still work fine
    expect(fn.blocks.length).toBeGreaterThan(0);
    for (const block of fn.blocks) {
      expect(block.phis.length).toBe(0);
    }
  });

  test("handles multiple phi nodes in same block", () => {
    const source = `
      fn test(x: int) -> int {
        let a: int = 0;
        let b: int = 0;
        if x > 0 {
          a = 1;
          b = 2;
        } else {
          a = 3;
          b = 4;
        }
        return a + b;
      }
    `;
    const mod = lowerAndDeSsa(source);
    const fn = getFunction(mod, "test");

    for (const block of fn.blocks) {
      expect(block.phis.length).toBe(0);
    }
  });

  test("preserves function structure", () => {
    const source = `
      fn add(a: int, b: int) -> int {
        return a + b;
      }
    `;
    const mod = lowerAndDeSsa(source);
    const fn = getFunction(mod, "add");

    expect(fn.name).toBe("add");
    expect(fn.params.length).toBe(2);
    expect(fn.blocks.length).toBeGreaterThan(0);
  });

  test("handles loop-generated phis", () => {
    const source = `
      fn sum(n: int) -> int {
        let total: int = 0;
        let i: int = 0;
        while i < n {
          total = total + i;
          i = i + 1;
        }
        return total;
      }
    `;
    const mod = lowerAndDeSsa(source);
    const fn = getFunction(mod, "sum");

    for (const block of fn.blocks) {
      expect(block.phis.length).toBe(0);
    }
  });
});
