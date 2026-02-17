import { describe, expect, test } from "bun:test";
import { getInstructions, lowerAndPrint, lowerFunction } from "./helpers.ts";

describe("KIR: as cast", () => {
  test("i32 → f64 emits cast instruction", () => {
    const fn = lowerFunction(`fn test() -> f64 { let x: i32 = 42; return x as f64; }`, "test");
    const casts = getInstructions(fn, "cast");
    expect(casts.length).toBeGreaterThanOrEqual(1);
    // biome-ignore lint/style/noNonNullAssertion: length checked above
    const cast = casts[0]!;
    if (cast.kind === "cast") {
      expect(cast.targetType).toEqual({ kind: "float", bits: 64 });
    }
  });

  test("f64 → i32 emits cast instruction", () => {
    const fn = lowerFunction(`fn test() -> i32 { let x: f64 = 2.5; return x as i32; }`, "test");
    const casts = getInstructions(fn, "cast");
    expect(casts.length).toBeGreaterThanOrEqual(1);
    // biome-ignore lint/style/noNonNullAssertion: length checked above
    const cast = casts[0]!;
    if (cast.kind === "cast") {
      expect(cast.targetType).toEqual({ kind: "int", bits: 32, signed: true });
    }
  });

  test("i32 → i64 widening emits cast", () => {
    const fn = lowerFunction(`fn test() -> i64 { let x: i32 = 42; return x as i64; }`, "test");
    const casts = getInstructions(fn, "cast");
    expect(casts.length).toBeGreaterThanOrEqual(1);
    // biome-ignore lint/style/noNonNullAssertion: length checked above
    const cast = casts[0]!;
    if (cast.kind === "cast") {
      expect(cast.targetType).toEqual({ kind: "int", bits: 64, signed: true });
    }
  });

  test("bool → i32 emits cast", () => {
    const fn = lowerFunction(`fn test() -> i32 { let x = true; return x as i32; }`, "test");
    const casts = getInstructions(fn, "cast");
    expect(casts.length).toBeGreaterThanOrEqual(1);
  });

  test("cast appears in KIR text output", () => {
    const kir = lowerAndPrint(`fn test() -> f64 { let x: i32 = 42; return x as f64; }`);
    expect(kir).toContain("cast");
    expect(kir).toContain("f64");
  });
});
