/**
 * Tests for error handling and recovery in the lexer
 */

import { describe, expect, test } from "bun:test";
import { Severity } from "../../src/errors/index.ts";
import { Lexer, TokenKind } from "../../src/lexer/index.ts";
import { SourceFile } from "../../src/utils/source.ts";

describe("Error handling", () => {
  test("should handle invalid characters", () => {
    const invalidChars = ["@", "#", "$", "`"];

    for (const char of invalidChars) {
      const source = new SourceFile("test.kei", `let x = ${char} + 1;`);
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();

      const diagnostics = lexer.getDiagnostics();
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].severity).toBe(Severity.Error);
      expect(diagnostics[0].message).toContain(`Unexpected character '${char}'`);
      expect(diagnostics[0].location.line).toBe(1);
      expect(diagnostics[0].location.column).toBe(9); // Position of invalid char

      // Lexer should continue and produce other valid tokens
      expect(tokens[0].kind).toBe(TokenKind.Let);
      expect(tokens[1].kind).toBe(TokenKind.Identifier);
      expect(tokens[2].kind).toBe(TokenKind.Equal);
      expect(tokens[3].kind).toBe(TokenKind.Error); // The invalid character
      expect(tokens[4].kind).toBe(TokenKind.Plus);
      expect(tokens[5].kind).toBe(TokenKind.IntLiteral);
      expect(tokens[6].kind).toBe(TokenKind.Semicolon);
      expect(tokens[7].kind).toBe(TokenKind.Eof);
    }
  });

  test("should recover from multiple invalid characters", () => {
    const source = new SourceFile("test.kei", "let @ x # = $ 42 ` ;");
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    const diagnostics = lexer.getDiagnostics();
    expect(diagnostics).toHaveLength(4); // Four invalid characters

    for (let i = 0; i < 4; i++) {
      expect(diagnostics[i].severity).toBe(Severity.Error);
      expect(diagnostics[i].message).toContain("Unexpected character");
    }

    // Should still tokenize valid parts
    expect(tokens[0].kind).toBe(TokenKind.Let);
    expect(tokens[1].kind).toBe(TokenKind.Error); // @
    expect(tokens[2].kind).toBe(TokenKind.Identifier); // x
    expect(tokens[3].kind).toBe(TokenKind.Error); // #
    expect(tokens[4].kind).toBe(TokenKind.Equal); // =
    expect(tokens[5].kind).toBe(TokenKind.Error); // $
    expect(tokens[6].kind).toBe(TokenKind.IntLiteral); // 42
    expect(tokens[7].kind).toBe(TokenKind.Error); // `
    expect(tokens[8].kind).toBe(TokenKind.Semicolon); // ;
    expect(tokens[9].kind).toBe(TokenKind.Eof);
  });

  test("should provide correct location information for errors", () => {
    const source = new SourceFile(
      "test.kei",
      `line 1
let x = @ + 1;  // error on line 2
line 3`
    );
    const lexer = new Lexer(source);
    const _tokens = lexer.tokenize();

    const diagnostics = lexer.getDiagnostics();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe(Severity.Error);
    expect(diagnostics[0].message).toContain("Unexpected character '@'");
    expect(diagnostics[0].location.line).toBe(2);
    expect(diagnostics[0].location.column).toBe(9);
    expect(diagnostics[0].location.file).toBe("test.kei");
  });

  test("should handle invalid identifiers starting with digits", () => {
    // Numbers followed by letters should be parsed as separate tokens
    const source = new SourceFile("test.kei", "42abc 123def");
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    expect(tokens).toHaveLength(5); // 42, abc, 123, def, EOF

    expect(tokens[0].kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0].value).toBe(42);

    expect(tokens[1].kind).toBe(TokenKind.Identifier);
    expect(tokens[1].lexeme).toBe("abc");

    expect(tokens[2].kind).toBe(TokenKind.IntLiteral);
    expect(tokens[2].value).toBe(123);

    expect(tokens[3].kind).toBe(TokenKind.Identifier);
    expect(tokens[3].lexeme).toBe("def");

    expect(tokens[4].kind).toBe(TokenKind.Eof);

    // This should not produce errors - it's valid lexing
    expect(lexer.getDiagnostics()).toHaveLength(0);
  });

  test("should handle reserved keyword usage", () => {
    const source = new SourceFile("test.kei", "let async = await + match;");
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    const diagnostics = lexer.getDiagnostics();
    expect(diagnostics).toHaveLength(3); // Three reserved keywords

    const expectedMessages = [
      "'async' is reserved for future use",
      "'await' is reserved for future use",
      "'match' is reserved for future use",
    ];

    for (let i = 0; i < 3; i++) {
      expect(diagnostics[i].severity).toBe(Severity.Error);
      expect(diagnostics[i].message).toBe(expectedMessages[i]);
    }

    // Tokens should still be created with correct kinds
    expect(tokens[0].kind).toBe(TokenKind.Let);
    expect(tokens[1].kind).toBe(TokenKind.Async);
    expect(tokens[2].kind).toBe(TokenKind.Equal);
    expect(tokens[3].kind).toBe(TokenKind.Await);
    expect(tokens[4].kind).toBe(TokenKind.Plus);
    expect(tokens[5].kind).toBe(TokenKind.Match);
    expect(tokens[6].kind).toBe(TokenKind.Semicolon);
    expect(tokens[7].kind).toBe(TokenKind.Eof);
  });

  test("should handle malformed number literals", () => {
    const source = new SourceFile("test.kei", "0x 0b 0o 1.0e 1.0e+ 1.0e-");
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    const diagnostics = lexer.getDiagnostics();
    expect(diagnostics.length).toBeGreaterThan(0);

    // All malformed numbers should produce errors
    for (const diagnostic of diagnostics) {
      expect(diagnostic.severity).toBe(Severity.Error);
      expect(diagnostic.message).toMatch(/Invalid|expected/i);
    }

    // Should produce Invalid tokens for malformed numbers
    const invalidTokens = tokens.filter((t) => t.kind === TokenKind.Error);
    expect(invalidTokens.length).toBeGreaterThan(0);
  });

  test("should handle unterminated block comments", () => {
    const source = new SourceFile(
      "test.kei",
      "let x = 42; /* This comment never ends\nlet y = 24;"
    );
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    const diagnostics = lexer.getDiagnostics();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe(Severity.Error);
    expect(diagnostics[0].message).toContain("Unterminated multi-line comment");

    // Should still tokenize the part before the comment
    expect(tokens[0].kind).toBe(TokenKind.Let);
    expect(tokens[1].kind).toBe(TokenKind.Identifier);
    expect(tokens[2].kind).toBe(TokenKind.Equal);
    expect(tokens[3].kind).toBe(TokenKind.IntLiteral);
    expect(tokens[4].kind).toBe(TokenKind.Semicolon);
    expect(tokens[5].kind).toBe(TokenKind.Eof);
  });

  test("should handle unterminated string literals", () => {
    const source = new SourceFile("test.kei", 'let msg = "unterminated string\nlet x = 42;');
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    const diagnostics = lexer.getDiagnostics();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe(Severity.Error);
    expect(diagnostics[0].message).toContain("Unterminated string literal");

    // Should recover and continue lexing
    expect(tokens[0].kind).toBe(TokenKind.Let);
    expect(tokens[1].kind).toBe(TokenKind.Identifier);
    expect(tokens[2].kind).toBe(TokenKind.Equal);
    expect(tokens[3].kind).toBe(TokenKind.Error); // The unterminated string
    expect(tokens[4].kind).toBe(TokenKind.Let); // Recovery continues here
  });

  test("should handle multiple error types in one source", () => {
    const source = new SourceFile(
      "test.kei",
      `
      let x = @ + 1;          // Invalid character
      let y = "unterminated   // Unterminated string
      let z = 0x;             // Invalid hex literal
      let async = 42;         // Reserved keyword
      /* unterminated comment
    `
    );
    const lexer = new Lexer(source);
    const _tokens = lexer.tokenize();

    const diagnostics = lexer.getDiagnostics();
    expect(diagnostics.length).toBeGreaterThan(3); // At least 4 different errors

    const severities = diagnostics.map((d) => d.severity);
    expect(severities.every((s) => s === Severity.Error)).toBe(true);

    // Check we have different types of error messages
    const messages = diagnostics.map((d) => d.message);
    expect(messages.some((m) => m.includes("Unexpected character"))).toBe(true);
    expect(messages.some((m) => m.includes("Unterminated"))).toBe(true);
    expect(messages.some((m) => m.includes("reserved for future use"))).toBe(true);
  });

  test("should provide accurate span information for errors", () => {
    const source = new SourceFile("test.kei", "let x = @@@;");
    const lexer = new Lexer(source);
    const _tokens = lexer.tokenize();

    const diagnostics = lexer.getDiagnostics();
    expect(diagnostics).toHaveLength(3); // Three @ characters

    // Each @ should have its own error with correct span
    for (let i = 0; i < 3; i++) {
      expect(diagnostics[i].location.column).toBe(9 + i); // @ positions
      expect(diagnostics[i].location.offset).toBe(8 + i); // 0-based offset
    }
  });

  test("should handle errors at start of file", () => {
    const source = new SourceFile("test.kei", "@let x = 1;");
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    const diagnostics = lexer.getDiagnostics();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].location.line).toBe(1);
    expect(diagnostics[0].location.column).toBe(1);
    expect(diagnostics[0].location.offset).toBe(0);

    expect(tokens[0].kind).toBe(TokenKind.Error);
    expect(tokens[1].kind).toBe(TokenKind.Let);
  });

  test("should handle errors at end of file", () => {
    const source = new SourceFile("test.kei", "let x = 1 @");
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    const diagnostics = lexer.getDiagnostics();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].location.column).toBe(11); // Position of @

    // let, x, =, 1, @, EOF
    expect(tokens[4].kind).toBe(TokenKind.Error);
    expect(tokens[5].kind).toBe(TokenKind.Eof);
  });

  test("should handle empty file", () => {
    const source = new SourceFile("test.kei", "");
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    expect(tokens).toHaveLength(1);
    expect(tokens[0].kind).toBe(TokenKind.Eof);
    expect(lexer.getDiagnostics()).toHaveLength(0);
  });

  test("should handle whitespace-only file", () => {
    const source = new SourceFile("test.kei", "   \t\n\r\n   ");
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    expect(tokens).toHaveLength(1);
    expect(tokens[0].kind).toBe(TokenKind.Eof);
    expect(lexer.getDiagnostics()).toHaveLength(0);
  });

  test("should handle comments-only file", () => {
    const source = new SourceFile(
      "test.kei",
      `
      // Just comments
      /* Multiple
         line comment */
      // Another comment
    `
    );
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    expect(tokens).toHaveLength(1);
    expect(tokens[0].kind).toBe(TokenKind.Eof);
    expect(lexer.getDiagnostics()).toHaveLength(0);
  });

  test("should continue lexing after error recovery", () => {
    const source = new SourceFile("test.kei", "valid @ valid # valid $ valid");
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    // Should have 3 error diagnostics
    const diagnostics = lexer.getDiagnostics();
    expect(diagnostics).toHaveLength(3);

    // Should still tokenize all valid parts
    const validTokens = tokens.filter((t) => t.kind === TokenKind.Identifier);
    expect(validTokens).toHaveLength(4);
    expect(validTokens.every((t) => t.lexeme === "valid")).toBe(true);

    const invalidTokens = tokens.filter((t) => t.kind === TokenKind.Error);
    expect(invalidTokens).toHaveLength(3);
  });

  test("should handle very long lines with errors", () => {
    const longValidPart = "a".repeat(500);
    const source = new SourceFile("test.kei", `${longValidPart}@${longValidPart}`);
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    const diagnostics = lexer.getDiagnostics();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].location.column).toBe(501); // Position of @

    expect(tokens[0].kind).toBe(TokenKind.Identifier);
    expect(tokens[0].lexeme).toBe(longValidPart);
    expect(tokens[1].kind).toBe(TokenKind.Error);
    expect(tokens[2].kind).toBe(TokenKind.Identifier);
    expect(tokens[2].lexeme).toBe(longValidPart);
  });
});
