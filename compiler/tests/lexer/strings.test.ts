/**
 * Tests for string literal edge cases and error handling
 */

import { describe, expect, test } from "bun:test";
import { Severity } from "../../src/errors";
import { TokenKind } from "../../src/lexer";
import { lex } from "./helpers";

describe("String literals - edge cases", () => {
  test("should handle unicode characters in strings", () => {
    const testCases = [
      { input: '"Hello, 世界!"', expected: "Hello, 世界!" },
      { input: '"🌍 Emoji test 🚀"', expected: "🌍 Emoji test 🚀" },
      { input: '"Café résumé naïve"', expected: "Café résumé naïve" },
      { input: '"Ñoño año diseño"', expected: "Ñoño año diseño" },
    ];

    for (const { input, expected } of testCases) {
      const { tokens, lexer } = lex(input);

      expect(tokens).toHaveLength(2);
      expect(tokens[0]!.kind).toBe(TokenKind.StringLiteral);
      expect(tokens[0]!.lexeme).toBe(input);
      expect(tokens[0]!.value).toBe(expected);
      expect(tokens[1]!.kind).toBe(TokenKind.Eof);
      expect(lexer.getDiagnostics()).toHaveLength(0);
    }
  });

  test("should handle all supported escape sequences", () => {
    const testCases = [
      { input: '"\\n"', expected: "\n", desc: "newline" },
      { input: '"\\t"', expected: "\t", desc: "tab" },
      { input: '"\\r"', expected: "\r", desc: "carriage return" },
      { input: '"\\\\"', expected: "\\", desc: "backslash" },
      { input: '"\\""', expected: '"', desc: "double quote" },
      { input: '"\\0"', expected: "\0", desc: "null byte" },
      { input: '"\\x00"', expected: "\x00", desc: "hex null" },
      { input: '"\\xFF"', expected: "\xFF", desc: "hex max byte" },
      { input: '"\\x20"', expected: " ", desc: "hex space" },
      { input: '"\\x09"', expected: "\t", desc: "hex tab" },
      { input: '"\\x0A"', expected: "\n", desc: "hex newline" },
    ];

    for (const { input, expected } of testCases) {
      const { tokens, lexer } = lex(input);

      expect(tokens).toHaveLength(2);
      expect(tokens[0]!.kind).toBe(TokenKind.StringLiteral);
      expect(tokens[0]!.lexeme).toBe(input);
      expect(tokens[0]!.value).toBe(expected);
      expect(tokens[1]!.kind).toBe(TokenKind.Eof);
      expect(lexer.getDiagnostics()).toHaveLength(0);
    }
  });

  test("should handle mixed escape sequences", () => {
    const { tokens, lexer } = lex('"Line 1\\nTab:\\tValue\\r\\nQuote: \\"Hello\\"\\x20End"');

    expect(tokens).toHaveLength(2);
    expect(tokens[0]!.kind).toBe(TokenKind.StringLiteral);
    expect(tokens[0]!.value).toBe('Line 1\nTab:\tValue\r\nQuote: "Hello" End');
    expect(lexer.getDiagnostics()).toHaveLength(0);
  });

  test("should handle hex escapes with both cases", () => {
    const testCases = [
      { input: '"\\x41\\x42\\x43"', expected: "ABC" },
      { input: '"\\x61\\x62\\x63"', expected: "abc" },
      { input: '"\\xaA\\xBb\\xCc"', expected: "\xaA\xBb\xCc" },
      { input: '"\\xFF\\x00\\x7F"', expected: "\xFF\x00\x7F" },
    ];

    for (const { input, expected } of testCases) {
      const { tokens, lexer } = lex(input);

      expect(tokens).toHaveLength(2);
      expect(tokens[0]!.kind).toBe(TokenKind.StringLiteral);
      expect(tokens[0]!.value).toBe(expected);
      expect(lexer.getDiagnostics()).toHaveLength(0);
    }
  });

  test("should handle strings with quotes and backslashes", () => {
    const testCases = [
      { input: '"He said \\"Hello\\""', expected: 'He said "Hello"' },
      {
        input: '"Path: C:\\\\Users\\\\file.txt"',
        expected: "Path: C:\\Users\\file.txt",
      },
    ];

    for (const { input, expected } of testCases) {
      const { tokens, lexer } = lex(input);

      expect(tokens).toHaveLength(2);
      expect(tokens[0]!.kind).toBe(TokenKind.StringLiteral);
      expect(tokens[0]!.value).toBe(expected);
      expect(lexer.getDiagnostics()).toHaveLength(0);
    }
  });

  test("should handle very long strings", () => {
    const longString = "A".repeat(1000);
    const { tokens, lexer } = lex(`"${longString}"`);

    expect(tokens).toHaveLength(2);
    expect(tokens[0]!.kind).toBe(TokenKind.StringLiteral);
    expect(tokens[0]!.value).toBe(longString);
    expect(lexer.getDiagnostics()).toHaveLength(0);
  });

  test("should handle empty string", () => {
    const { tokens, lexer } = lex('""');

    expect(tokens).toHaveLength(2);
    expect(tokens[0]!.kind).toBe(TokenKind.StringLiteral);
    expect(tokens[0]!.lexeme).toBe('""');
    expect(tokens[0]!.value).toBe("");
    expect(tokens[1]!.kind).toBe(TokenKind.Eof);
    expect(lexer.getDiagnostics()).toHaveLength(0);
  });

  describe("String error cases", () => {
    test("should error on unterminated string at end of file", () => {
      const { tokens, lexer } = lex('"unterminated string');

      const diagnostics = lexer.getDiagnostics();
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics[0]!.severity).toBe(Severity.Error);
      expect(diagnostics[0]!.message).toContain("Unterminated string literal");
      expect(tokens[0]!.kind).toBe(TokenKind.Error);
    });

    test("should error on unterminated string with newline", () => {
      const { tokens, lexer } = lex('"string with\nnewline');

      const diagnostics = lexer.getDiagnostics();
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics[0]!.severity).toBe(Severity.Error);
      expect(diagnostics[0]!.message).toContain("Unterminated string literal");
      expect(tokens[0]!.kind).toBe(TokenKind.Error);
    });

    test("should error on invalid escape sequences", () => {
      // Invalid escapes produce a diagnostic but the string still closes normally
      const invalidEscapes = [
        { input: '"\\q"', char: "q" },
        { input: '"\\z"', char: "z" },
        { input: '"\\@"', char: "@" },
      ];

      for (const { input, char } of invalidEscapes) {
        const { tokens, lexer } = lex(input);

        const diagnostics = lexer.getDiagnostics();
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]!.severity).toBe(Severity.Error);
        expect(diagnostics[0]!.message).toContain(`Invalid escape sequence '\\${char}'`);
        // String still parses to completion (with missing escaped char)
        expect(tokens[0]!.kind).toBe(TokenKind.StringLiteral);
      }
    });

    test("should error on incomplete hex escapes", () => {
      const invalidHexEscapes = [
        '"\\xG1"', // invalid first hex digit
        '"\\x1G"', // invalid second hex digit
      ];

      for (const input of invalidHexEscapes) {
        const { diagnostics } = lex(input);
        expect(diagnostics.length).toBeGreaterThan(0);
        expect(diagnostics[0]!.severity).toBe(Severity.Error);
        expect(diagnostics[0]!.message).toContain("hex escape");
      }
    });

    test("should error on hex escape at end of string", () => {
      // \x with no digits, followed by closing quote
      const { diagnostics } = lex('"\\x"');
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics[0]!.severity).toBe(Severity.Error);
      expect(diagnostics[0]!.message).toContain("hex escape");
    });
  });

  test("should handle multiple strings in sequence", () => {
    const { tokens, lexer } = lex('"first" "second" "third"');

    // 3 strings + EOF
    expect(tokens).toHaveLength(4);

    expect(tokens[0]!.kind).toBe(TokenKind.StringLiteral);
    expect(tokens[0]!.value).toBe("first");

    expect(tokens[1]!.kind).toBe(TokenKind.StringLiteral);
    expect(tokens[1]!.value).toBe("second");

    expect(tokens[2]!.kind).toBe(TokenKind.StringLiteral);
    expect(tokens[2]!.value).toBe("third");

    expect(tokens[3]!.kind).toBe(TokenKind.Eof);
    expect(lexer.getDiagnostics()).toHaveLength(0);
  });

  test("should preserve correct source positions for strings", () => {
    const { tokens, lexer } = lex('let msg = "Hello\\nWorld";');

    // let, msg, =, string, ;, EOF
    expect(tokens).toHaveLength(6);

    const stringToken = tokens[3]!;
    expect(stringToken.kind).toBe(TokenKind.StringLiteral);
    expect(stringToken.line).toBe(1);
    expect(stringToken.column).toBe(11);
    expect(stringToken.span.start).toBe(10);
    expect(stringToken.value).toBe("Hello\nWorld");

    expect(lexer.getDiagnostics()).toHaveLength(0);
  });

  test("should handle strings on multiple lines with proper positions", () => {
    const { tokens, lexer } = lex(`let a = "first";
let b = "second";
let c = "third";`);

    const strings = tokens.filter((t) => t.kind === TokenKind.StringLiteral);

    expect(strings).toHaveLength(3);

    expect(strings[0]!.line).toBe(1);
    expect(strings[0]!.value).toBe("first");

    expect(strings[1]!.line).toBe(2);
    expect(strings[1]!.value).toBe("second");

    expect(strings[2]!.line).toBe(3);
    expect(strings[2]!.value).toBe("third");

    expect(lexer.getDiagnostics()).toHaveLength(0);
  });

  test("should handle string with all printable ASCII characters", () => {
    const printableChars = Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i))
      .filter((c) => c !== '"' && c !== "\\")
      .join("");

    const { tokens, lexer } = lex(`"${printableChars}"`);

    expect(tokens).toHaveLength(2);
    expect(tokens[0]!.kind).toBe(TokenKind.StringLiteral);
    expect(tokens[0]!.value).toBe(printableChars);
    expect(lexer.getDiagnostics()).toHaveLength(0);
  });
});
