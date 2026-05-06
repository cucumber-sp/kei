/**
 * Type-checker tests for the `inline<T, N>` fixed-size value-type array.
 * Covers source-level type resolution, length validation, and assignability.
 */

import { describe, expect, test } from "bun:test";
import type { Type } from "../../src/checker/types";
import { checkSource } from "../helpers/pipeline";
import { checkError, checkOk } from "./helpers";

function typeOfLet(source: string, varName: string): Type {
  const { program, result } = checkSource(source);
  const mainDecl = program.declarations[0];
  if (mainDecl?.kind !== "FunctionDecl") throw new Error("Expected FunctionDecl");
  for (const stmt of mainDecl.body.statements) {
    if (stmt.kind === "LetStmt" && stmt.name === varName) {
      const type = result.types.typeMap.get(stmt.initializer);
      if (type) return type;
    }
  }
  throw new Error(`Let binding '${varName}' not found`);
}

describe("Checker — inline<T, N> resolution", () => {
  test("`inline<int, 5>` resolves to array kind with length 5", () => {
    const src = "fn main() -> int { let a: inline<int, 5> = [1, 2, 3, 4, 5]; return 0; }";
    const t = typeOfLet(src, "a");
    expect(t.kind).toBe("array");
    if (t.kind !== "array") return;
    expect(t.element.kind).toBe("int");
    expect(t.length).toBe(5);
  });

  test("`inline<bool, 3>` resolves with bool element", () => {
    const src = "fn main() -> int { let a: inline<bool, 3> = [true, false, true]; return 0; }";
    const t = typeOfLet(src, "a");
    expect(t.kind).toBe("array");
    if (t.kind !== "array") return;
    expect(t.element.kind).toBe("bool");
    expect(t.length).toBe(3);
  });

  test("`inline<f64, 2>` resolves with f64 element", () => {
    const src = "fn main() -> int { let a: inline<f64, 2> = [1.0, 2.0]; return 0; }";
    const t = typeOfLet(src, "a");
    expect(t.kind).toBe("array");
    if (t.kind !== "array") return;
    expect(t.element.kind).toBe("float");
  });

  test("inline literal annotation accepts a matching array literal", () => {
    checkOk(`
      fn main() -> int {
        let a: inline<int, 3> = [1, 2, 3];
        return 0;
      }
    `);
  });

  test("inline parameter is accepted in function declarations", () => {
    checkOk(`
      fn first(xs: inline<int, 5>) -> int {
        return xs[0];
      }
      fn main() -> int {
        let xs: inline<int, 5> = [1, 2, 3, 4, 5];
        let _ = first(xs);
        return 0;
      }
    `);
  });

  test("inline as struct field is accepted", () => {
    checkOk(`
      struct Buf { data: inline<int, 4>; len: int; }
      fn main() -> int {
        let b = Buf{ data: [1, 2, 3, 4], len: 4 };
        let _ = b.data[0];
        return 0;
      }
    `);
  });
});

describe("Checker — inline<T, N> errors", () => {
  test("missing length is rejected", () => {
    checkError(
      "fn main() -> int { let a: inline<int> = [1, 2, 3]; return 0; }",
      "expects exactly 2 type arguments"
    );
  });

  test("extra type argument is rejected", () => {
    checkError(
      "fn main() -> int { let a: inline<int, 3, 5> = [1, 2, 3]; return 0; }",
      "expects exactly 2 type arguments"
    );
  });

  test("zero length is rejected", () => {
    checkError(
      "fn main() -> int { let a: inline<int, 0> = [1]; return 0; }",
      "must be a positive integer literal"
    );
  });

  test("non-integer second argument is rejected (type name)", () => {
    checkError(
      "fn main() -> int { let a: inline<int, int> = [1, 2, 3]; return 0; }",
      "must be a positive integer literal"
    );
  });
});

describe("Checker — inline<T, N> indexing and assignment", () => {
  test("indexing returns the element type", () => {
    const src = "fn main() -> int { let a: inline<int, 3> = [1, 2, 3]; let x = a[0]; return 0; }";
    const t = typeOfLet(src, "x");
    expect(t.kind).toBe("int");
  });

  test(".len returns usize (u64)", () => {
    const src = "fn main() -> int { let a: inline<int, 3> = [1, 2, 3]; let n = a.len; return 0; }";
    const t = typeOfLet(src, "n");
    expect(t.kind).toBe("int");
    if (t.kind !== "int") return;
    expect(t.bits).toBe(64);
    expect(t.signed).toBe(false);
  });

  test("index assignment with matching element type type-checks", () => {
    checkOk(`
      fn main() -> int {
        let a: inline<int, 3> = [1, 2, 3];
        a[0] = 99;
        return 0;
      }
    `);
  });

  test("index assignment with wrong element type is rejected", () => {
    checkError(
      `fn main() -> int { let a: inline<int, 3> = [1, 2, 3]; a[0] = "x"; return 0; }`,
      "type"
    );
  });

  test("indexing with a non-integer is rejected", () => {
    checkError(
      "fn main() -> int { let a: inline<int, 3> = [1, 2, 3]; let x = a[true]; return 0; }",
      "index must be an integer"
    );
  });
});

describe("Checker — inline<T, N> assignability", () => {
  test("inline<T, N> is assignable to slice<T>", () => {
    // Both `array<T>` and `inline<T, N>` lower to the same internal `array`
    // kind, and `array<T>` is already known to be assignable to `slice<T>`.
    checkOk(`
      fn take(s: slice<int>) -> int { return 0; }
      fn main() -> int {
        let a: inline<int, 3> = [1, 2, 3];
        let _ = take(a);
        return 0;
      }
    `);
  });

  test("inline<int, N> not assignable to inline<bool, N>", () => {
    checkError(
      `
      fn main() -> int {
        let a: inline<int, 3> = [1, 2, 3];
        let b: inline<bool, 3> = a;
        return 0;
      }
    `,
      "type"
    );
  });
});
