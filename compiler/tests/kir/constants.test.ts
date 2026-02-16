import { test, expect, describe } from "bun:test";
import { lowerFunction, getInstructions } from "./helpers.ts";
import type { KirConstInt, KirConstFloat, KirConstBool, KirConstString } from "../../src/kir/kir-types.ts";

describe("KIR: constants", () => {
  test("integer constant", () => {
    const fn = lowerFunction(`
      fn foo() -> int { return 42; }
    `, "foo");
    const consts = getInstructions(fn, "const_int") as KirConstInt[];
    expect(consts).toHaveLength(1);
    expect(consts[0].value).toBe(42);
    expect(consts[0].type.kind).toBe("int");
  });

  test("float constant", () => {
    const fn = lowerFunction(`
      fn foo() -> f64 { return 3.14; }
    `, "foo");
    const consts = getInstructions(fn, "const_float") as KirConstFloat[];
    expect(consts).toHaveLength(1);
    expect(consts[0].value).toBe(3.14);
    expect(consts[0].type.kind).toBe("float");
  });

  test("boolean true constant", () => {
    const fn = lowerFunction(`
      fn foo() -> bool { return true; }
    `, "foo");
    const consts = getInstructions(fn, "const_bool") as KirConstBool[];
    expect(consts).toHaveLength(1);
    expect(consts[0].value).toBe(true);
  });

  test("boolean false constant", () => {
    const fn = lowerFunction(`
      fn foo() -> bool { return false; }
    `, "foo");
    const consts = getInstructions(fn, "const_bool") as KirConstBool[];
    expect(consts).toHaveLength(1);
    expect(consts[0].value).toBe(false);
  });

  test("string constant", () => {
    const fn = lowerFunction(`
      fn foo() -> string { return "hello"; }
    `, "foo");
    const consts = getInstructions(fn, "const_string") as KirConstString[];
    expect(consts).toHaveLength(1);
    expect(consts[0].value).toBe("hello");
  });

  test("zero constant", () => {
    const fn = lowerFunction(`
      fn foo() -> int { return 0; }
    `, "foo");
    const consts = getInstructions(fn, "const_int") as KirConstInt[];
    expect(consts).toHaveLength(1);
    expect(consts[0].value).toBe(0);
  });

  test("negative literal creates negation", () => {
    const fn = lowerFunction(`
      fn foo() -> int { return -5; }
    `, "foo");
    const consts = getInstructions(fn, "const_int") as KirConstInt[];
    expect(consts.length).toBeGreaterThanOrEqual(1);
    const negs = getInstructions(fn, "neg");
    expect(negs).toHaveLength(1);
  });
});
