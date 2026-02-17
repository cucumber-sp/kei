import { describe, expect, test } from "bun:test";
import type { Expression } from "../../src/ast/nodes.ts";
import { parse } from "./helpers.ts";

function parseExpr(exprStr: string): Expression {
  const program = parse(`fn test() { let _r = ${exprStr}; }`);
  // biome-ignore lint/style/noNonNullAssertion: test input guarantees declaration exists
  const fn = program.declarations[0]!;
  if (fn.kind !== "FunctionDecl") throw new Error("Expected FunctionDecl");
  // biome-ignore lint/style/noNonNullAssertion: test input guarantees statement exists
  const stmt = fn.body.statements[0]!;
  if (stmt.kind !== "LetStmt") throw new Error("Expected LetStmt");
  return stmt.initializer;
}

function parseExprStmt(src: string): Expression {
  const program = parse(`fn test() { ${src} }`);
  // biome-ignore lint/style/noNonNullAssertion: test input guarantees declaration exists
  const fn = program.declarations[0]!;
  if (fn.kind !== "FunctionDecl") throw new Error("Expected FunctionDecl");
  // biome-ignore lint/style/noNonNullAssertion: test input guarantees statement exists
  const stmt = fn.body.statements[0]!;
  if (stmt.kind !== "ExprStmt") throw new Error(`Expected ExprStmt, got ${stmt.kind}`);
  return stmt.expression;
}

describe("Parser — Generic Type Args", () => {
  // ── Generic calls ──────────────────────────────────────────────────

  test("generic call with one type arg", () => {
    const expr = parseExpr("alloc<i32>(1)");
    expect(expr.kind).toBe("CallExpr");
    if (expr.kind !== "CallExpr") return;
    expect(expr.callee.kind).toBe("Identifier");
    if (expr.callee.kind === "Identifier") {
      expect(expr.callee.name).toBe("alloc");
    }
    expect(expr.typeArgs).toHaveLength(1);
    expect(expr.typeArgs[0]?.kind).toBe("NamedType");
    if (expr.typeArgs[0]?.kind === "NamedType") {
      expect(expr.typeArgs[0].name).toBe("i32");
    }
    expect(expr.args).toHaveLength(1);
  });

  test("generic call with multiple type args", () => {
    const expr = parseExpr("make<i32, string>(1, 2)");
    expect(expr.kind).toBe("CallExpr");
    if (expr.kind !== "CallExpr") return;
    expect(expr.typeArgs).toHaveLength(2);
    expect(expr.typeArgs[0]?.kind).toBe("NamedType");
    if (expr.typeArgs[0]?.kind === "NamedType") {
      expect(expr.typeArgs[0].name).toBe("i32");
    }
    expect(expr.typeArgs[1]?.kind).toBe("NamedType");
    if (expr.typeArgs[1]?.kind === "NamedType") {
      expect(expr.typeArgs[1].name).toBe("string");
    }
    expect(expr.args).toHaveLength(2);
  });

  test("generic call with no args", () => {
    const expr = parseExpr("init<bool>()");
    expect(expr.kind).toBe("CallExpr");
    if (expr.kind !== "CallExpr") return;
    expect(expr.typeArgs).toHaveLength(1);
    expect(expr.args).toHaveLength(0);
  });

  test("non-generic call has empty typeArgs", () => {
    const expr = parseExpr("f(x, y)");
    expect(expr.kind).toBe("CallExpr");
    if (expr.kind !== "CallExpr") return;
    expect(expr.typeArgs).toHaveLength(0);
    expect(expr.args).toHaveLength(2);
  });

  test("comparison is NOT parsed as generic call", () => {
    // a < b > (c) should be binary comparisons, not a generic call
    const expr = parseExpr("a < b");
    expect(expr.kind).toBe("BinaryExpr");
    if (expr.kind !== "BinaryExpr") return;
    expect(expr.operator).toBe("<");
  });

  test("chained comparison not mistaken for generics", () => {
    const expr = parseExprStmt("x = a < b;");
    expect(expr.kind).toBe("AssignExpr");
    if (expr.kind !== "AssignExpr") return;
    expect(expr.value.kind).toBe("BinaryExpr");
  });

  test("generic call on member expression", () => {
    const expr = parseExpr("math.alloc<i32>(1)");
    expect(expr.kind).toBe("CallExpr");
    if (expr.kind !== "CallExpr") return;
    expect(expr.callee.kind).toBe("MemberExpr");
    expect(expr.typeArgs).toHaveLength(1);
    if (expr.typeArgs[0]?.kind === "NamedType") {
      expect(expr.typeArgs[0].name).toBe("i32");
    }
  });

  // ── Generic struct literals ────────────────────────────────────────

  test("generic struct literal with one type arg", () => {
    const expr = parseExpr("Box<i32>{ value: 42 }");
    expect(expr.kind).toBe("StructLiteral");
    if (expr.kind !== "StructLiteral") return;
    expect(expr.name).toBe("Box");
    expect(expr.typeArgs).toHaveLength(1);
    expect(expr.typeArgs[0]?.kind).toBe("NamedType");
    if (expr.typeArgs[0]?.kind === "NamedType") {
      expect(expr.typeArgs[0].name).toBe("i32");
    }
    expect(expr.fields).toHaveLength(1);
    expect(expr.fields[0]?.name).toBe("value");
  });

  test("generic struct literal with multiple type args", () => {
    const expr = parseExpr("Pair<i32, bool>{ first: 1, second: true }");
    expect(expr.kind).toBe("StructLiteral");
    if (expr.kind !== "StructLiteral") return;
    expect(expr.name).toBe("Pair");
    expect(expr.typeArgs).toHaveLength(2);
    if (expr.typeArgs[0]?.kind === "NamedType") {
      expect(expr.typeArgs[0].name).toBe("i32");
    }
    if (expr.typeArgs[1]?.kind === "NamedType") {
      expect(expr.typeArgs[1].name).toBe("bool");
    }
    expect(expr.fields).toHaveLength(2);
  });

  test("generic struct literal with identifier type arg", () => {
    const expr = parseExpr("Wrapper<MyType>{ data: p }");
    expect(expr.kind).toBe("StructLiteral");
    if (expr.kind !== "StructLiteral") return;
    expect(expr.typeArgs).toHaveLength(1);
    expect(expr.typeArgs[0]?.kind).toBe("NamedType");
    if (expr.typeArgs[0]?.kind === "NamedType") {
      expect(expr.typeArgs[0].name).toBe("MyType");
    }
  });

  test("non-generic struct literal has empty typeArgs", () => {
    const expr = parseExpr("Point{ x: 1, y: 2 }");
    expect(expr.kind).toBe("StructLiteral");
    if (expr.kind !== "StructLiteral") return;
    expect(expr.typeArgs).toHaveLength(0);
    expect(expr.fields).toHaveLength(2);
  });

  test("generic struct literal with empty body", () => {
    const expr = parseExpr("Empty<i32>{}");
    expect(expr.kind).toBe("StructLiteral");
    if (expr.kind !== "StructLiteral") return;
    expect(expr.name).toBe("Empty");
    expect(expr.typeArgs).toHaveLength(1);
    expect(expr.fields).toHaveLength(0);
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  test("generic call with user-defined type arg", () => {
    const expr = parseExpr("convert<MyType>(val)");
    expect(expr.kind).toBe("CallExpr");
    if (expr.kind !== "CallExpr") return;
    expect(expr.typeArgs).toHaveLength(1);
    if (expr.typeArgs[0]?.kind === "NamedType") {
      expect(expr.typeArgs[0].name).toBe("MyType");
    }
  });

  test("generic call with primitive type keywords", () => {
    const expr = parseExpr("cast<u64>(x)");
    expect(expr.kind).toBe("CallExpr");
    if (expr.kind !== "CallExpr") return;
    expect(expr.typeArgs).toHaveLength(1);
    if (expr.typeArgs[0]?.kind === "NamedType") {
      expect(expr.typeArgs[0].name).toBe("u64");
    }
  });
});
