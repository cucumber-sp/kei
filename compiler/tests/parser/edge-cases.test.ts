import { describe, expect, test } from "bun:test";
import type { Expression } from "../../src/ast/nodes.ts";
import { parse, parseWithDiagnostics } from "./helpers.ts";

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

describe("Parser — Edge Cases", () => {
  describe("deeply nested expressions", () => {
    test("nested parenthesized arithmetic: ((((1 + 2) * 3) - 4) / 5)", () => {
      const expr = parseExpr("((((1 + 2) * 3) - 4) / 5)");
      expect(expr.kind).toBe("GroupExpr");
      if (expr.kind !== "GroupExpr") return;
      const inner = expr.expression;
      expect(inner.kind).toBe("BinaryExpr");
      if (inner.kind !== "BinaryExpr") return;
      expect(inner.operator).toBe("/");
      expect(inner.left.kind).toBe("GroupExpr");
    });

    test("deeply nested function calls: f(g(h(x)))", () => {
      const expr = parseExpr("f(g(h(x)))");
      expect(expr.kind).toBe("CallExpr");
      if (expr.kind !== "CallExpr") return;
      expect(expr.args[0]?.kind).toBe("CallExpr");
      // biome-ignore lint/style/noNonNullAssertion: test input guarantees element exists
      const inner = expr.args[0]!;
      if (inner.kind !== "CallExpr") return;
      expect(inner.args[0]?.kind).toBe("CallExpr");
    });

    test("nested member access + index: a.b[0].c.d[1]", () => {
      const expr = parseExpr("a.b[0].c.d[1]");
      expect(expr.kind).toBe("IndexExpr");
      if (expr.kind !== "IndexExpr") return;
      expect(expr.object.kind).toBe("MemberExpr");
    });

    test("nested if-expressions", () => {
      const expr = parseExpr("if true { if false { 1 } else { 2 } } else { 3 }");
      expect(expr.kind).toBe("IfExpr");
      if (expr.kind !== "IfExpr") return;
      expect(expr.thenBlock.statements[0]?.kind).toBe("ExprStmt");
    });
  });

  describe("operator precedence", () => {
    test("1 + 2 * 3 parses as 1 + (2 * 3)", () => {
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

    test("1 * 2 + 3 parses as (1 * 2) + 3", () => {
      const expr = parseExpr("1 * 2 + 3");
      expect(expr.kind).toBe("BinaryExpr");
      if (expr.kind !== "BinaryExpr") return;
      expect(expr.operator).toBe("+");
      expect(expr.left.kind).toBe("BinaryExpr");
      if (expr.left.kind === "BinaryExpr") {
        expect(expr.left.operator).toBe("*");
      }
    });

    test("comparison lower than arithmetic: 1 + 2 < 3 + 4", () => {
      const expr = parseExpr("1 + 2 < 3 + 4");
      expect(expr.kind).toBe("BinaryExpr");
      if (expr.kind !== "BinaryExpr") return;
      expect(expr.operator).toBe("<");
      expect(expr.left.kind).toBe("BinaryExpr");
      expect(expr.right.kind).toBe("BinaryExpr");
    });

    test("logical AND lower than comparison: a < b && c > d", () => {
      const expr = parseExpr("a < b && c > d");
      expect(expr.kind).toBe("BinaryExpr");
      if (expr.kind !== "BinaryExpr") return;
      expect(expr.operator).toBe("&&");
    });

    test("logical OR lower than AND: a && b || c && d", () => {
      const expr = parseExpr("a && b || c && d");
      expect(expr.kind).toBe("BinaryExpr");
      if (expr.kind !== "BinaryExpr") return;
      expect(expr.operator).toBe("||");
      expect(expr.left.kind).toBe("BinaryExpr");
      expect(expr.right.kind).toBe("BinaryExpr");
    });

    test("shift lower than additive: a + b << c", () => {
      const expr = parseExpr("a + b << c");
      expect(expr.kind).toBe("BinaryExpr");
      if (expr.kind !== "BinaryExpr") return;
      expect(expr.operator).toBe("<<");
      expect(expr.left.kind).toBe("BinaryExpr");
    });

    test("bitwise AND, XOR, OR precedence: a & b ^ c | d", () => {
      const expr = parseExpr("a & b ^ c | d");
      expect(expr.kind).toBe("BinaryExpr");
      if (expr.kind !== "BinaryExpr") return;
      // | is lowest
      expect(expr.operator).toBe("|");
    });

    test("modulo same precedence as multiply: a % b * c", () => {
      const expr = parseExpr("a % b * c");
      expect(expr.kind).toBe("BinaryExpr");
      if (expr.kind !== "BinaryExpr") return;
      // left-to-right: (a % b) * c
      expect(expr.operator).toBe("*");
      expect(expr.left.kind).toBe("BinaryExpr");
      if (expr.left.kind === "BinaryExpr") {
        expect(expr.left.operator).toBe("%");
      }
    });

    test("unary minus higher than binary: -a * b parses as (-a) * b", () => {
      const expr = parseExpr("-a * b");
      expect(expr.kind).toBe("BinaryExpr");
      if (expr.kind !== "BinaryExpr") return;
      expect(expr.operator).toBe("*");
      expect(expr.left.kind).toBe("UnaryExpr");
    });
  });

  describe("unary expressions", () => {
    test("double negation: -(-x)", () => {
      const expr = parseExpr("-(-x)");
      expect(expr.kind).toBe("UnaryExpr");
      if (expr.kind !== "UnaryExpr") return;
      expect(expr.operator).toBe("-");
      expect(expr.operand.kind).toBe("GroupExpr");
    });

    test("negation of literal: -1", () => {
      const expr = parseExpr("-1");
      expect(expr.kind).toBe("UnaryExpr");
      if (expr.kind !== "UnaryExpr") return;
      expect(expr.operator).toBe("-");
      expect(expr.operand.kind).toBe("IntLiteral");
    });

    test("logical not of comparison: !(a > b)", () => {
      const expr = parseExpr("!(a > b)");
      expect(expr.kind).toBe("UnaryExpr");
      if (expr.kind !== "UnaryExpr") return;
      expect(expr.operator).toBe("!");
      expect(expr.operand.kind).toBe("GroupExpr");
    });

    test("bitwise not: ~x", () => {
      const expr = parseExpr("~x");
      expect(expr.kind).toBe("UnaryExpr");
      if (expr.kind !== "UnaryExpr") return;
      expect(expr.operator).toBe("~");
    });

    test("address-of in complex expression: unsafe { &arr[0] }", () => {
      const expr = parseExpr("unsafe { &arr[0] }");
      expect(expr.kind).toBe("UnsafeExpr");
    });
  });

  describe("trailing commas", () => {
    test("trailing comma in struct literal fields", () => {
      const expr = parseExpr("Point{ x: 1.0, y: 2.0, }");
      expect(expr.kind).toBe("StructLiteral");
      if (expr.kind !== "StructLiteral") return;
      expect(expr.fields).toHaveLength(2);
    });

    test("trailing comma in enum variants", () => {
      const program = parse("enum Dir : u8 { Up = 0, Down = 1, }");
      // biome-ignore lint/style/noNonNullAssertion: test input guarantees declaration exists
      const e = program.declarations[0]!;
      if (e.kind !== "EnumDecl") return;
      expect(e.variants).toHaveLength(2);
    });
  });

  describe("empty and minimal constructs", () => {
    test("empty function body", () => {
      const { program, diagnostics } = parseWithDiagnostics("fn empty() { }");
      expect(diagnostics).toHaveLength(0);
      // biome-ignore lint/style/noNonNullAssertion: test input guarantees declaration exists
      const fn = program.declarations[0]!;
      if (fn.kind !== "FunctionDecl") return;
      expect(fn.body.statements).toHaveLength(0);
    });

    test("empty struct", () => {
      const program = parse("struct Empty {}");
      // biome-ignore lint/style/noNonNullAssertion: test input guarantees declaration exists
      const s = program.declarations[0]!;
      expect(s.kind).toBe("StructDecl");
      if (s.kind !== "StructDecl") return;
      expect(s.fields).toHaveLength(0);
      expect(s.methods).toHaveLength(0);
    });

    test("empty enum", () => {
      const program = parse("enum Nothing : u8 {}");
      // biome-ignore lint/style/noNonNullAssertion: test input guarantees declaration exists
      const e = program.declarations[0]!;
      expect(e.kind).toBe("EnumDecl");
      if (e.kind !== "EnumDecl") return;
      expect(e.variants).toHaveLength(0);
    });

    test("function with single return", () => {
      const program = parse("fn identity() -> int { return 42; }");
      // biome-ignore lint/style/noNonNullAssertion: test input guarantees declaration exists
      const fn = program.declarations[0]!;
      if (fn.kind !== "FunctionDecl") return;
      expect(fn.body.statements).toHaveLength(1);
      expect(fn.body.statements[0]?.kind).toBe("ReturnStmt");
    });
  });

  describe("multiple statements", () => {
    test("multiple statements on separate lines", () => {
      const program = parse(`
        fn test() {
          let a = 1;
          let b = 2;
          let c = a + b;
        }
      `);
      // biome-ignore lint/style/noNonNullAssertion: test input guarantees declaration exists
      const fn = program.declarations[0]!;
      if (fn.kind !== "FunctionDecl") return;
      expect(fn.body.statements).toHaveLength(3);
    });

    test("multiple declarations in program", () => {
      const program = parse(`
        struct A { x: int; }
        struct B { y: int; }
        fn foo() -> int { return 0; }
        fn bar() -> int { return 1; }
      `);
      expect(program.declarations).toHaveLength(4);
    });
  });

  describe("string and literal edge cases", () => {
    test("string with escape sequences parses", () => {
      const expr = parseExpr('"hello\\nworld\\t!"');
      expect(expr.kind).toBe("StringLiteral");
    });

    test("empty string literal", () => {
      const expr = parseExpr('""');
      expect(expr.kind).toBe("StringLiteral");
      if (expr.kind !== "StringLiteral") return;
      expect(expr.value).toBe("");
    });

    test("large integer literal", () => {
      const expr = parseExpr("2147483647");
      expect(expr.kind).toBe("IntLiteral");
      if (expr.kind !== "IntLiteral") return;
      expect(expr.value).toBe(2147483647);
    });

    test("hex literal in expression", () => {
      const expr = parseExpr("0xFF");
      expect(expr.kind).toBe("IntLiteral");
      if (expr.kind !== "IntLiteral") return;
      expect(expr.value).toBe(255);
    });

    test("binary literal in expression", () => {
      const expr = parseExpr("0b1010");
      expect(expr.kind).toBe("IntLiteral");
      if (expr.kind !== "IntLiteral") return;
      expect(expr.value).toBe(10);
    });

    test("octal literal in expression", () => {
      const expr = parseExpr("0o77");
      expect(expr.kind).toBe("IntLiteral");
      if (expr.kind !== "IntLiteral") return;
      expect(expr.value).toBe(63);
    });

    test("float with exponent", () => {
      const expr = parseExpr("1.5e10");
      expect(expr.kind).toBe("FloatLiteral");
    });

    test("zero literal", () => {
      const expr = parseExpr("0");
      expect(expr.kind).toBe("IntLiteral");
      if (expr.kind !== "IntLiteral") return;
      expect(expr.value).toBe(0);
    });
  });

  describe("identifier edge cases", () => {
    test("very long identifier name", () => {
      const longName = "a".repeat(200);
      const program = parse(`fn ${longName}() -> int { return 0; }`);
      // biome-ignore lint/style/noNonNullAssertion: test input guarantees declaration exists
      const fn = program.declarations[0]!;
      if (fn.kind !== "FunctionDecl") return;
      expect(fn.name).toBe(longName);
    });

    test("identifiers with underscores", () => {
      const program = parse("fn _my_func(_a: int, __b: int) -> int { return _a; }");
      // biome-ignore lint/style/noNonNullAssertion: test input guarantees declaration exists
      const fn = program.declarations[0]!;
      if (fn.kind !== "FunctionDecl") return;
      expect(fn.name).toBe("_my_func");
      expect(fn.params[0]?.name).toBe("_a");
      expect(fn.params[1]?.name).toBe("__b");
    });

    test("single character identifier", () => {
      const expr = parseExpr("x");
      expect(expr.kind).toBe("Identifier");
      if (expr.kind !== "Identifier") return;
      expect(expr.name).toBe("x");
    });
  });

  describe("comments in various positions", () => {
    test("comment before function", () => {
      const { program, diagnostics } = parseWithDiagnostics(`
        // This is a function
        fn foo() -> int { return 0; }
      `);
      expect(diagnostics).toHaveLength(0);
      expect(program.declarations).toHaveLength(1);
    });

    test("comment inside function body", () => {
      const { program, diagnostics } = parseWithDiagnostics(`
        fn foo() -> int {
          // compute result
          let x = 42;
          /* inline */ return x;
        }
      `);
      expect(diagnostics).toHaveLength(0);
      // biome-ignore lint/style/noNonNullAssertion: test input guarantees declaration exists
      const fn = program.declarations[0]!;
      if (fn.kind !== "FunctionDecl") return;
      expect(fn.body.statements).toHaveLength(2);
    });

    test("block comment between tokens", () => {
      const { program, diagnostics } = parseWithDiagnostics(
        "fn /* comment */ test() /* another */ -> int { return /* here */ 0; }"
      );
      expect(diagnostics).toHaveLength(0);
      // biome-ignore lint/style/noNonNullAssertion: test input guarantees declaration exists
      const fn = program.declarations[0]!;
      if (fn.kind !== "FunctionDecl") return;
      expect(fn.name).toBe("test");
    });

    test("comment between struct fields", () => {
      const program = parse(`
        struct Point {
          // x coordinate
          x: f64;
          /* y coordinate */
          y: f64;
        }
      `);
      // biome-ignore lint/style/noNonNullAssertion: test input guarantees declaration exists
      const s = program.declarations[0]!;
      if (s.kind !== "StructDecl") return;
      expect(s.fields).toHaveLength(2);
    });
  });

  describe("complex expression combinations", () => {
    test("method chain: a.b().c().d", () => {
      const expr = parseExpr("a.b().c().d");
      expect(expr.kind).toBe("MemberExpr");
      if (expr.kind !== "MemberExpr") return;
      expect(expr.property).toBe("d");
      expect(expr.object.kind).toBe("CallExpr");
    });

    test("struct literal in function call", () => {
      const expr = parseExpr("process(Point{ x: 1.0, y: 2.0 })");
      expect(expr.kind).toBe("CallExpr");
      if (expr.kind !== "CallExpr") return;
      expect(expr.args).toHaveLength(1);
      expect(expr.args[0]?.kind).toBe("StructLiteral");
    });

    test("if expression as function argument", () => {
      const expr = parseExpr("f(if true { 1 } else { 2 })");
      expect(expr.kind).toBe("CallExpr");
      if (expr.kind !== "CallExpr") return;
      expect(expr.args).toHaveLength(1);
      expect(expr.args[0]?.kind).toBe("IfExpr");
    });

    test("inclusive range: 0..=10", () => {
      const expr = parseExpr("0..=10");
      expect(expr.kind).toBe("RangeExpr");
      if (expr.kind !== "RangeExpr") return;
      expect(expr.inclusive).toBe(true);
    });

    test("multiple compound assignments parse", () => {
      const program = parse(`
        fn test() {
          let x = 1;
          x += 2;
          x -= 3;
          x *= 4;
          x /= 5;
          x %= 6;
          x &= 7;
          x |= 8;
          x ^= 9;
          x <<= 1;
          x >>= 2;
        }
      `);
      // biome-ignore lint/style/noNonNullAssertion: test input guarantees declaration exists
      const fn = program.declarations[0]!;
      if (fn.kind !== "FunctionDecl") return;
      // let + 10 assignments = 11
      expect(fn.body.statements).toHaveLength(11);
    });

    test("deref then index: p->arr[0]", () => {
      const expr = parseExpr("p->arr[0]");
      expect(expr.kind).toBe("IndexExpr");
      if (expr.kind !== "IndexExpr") return;
      expect(expr.object.kind).toBe("MemberExpr");
    });

    test("sizeof parsed as call-like expression", () => {
      const program = parse("fn test() { let s = sizeof(Point); }");
      // biome-ignore lint/style/noNonNullAssertion: test input guarantees declaration exists
      const fn = program.declarations[0]!;
      if (fn.kind !== "FunctionDecl") return;
      expect(fn.body.statements).toHaveLength(1);
    });

    test("sizeof with primitive type keywords", () => {
      const primitives = [
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
        "bool",
        "string",
      ];
      for (const prim of primitives) {
        const expr = parseExpr(`sizeof(${prim})`);
        expect(expr.kind).toBe("CallExpr");
        if (expr.kind !== "CallExpr") continue;
        expect(expr.args).toHaveLength(1);
        expect(expr.args[0].kind).toBe("Identifier");
        if (expr.args[0].kind === "Identifier") {
          expect(expr.args[0].name).toBe(prim);
        }
      }
    });
  });

  describe("parser error recovery", () => {
    test("missing closing paren in call", () => {
      const { diagnostics } = parseWithDiagnostics("fn test() { f(a, b; }");
      expect(diagnostics.length).toBeGreaterThan(0);
    });

    test("missing type in let", () => {
      const { diagnostics } = parseWithDiagnostics("fn test() { let x: = 42; }");
      expect(diagnostics.length).toBeGreaterThan(0);
    });

    test("double semicolons are ok (empty statement-ish)", () => {
      // The parser may or may not error on double semicolons
      // depending on implementation; just verify it doesn't crash
      const { program } = parseWithDiagnostics("fn test() { let x = 42;; }");
      expect(program.declarations.length).toBeGreaterThanOrEqual(1);
    });

    test("missing return type arrow", () => {
      const { diagnostics } = parseWithDiagnostics("fn test() int { return 0; }");
      expect(diagnostics.length).toBeGreaterThan(0);
    });
  });

  describe("generic and complex declarations", () => {
    test("generic function with multiple type params", () => {
      const program = parse("fn pair<A, B>(a: A, b: B) -> A { return a; }");
      // biome-ignore lint/style/noNonNullAssertion: test input guarantees declaration exists
      const fn = program.declarations[0]!;
      if (fn.kind !== "FunctionDecl") return;
      expect(fn.genericParams).toEqual(["A", "B"]);
    });

    test("struct with methods and fields interleaved", () => {
      const program = parse(`
        struct Vec2 {
          x: f64;
          y: f64;
          fn length(self: Vec2) -> f64 { return self.x; }
          fn zero() -> Vec2 { return Vec2{ x: 0.0, y: 0.0 }; }
        }
      `);
      // biome-ignore lint/style/noNonNullAssertion: test input guarantees declaration exists
      const s = program.declarations[0]!;
      if (s.kind !== "StructDecl") return;
      expect(s.fields).toHaveLength(2);
      expect(s.methods).toHaveLength(2);
    });

    test("enum with trailing comma in variants", () => {
      const program = parse("enum Dir : u8 { Up = 0, Down = 1, Left = 2, Right = 3, }");
      // biome-ignore lint/style/noNonNullAssertion: test input guarantees declaration exists
      const e = program.declarations[0]!;
      if (e.kind !== "EnumDecl") return;
      expect(e.variants).toHaveLength(4);
    });

    test("data enum with mixed variant types", () => {
      const program = parse(`
        enum Result {
          Ok(value: int),
          Err(message: string, code: int),
          Unknown
        }
      `);
      // biome-ignore lint/style/noNonNullAssertion: test input guarantees declaration exists
      const e = program.declarations[0]!;
      if (e.kind !== "EnumDecl") return;
      expect(e.variants).toHaveLength(3);
      expect(e.variants[0]?.fields).toHaveLength(1);
      expect(e.variants[1]?.fields).toHaveLength(2);
      expect(e.variants[2]?.fields).toHaveLength(0);
    });

    test("type alias for pointer type", () => {
      const program = parse("type IntPtr = ptr<int>;");
      // biome-ignore lint/style/noNonNullAssertion: test input guarantees declaration exists
      const t = program.declarations[0]!;
      expect(t.kind).toBe("TypeAlias");
      if (t.kind !== "TypeAlias") return;
      expect(t.name).toBe("IntPtr");
    });
  });
});
