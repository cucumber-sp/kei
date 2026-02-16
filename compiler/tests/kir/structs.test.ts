import { test, expect, describe } from "bun:test";
import { lower, lowerFunction, getInstructions } from "./helpers.ts";
import type { KirFieldPtr, KirStackAlloc, KirStore } from "../../src/kir/kir-types.ts";

describe("KIR: struct type declarations", () => {
  test("struct declaration generates type decl", () => {
    const mod = lower(`
      struct Point {
        x: int;
        y: int;
      }
      fn foo() {}
    `);
    expect(mod.types).toHaveLength(1);
    expect(mod.types[0].name).toBe("Point");
    expect(mod.types[0].type.kind).toBe("struct");
    if (mod.types[0].type.kind === "struct") {
      expect(mod.types[0].type.fields).toHaveLength(2);
      expect(mod.types[0].type.fields[0].name).toBe("x");
      expect(mod.types[0].type.fields[1].name).toBe("y");
    }
  });
});

describe("KIR: struct literals", () => {
  test("struct literal generates stack_alloc + field_ptr + store", () => {
    const fn = lowerFunction(`
      struct Point {
        x: int;
        y: int;
      }
      fn foo() {
        let p: Point = Point { x: 10, y: 20 };
      }
    `, "foo");
    // stack_alloc for the struct literal + let binding
    const allocs = getInstructions(fn, "stack_alloc") as KirStackAlloc[];
    expect(allocs.length).toBeGreaterThanOrEqual(1);

    // field_ptr for each field
    const fieldPtrs = getInstructions(fn, "field_ptr") as KirFieldPtr[];
    expect(fieldPtrs.length).toBeGreaterThanOrEqual(2);
    const fieldNames = fieldPtrs.map((fp) => fp.field);
    expect(fieldNames).toContain("x");
    expect(fieldNames).toContain("y");

    // stores for field values
    const stores = getInstructions(fn, "store") as KirStore[];
    expect(stores.length).toBeGreaterThanOrEqual(2);
  });
});

describe("KIR: struct field access", () => {
  test("field access generates field_ptr + load", () => {
    const fn = lowerFunction(`
      struct Point {
        x: int;
        y: int;
      }
      fn foo() -> int {
        let p: Point = Point { x: 10, y: 20 };
        return p.x;
      }
    `, "foo");
    const fieldPtrs = getInstructions(fn, "field_ptr") as KirFieldPtr[];
    // At least field_ptrs from struct literal + field access
    expect(fieldPtrs.length).toBeGreaterThanOrEqual(3);
    // The last field_ptr should be for the .x access
    const xAccess = fieldPtrs.find(
      (fp) => fp.field === "x" && fieldPtrs.indexOf(fp) >= 2
    );
    expect(xAccess).toBeDefined();

    const loads = getInstructions(fn, "load");
    expect(loads.length).toBeGreaterThanOrEqual(1);
  });
});
