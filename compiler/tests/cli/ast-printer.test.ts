import { describe, expect, test } from "bun:test";
import { printAst } from "../../src/cli/ast-printer";
import { Lexer } from "../../src/lexer";
import { Parser } from "../../src/parser";
import { SourceFile } from "../../src/utils/source";

function captureLog(fn: () => void): string {
  const lines: string[] = [];
  const original = console.log;
  console.log = (msg?: unknown) => {
    lines.push(String(msg ?? ""));
  };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines.join("\n");
}

function printSource(src: string): string {
  const file = new SourceFile("test.kei", src);
  const lexer = new Lexer(file);
  const tokens = lexer.tokenize();
  const program = new Parser(tokens).parse();
  return captureLog(() => printAst(program as unknown as Record<string, unknown>, 0));
}

describe("printAst — Program shape", () => {
  test("renders empty Program with no children", () => {
    const out = printSource("");
    expect(out).toBe("Program");
  });

  test("renders Program header on its own line", () => {
    const out = printSource("fn main() -> int { return 0; }");
    const lines = out.split("\n");
    expect(lines[0]).toBe("Program");
  });
});

describe("printAst — real AST", () => {
  const source = "fn main() -> int { let x = 42; return 0; }";

  test("renders FunctionDecl with scalar fields inline", () => {
    const out = printSource(source);
    expect(out).toContain("FunctionDecl");
    expect(out).toContain("name=main");
  });

  test("skips 'kind' and 'span' fields", () => {
    const out = printSource(source);
    expect(out).not.toMatch(/kind=/);
    expect(out).not.toMatch(/span=/);
  });

  test("indents children by two spaces per level", () => {
    const out = printSource(source);
    const lines = out.split("\n");
    const fnLine = lines.find((l) => l.includes("FunctionDecl")) ?? "";
    expect(fnLine.startsWith("  ")).toBe(true); // indented under Program
  });

  test("recurses into named child node fields", () => {
    const out = printSource(source);
    expect(out).toContain("returnType:");
    expect(out).toContain("NamedType name=int");
  });

  test("recurses through nested children: body → statements → LetStmt → initializer → IntLiteral", () => {
    const out = printSource(source);
    expect(out).toContain("body:");
    expect(out).toContain("statements:");
    expect(out).toContain("LetStmt");
    expect(out).toContain("initializer:");
    expect(out).toContain("IntLiteral value=42");
  });

  test("renders empty arrays as bracketed lists inline", () => {
    const out = printSource(source);
    expect(out).toContain("params=[]");
    expect(out).toContain("genericParams=[]");
  });
});

describe("printAst — synthetic nodes", () => {
  test("handles a node with only scalar fields", () => {
    const out = captureLog(() => {
      printAst({ kind: "Stub", name: "x", value: 7 }, 0);
    });
    expect(out).toBe("Stub name=x value=7");
  });

  test("handles a node with no fields besides kind/span", () => {
    const out = captureLog(() => {
      printAst({ kind: "Empty", span: { start: 0, end: 0 } }, 0);
    });
    expect(out).toBe("Empty");
  });

  test("skips null and undefined fields", () => {
    const out = captureLog(() => {
      printAst({ kind: "WithNull", a: null, b: undefined, c: 3 }, 0);
    });
    expect(out).toBe("WithNull c=3");
  });

  test("respects custom indent level", () => {
    const out = captureLog(() => {
      printAst({ kind: "Foo", x: 1 }, 3);
    });
    expect(out).toBe("      Foo x=1"); // 3 * 2 spaces = 6 spaces
  });

  test("renders array of primitives as bracket-list", () => {
    const out = captureLog(() => {
      printAst({ kind: "Path", parts: ["a", "b", "c"] }, 0);
    });
    expect(out).toBe("Path parts=[a, b, c]");
  });

  test("recurses into a single child node", () => {
    const out = captureLog(() => {
      printAst(
        {
          kind: "Outer",
          inner: { kind: "Inner", value: 1 },
        },
        0
      );
    });
    expect(out).toBe(["Outer", "  inner:", "    Inner value=1"].join("\n"));
  });

  test("recurses into an array-of-nodes child", () => {
    const out = captureLog(() => {
      printAst(
        {
          kind: "Outer",
          items: [
            { kind: "A", v: 1 },
            { kind: "B", v: 2 },
          ],
        },
        0
      );
    });
    expect(out).toBe(["Outer", "  items:", "    A v=1", "    B v=2"].join("\n"));
  });

  test("treats empty arrays as scalar (bracket-list)", () => {
    const out = captureLog(() => {
      printAst({ kind: "Empty", items: [] }, 0);
    });
    // Empty arrays don't qualify as 'array of nodes' (length===0 path),
    // so they fall through to the scalar bracket-list rendering.
    expect(out).toBe("Empty items=[]");
  });
});
