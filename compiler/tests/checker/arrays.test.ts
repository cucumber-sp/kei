import { describe, expect, test } from "bun:test";
import { Checker } from "../../src/checker/checker.ts";
import type { Type } from "../../src/checker/types";
import { Lexer } from "../../src/lexer/index.ts";
import { Parser } from "../../src/parser/index.ts";
import { SourceFile } from "../../src/utils/source.ts";
import { checkError, checkOk } from "./helpers.ts";

/** Get type of a let-binding by name from checked source */
function typeOfLet(source: string, varName: string): Type {
  const file = new SourceFile("test.kei", source);
  const lexer = new Lexer(file);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const checker = new Checker(program, file);
  const result = checker.check();

  // Find the let statement and get the initializer type
  const mainDecl = program.declarations[0];
  if (mainDecl?.kind !== "FunctionDecl") throw new Error("Expected FunctionDecl");
  for (const stmt of mainDecl.body.statements) {
    if (stmt.kind === "LetStmt" && stmt.name === varName) {
      const type = result.typeMap.get(stmt.initializer);
      if (type) return type;
    }
  }
  throw new Error(`Let binding '${varName}' not found`);
}

describe("Checker — Array Literals", () => {
  test("array literal type inference from int elements", () => {
    checkOk(`
      fn main() -> int {
        let arr = [1, 2, 3];
        return 0;
      }
    `);
  });

  test("array literal infers element type", () => {
    const src = `fn main() -> int { let arr = [10, 20, 30]; return 0; }`;
    const t = typeOfLet(src, "arr");
    expect(t.kind).toBe("array");
    if (t.kind !== "array") return;
    expect(t.element.kind).toBe("int");
    expect(t.length).toBe(3);
  });

  test("empty array literal is an error", () => {
    checkError(`fn main() -> int { let arr = []; return 0; }`, "empty array literal");
  });

  test("mixed types in array literal", () => {
    checkError(`fn main() -> int { let arr = [1, "hello"]; return 0; }`, "expected 'i32'");
  });

  test("array indexing returns element type", () => {
    const src = `fn main() -> int { let arr = [1, 2, 3]; let x = arr[0]; return 0; }`;
    const t = typeOfLet(src, "x");
    expect(t.kind).toBe("int");
  });

  test("array index must be integer", () => {
    checkError(
      `fn main() -> int { let arr = [1, 2]; let x = arr[true]; return 0; }`,
      "index must be an integer"
    );
  });

  test("array .len returns usize", () => {
    const src = `fn main() -> int { let arr = [1, 2, 3]; let n = arr.len; return 0; }`;
    const t = typeOfLet(src, "n");
    expect(t.kind).toBe("int");
    if (t.kind !== "int") return;
    expect(t.bits).toBe(64);
    expect(t.signed).toBe(false);
  });

  test("cannot index non-array type", () => {
    checkError(`fn main() -> int { let x = 42; let y = x[0]; return 0; }`, "cannot index type");
  });

  test("array of booleans", () => {
    checkOk(`
      fn main() -> int {
        let flags = [true, false, true];
        return 0;
      }
    `);
  });

  test("array of strings", () => {
    checkOk(`
      fn main() -> int {
        let names = ["alice", "bob"];
        return 0;
      }
    `);
  });

  test("array index assignment type checks", () => {
    checkOk(`
      fn main() -> int {
        let arr = [1, 2, 3];
        arr[0] = 42;
        return 0;
      }
    `);
  });
});
