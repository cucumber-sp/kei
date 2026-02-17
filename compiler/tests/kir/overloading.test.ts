import { describe, expect, test } from "bun:test";
import { lower } from "./helpers.ts";

describe("KIR — Function Overloading", () => {
  test("overloaded functions get mangled names", () => {
    const mod = lower(`
      fn process(x: i32) -> i32 { return x; }
      fn process(x: string) -> string { return x; }
      fn main() -> int { process(42); process("hi"); return 0; }
    `);

    const names = mod.functions.map((f) => f.name);
    expect(names).toContain("process_i32");
    expect(names).toContain("process_string");
    expect(names).toContain("main");
  });

  test("non-overloaded functions keep plain names", () => {
    const mod = lower(`
      fn helper(x: i32) -> i32 { return x; }
      fn main() -> int { return helper(1); }
    `);

    const names = mod.functions.map((f) => f.name);
    expect(names).toContain("helper");
    expect(names).not.toContain("helper_i32");
  });

  test("overloaded call emits mangled function name in call instruction", () => {
    const mod = lower(`
      fn process(x: i32) -> i32 { return x; }
      fn process(x: string) -> string { return x; }
      fn main() -> int { process(42); process("hi"); return 0; }
    `);

    const mainFn = mod.functions.find((f) => f.name === "main");
    expect(mainFn).toBeDefined();

    // Collect all call/call_void instructions
    const calls: string[] = [];
    // biome-ignore lint/style/noNonNullAssertion: mainFn existence asserted above
    for (const block of mainFn!.blocks) {
      for (const inst of block.instructions) {
        if (inst.kind === "call" || inst.kind === "call_void") {
          calls.push(inst.func);
        }
      }
    }

    expect(calls).toContain("process_i32");
    expect(calls).toContain("process_string");
  });

  test("user-defined overloads use mangled names in KIR", () => {
    const mod = lower(`
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

    const mainFn = mod.functions.find((f) => f.name === "main");
    expect(mainFn).toBeDefined();

    const calls: string[] = [];
    // biome-ignore lint/style/noNonNullAssertion: mainFn existence asserted above
    for (const block of mainFn!.blocks) {
      for (const inst of block.instructions) {
        if (inst.kind === "call" || inst.kind === "call_void") {
          calls.push(inst.func);
        }
      }
    }

    expect(calls).toContain("log_i32");
    expect(calls).toContain("log_string");
    expect(calls).toContain("log_f64");
    expect(calls).toContain("log_bool");
  });
});
