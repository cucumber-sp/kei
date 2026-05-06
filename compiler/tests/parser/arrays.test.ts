import { describe, expect, test } from "bun:test";
import type { Expression } from "../../src/ast/nodes";
import { parse } from "./helpers";

function parseExpr(exprStr: string): Expression {
  const program = parse(`fn test() { let _r = ${exprStr}; }`);
  const fn = program.declarations[0]!;
  if (fn.kind !== "FunctionDecl") throw new Error("Expected FunctionDecl");
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
    const program = parse("fn test() { let a = [1]; let b = a[0]; }");
    const fn = program.declarations[0]!;
    if (fn.kind !== "FunctionDecl") return;
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

describe("Parser — inline<T, N> type", () => {
  test("inline<int, 4> parses as GenericType with element + integer length", () => {
    const program = parse("fn test() { let a: inline<int, 4> = [1, 2, 3, 4]; }");
    const fn = program.declarations[0]!;
    if (fn.kind !== "FunctionDecl") return;
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "LetStmt") return;
    const ann = stmt.typeAnnotation;
    expect(ann?.kind).toBe("GenericType");
    if (ann?.kind !== "GenericType") return;
    expect(ann.name).toBe("inline");
    expect(ann.typeArgs.length).toBe(2);
    expect(ann.typeArgs[0]?.kind).toBe("NamedType");
    if (ann.typeArgs[0]?.kind === "NamedType") {
      expect(ann.typeArgs[0].name).toBe("int");
    }
    // Length: parsed as a NamedType whose name is the integer literal text
    expect(ann.typeArgs[1]?.kind).toBe("NamedType");
    if (ann.typeArgs[1]?.kind === "NamedType") {
      expect(ann.typeArgs[1].name).toBe("4");
    }
  });

  test("inline<bool, 1> parses with single-element length", () => {
    const program = parse("fn test() { let a: inline<bool, 1> = [true]; }");
    const fn = program.declarations[0]!;
    if (fn.kind !== "FunctionDecl") return;
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "LetStmt") return;
    const ann = stmt.typeAnnotation;
    if (ann?.kind !== "GenericType") return;
    expect(ann.name).toBe("inline");
    if (ann.typeArgs[1]?.kind === "NamedType") {
      expect(ann.typeArgs[1].name).toBe("1");
    }
  });

  test("inline accepted in struct field declaration", () => {
    const program = parse("struct S { data: inline<int, 8>; }");
    const decl = program.declarations[0]!;
    if (decl.kind !== "StructDecl") return;
    expect(decl.fields[0]?.name).toBe("data");
    const ft = decl.fields[0]?.typeAnnotation;
    expect(ft?.kind).toBe("GenericType");
    if (ft?.kind === "GenericType") {
      expect(ft.name).toBe("inline");
    }
  });

  test("inline accepted in function parameter type", () => {
    const program = parse("fn f(xs: inline<int, 3>) -> int { return 0; }");
    const fn = program.declarations[0]!;
    if (fn.kind !== "FunctionDecl") return;
    const param = fn.params[0]!;
    expect(param.name).toBe("xs");
    expect(param.typeAnnotation.kind).toBe("GenericType");
    if (param.typeAnnotation.kind === "GenericType") {
      expect(param.typeAnnotation.name).toBe("inline");
    }
  });
});
