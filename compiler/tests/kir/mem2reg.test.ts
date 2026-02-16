import { test, expect, describe } from "bun:test";
import { lower, lowerFunction, getInstructions, countInstructions } from "./helpers.ts";
import { runMem2Reg } from "../../src/kir/mem2reg.ts";
import { printKir } from "../../src/kir/printer.ts";
import type { KirFunction, KirBlock, KirPhi } from "../../src/kir/kir-types.ts";

/** Lower source, run mem2reg, return module. */
function lowerOpt(source: string) {
  const mod = lower(source);
  return runMem2Reg(mod);
}

/** Lower source, run mem2reg, return named function. */
function lowerOptFunction(source: string, name: string): KirFunction {
  const mod = lowerOpt(source);
  const fn = mod.functions.find((f) => f.name === name);
  if (!fn) {
    const available = mod.functions.map((f) => f.name).join(", ");
    throw new Error(`Function '${name}' not found. Available: ${available}`);
  }
  return fn;
}

/** Count phi nodes across all blocks. */
function countPhis(fn: KirFunction): number {
  let count = 0;
  for (const block of fn.blocks) {
    count += block.phis.length;
  }
  return count;
}

/** Get all phi nodes from a function. */
function getPhis(fn: KirFunction): KirPhi[] {
  const result: KirPhi[] = [];
  for (const block of fn.blocks) {
    result.push(...block.phis);
  }
  return result;
}

/** Get phi nodes from a specific block. */
function getBlockPhis(fn: KirFunction, blockPrefix: string): KirPhi[] {
  const block = fn.blocks.find((b) => b.id.startsWith(blockPrefix));
  return block ? block.phis : [];
}

describe("mem2reg: simple variable (no phi needed)", () => {
  test("removes stack_alloc/load/store for simple let", () => {
    const fn = lowerOptFunction(`
      fn foo() -> int {
        let x: int = 42;
        return x;
      }
    `, "foo");

    // No stack_alloc, load, or store should remain for the promoted variable
    const allocs = getInstructions(fn, "stack_alloc");
    const loads = getInstructions(fn, "load");
    const stores = getInstructions(fn, "store");
    expect(allocs).toHaveLength(0);
    expect(loads).toHaveLength(0);
    expect(stores).toHaveLength(0);

    // No phi nodes needed (single block)
    expect(countPhis(fn)).toBe(0);
  });

  test("preserves const_int values through promotion", () => {
    const fn = lowerOptFunction(`
      fn foo() -> int {
        let x: int = 42;
        return x;
      }
    `, "foo");

    // The const_int 42 should still exist
    const constInts = getInstructions(fn, "const_int");
    expect(constInts.length).toBeGreaterThanOrEqual(1);

    // Return should reference the const directly (or through SSA)
    expect(fn.blocks[0].terminator.kind).toBe("ret");
  });

  test("sequential assignments without branches", () => {
    const fn = lowerOptFunction(`
      fn foo() -> int {
        let x: int = 1;
        x = 2;
        x = 3;
        return x;
      }
    `, "foo");

    const allocs = getInstructions(fn, "stack_alloc");
    expect(allocs).toHaveLength(0);
    expect(countPhis(fn)).toBe(0);
  });

  test("multiple variables, single block", () => {
    const fn = lowerOptFunction(`
      fn foo() -> int {
        let a: int = 10;
        let b: int = 20;
        return a + b;
      }
    `, "foo");

    const allocs = getInstructions(fn, "stack_alloc");
    expect(allocs).toHaveLength(0);
    expect(countPhis(fn)).toBe(0);
  });

  test("parameter usage unaffected", () => {
    const fn = lowerOptFunction(`
      fn foo(x: int) -> int {
        return x;
      }
    `, "foo");

    // Parameters aren't stack-allocated, so nothing to promote
    const allocs = getInstructions(fn, "stack_alloc");
    expect(allocs).toHaveLength(0);
    expect(countPhis(fn)).toBe(0);
  });
});

describe("mem2reg: if/else with phi nodes", () => {
  test("variable modified in both branches creates phi at merge", () => {
    const fn = lowerOptFunction(`
      fn foo(cond: bool) -> int {
        let x: int = 0;
        if cond {
          x = 1;
        } else {
          x = 2;
        }
        return x;
      }
    `, "foo");

    // stack_alloc/load/store for x should be removed
    const allocs = getInstructions(fn, "stack_alloc");
    expect(allocs).toHaveLength(0);

    // Should have a phi node at the merge block
    const phis = getPhis(fn);
    expect(phis.length).toBeGreaterThanOrEqual(1);

    // Phi should have 2 incoming values
    const phi = phis.find((p) => p.incoming.length === 2);
    expect(phi).toBeDefined();
  });

  test("variable only modified in one branch still needs phi", () => {
    const fn = lowerOptFunction(`
      fn foo(cond: bool) -> int {
        let x: int = 0;
        if cond {
          x = 1;
        }
        return x;
      }
    `, "foo");

    const allocs = getInstructions(fn, "stack_alloc");
    expect(allocs).toHaveLength(0);

    // Should have a phi at the merge point
    const phis = getPhis(fn);
    expect(phis.length).toBeGreaterThanOrEqual(1);
  });

  test("phi node has correct type", () => {
    const fn = lowerOptFunction(`
      fn foo(cond: bool) -> int {
        let x: int = 0;
        if cond {
          x = 1;
        } else {
          x = 2;
        }
        return x;
      }
    `, "foo");

    const phis = getPhis(fn);
    const phi = phis.find((p) => p.incoming.length === 2);
    expect(phi).toBeDefined();
    expect(phi!.type.kind).toBe("int");
  });
});

describe("mem2reg: while loop with phi nodes", () => {
  test("loop variable creates phi at loop header", () => {
    const fn = lowerOptFunction(`
      fn foo() -> int {
        let x: int = 0;
        while x < 10 {
          x = x + 1;
        }
        return x;
      }
    `, "foo");

    const allocs = getInstructions(fn, "stack_alloc");
    expect(allocs).toHaveLength(0);

    // Should have phi node(s) at the loop header
    const headerPhis = getBlockPhis(fn, "while.header");
    expect(headerPhis.length).toBeGreaterThanOrEqual(1);
  });

  test("loop phi has incoming from entry and back-edge", () => {
    const fn = lowerOptFunction(`
      fn foo() -> int {
        let x: int = 0;
        while x < 10 {
          x = x + 1;
        }
        return x;
      }
    `, "foo");

    const headerPhis = getBlockPhis(fn, "while.header");
    expect(headerPhis.length).toBeGreaterThanOrEqual(1);

    // The phi should have 2 incoming edges:
    // one from the pre-loop block, one from the loop body (back-edge)
    const phi = headerPhis[0];
    expect(phi.incoming).toHaveLength(2);
  });
});

describe("mem2reg: multiple variables with different liveness", () => {
  test("two variables, one modified in branch, one not", () => {
    const fn = lowerOptFunction(`
      fn foo(cond: bool) -> int {
        let x: int = 1;
        let y: int = 2;
        if cond {
          x = 10;
        }
        return x + y;
      }
    `, "foo");

    const allocs = getInstructions(fn, "stack_alloc");
    expect(allocs).toHaveLength(0);

    // Only x needs a phi, y doesn't
    const phis = getPhis(fn);
    expect(phis.length).toBeGreaterThanOrEqual(1);
  });

  test("variables with independent liveness", () => {
    const fn = lowerOptFunction(`
      fn foo(cond: bool) -> int {
        let a: int = 1;
        let b: int = 2;
        if cond {
          a = 10;
          b = 20;
        } else {
          a = 30;
          b = 40;
        }
        return a + b;
      }
    `, "foo");

    const allocs = getInstructions(fn, "stack_alloc");
    expect(allocs).toHaveLength(0);

    // Both a and b need phi nodes at the merge
    const phis = getPhis(fn);
    expect(phis.length).toBeGreaterThanOrEqual(2);
  });
});

describe("mem2reg: nested control flow", () => {
  test("nested if/else", () => {
    const fn = lowerOptFunction(`
      fn foo(a: bool, b: bool) -> int {
        let x: int = 0;
        if a {
          if b {
            x = 1;
          } else {
            x = 2;
          }
        } else {
          x = 3;
        }
        return x;
      }
    `, "foo");

    const allocs = getInstructions(fn, "stack_alloc");
    expect(allocs).toHaveLength(0);

    // Should have phi nodes at merge points
    const phis = getPhis(fn);
    expect(phis.length).toBeGreaterThanOrEqual(1);
  });

  test("if inside while loop", () => {
    const fn = lowerOptFunction(`
      fn foo() -> int {
        let x: int = 0;
        let i: int = 0;
        while i < 10 {
          if i == 5 {
            x = 100;
          }
          i = i + 1;
        }
        return x;
      }
    `, "foo");

    const allocs = getInstructions(fn, "stack_alloc");
    expect(allocs).toHaveLength(0);

    // Should have phi nodes
    const phis = getPhis(fn);
    expect(phis.length).toBeGreaterThanOrEqual(1);
  });
});

describe("mem2reg: variables only used in one branch (no phi needed)", () => {
  test("variable defined and used only in then branch", () => {
    const fn = lowerOptFunction(`
      fn foo(cond: bool) -> int {
        if cond {
          let x: int = 42;
          return x;
        }
        return 0;
      }
    `, "foo");

    const allocs = getInstructions(fn, "stack_alloc");
    expect(allocs).toHaveLength(0);

    // No phi needed since x doesn't escape its branch
    // (it's defined and used in the same block)
  });

  test("const variables are not stack-allocated", () => {
    const fn = lowerOptFunction(`
      fn foo() -> int {
        const x: int = 42;
        return x;
      }
    `, "foo");

    // Const vars use direct binding, no stack_alloc
    const allocs = getInstructions(fn, "stack_alloc");
    expect(allocs).toHaveLength(0);
    expect(countPhis(fn)).toBe(0);
  });
});

describe("mem2reg: printer output", () => {
  test("phi nodes print with φ syntax", () => {
    const mod = lowerOpt(`
      fn foo(cond: bool) -> int {
        let x: int = 0;
        if cond {
          x = 1;
        } else {
          x = 2;
        }
        return x;
      }
    `);

    const output = printKir(mod);
    // Should contain phi node syntax
    expect(output).toContain("φ");
    expect(output).toContain("from");
  });

  test("no stack_alloc/load/store in optimized output for simple case", () => {
    const mod = lowerOpt(`
      fn foo() -> int {
        let x: int = 42;
        return x;
      }
    `);

    const output = printKir(mod);
    expect(output).not.toContain("stack_alloc");
    expect(output).not.toContain("load ");
    expect(output).not.toContain("store ");
  });
});

describe("mem2reg: preserves non-promotable allocas", () => {
  test("struct field access preserves alloca (address-taken)", () => {
    const fn = lowerOptFunction(`
      struct Point {
        x: int;
        y: int;
      }
      fn foo() -> int {
        let p: Point = Point { x: 1, y: 2 };
        return p.x;
      }
    `, "foo");

    // Struct literal uses field_ptr, so p's alloca is address-taken
    // and should NOT be promoted (stack_alloc should remain)
    const allocs = getInstructions(fn, "stack_alloc");
    expect(allocs.length).toBeGreaterThanOrEqual(1);
  });
});

describe("mem2reg: idempotency", () => {
  test("running mem2reg twice produces same result", () => {
    const source = `
      fn foo(cond: bool) -> int {
        let x: int = 0;
        if cond {
          x = 1;
        } else {
          x = 2;
        }
        return x;
      }
    `;
    const mod1 = lowerOpt(source);
    const output1 = printKir(mod1);

    // Run mem2reg again on the already-optimized module
    const mod2 = runMem2Reg(mod1);
    const output2 = printKir(mod2);

    expect(output2).toBe(output1);
  });
});

describe("mem2reg: function with no promotable allocas", () => {
  test("function with only params returns unchanged", () => {
    const fn = lowerOptFunction(`
      fn add(a: int, b: int) -> int {
        return a + b;
      }
    `, "add");

    // No allocas to promote, function should be basically unchanged
    const allocs = getInstructions(fn, "stack_alloc");
    expect(allocs).toHaveLength(0);
    expect(countPhis(fn)).toBe(0);
  });

  test("empty function", () => {
    const fn = lowerOptFunction(`fn noop() {}`, "noop");
    expect(fn.blocks).toHaveLength(1);
    expect(countPhis(fn)).toBe(0);
  });
});

describe("mem2reg: compound assignment", () => {
  test("compound assignment in loop", () => {
    const fn = lowerOptFunction(`
      fn sum() -> int {
        let total: int = 0;
        let i: int = 0;
        while i < 5 {
          total += i;
          i += 1;
        }
        return total;
      }
    `, "sum");

    const allocs = getInstructions(fn, "stack_alloc");
    expect(allocs).toHaveLength(0);

    // Loop header should have phi nodes for both total and i
    const headerPhis = getBlockPhis(fn, "while.header");
    expect(headerPhis.length).toBeGreaterThanOrEqual(2);
  });
});
