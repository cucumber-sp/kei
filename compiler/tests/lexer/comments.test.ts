/**
 * Tests for comment handling
 */

import { describe, expect, test } from "bun:test";
import { Severity } from "../../src/errors/index.ts";
import { Lexer, TokenKind } from "../../src/lexer/index.ts";
import { SourceFile } from "../../src/utils/source.ts";

describe("Comments", () => {
  describe("Single-line comments", () => {
    test("should skip single-line comments", () => {
      const source = new SourceFile("test.kei", "// This is a comment\nlet x = 42;");
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();

      // let, x, =, 42, ;, EOF
      expect(tokens).toHaveLength(6);
      expect(tokens[0].kind).toBe(TokenKind.Let);
      expect(tokens[1].kind).toBe(TokenKind.Identifier);
      expect(tokens[1].lexeme).toBe("x");
      expect(tokens[2].kind).toBe(TokenKind.Equal);
      expect(tokens[3].kind).toBe(TokenKind.IntLiteral);
      expect(tokens[3].value).toBe(42);
      expect(tokens[4].kind).toBe(TokenKind.Semicolon);
      expect(tokens[5].kind).toBe(TokenKind.Eof);

      expect(lexer.getDiagnostics()).toHaveLength(0);
    });

    test("should handle comment at end of line", () => {
      const source = new SourceFile("test.kei", "let x = 42; // This is an end-of-line comment");
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();

      // let, x, =, 42, ;, EOF
      expect(tokens).toHaveLength(6);
      expect(tokens[0].kind).toBe(TokenKind.Let);
      expect(tokens[4].kind).toBe(TokenKind.Semicolon);
      expect(tokens[5].kind).toBe(TokenKind.Eof);

      expect(lexer.getDiagnostics()).toHaveLength(0);
    });

    test("should handle multiple single-line comments", () => {
      const source = new SourceFile(
        "test.kei",
        `
        // First comment
        let x = 1; // Comment after code
        // Another comment
        let y = 2;
        // Final comment
      `
      );
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();

      // let, x, =, 1, ;, let, y, =, 2, ;, EOF
      expect(tokens).toHaveLength(11);

      expect(tokens[0].kind).toBe(TokenKind.Let);
      expect(tokens[1].lexeme).toBe("x");
      expect(tokens[3].value).toBe(1);
      expect(tokens[5].kind).toBe(TokenKind.Let);
      expect(tokens[6].lexeme).toBe("y");
      expect(tokens[8].value).toBe(2);
      expect(tokens[10].kind).toBe(TokenKind.Eof);

      expect(lexer.getDiagnostics()).toHaveLength(0);
    });

    test("should handle comment at end of file", () => {
      const source = new SourceFile("test.kei", "let x = 42; // Comment at EOF");
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();

      // let, x, =, 42, ;, EOF
      expect(tokens).toHaveLength(6);
      expect(tokens[5].kind).toBe(TokenKind.Eof);

      expect(lexer.getDiagnostics()).toHaveLength(0);
    });

    test("should handle empty comment", () => {
      const source = new SourceFile("test.kei", "let x = 42; //");
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();

      // let, x, =, 42, ;, EOF
      expect(tokens).toHaveLength(6);
      expect(tokens[5].kind).toBe(TokenKind.Eof);

      expect(lexer.getDiagnostics()).toHaveLength(0);
    });

    test("should handle comment with only whitespace", () => {
      const source = new SourceFile("test.kei", "let x = 42; //   \t   ");
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();

      expect(tokens).toHaveLength(6);
      expect(tokens[5].kind).toBe(TokenKind.Eof);

      expect(lexer.getDiagnostics()).toHaveLength(0);
    });
  });

  describe("Multi-line comments", () => {
    test("should skip multi-line comments", () => {
      const source = new SourceFile("test.kei", "/* This is a\nmulti-line comment */\nlet x = 42;");
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();

      // let, x, =, 42, ;, EOF
      expect(tokens).toHaveLength(6);
      expect(tokens[0].kind).toBe(TokenKind.Let);
      expect(tokens[1].lexeme).toBe("x");
      expect(tokens[2].kind).toBe(TokenKind.Equal);
      expect(tokens[3].value).toBe(42);
      expect(tokens[4].kind).toBe(TokenKind.Semicolon);
      expect(tokens[5].kind).toBe(TokenKind.Eof);

      expect(lexer.getDiagnostics()).toHaveLength(0);
    });

    test("should handle inline multi-line comments", () => {
      const source = new SourceFile("test.kei", "let x = /* inline comment */ 42;");
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();

      // let, x, =, 42, ;, EOF
      expect(tokens).toHaveLength(6);
      expect(tokens[0].kind).toBe(TokenKind.Let);
      expect(tokens[1].lexeme).toBe("x");
      expect(tokens[2].kind).toBe(TokenKind.Equal);
      expect(tokens[3].value).toBe(42);
      expect(tokens[4].kind).toBe(TokenKind.Semicolon);
      expect(tokens[5].kind).toBe(TokenKind.Eof);

      expect(lexer.getDiagnostics()).toHaveLength(0);
    });

    test("should handle multiple multi-line comments", () => {
      const source = new SourceFile(
        "test.kei",
        `
        /* First comment */
        let x = /* inline */ 1;
        /* Another comment
           spanning multiple
           lines */
        let y = 2;
      `
      );
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();

      // let, x, =, 1, ;, let, y, =, 2, ;, EOF
      expect(tokens).toHaveLength(11);

      expect(tokens[0].kind).toBe(TokenKind.Let);
      expect(tokens[1].lexeme).toBe("x");
      expect(tokens[3].value).toBe(1);
      expect(tokens[5].kind).toBe(TokenKind.Let);
      expect(tokens[6].lexeme).toBe("y");
      expect(tokens[8].value).toBe(2);

      expect(lexer.getDiagnostics()).toHaveLength(0);
    });

    test("should handle empty multi-line comment", () => {
      const source = new SourceFile("test.kei", "let x = /**/42;");
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();

      // let, x, =, 42, ;, EOF
      expect(tokens).toHaveLength(6);
      expect(tokens[3].value).toBe(42);

      expect(lexer.getDiagnostics()).toHaveLength(0);
    });

    test("should handle multi-line comment with special characters", () => {
      const source = new SourceFile(
        "test.kei",
        `
        /* Comment with special chars: @#$%^&*(){}[]<>?/.,;'"!~ */
        let x = 42;
      `
      );
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();

      // let, x, =, 42, ;, EOF
      expect(tokens).toHaveLength(6);
      expect(tokens[0].kind).toBe(TokenKind.Let);
      expect(tokens[3].value).toBe(42);

      expect(lexer.getDiagnostics()).toHaveLength(0);
    });

    test("should error on unterminated multi-line comment", () => {
      const source = new SourceFile("test.kei", "/* This comment is not terminated\nlet x = 42;");
      const lexer = new Lexer(source);
      const _tokens = lexer.tokenize();

      const diagnostics = lexer.getDiagnostics();
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].severity).toBe(Severity.Error);
      expect(diagnostics[0].message).toContain("Unterminated multi-line comment");
    });

    test("should handle comment that looks like nested comment start", () => {
      const source = new SourceFile(
        "test.kei",
        "/* This has /* inside but no nesting */ let x = 42;"
      );
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();

      // let, x, =, 42, ;, EOF
      expect(tokens).toHaveLength(6);
      expect(tokens[0].kind).toBe(TokenKind.Let);
      expect(tokens[3].value).toBe(42);

      expect(lexer.getDiagnostics()).toHaveLength(0);
    });
  });

  describe("Comments mixed with code", () => {
    test("should handle complex code with mixed comments", () => {
      const source = new SourceFile(
        "test.kei",
        `
        // Function definition with comments
        fn main() -> int { /* entry point */
            let x = 42; // local variable
            /* calculate result */
            let result = x * 2; // multiply by 2
            return result; // return the result
        } // end of main
      `
      );
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();

      // fn, main, (, ), ->, int, {, let, x, =, 42, ;, let, result, =, x, *, 2, ;, return, result, ;, }, EOF
      expect(tokens).toHaveLength(24);

      expect(tokens[0].kind).toBe(TokenKind.Fn);
      expect(tokens[1].lexeme).toBe("main");
      expect(tokens[5].kind).toBe(TokenKind.Int);
      expect(tokens[10].value).toBe(42);
      expect(tokens[17].value).toBe(2);
      expect(tokens[19].kind).toBe(TokenKind.Return);
      expect(tokens[23].kind).toBe(TokenKind.Eof);

      expect(lexer.getDiagnostics()).toHaveLength(0);
    });

    test("should not treat // inside string as comment", () => {
      const source = new SourceFile("test.kei", '"This string has // in it" let x = 42;');
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();

      // string, let, x, =, 42, ;, EOF
      expect(tokens).toHaveLength(7);
      expect(tokens[0].kind).toBe(TokenKind.StringLiteral);
      expect(tokens[0].value).toBe("This string has // in it");
      expect(tokens[1].kind).toBe(TokenKind.Let);
      expect(tokens[4].value).toBe(42);

      expect(lexer.getDiagnostics()).toHaveLength(0);
    });

    test("should not treat /* inside string as comment", () => {
      const source = new SourceFile(
        "test.kei",
        '"This string has /* comment */ in it" let x = 42;'
      );
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();

      // string, let, x, =, 42, ;, EOF
      expect(tokens).toHaveLength(7);
      expect(tokens[0].kind).toBe(TokenKind.StringLiteral);
      expect(tokens[0].value).toBe("This string has /* comment */ in it");
      expect(tokens[1].kind).toBe(TokenKind.Let);

      expect(lexer.getDiagnostics()).toHaveLength(0);
    });

    test("should handle comment immediately after operators", () => {
      const source = new SourceFile("test.kei", "a +/* add */ b - // subtract\n c");
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();

      // a, +, b, -, c, EOF
      expect(tokens).toHaveLength(6);
      expect(tokens[0].kind).toBe(TokenKind.Identifier);
      expect(tokens[0].lexeme).toBe("a");
      expect(tokens[1].kind).toBe(TokenKind.Plus);
      expect(tokens[2].lexeme).toBe("b");
      expect(tokens[3].kind).toBe(TokenKind.Minus);
      expect(tokens[4].lexeme).toBe("c");

      expect(lexer.getDiagnostics()).toHaveLength(0);
    });

    test("should preserve line/column information with comments", () => {
      const source = new SourceFile(
        "test.kei",
        `// Line 1 comment
let x = 42; // Line 2 comment
/* Multi-line comment
   on line 3 and 4 */
let y = 24;`
      );
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();

      // First token after comment should be on line 2
      expect(tokens[0].kind).toBe(TokenKind.Let);
      expect(tokens[0].line).toBe(2);
      expect(tokens[0].column).toBe(1);

      // Token after multi-line comment should be on line 5
      expect(tokens[5].kind).toBe(TokenKind.Let);
      expect(tokens[5].line).toBe(5);
      expect(tokens[5].column).toBe(1);

      expect(lexer.getDiagnostics()).toHaveLength(0);
    });
  });

  test("should handle division operator vs comment disambiguation", () => {
    // Make sure we correctly distinguish / and /* vs //
    const source = new SourceFile("test.kei", "a / b /*not comment start*/ c // comment\na /= b");
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    expect(tokens[0].lexeme).toBe("a");
    expect(tokens[1].kind).toBe(TokenKind.Slash);
    expect(tokens[2].lexeme).toBe("b");
    expect(tokens[3].lexeme).toBe("c");
    expect(tokens[4].lexeme).toBe("a"); // on new line
    expect(tokens[5].kind).toBe(TokenKind.SlashEqual);
    expect(tokens[6].lexeme).toBe("b");

    expect(lexer.getDiagnostics()).toHaveLength(0);
  });
});
