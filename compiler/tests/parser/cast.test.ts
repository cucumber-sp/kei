import { describe, expect, test } from "bun:test";
import type { Expression } from "../../src/ast/nodes.ts";
import { parse } from "./helpers.ts";

function parseExpr(exprStr: string): Expression {
  const program = parse(`fn test() { let _r = ${exprStr}; }`);
  const fn = program.declarations[0]!;
  if (fn.kind !== "FunctionDecl") throw new Error("Expected FunctionDecl");
  const stmt = fn.body.statements[0]!;
  if (stmt.kind !== "LetStmt") throw new Error("Expected LetStmt");
  return stmt.initializer;
}

describe("Parser — as cast", () => {
  test("simple cast: x as i32", () => {
    const expr = parseExpr("x as i32");
    expect(expr.kind).toBe("CastExpr");
    if (expr.kind !== "CastExpr") return;
    expect(expr.operand.kind).toBe("Identifier");
    expect(expr.targetType.kind).toBe("NamedType");
    if (expr.targetType.kind === "NamedType") {
      expect(expr.targetType.name).toBe("i32");
    }
  });

  test("cast with float type: x as f64", () => {
    const expr = parseExpr("x as f64");
    expect(expr.kind).toBe("CastExpr");
    if (expr.kind !== "CastExpr") return;
    expect(expr.targetType.kind).toBe("NamedType");
    if (expr.targetType.kind === "NamedType") {
      expect(expr.targetType.name).toBe("f64");
    }
  });

  test("cast binds tighter than addition: a + b as i64 = a + (b as i64)", () => {
    const expr = parseExpr("a + b as i64");
    expect(expr.kind).toBe("BinaryExpr");
    if (expr.kind !== "BinaryExpr") return;
    expect(expr.operator).toBe("+");
    expect(expr.right.kind).toBe("CastExpr");
  });

  test("chained cast: x as i64 as f64", () => {
    const expr = parseExpr("x as i64 as f64");
    expect(expr.kind).toBe("CastExpr");
    if (expr.kind !== "CastExpr") return;
    expect(expr.operand.kind).toBe("CastExpr");
    if (expr.targetType.kind === "NamedType") {
      expect(expr.targetType.name).toBe("f64");
    }
  });

  test("cast with generic type: p as ptr<u8>", () => {
    const expr = parseExpr("p as ptr<u8>");
    expect(expr.kind).toBe("CastExpr");
    if (expr.kind !== "CastExpr") return;
    expect(expr.targetType.kind).toBe("GenericType");
    if (expr.targetType.kind === "GenericType") {
      expect(expr.targetType.name).toBe("ptr");
    }
  });

  test("cast on literal: 42 as f64", () => {
    const expr = parseExpr("42 as f64");
    expect(expr.kind).toBe("CastExpr");
    if (expr.kind !== "CastExpr") return;
    expect(expr.operand.kind).toBe("IntLiteral");
  });

  test("cast in parentheses: (x as f64)", () => {
    const expr = parseExpr("(x as f64)");
    expect(expr.kind).toBe("GroupExpr");
    if (expr.kind !== "GroupExpr") return;
    expect(expr.expression.kind).toBe("CastExpr");
  });
});
