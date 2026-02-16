import { test, expect, describe } from "bun:test";
import { emitC } from "../../src/backend/c-emitter.ts";
import { runDeSsa } from "../../src/backend/de-ssa.ts";
import { runMem2Reg } from "../../src/kir/mem2reg.ts";
import { lower } from "../kir/helpers.ts";

function compileToC(source: string): string {
  let mod = lower(source);
  mod = runMem2Reg(mod);
  mod = runDeSsa(mod);
  return emitC(mod);
}

describe("C emitter — as cast", () => {
  test("i32 → f64 emits C cast", () => {
    const c = compileToC(`
      fn test() -> f64 { let x: i32 = 42; return x as f64; }
      fn main() -> int { return 0; }
    `);
    expect(c).toContain("(double)");
  });

  test("f64 → i32 emits C cast", () => {
    const c = compileToC(`
      fn test() -> i32 { let x: f64 = 2.5; return x as i32; }
      fn main() -> int { return 0; }
    `);
    expect(c).toContain("(int32_t)");
  });

  test("i32 → i64 emits C cast", () => {
    const c = compileToC(`
      fn test() -> i64 { let x: i32 = 42; return x as i64; }
      fn main() -> int { return 0; }
    `);
    expect(c).toContain("(int64_t)");
  });

  test("i64 → i32 narrowing emits C cast", () => {
    const c = compileToC(`
      fn test() -> i32 { let x: i64 = 1000; return x as i32; }
      fn main() -> int { return 0; }
    `);
    expect(c).toContain("(int32_t)");
  });

  test("bool → i32 emits C cast", () => {
    const c = compileToC(`
      fn test() -> i32 { let x = true; return x as i32; }
      fn main() -> int { return 0; }
    `);
    expect(c).toContain("(int32_t)");
  });
});
