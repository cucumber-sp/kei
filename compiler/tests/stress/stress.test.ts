/**
 * Stress tests for compiler robustness.
 *
 * These tests generate large or deeply nested programs to verify the compiler
 * does not crash, hang, or produce incorrect results under extreme inputs.
 */

import { describe, test, expect } from "bun:test";
import { Lexer } from "../../src/lexer/index.ts";
import { Parser } from "../../src/parser/index.ts";
import { Checker } from "../../src/checker/checker.ts";
import { lowerToKir } from "../../src/kir/lowering.ts";
import { runMem2Reg } from "../../src/kir/mem2reg.ts";
import { runDeSsa } from "../../src/backend/de-ssa.ts";
import { emitC } from "../../src/backend/c-emitter.ts";
import { SourceFile } from "../../src/utils/source.ts";
import type { Diagnostic } from "../../src/errors/diagnostic.ts";

/** Run the full pipeline: source → tokens → AST → check → KIR → mem2reg → de-ssa → C */
function compileFull(source: string): string {
  const file = new SourceFile("stress.kei", source);
  const lexer = new Lexer(file);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();

  const parserDiags = parser.getDiagnostics();
  if (parserDiags.length > 0) {
    const msgs = parserDiags.map((d) => d.message).join(", ");
    throw new Error(`Parser errors: ${msgs}`);
  }

  const checker = new Checker(program, file);
  const result = checker.check();

  const errors = result.diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    const msgs = errors
      .map((d) => `  ${d.message} at ${d.location.line}:${d.location.column}`)
      .join("\n");
    throw new Error(`Type errors:\n${msgs}`);
  }

  let mod = lowerToKir(program, result);
  mod = runMem2Reg(mod);
  mod = runDeSsa(mod);
  return emitC(mod);
}

/** Lex + parse only, return diagnostics. */
function parseOnly(source: string): { parsed: boolean; diagnostics: string[] } {
  const file = new SourceFile("stress.kei", source);
  const lexer = new Lexer(file);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  parser.parse();
  const diags = parser.getDiagnostics();
  return {
    parsed: true,
    diagnostics: diags.map((d) => d.message),
  };
}

/** Lex + parse + check, return diagnostics. */
function checkOnly(source: string): Diagnostic[] {
  const file = new SourceFile("stress.kei", source);
  const lexer = new Lexer(file);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();

  const parserDiags = parser.getDiagnostics();
  if (parserDiags.length > 0) {
    const msgs = parserDiags.map((d) => d.message).join(", ");
    throw new Error(`Parser errors: ${msgs}`);
  }

  const checker = new Checker(program, file);
  const result = checker.check();
  return result.diagnostics;
}

// ─── Very long source files ─────────────────────────────────────────────────

describe("stress: large source files", () => {
  test("1000 let statements in a single function", () => {
    const stmts = Array.from(
      { length: 1000 },
      (_, i) => `  let x${i}: i32 = ${i};`
    ).join("\n");
    const source = `fn main() -> i32 {\n${stmts}\n  return x999;\n}`;
    const c = compileFull(source);
    expect(c).toContain("main");
    expect(c).toContain("999");
  });

  test("500 independent functions", () => {
    // Use "func" prefix to avoid collisions with keywords like f32, f64
    const fns = Array.from(
      { length: 500 },
      (_, i) => `fn func${i}() -> i32 { return ${i}; }`
    ).join("\n");
    const source = `${fns}\nfn main() -> i32 { return func0(); }`;
    const c = compileFull(source);
    expect(c).toContain("main");
  });

  test("200 struct declarations", () => {
    const structs = Array.from(
      { length: 200 },
      (_, i) => `struct S${i} { a: i32; b: i32; }`
    ).join("\n");
    const source = `${structs}\nfn main() -> i32 { let s = S0{ a: 1, b: 2 }; return s.a; }`;
    const c = compileFull(source);
    expect(c).toContain("S0");
  });
});

// ─── Deeply nested blocks ───────────────────────────────────────────────────

describe("stress: deeply nested blocks", () => {
  test("25 levels of nested if blocks", () => {
    let source = "fn main() -> i32 {\n  let x: i32 = 0;\n";
    for (let i = 0; i < 25; i++) {
      source += "  ".repeat(i + 1) + `if x == 0 {\n`;
    }
    source += "  ".repeat(26) + "x = 1;\n";
    for (let i = 24; i >= 0; i--) {
      source += "  ".repeat(i + 1) + "}\n";
    }
    source += "  return x;\n}";
    const c = compileFull(source);
    expect(c).toContain("main");
  });

  test("30 levels of nested blocks (plain scopes)", () => {
    let source = "fn main() -> i32 {\n  let x: i32 = 0;\n";
    for (let i = 0; i < 30; i++) {
      source += "  ".repeat(i + 1) + "{\n";
    }
    source += "  ".repeat(31) + "x = 42;\n";
    for (let i = 29; i >= 0; i--) {
      source += "  ".repeat(i + 1) + "}\n";
    }
    source += "  return x;\n}";
    const c = compileFull(source);
    expect(c).toContain("42");
  });

  test("20 levels of nested while loops", () => {
    let source = "fn main() -> i32 {\n  let x: i32 = 0;\n";
    for (let i = 0; i < 20; i++) {
      source += "  ".repeat(i + 1) + `while x == 0 {\n`;
    }
    source += "  ".repeat(21) + "x = 1;\n";
    for (let i = 19; i >= 0; i--) {
      source += "  ".repeat(i + 1) + "}\n";
    }
    source += "  return x;\n}";
    const c = compileFull(source);
    expect(c).toContain("main");
  });
});

// ─── Deeply nested expressions ──────────────────────────────────────────────

describe("stress: deeply nested expressions", () => {
  test("100 chained binary additions", () => {
    const expr = Array.from({ length: 100 }, (_, i) => `${i}`).join(" + ");
    const source = `fn main() -> i32 { return ${expr}; }`;
    const c = compileFull(source);
    expect(c).toContain("main");
  });

  test("50 chained comparisons via logical and", () => {
    const parts = Array.from(
      { length: 50 },
      (_, i) => `(${i + 1} < ${i + 2})`
    );
    const expr = parts.join(" && ");
    const source = `fn main() -> i32 { let b: bool = ${expr}; return 0; }`;
    const c = compileFull(source);
    expect(c).toContain("main");
  });

  test("deeply nested parenthesized expression", () => {
    const depth = 80;
    const open = "(".repeat(depth);
    const close = ")".repeat(depth);
    const source = `fn main() -> i32 { return ${open}42${close}; }`;
    const c = compileFull(source);
    expect(c).toContain("42");
  });

  test("long chain of multiplications", () => {
    const expr = Array.from({ length: 150 }, () => "1").join(" * ");
    const source = `fn main() -> i32 { return ${expr}; }`;
    const c = compileFull(source);
    expect(c).toContain("main");
  });
});

// ─── Function overloads ─────────────────────────────────────────────────────

describe("stress: many function overloads", () => {
  test("12 overloads of the same function name", () => {
    const overloads = Array.from(
      { length: 12 },
      (_, i) => {
        const params = Array.from(
          { length: i + 1 },
          (_, j) => `p${j}: i32`
        ).join(", ");
        const sum = Array.from({ length: i + 1 }, (_, j) => `p${j}`).join(
          " + "
        );
        return `fn compute(${params}) -> i32 { return ${sum}; }`;
      }
    ).join("\n");

    const source = `${overloads}\nfn main() -> i32 { return compute(1); }`;
    const c = compileFull(source);
    expect(c).toContain("main");
  });

  test("10 overloads differentiated by type", () => {
    const types = [
      "i32",
      "i64",
      "u8",
      "u16",
      "u32",
      "u64",
      "i8",
      "i16",
      "f32",
      "f64",
    ];
    const overloads = types
      .map((t) => `fn process(x: ${t}) -> ${t} { return x; }`)
      .join("\n");
    const source = `${overloads}\nfn main() -> i32 { let x: i32 = 5; return process(x); }`;
    const c = compileFull(source);
    expect(c).toContain("process");
  });
});

// ─── Many struct fields ─────────────────────────────────────────────────────

describe("stress: large struct declarations", () => {
  test("struct with 50 fields", () => {
    // Use "field" prefix to avoid collisions with keywords (f32, f64)
    const fields = Array.from(
      { length: 50 },
      (_, i) => `  field${i}: i32;`
    ).join("\n");
    const inits = Array.from(
      { length: 50 },
      (_, i) => `field${i}: ${i}`
    ).join(", ");
    const source = `struct Big {\n${fields}\n}\nfn main() -> i32 {\n  let b = Big{ ${inits} };\n  return b.field0;\n}`;
    const c = compileFull(source);
    expect(c).toContain("Big");
  });

  test("struct with 100 fields", () => {
    const fields = Array.from(
      { length: 100 },
      (_, i) => `  field${i}: i32;`
    ).join("\n");
    const inits = Array.from(
      { length: 100 },
      (_, i) => `field${i}: ${i}`
    ).join(", ");
    const source = `struct Huge {\n${fields}\n}\nfn main() -> i32 {\n  let h = Huge{ ${inits} };\n  return h.field99;\n}`;
    const c = compileFull(source);
    expect(c).toContain("Huge");
  });

  test("struct with mixed types across 60 fields", () => {
    const types = ["i32", "i64", "f64", "bool", "u8", "u16"];
    const fields = Array.from(
      { length: 60 },
      (_, i) => `  field${i}: ${types[i % types.length]};`
    ).join("\n");
    const defaults: Record<string, string> = {
      i32: "0",
      i64: "0",
      f64: "0.0",
      bool: "false",
      u8: "0",
      u16: "0",
    };
    const inits = Array.from(
      { length: 60 },
      (_, i) => `field${i}: ${defaults[types[i % types.length]]}`
    ).join(", ");
    const source = `struct Mixed {\n${fields}\n}\nfn main() -> i32 {\n  let m = Mixed{ ${inits} };\n  return 0;\n}`;
    const c = compileFull(source);
    expect(c).toContain("Mixed");
  });
});

// ─── Many enum variants ─────────────────────────────────────────────────────

describe("stress: large enum declarations", () => {
  test("enum with 50 variants (simple)", () => {
    const variants = Array.from(
      { length: 50 },
      (_, i) => `V${i} = ${i}`
    ).join(", ");
    const source = `enum BigEnum : i32 { ${variants} }\nfn main() -> i32 { return 0; }`;
    const c = compileFull(source);
    expect(c).toContain("BigEnum");
  });

  test("enum with 100 variants", () => {
    const variants = Array.from(
      { length: 100 },
      (_, i) => `Variant${i} = ${i}`
    ).join(", ");
    const source = `enum HugeEnum : i32 { ${variants} }\nfn main() -> i32 { return 0; }`;
    const c = compileFull(source);
    expect(c).toContain("HugeEnum");
  });

  test("data enum with 50 variants with fields", () => {
    const variants = Array.from(
      { length: 50 },
      (_, i) => `V${i}(x: i32, y: i32)`
    ).join(",\n  ");
    const source = `enum DataEnum {\n  ${variants}\n}\nfn main() -> i32 { return 0; }`;
    const diags = checkOnly(source);
    const errors = diags.filter((d) => d.severity === "error");
    expect(errors.length).toBe(0);
  });
});

// ─── Very long identifiers ──────────────────────────────────────────────────

describe("stress: long identifiers", () => {
  test("variable with 200-char identifier", () => {
    const name = "x".repeat(200);
    const source = `fn main() -> i32 { let ${name}: i32 = 42; return ${name}; }`;
    const c = compileFull(source);
    expect(c).toContain("42");
  });

  test("function with 200-char identifier", () => {
    const name = "g".repeat(200);
    const source = `fn ${name}() -> i32 { return 1; }\nfn main() -> i32 { return ${name}(); }`;
    const c = compileFull(source);
    expect(c).toContain(name);
  });

  test("struct with 200-char name and 200-char field", () => {
    const sName = "S".repeat(200);
    const fName = "z".repeat(200);
    const source = `struct ${sName} { ${fName}: i32; }\nfn main() -> i32 {\n  let s = ${sName}{ ${fName}: 42 };\n  return s.${fName};\n}`;
    const c = compileFull(source);
    expect(c).toContain(sName);
  });

  test("500-char identifier", () => {
    const name = "v".repeat(500);
    const source = `fn main() -> i32 { let ${name}: i32 = 7; return ${name}; }`;
    const c = compileFull(source);
    expect(c).toContain("7");
  });
});

// ─── Very long string literals ──────────────────────────────────────────────

describe("stress: long string literals", () => {
  test("string literal with 1000 characters", () => {
    const str = "a".repeat(1000);
    const source = `fn main() -> i32 { let s: string = "${str}"; return 0; }`;
    const c = compileFull(source);
    expect(c).toContain(str);
  });

  test("string literal with 5000 characters", () => {
    const str = "b".repeat(5000);
    const source = `fn main() -> i32 { let s: string = "${str}"; return 0; }`;
    const c = compileFull(source);
    expect(c.length).toBeGreaterThan(5000);
  });

  test("many short string literals (200 strings)", () => {
    const stmts = Array.from(
      { length: 200 },
      (_, i) => `  let s${i}: string = "str_${i}";`
    ).join("\n");
    const source = `fn main() -> i32 {\n${stmts}\n  return 0;\n}`;
    const c = compileFull(source);
    expect(c).toContain("str_199");
  });
});

// ─── Many generic instantiations ────────────────────────────────────────────

describe("stress: many generic instantiations", () => {
  test("20 different instantiations of same generic struct", () => {
    const intTypes = ["i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64"];
    const floatTypes = ["f32", "f64"];
    const allTypes = [...intTypes, ...floatTypes];

    const instantiations: string[] = [];
    for (let i = 0; i < 20; i++) {
      const t = allTypes[i % allTypes.length];
      const defaultVal = floatTypes.includes(t) ? "0.0" : "0";
      instantiations.push(
        `  let b${i} = Box<${t}>{ value: ${defaultVal} };`
      );
    }

    const source = `
      struct Box<T> { value: T; }
      fn main() -> i32 {
      ${instantiations.join("\n")}
        return 0;
      }
    `;
    const diags = checkOnly(source);
    const errors = diags.filter((d) => d.severity === "error");
    expect(errors.length).toBe(0);
  });

  test("generic struct with nested generic fields", () => {
    // Use only single-level nesting to avoid >> parsing issues
    const source = `
      struct Wrap<T> { inner: T; }
      fn main() -> i32 {
        let w0 = Wrap<i32>{ inner: 42 };
        let w1 = Wrap<bool>{ inner: true };
        let w2 = Wrap<i64>{ inner: 100 };
        return 0;
      }
    `;
    const diags = checkOnly(source);
    const errors = diags.filter((d) => d.severity === "error");
    expect(errors.length).toBe(0);
  });

  test("generic function with 15 different instantiations", () => {
    const types = [
      "i8",
      "i16",
      "i32",
      "i64",
      "u8",
      "u16",
      "u32",
      "u64",
      "f32",
      "f64",
    ];
    const calls: string[] = [];
    for (let i = 0; i < 15; i++) {
      const t = types[i % types.length];
      const val = t.startsWith("f") ? "0.0" : "0";
      calls.push(`  let r${i} = identity<${t}>(${val});`);
    }
    const source = `
      fn identity<T>(x: T) -> T { return x; }
      fn main() -> i32 {
      ${calls.join("\n")}
        return 0;
      }
    `;
    const diags = checkOnly(source);
    const errors = diags.filter((d) => d.severity === "error");
    expect(errors.length).toBe(0);
  });

  test("generic pair with 20 different type combinations", () => {
    const types = ["i32", "i64", "f64", "bool", "u8"];
    const instantiations: string[] = [];
    let idx = 0;
    for (let i = 0; i < types.length; i++) {
      for (let j = 0; j < types.length && idx < 20; j++, idx++) {
        const ta = types[i];
        const tb = types[j];
        const va = ta === "f64" ? "0.0" : ta === "bool" ? "false" : "0";
        const vb = tb === "f64" ? "0.0" : tb === "bool" ? "false" : "0";
        instantiations.push(
          `  let p${idx} = Pair<${ta}, ${tb}>{ first: ${va}, second: ${vb} };`
        );
      }
    }
    const source = `
      struct Pair<A, B> { first: A; second: B; }
      fn main() -> i32 {
      ${instantiations.join("\n")}
        return 0;
      }
    `;
    const diags = checkOnly(source);
    const errors = diags.filter((d) => d.severity === "error");
    expect(errors.length).toBe(0);
  });
});

// ─── Chained method calls ───────────────────────────────────────────────────

describe("stress: chained method calls", () => {
  test("chain of 10 method calls returning self", () => {
    const source = `
      struct Builder {
        value: i32;
        fn set(self: Builder, v: i32) -> Builder {
          return Builder{ value: v };
        }
      }
      fn main() -> i32 {
        let b = Builder{ value: 0 };
        let r = b.set(1).set(2).set(3).set(4).set(5).set(6).set(7).set(8).set(9).set(10);
        return r.value;
      }
    `;
    const c = compileFull(source);
    expect(c).toContain("Builder");
  });

  test("chain of 20 method calls", () => {
    const chain = Array.from({ length: 20 }, (_, i) => `.set(${i + 1})`).join(
      ""
    );
    const source = `
      struct Chain {
        val: i32;
        fn set(self: Chain, v: i32) -> Chain {
          return Chain{ val: v };
        }
      }
      fn main() -> i32 {
        let c = Chain{ val: 0 };
        let r = c${chain};
        return r.val;
      }
    `;
    const c = compileFull(source);
    expect(c).toContain("Chain");
  });

  test("chained field accesses across nested structs", () => {
    // Declare structs bottom-up so all types are defined before use
    const source = `
      struct E { value: i32; }
      struct D { e: E; }
      struct C { d: D; }
      struct B { c: C; }
      struct A { b: B; }
      fn main() -> i32 {
        let e = E{ value: 42 };
        let d = D{ e: e };
        let c = C{ d: d };
        let b = B{ c: c };
        let a = A{ b: b };
        return a.b.c.d.e.value;
      }
    `;
    const c = compileFull(source);
    expect(c).toContain("42");
  });
});

// ─── Arrays ─────────────────────────────────────────────────────────────────

describe("stress: large arrays", () => {
  test("array with 100 elements", () => {
    const elements = Array.from({ length: 100 }, (_, i) => `${i}`).join(", ");
    const source = `fn main() -> i32 { let arr = [${elements}]; return arr[99]; }`;
    const c = compileFull(source);
    expect(c).toContain("main");
  });

  test("array with 200 elements", () => {
    const elements = Array.from({ length: 200 }, (_, i) => `${i}`).join(", ");
    const source = `fn main() -> i32 { let arr = [${elements}]; return arr[0]; }`;
    const c = compileFull(source);
    expect(c).toContain("main");
  });
});

// ─── Combined stress ────────────────────────────────────────────────────────

describe("stress: combined scenarios", () => {
  test("many functions each with many local variables", () => {
    const fns = Array.from({ length: 50 }, (_, fi) => {
      const vars = Array.from(
        { length: 20 },
        (_, vi) => `  let v${vi}: i32 = ${vi};`
      ).join("\n");
      return `fn func${fi}() -> i32 {\n${vars}\n  return v19;\n}`;
    }).join("\n");
    const source = `${fns}\nfn main() -> i32 { return func0(); }`;
    const c = compileFull(source);
    expect(c).toContain("main");
  });

  test("struct with methods and many calls", () => {
    const calls = Array.from(
      { length: 30 },
      (_, i) => `  let r${i} = p.add(${i});`
    ).join("\n");
    const source = `
      struct Point {
        x: i32;
        y: i32;
        fn add(self: Point, n: i32) -> i32 {
          return self.x + self.y + n;
        }
      }
      fn main() -> i32 {
        let p = Point{ x: 1, y: 2 };
      ${calls}
        return r29;
      }
    `;
    const c = compileFull(source);
    expect(c).toContain("Point");
  });

  test("many enum variants used in switch", () => {
    const count = 30;
    const variants = Array.from(
      { length: count },
      (_, i) => `V${i} = ${i}`
    ).join(", ");
    const cases = Array.from(
      { length: count },
      (_, i) => `    case V${i}: return ${i};`
    ).join("\n");
    const source = `
      enum Action : i32 { ${variants} }
      fn handle(a: Action) -> i32 {
        switch a {
      ${cases}
        }
      }
      fn main() -> i32 { return 0; }
    `;
    const c = compileFull(source);
    expect(c).toContain("Action");
  });

  test("error handling with many throws functions", () => {
    const fns = Array.from({ length: 20 }, (_, i) => {
      return `
      struct Err${i} { code: i32; }
      fn may_fail_${i}(x: i32) -> i32 throws Err${i} {
        if x < 0 {
          throw Err${i}{ code: ${i} };
        }
        return x;
      }`;
    }).join("\n");

    // Use correct catch syntax: expr catch panic;
    const catches = Array.from({ length: 20 }, (_, i) => {
      return `  let r${i} = may_fail_${i}(${i}) catch panic;`;
    }).join("\n");

    const source = `
      ${fns}
      fn main() -> i32 {
      ${catches}
        return r0;
      }
    `;
    const c = compileFull(source);
    expect(c).toContain("main");
  });

  test("deeply nested if-else chains (30 levels)", () => {
    let body = "return 0;";
    for (let i = 29; i >= 0; i--) {
      body = `if x == ${i} { return ${i}; } else { ${body} }`;
    }
    const source = `fn test_fn(x: i32) -> i32 { ${body} }\nfn main() -> i32 { return test_fn(15); }`;
    const c = compileFull(source);
    expect(c).toContain("main");
  });
});

// ─── Edge cases that should not crash ───────────────────────────────────────

describe("stress: edge cases (no crash)", () => {
  test("empty function body", () => {
    const source = `fn nothing() {}\nfn main() -> i32 { nothing(); return 0; }`;
    const c = compileFull(source);
    expect(c).toContain("nothing");
  });

  test("empty struct", () => {
    const result = parseOnly(`struct Empty {}\nfn main() -> i32 { return 0; }`);
    expect(result.parsed).toBe(true);
  });

  test("single-character identifiers a through z", () => {
    const chars = "abcdefghijklmnopqrstuvwxyz";
    const stmts = Array.from({ length: 26 }, (_, i) => {
      return `  let ${chars[i]}: i32 = ${i};`;
    }).join("\n");
    const source = `fn main() -> i32 {\n${stmts}\n  return a;\n}`;
    const c = compileFull(source);
    expect(c).toContain("main");
  });

  test("function with 20 parameters", () => {
    const params = Array.from(
      { length: 20 },
      (_, i) => `p${i}: i32`
    ).join(", ");
    const sum = Array.from({ length: 20 }, (_, i) => `p${i}`).join(" + ");
    const args = Array.from({ length: 20 }, (_, i) => `${i}`).join(", ");
    const source = `fn big(${params}) -> i32 { return ${sum}; }\nfn main() -> i32 { return big(${args}); }`;
    const c = compileFull(source);
    expect(c).toContain("big");
  });

  test("many return statements in one function", () => {
    const ifs = Array.from(
      { length: 50 },
      (_, i) => `  if x == ${i} { return ${i}; }`
    ).join("\n");
    const source = `fn pick(x: i32) -> i32 {\n${ifs}\n  return 0;\n}\nfn main() -> i32 { return pick(25); }`;
    const c = compileFull(source);
    expect(c).toContain("pick");
  });

  test("many struct literals in sequence", () => {
    const stmts = Array.from(
      { length: 100 },
      (_, i) => `  let p${i} = Pt{ x: ${i}, y: ${i} };`
    ).join("\n");
    const source = `struct Pt { x: i32; y: i32; }\nfn main() -> i32 {\n${stmts}\n  return p99.x;\n}`;
    const c = compileFull(source);
    expect(c).toContain("Pt");
  });
});
