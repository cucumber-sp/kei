import { describe, expect, test } from "bun:test";
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

  test("overloaded functions with multiple types get correct C calls", () => {
    const c = compileToC(`
      fn log(value: i32) {}
      fn log(value: string) {}
      fn log(value: f64) {}
      fn log(value: bool) {}
      fn main() -> int {
        log(42);
        log("hello");
        log(3.14);
        log(true);
        return 0;
      }
    `);
    expect(c).toContain("log_i32");
    expect(c).toContain("log_string");
    expect(c).toContain("log_f64");
    expect(c).toContain("log_bool");
  });
});
