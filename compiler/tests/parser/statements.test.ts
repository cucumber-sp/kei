import { describe, expect, test } from "bun:test";
import type { Statement } from "../../src/ast/nodes.ts";
import { parse } from "./helpers.ts";

function parseStatements(body: string): Statement[] {
  const program = parse(`fn test() { ${body} }`);
  // biome-ignore lint/style/noNonNullAssertion: test input guarantees declaration exists
  const fn = program.declarations[0]!;
  if (fn.kind !== "FunctionDecl") throw new Error("Expected FunctionDecl");
  return fn.body.statements;
}

function parseFirst(body: string): Statement {
  const stmts = parseStatements(body);
  // biome-ignore lint/style/noNonNullAssertion: test input guarantees statement exists
  return stmts[0]!;
}

describe("Parser — Statements", () => {
  test("let without type annotation", () => {
    const stmt = parseFirst("let x = 42;");
    expect(stmt.kind).toBe("LetStmt");
    if (stmt.kind !== "LetStmt") return;
    expect(stmt.name).toBe("x");
    expect(stmt.typeAnnotation).toBeNull();
  });

  test("let with type annotation", () => {
    const stmt = parseFirst("let x: int = 42;");
    if (stmt.kind !== "LetStmt") return;
    expect(stmt.name).toBe("x");
    expect(stmt.typeAnnotation).not.toBeNull();
  });

  test("const", () => {
    const stmt = parseFirst("const x = 42;");
    expect(stmt.kind).toBe("ConstStmt");
    if (stmt.kind !== "ConstStmt") return;
    expect(stmt.name).toBe("x");
  });

  test("return with value", () => {
    const stmt = parseFirst("return 42;");
    expect(stmt.kind).toBe("ReturnStmt");
    if (stmt.kind !== "ReturnStmt") return;
    expect(stmt.value).not.toBeNull();
  });

  test("return without value", () => {
    const stmt = parseFirst("return;");
    if (stmt.kind !== "ReturnStmt") return;
    expect(stmt.value).toBeNull();
  });

  test("if / else if / else", () => {
    const stmt = parseFirst("if x > 0 { a(); } else if x < 0 { b(); } else { c(); }");
    expect(stmt.kind).toBe("IfStmt");
    if (stmt.kind !== "IfStmt") return;
    expect(stmt.elseBlock).not.toBeNull();
    expect(stmt.elseBlock?.kind).toBe("IfStmt");
    if (stmt.elseBlock?.kind === "IfStmt") {
      expect(stmt.elseBlock?.elseBlock).not.toBeNull();
      expect(stmt.elseBlock?.elseBlock?.kind).toBe("BlockStmt");
    }
  });

  test("while", () => {
    const stmt = parseFirst("while x < 10 { x = x + 1; }");
    expect(stmt.kind).toBe("WhileStmt");
    if (stmt.kind !== "WhileStmt") return;
    expect(stmt.body.statements).toHaveLength(1);
  });

  test("c-style for", () => {
    const stmt = parseFirst("for (let i = 0; i < 10; i = i + 1) { x = i; }");
    expect(stmt.kind).toBe("CForStmt");
    if (stmt.kind !== "CForStmt") return;
    expect(stmt.init.kind).toBe("LetStmt");
    expect(stmt.init.name).toBe("i");
    expect(stmt.condition.kind).toBe("BinaryExpr");
    expect(stmt.update.kind).toBe("AssignExpr");
    expect(stmt.body.statements).toHaveLength(1);
  });

  test("for with index", () => {
    const stmt = parseFirst("for item, idx in collection { x = item; }");
    if (stmt.kind !== "ForStmt") return;
    expect(stmt.variable).toBe("item");
    expect(stmt.index).toBe("idx");
  });

  test("switch statement", () => {
    const stmt = parseFirst("switch val { case 1: x = 10; case 2, 3: x = 20; default: x = 0; }");
    expect(stmt.kind).toBe("SwitchStmt");
    if (stmt.kind !== "SwitchStmt") return;
    expect(stmt.cases).toHaveLength(3);
    expect(stmt.cases[0]?.values).toHaveLength(1);
    expect(stmt.cases[0]?.bindings).toBeNull();
    expect(stmt.cases[1]?.values).toHaveLength(2);
    expect(stmt.cases[1]?.bindings).toBeNull();
    expect(stmt.cases[2]?.isDefault).toBe(true);
    expect(stmt.cases[2]?.bindings).toBeNull();
  });

  test("switch case with destructuring bindings", () => {
    const stmt = parseFirst("switch val { case Circle(r): x = r; case Point: x = 0; }");
    expect(stmt.kind).toBe("SwitchStmt");
    if (stmt.kind !== "SwitchStmt") return;
    expect(stmt.cases).toHaveLength(2);
    expect(stmt.cases[0]?.values).toHaveLength(1);
    expect(stmt.cases[0]?.values[0]?.kind).toBe("Identifier");
    expect(stmt.cases[0]?.bindings).toEqual(["r"]);
    expect(stmt.cases[1]?.bindings).toBeNull();
  });

  test("switch case with multiple destructuring bindings", () => {
    const stmt = parseFirst("switch val { case Rect(w, h): x = w; }");
    expect(stmt.kind).toBe("SwitchStmt");
    if (stmt.kind !== "SwitchStmt") return;
    expect(stmt.cases[0]?.bindings).toEqual(["w", "h"]);
  });

  test("defer", () => {
    const stmt = parseFirst("defer cleanup();");
    expect(stmt.kind).toBe("DeferStmt");
    if (stmt.kind !== "DeferStmt") return;
    expect(stmt.statement.kind).toBe("ExprStmt");
  });

  test("break", () => {
    const stmt = parseFirst("break;");
    expect(stmt.kind).toBe("BreakStmt");
  });

  test("continue", () => {
    const stmt = parseFirst("continue;");
    expect(stmt.kind).toBe("ContinueStmt");
  });

  test("assert without message", () => {
    const stmt = parseFirst("assert(x > 0);");
    expect(stmt.kind).toBe("AssertStmt");
    if (stmt.kind !== "AssertStmt") return;
    expect(stmt.message).toBeNull();
  });

  test("assert with message", () => {
    const stmt = parseFirst('assert(x > 0, "x must be positive");');
    if (stmt.kind !== "AssertStmt") return;
    expect(stmt.message).not.toBeNull();
  });

  test("require without message", () => {
    const stmt = parseFirst("require(size > 0);");
    expect(stmt.kind).toBe("RequireStmt");
  });

  test("require with message", () => {
    const stmt = parseFirst('require(size > 0, "size must be positive");');
    if (stmt.kind !== "RequireStmt") return;
    expect(stmt.message).not.toBeNull();
  });

  test("unsafe block", () => {
    const stmt = parseFirst("unsafe { let x = 1; }");
    expect(stmt.kind).toBe("UnsafeBlock");
    if (stmt.kind !== "UnsafeBlock") return;
    expect(stmt.body.statements).toHaveLength(1);
  });

  test("nested blocks", () => {
    const stmt = parseFirst("{ let x = 1; { let y = 2; } }");
    expect(stmt.kind).toBe("BlockStmt");
    if (stmt.kind !== "BlockStmt") return;
    expect(stmt.statements).toHaveLength(2);
    expect(stmt.statements[1]?.kind).toBe("BlockStmt");
  });
});
