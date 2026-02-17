import { describe, expect, test } from "bun:test";
import { runDeSsa } from "../../src/backend/de-ssa.ts";
import type { KirFunction, KirModule, KirType, VarId } from "../../src/kir/kir-types.ts";
import { runMem2Reg } from "../../src/kir/mem2reg.ts";
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
        0
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

  test("skips self-copies (dest === src)", () => {
    const source = `
      fn test(x: int) -> int {
        let a: int = x;
        if x > 0 {
          a = 1;
        }
        return a;
      }
    `;
    const mod = lowerAndDeSsa(source);
    const fn = getFunction(mod, "test");

    for (const block of fn.blocks) {
      expect(block.phis.length).toBe(0);
    }
  });

  test("updates localCount after inserting temporaries", () => {
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
    let mod = lower(source);
    mod = runMem2Reg(mod);
    const beforeCount = getFunction(mod, "test").localCount;
    mod = runDeSsa(mod);
    const afterCount = getFunction(mod, "test").localCount;

    // localCount should be >= beforeCount (may have added temporaries)
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount);
  });
});

describe("de-ssa: lost-copy regression", () => {
  test("handles interfering phi copies correctly with temporaries", () => {
    // Construct a synthetic KIR module with two phis where one phi's
    // dest is the other phi's source from the same predecessor.
    // This is the classic lost-copy scenario:
    //   %a = φ [%x from bb0]
    //   %b = φ [%a from bb0]   ← %a here means the OLD %a, not the one just assigned
    const i32: KirType = { kind: "int", bits: 32, signed: true };
    const mod: KirModule = {
      name: "test",
      globals: [],
      types: [],
      externs: [],
      functions: [
        {
          name: "test",
          params: [],
          returnType: i32,
          localCount: 5,
          blocks: [
            {
              id: "entry",
              phis: [],
              instructions: [
                { kind: "const_int", dest: "%0", type: i32, value: 10 },
                { kind: "const_int", dest: "%1", type: i32, value: 20 },
              ],
              terminator: { kind: "jump", target: "merge" },
            },
            {
              id: "merge",
              phis: [
                {
                  dest: "%2" as VarId,
                  type: i32,
                  incoming: [{ value: "%0" as VarId, from: "entry" }],
                },
                {
                  dest: "%3" as VarId,
                  type: i32,
                  incoming: [{ value: "%2" as VarId, from: "entry" }],
                },
              ],
              instructions: [
                {
                  kind: "bin_op",
                  op: "add" as const,
                  dest: "%4" as VarId,
                  lhs: "%2" as VarId,
                  rhs: "%3" as VarId,
                  type: i32,
                },
              ],
              terminator: { kind: "ret", value: "%4" as VarId },
            },
          ],
        },
      ],
    };

    const result = runDeSsa(mod);
    const fn = result.functions[0];
    // biome-ignore lint/style/noNonNullAssertion: test setup guarantees entry block exists
    const entryBlock = fn.blocks.find((b) => b.id === "entry")!;

    // Should have no phis remaining
    for (const block of fn.blocks) {
      expect(block.phis.length).toBe(0);
    }

    // The entry block should have a temporary save for %2 since it's
    // both a phi dest and a phi source from the same predecessor.
    // Look for: temp = %2 (save), %2 = %0 (copy), %3 = temp (copy)
    const casts = entryBlock.instructions.filter((i) => i.kind === "cast");
    expect(casts.length).toBeGreaterThanOrEqual(2);

    // Verify the second copy (%3 = ...) doesn't directly reference %2,
    // because %2 gets overwritten. It should use a temp instead.
    const copyForB = casts.find((i) => i.kind === "cast" && i.dest === "%3");
    expect(copyForB).toBeDefined();
    if (copyForB && copyForB.kind === "cast") {
      // The source should be a temp variable (not %2 directly, since
      // %2 would have been overwritten by the earlier copy)
      expect(copyForB.value).not.toBe("%2");
    }
  });

  test("no temp needed when phi copies don't interfere", () => {
    // Two independent phis — no interference, no temps needed
    const i32: KirType = { kind: "int", bits: 32, signed: true };
    const mod: KirModule = {
      name: "test",
      globals: [],
      types: [],
      externs: [],
      functions: [
        {
          name: "test",
          params: [],
          returnType: i32,
          localCount: 6,
          blocks: [
            {
              id: "entry",
              phis: [],
              instructions: [
                { kind: "const_int", dest: "%0", type: i32, value: 10 },
                { kind: "const_int", dest: "%1", type: i32, value: 20 },
              ],
              terminator: { kind: "jump", target: "merge" },
            },
            {
              id: "merge",
              phis: [
                {
                  dest: "%2" as VarId,
                  type: i32,
                  incoming: [{ value: "%0" as VarId, from: "entry" }],
                },
                {
                  dest: "%3" as VarId,
                  type: i32,
                  incoming: [{ value: "%1" as VarId, from: "entry" }],
                },
              ],
              instructions: [
                {
                  kind: "bin_op",
                  op: "add" as const,
                  dest: "%4" as VarId,
                  lhs: "%2" as VarId,
                  rhs: "%3" as VarId,
                  type: i32,
                },
              ],
              terminator: { kind: "ret", value: "%4" as VarId },
            },
          ],
        },
      ],
    };

    const result = runDeSsa(mod);
    const fn = result.functions[0];
    // biome-ignore lint/style/noNonNullAssertion: test setup guarantees entry block exists
    const entryBlock = fn.blocks.find((b) => b.id === "entry")!;

    // No temps needed — localCount should stay the same
    expect(fn.localCount).toBe(6);

    // Should have exactly 2 cast instructions (one per phi, no temps)
    const casts = entryBlock.instructions.filter((i) => i.kind === "cast");
    expect(casts.length).toBe(2);
  });
});
