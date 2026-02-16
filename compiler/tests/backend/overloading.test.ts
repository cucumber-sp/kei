import { describe, test, expect } from "bun:test";
import { emitC } from "../../src/backend/c-emitter.ts";
import { runDeSsa } from "../../src/backend/de-ssa.ts";
import { runMem2Reg } from "../../src/kir/mem2reg.ts";
import { lower } from "../kir/helpers.ts";

/** Full pipeline: source → KIR → mem2reg → de-ssa → C code */
function compileToC(source: string): string {
  let mod = lower(source);
  mod = runMem2Reg(mod);
  mod = runDeSsa(mod);
  return emitC(mod);
}

describe("C Emitter — Function Overloading", () => {
  test("print(i32) maps to kei_print_int", () => {
    const c = compileToC(`fn main() -> int { print(42); return 0; }`);
    expect(c).toContain("kei_print_int");
  });

  test("print(string) maps to kei_print_string", () => {
    const c = compileToC(`fn main() -> int { print("hello"); return 0; }`);
    expect(c).toContain("kei_print_string");
  });

  test("print(f64) maps to kei_print_float", () => {
    const c = compileToC(`fn main() -> int { print(3.14); return 0; }`);
    expect(c).toContain("kei_print_float");
  });

  test("print(bool) maps to kei_print_bool", () => {
    const c = compileToC(`fn main() -> int { print(true); return 0; }`);
    expect(c).toContain("kei_print_bool");
  });

  test("all print types in one function emit correct C calls", () => {
    const c = compileToC(`
      fn main() -> int {
        print(42);
        print("hello");
        print(3.14);
        print(true);
        return 0;
      }
    `);
    expect(c).toContain("kei_print_int");
    expect(c).toContain("kei_print_string");
    expect(c).toContain("kei_print_float");
    expect(c).toContain("kei_print_bool");
  });

  test("user-defined overloaded functions get separate C definitions", () => {
    const c = compileToC(`
      fn greet(x: i32) -> i32 { return x; }
      fn greet(x: string) -> string { return x; }
      fn main() -> int { greet(42); greet("hi"); return 0; }
    `);
    // Should have two separate function definitions
    expect(c).toContain("greet_i32");
    expect(c).toContain("greet_string");
  });
});
