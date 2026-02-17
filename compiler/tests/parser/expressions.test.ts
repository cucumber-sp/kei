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

describe("Parser — Expressions", () => {
  test("precedence: 1 + 2 * 3", () => {
    const expr = parseExpr("1 + 2 * 3");
    expect(expr.kind).toBe("BinaryExpr");
    if (expr.kind !== "BinaryExpr") return;
    expect(expr.operator).toBe("+");
    expect(expr.left.kind).toBe("IntLiteral");
    expect(expr.right.kind).toBe("BinaryExpr");
    if (expr.right.kind === "BinaryExpr") {
      expect(expr.right.operator).toBe("*");
    }
  });

  test("unary minus", () => {
    const expr = parseExpr("-x");
    expect(expr.kind).toBe("UnaryExpr");
    if (expr.kind !== "UnaryExpr") return;
    expect(expr.operator).toBe("-");
  });

  test("unary bang", () => {
    const expr = parseExpr("!flag");
    if (expr.kind !== "UnaryExpr") return;
    expect(expr.operator).toBe("!");
  });

  test("unary tilde", () => {
    const expr = parseExpr("~bits");
    if (expr.kind !== "UnaryExpr") return;
    expect(expr.operator).toBe("~");
  });

  test("address-of", () => {
    const expr = parseExpr("&value");
    if (expr.kind !== "UnaryExpr") return;
    expect(expr.operator).toBe("&");
  });

  test("member access", () => {
    const expr = parseExpr("a.b");
    expect(expr.kind).toBe("MemberExpr");
    if (expr.kind !== "MemberExpr") return;
    expect(expr.property).toBe("b");
  });

  test("index access", () => {
    const expr = parseExpr("a[i]");
    expect(expr.kind).toBe("IndexExpr");
  });

  test("dereference", () => {
    const expr = parseExpr("a.*");
    expect(expr.kind).toBe("DerefExpr");
  });

  test("function call", () => {
    const expr = parseExpr("f(x, y)");
    expect(expr.kind).toBe("CallExpr");
    if (expr.kind !== "CallExpr") return;
    expect(expr.args).toHaveLength(2);
  });

  test("postfix increment", () => {
    const expr = parseExprStmt("a++;");
    expect(expr.kind).toBe("IncrementExpr");
  });

  test("postfix decrement", () => {
    const expr = parseExprStmt("a--;");
    expect(expr.kind).toBe("DecrementExpr");
  });

  test("chaining: a.b.c", () => {
    const expr = parseExpr("a.b.c");
    expect(expr.kind).toBe("MemberExpr");
    if (expr.kind !== "MemberExpr") return;
    expect(expr.property).toBe("c");
    expect(expr.object.kind).toBe("MemberExpr");
  });

  test("chaining: a[0].field", () => {
    const expr = parseExpr("a[0].field");
    expect(expr.kind).toBe("MemberExpr");
    if (expr.kind !== "MemberExpr") return;
    expect(expr.object.kind).toBe("IndexExpr");
  });

  test("chaining: f(x)(y)", () => {
    const expr = parseExpr("f(x)(y)");
    expect(expr.kind).toBe("CallExpr");
    if (expr.kind !== "CallExpr") return;
    expect(expr.callee.kind).toBe("CallExpr");
  });

  test("assignment", () => {
    const expr = parseExprStmt("x = 1;");
    expect(expr.kind).toBe("AssignExpr");
    if (expr.kind !== "AssignExpr") return;
    expect(expr.operator).toBe("=");
  });

  test("compound assignment", () => {
    const expr = parseExprStmt("x += 1;");
    if (expr.kind !== "AssignExpr") return;
    expect(expr.operator).toBe("+=");
  });

  test("shift assignment", () => {
    const expr = parseExprStmt("x <<= 2;");
    if (expr.kind !== "AssignExpr") return;
    expect(expr.operator).toBe("<<=");
  });

  test("right-associative assignment: a = b = c", () => {
    const expr = parseExprStmt("a = b = c;");
    expect(expr.kind).toBe("AssignExpr");
    if (expr.kind !== "AssignExpr") return;
    expect(expr.value.kind).toBe("AssignExpr");
  });

  test("struct literal", () => {
    const expr = parseExpr("Point{ x: 1.0, y: 2.0 }");
    expect(expr.kind).toBe("StructLiteral");
    if (expr.kind !== "StructLiteral") return;
    expect(expr.name).toBe("Point");
    expect(expr.fields).toHaveLength(2);
    expect(expr.fields[0]?.name).toBe("x");
  });

  test("if expression", () => {
    const expr = parseExpr("if a > b { a } else { b }");
    expect(expr.kind).toBe("IfExpr");
    if (expr.kind !== "IfExpr") return;
    expect(expr.thenBlock.statements).toHaveLength(1);
    expect(expr.elseBlock.statements).toHaveLength(1);
  });

  test("move expression", () => {
    const expr = parseExpr("move value");
    expect(expr.kind).toBe("MoveExpr");
  });

  test("catch block", () => {
    const program = parse(
      "fn test() { let x = getUser(10) catch { NotFound: return -1; DbError e: return -2; }; }"
    );
    // biome-ignore lint/style/noNonNullAssertion: test input guarantees declaration exists
    const fn = program.declarations[0]!;
    if (fn.kind !== "FunctionDecl") return;
    // biome-ignore lint/style/noNonNullAssertion: test input guarantees statement exists
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "LetStmt") return;
    const expr = stmt.initializer;
    expect(expr.kind).toBe("CatchExpr");
    if (expr.kind !== "CatchExpr") return;
    expect(expr.catchType).toBe("block");
    expect(expr.clauses).toHaveLength(2);
    expect(expr.clauses[0]?.errorType).toBe("NotFound");
    expect(expr.clauses[1]?.varName).toBe("e");
  });

  test("catch panic", () => {
    const expr = parseExpr("getUser(10) catch panic");
    expect(expr.kind).toBe("CatchExpr");
    if (expr.kind !== "CatchExpr") return;
    expect(expr.catchType).toBe("panic");
  });

  test("catch throw", () => {
    const expr = parseExpr("getUser(10) catch throw");
    if (expr.kind !== "CatchExpr") return;
    expect(expr.catchType).toBe("throw");
  });

  test("throw expression", () => {
    const expr = parseExpr("throw NotFound{}");
    expect(expr.kind).toBe("ThrowExpr");
    if (expr.kind !== "ThrowExpr") return;
    expect(expr.value.kind).toBe("StructLiteral");
  });

  test("grouping", () => {
    const expr = parseExpr("(a + b) * c");
    expect(expr.kind).toBe("BinaryExpr");
    if (expr.kind !== "BinaryExpr") return;
    expect(expr.operator).toBe("*");
    expect(expr.left.kind).toBe("GroupExpr");
  });

  test("int literal", () => {
    const expr = parseExpr("42");
    expect(expr.kind).toBe("IntLiteral");
    if (expr.kind !== "IntLiteral") return;
    expect(expr.value).toBe(42);
  });

  test("float literal", () => {
    const expr = parseExpr("3.14");
    expect(expr.kind).toBe("FloatLiteral");
    if (expr.kind !== "FloatLiteral") return;
    expect(expr.value).toBeCloseTo(3.14);
  });

  test("string literal", () => {
    const expr = parseExpr('"hello"');
    expect(expr.kind).toBe("StringLiteral");
    if (expr.kind !== "StringLiteral") return;
    expect(expr.value).toBe("hello");
  });

  test("bool literals", () => {
    expect(parseExpr("true").kind).toBe("BoolLiteral");
    expect(parseExpr("false").kind).toBe("BoolLiteral");
  });

  test("null literal", () => {
    expect(parseExpr("null").kind).toBe("NullLiteral");
  });

  test("complex: arr[i + 1].method(a * b, c) catch panic", () => {
    const expr = parseExpr("arr[i + 1].method(a * b, c) catch panic");
    expect(expr.kind).toBe("CatchExpr");
    if (expr.kind !== "CatchExpr") return;
    expect(expr.operand.kind).toBe("CallExpr");
  });

  test("logical operators precedence: a < b && c > d", () => {
    const expr = parseExpr("a < b && c > d");
    expect(expr.kind).toBe("BinaryExpr");
    if (expr.kind !== "BinaryExpr") return;
    expect(expr.operator).toBe("&&");
    expect(expr.left.kind).toBe("BinaryExpr");
    expect(expr.right.kind).toBe("BinaryExpr");
  });

  test("bitwise operators", () => {
    const expr = parseExpr("a & b | c ^ d");
    // | has lowest precedence of the three
    expect(expr.kind).toBe("BinaryExpr");
    if (expr.kind !== "BinaryExpr") return;
    expect(expr.operator).toBe("|");
  });

  test("range expression", () => {
    const expr = parseExpr("0..10");
    expect(expr.kind).toBe("RangeExpr");
    if (expr.kind !== "RangeExpr") return;
    expect(expr.inclusive).toBe(false);
  });

  test("empty struct literal", () => {
    const expr = parseExpr("NotFound{}");
    expect(expr.kind).toBe("StructLiteral");
    if (expr.kind !== "StructLiteral") return;
    expect(expr.name).toBe("NotFound");
    expect(expr.fields).toHaveLength(0);
  });

  test("unsafe expression", () => {
    const expr = parseExpr("unsafe { alloc(1024) }");
    expect(expr.kind).toBe("UnsafeExpr");
    if (expr.kind !== "UnsafeExpr") return;
    expect(expr.body.statements).toHaveLength(1);
    // biome-ignore lint/style/noNonNullAssertion: test input guarantees statement exists
    const inner = expr.body.statements[0]!;
    expect(inner.kind).toBe("ExprStmt");
    if (inner.kind !== "ExprStmt") return;
    expect(inner.expression.kind).toBe("CallExpr");
  });

  test("unsafe expression with address-of", () => {
    const expr = parseExpr("unsafe { &x }");
    expect(expr.kind).toBe("UnsafeExpr");
    if (expr.kind !== "UnsafeExpr") return;
    expect(expr.body.statements).toHaveLength(1);
    // biome-ignore lint/style/noNonNullAssertion: test input guarantees statement exists
    const inner = expr.body.statements[0]!;
    if (inner.kind !== "ExprStmt") return;
    expect(inner.expression.kind).toBe("UnaryExpr");
  });

  test("deref then member: a.*.x", () => {
    const expr = parseExpr("a.*.x");
    expect(expr.kind).toBe("MemberExpr");
    if (expr.kind !== "MemberExpr") return;
    expect(expr.property).toBe("x");
    expect(expr.object.kind).toBe("DerefExpr");
  });
});
