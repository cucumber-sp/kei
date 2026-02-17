import { describe, expect, test } from "bun:test";
import type { Expression } from "../../src/ast/nodes.ts";
import { parse } from "./helpers.ts";

function parseExpr(exprStr: string): Expression {
  const program = parse(`fn test() { let _r = ${exprStr}; }`);
  // biome-ignore lint/style/noNonNullAssertion: test input guarantees at least one declaration
  const fn = program.declarations[0]!;
  if (fn.kind !== "FunctionDecl") throw new Error("Expected FunctionDecl");
  // biome-ignore lint/style/noNonNullAssertion: test input guarantees at least one statement
  const stmt = fn.body.statements[0]!;
  if (stmt.kind !== "LetStmt") throw new Error("Expected LetStmt");
  return stmt.initializer;
}

describe("Parser — Array Literals", () => {
  test("simple array [1, 2, 3]", () => {
    const expr = parseExpr("[1, 2, 3]");
    expect(expr.kind).toBe("ArrayLiteral");
    if (expr.kind !== "ArrayLiteral") return;
    expect(expr.elements.length).toBe(3);
    expect(expr.elements[0]?.kind).toBe("IntLiteral");
    expect(expr.elements[1]?.kind).toBe("IntLiteral");
    expect(expr.elements[2]?.kind).toBe("IntLiteral");
  });

  test("single element array [42]", () => {
    const expr = parseExpr("[42]");
    expect(expr.kind).toBe("ArrayLiteral");
    if (expr.kind !== "ArrayLiteral") return;
    expect(expr.elements.length).toBe(1);
  });

  test("array with expressions [1 + 2, 3 * 4]", () => {
    const expr = parseExpr("[1 + 2, 3 * 4]");
    expect(expr.kind).toBe("ArrayLiteral");
    if (expr.kind !== "ArrayLiteral") return;
    expect(expr.elements.length).toBe(2);
    expect(expr.elements[0]?.kind).toBe("BinaryExpr");
    expect(expr.elements[1]?.kind).toBe("BinaryExpr");
  });

  test("array with trailing comma [1, 2, 3,]", () => {
    const expr = parseExpr("[1, 2, 3,]");
    expect(expr.kind).toBe("ArrayLiteral");
    if (expr.kind !== "ArrayLiteral") return;
    expect(expr.elements.length).toBe(3);
  });

  test("array indexing arr[0] is still parsed", () => {
    // Ensure postfix indexing still works with identifiers
    const program = parse(`fn test() { let a = [1]; let b = a[0]; }`);
    // biome-ignore lint/style/noNonNullAssertion: test input guarantees at least one declaration
    const fn = program.declarations[0]!;
    if (fn.kind !== "FunctionDecl") return;
    // biome-ignore lint/style/noNonNullAssertion: test input guarantees a second statement exists
    const stmt = fn.body.statements[1]!;
    if (stmt.kind !== "LetStmt") return;
    expect(stmt.initializer.kind).toBe("IndexExpr");
  });

  test("nested array literal [[1, 2], [3, 4]] parses outer", () => {
    // Inner arrays are parsed as elements
    const expr = parseExpr("[[1, 2], [3, 4]]");
    expect(expr.kind).toBe("ArrayLiteral");
    if (expr.kind !== "ArrayLiteral") return;
    expect(expr.elements.length).toBe(2);
    expect(expr.elements[0]?.kind).toBe("ArrayLiteral");
    expect(expr.elements[1]?.kind).toBe("ArrayLiteral");
  });

  test("string array", () => {
    const expr = parseExpr(`["hello", "world"]`);
    expect(expr.kind).toBe("ArrayLiteral");
    if (expr.kind !== "ArrayLiteral") return;
    expect(expr.elements.length).toBe(2);
    expect(expr.elements[0]?.kind).toBe("StringLiteral");
  });
});
