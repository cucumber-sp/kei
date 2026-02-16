import { describe, expect, test } from "bun:test";
import { parseWithDiagnostics } from "./helpers.ts";

describe("Parser — Error Recovery", () => {
  test("missing semicolon after let", () => {
    const { diagnostics } = parseWithDiagnostics("fn test() { let x = 42 }");
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  test("missing closing brace", () => {
    const { diagnostics } = parseWithDiagnostics("fn test() { let x = 42;");
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  test("missing closing paren", () => {
    const { diagnostics } = parseWithDiagnostics("fn test( { }");
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  test("unexpected token in expression", () => {
    const { diagnostics } = parseWithDiagnostics("fn test() { let x = ; }");
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  test("empty function body is valid", () => {
    const { program, diagnostics } = parseWithDiagnostics("fn test() { }");
    expect(diagnostics).toHaveLength(0);
    expect(program.declarations).toHaveLength(1);
    const fn = program.declarations[0]!;
    if (fn.kind === "FunctionDecl") {
      expect(fn.body.statements).toHaveLength(0);
    }
  });

  test("multiple errors — parser continues", () => {
    const { program, diagnostics } = parseWithDiagnostics(`
      fn a() { let x = }
      fn b() { return 1; }
    `);
    // Should have errors but also parse fn b
    expect(diagnostics.length).toBeGreaterThan(0);
    // Parser should recover and parse at least some declarations
    expect(program.declarations.length).toBeGreaterThanOrEqual(1);
  });

  test("unterminated struct", () => {
    const { diagnostics } = parseWithDiagnostics("struct Point { x: f64;");
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  test("invalid at top level", () => {
    const { diagnostics } = parseWithDiagnostics("42;");
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
