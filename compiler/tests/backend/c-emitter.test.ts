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

describe("c-emitter", () => {
  test("emits runtime header", () => {
    const c = compileToC(`fn main() -> int { return 0; }`);
    expect(c).toContain("#include <stdio.h>");
    expect(c).toContain("#include <stdint.h>");
    expect(c).toContain("#include <stdbool.h>");
    expect(c).toContain("kei_string");
    expect(c).toContain("kei_panic");
  });

  test("emits main as C main with int return", () => {
    const c = compileToC(`fn main() -> int { return 0; }`);
    expect(c).toContain("int main(void)");
    expect(c).toContain("return");
  });

  test("emits integer constants", () => {
    const c = compileToC(`fn main() -> int { return 42; }`);
    expect(c).toContain("42");
  });

  test("emits boolean constants", () => {
    const c = compileToC(`
      fn test() -> bool { return true; }
      fn main() -> int { return 0; }
    `);
    expect(c).toContain("true");
  });

  test("emits string constants", () => {
    const c = compileToC(`
      fn test() -> string { return "hello"; }
      fn main() -> int { return 0; }
    `);
    expect(c).toContain('"hello"');
  });

  test("emits arithmetic operations", () => {
    const c = compileToC(`
      fn add(a: int, b: int) -> int { return a + b; }
      fn main() -> int { return 0; }
    `);
    expect(c).toContain("+");
  });

  test("emits comparison operations", () => {
    const c = compileToC(`
      fn gt(a: int, b: int) -> bool { return a > b; }
      fn main() -> int { return 0; }
    `);
    expect(c).toContain(">");
  });

  test("emits if/else as branch with goto", () => {
    const c = compileToC(`
      fn test(x: int) -> int {
        if x > 0 { return 1; } else { return -1; }
      }
      fn main() -> int { return 0; }
    `);
    // Should have goto-based branching
    expect(c).toContain("goto");
    expect(c).toContain("if (");
  });

  test("emits function calls", () => {
    const c = compileToC(`
      fn helper() -> int { return 42; }
      fn main() -> int { return helper(); }
    `);
    expect(c).toContain("helper(");
  });

  test("emits function prototypes", () => {
    const c = compileToC(`
      fn helper(x: int) -> int { return x; }
      fn main() -> int { return helper(1); }
    `);
    // Should have forward declaration
    const lines = c.split("\n");
    const prototypes = lines.filter(
      (l) => l.includes("helper") && l.trim().endsWith(";") && !l.includes("=")
    );
    expect(prototypes.length).toBeGreaterThan(0);
  });

  test("emits negation", () => {
    const c = compileToC(`
      fn neg(x: int) -> int { return -x; }
      fn main() -> int { return 0; }
    `);
    expect(c).toContain("-");
  });

  test("emits logical not", () => {
    const c = compileToC(`
      fn inv(x: bool) -> bool { return !x; }
      fn main() -> int { return 0; }
    `);
    expect(c).toContain("!");
  });

  test("emits void functions", () => {
    const c = compileToC(`
      fn doNothing() -> void { }
      fn main() -> int { doNothing(); return 0; }
    `);
    expect(c).toContain("void doNothing");
  });

  test("emits valid C type names", () => {
    const c = compileToC(`
      fn test() -> i32 { return 1; }
      fn main() -> int { return 0; }
    `);
    expect(c).toContain("int32_t");
  });

  test("emits f64 as double", () => {
    const c = compileToC(`
      fn test() -> f64 { return 3.14; }
      fn main() -> int { return 0; }
    `);
    expect(c).toContain("double");
    expect(c).toContain("3.14");
  });

  test("emits while loop as goto pattern", () => {
    const c = compileToC(`
      fn test() -> int {
        let i: int = 0;
        while i < 10 {
          i = i + 1;
        }
        return i;
      }
      fn main() -> int { return 0; }
    `);
    expect(c).toContain("goto");
  });

  test("emits multiple parameters", () => {
    const c = compileToC(`
      fn add3(a: int, b: int, c: int) -> int { return a + b + c; }
      fn main() -> int { return 0; }
    `);
    // Should have all three params in signature
    const match = c.match(/add3\([^)]+\)/);
    expect(match).toBeTruthy();
  });

  test("produces syntactically plausible C", () => {
    const c = compileToC(`
      fn factorial(n: int) -> int {
        if n <= 1 {
          return 1;
        }
        return n * factorial(n - 1);
      }
      fn main() -> int { return factorial(5); }
    `);
    // Basic structural checks
    expect(c).toContain("{");
    expect(c).toContain("}");
    expect(c).toContain("return");
    expect(c).toContain("factorial");
    // Should not have any phi nodes
    expect(c).not.toContain("phi");
    expect(c).not.toContain("φ");
  });

  test("enum data variant construction emits tagged union init", () => {
    const c = compileToC(`
      enum Shape { Circle(radius: f64), Point }
      fn main() -> int {
        let s: Shape = Shape.Circle(3.14);
        let p: Shape = Shape.Point;
        return 0;
      }
    `);
    // Should have the tagged union typedef
    expect(c).toContain("typedef struct");
    expect(c).toContain("int32_t tag;");
    expect(c).toContain("union {");
    // Tag constants
    expect(c).toContain("Shape_Circle");
    expect(c).toContain("Shape_Point");
    // Data variant construction: tag + data field access
    expect(c).toContain("->tag");
    expect(c).toContain("->data.Circle.radius");
  });

  test("switch on tagged union enum compares .tag field", () => {
    const c = compileToC(`
      enum Shape { Circle(radius: f64), Point }
      fn main() -> int {
        let s: Shape = Shape.Circle(3.14);
        switch s {
          case Circle: return 1;
          case Point: return 2;
        }
        return 0;
      }
    `);
    // The switch should load the tag and compare against tag constants
    expect(c).toContain("->tag");
    // Should produce if/else if chain comparing tag values
    expect(c).toMatch(/if \(/);
  });
});
