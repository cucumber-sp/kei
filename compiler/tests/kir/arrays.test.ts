import { describe, expect, test } from "bun:test";
import { countInstructions, getInstructions, lower, lowerFunction } from "./helpers.ts";

describe("KIR — Array Literals", () => {
  test("array literal emits stack_alloc with array type", () => {
    const fn = lowerFunction(
      `
      fn main() -> int {
        let arr = [1, 2, 3];
        return 0;
      }
    `,
      "main"
    );

    const allocs = getInstructions(fn, "stack_alloc");
    const arrayAlloc = allocs.find((i) => i.kind === "stack_alloc" && i.type.kind === "array");
    expect(arrayAlloc).toBeDefined();
    if (arrayAlloc?.kind === "stack_alloc" && arrayAlloc.type.kind === "array") {
      expect(arrayAlloc.type.length).toBe(3);
      expect(arrayAlloc.type.element.kind).toBe("int");
    }
  });

  test("array literal emits index_ptr + store for each element", () => {
    const fn = lowerFunction(
      `
      fn main() -> int {
        let arr = [10, 20, 30];
        return 0;
      }
    `,
      "main"
    );

    // 3 elements → 3 index_ptr instructions for storing
    const indexPtrs = getInstructions(fn, "index_ptr");
    expect(indexPtrs.length).toBeGreaterThanOrEqual(3);

    const stores = getInstructions(fn, "store");
    expect(stores.length).toBeGreaterThanOrEqual(3);
  });

  test("array index access emits bounds_check", () => {
    const fn = lowerFunction(
      `
      fn main() -> int {
        let arr = [1, 2, 3];
        let x = arr[0];
        return 0;
      }
    `,
      "main"
    );

    const boundsChecks = getInstructions(fn, "bounds_check");
    expect(boundsChecks.length).toBeGreaterThanOrEqual(1);
  });

  test("array .len emits const_int with array length", () => {
    const fn = lowerFunction(
      `
      fn main() -> int {
        let arr = [1, 2, 3, 4, 5];
        let n = arr.len;
        return 0;
      }
    `,
      "main"
    );

    // Should have a const_int with value 5 for the len
    const constInts = getInstructions(fn, "const_int");
    const lenConst = constInts.find((i) => i.kind === "const_int" && i.value === 5);
    expect(lenConst).toBeDefined();
  });

  test("array index assignment emits index_ptr + store", () => {
    const fn = lowerFunction(
      `
      fn main() -> int {
        let arr = [0, 0, 0];
        arr[1] = 42;
        return 0;
      }
    `,
      "main"
    );

    // Should have index_ptr instructions for both init and assignment
    const indexPtrs = getInstructions(fn, "index_ptr");
    expect(indexPtrs.length).toBeGreaterThanOrEqual(4); // 3 for init + 1 for assignment
  });
});
