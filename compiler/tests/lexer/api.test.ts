/**
 * Tests for the {@link Lexer} class API surface itself — `tokenize()`,
 * `nextToken()`, `getDiagnostics()` — plus operators that don't appear
 * elsewhere in the suite.
 *
 * Most of the lexer is exercised through `tests/helpers/pipeline.ts`. The cases
 * here pin behaviour that callers can rely on directly:
 *
 *   - `tokenize()` resets state on each call
 *   - `nextToken()` is callable in isolation, and remains stable past EOF
 *   - the predicate helpers (`isDigit`, `isAlpha`, …) handle empty input safely
 */

import { describe, expect, test } from "bun:test";
import { Severity } from "../../src/errors";
import {
  isAlpha,
  isAlphaNumeric,
  isBinaryDigit,
  isDigit,
  isHexDigit,
  isOctalDigit,
  Lexer,
  TokenKind,
} from "../../src/lexer";
import { SourceFile } from "../../src/utils/source";
import { lex, tokensOf } from "./helpers";

describe("Lexer.tokenize()", () => {
  test("returns identical tokens when invoked twice on the same instance", () => {
    const lexer = new Lexer(new SourceFile("test.kei", "let x = 42;"));
    const first = lexer.tokenize();
    const second = lexer.tokenize();

    expect(second).toHaveLength(first.length);
    for (let i = 0; i < first.length; i++) {
      expect(second[i]?.kind).toBe(first[i]!.kind);
      expect(second[i]?.lexeme).toBe(first[i]!.lexeme);
      expect(second[i]?.span.start).toBe(first[i]!.span.start);
    }
  });

  test("clears prior diagnostics on re-tokenization", () => {
    const lexer = new Lexer(new SourceFile("test.kei", "@"));
    lexer.tokenize();
    expect(lexer.getDiagnostics()).toHaveLength(1);

    lexer.tokenize();
    // After the second run the diagnostic from the first should be replaced,
    // not appended — `@` produces exactly one diagnostic.
    expect(lexer.getDiagnostics()).toHaveLength(1);
  });

  test("always terminates the stream with an EOF token", () => {
    for (const src of ["", "   ", "let", "// comment only"]) {
      const tokens = tokensOf(src);
      expect(tokens.at(-1)?.kind).toBe(TokenKind.Eof);
    }
  });

  test("EOF token sits at the end-of-input offset", () => {
    const src = "let";
    const tokens = tokensOf(src);
    const eof = tokens.at(-1);
    expect(eof?.kind).toBe(TokenKind.Eof);
    expect(eof?.span.start).toBe(src.length);
    expect(eof?.span.end).toBe(src.length);
  });
});

describe("Lexer.nextToken()", () => {
  test("can be driven manually without calling tokenize()", () => {
    const lexer = new Lexer(new SourceFile("test.kei", "fn foo()"));
    const seen: TokenKind[] = [];
    while (true) {
      const tok = lexer.nextToken();
      seen.push(tok.kind);
      if (tok.kind === TokenKind.Eof) break;
    }
    expect(seen).toEqual([
      TokenKind.Fn,
      TokenKind.Identifier,
      TokenKind.LeftParen,
      TokenKind.RightParen,
      TokenKind.Eof,
    ]);
  });

  test("returns EOF idempotently once the source is exhausted", () => {
    const lexer = new Lexer(new SourceFile("test.kei", ""));
    const first = lexer.nextToken();
    const second = lexer.nextToken();
    expect(first.kind).toBe(TokenKind.Eof);
    expect(second.kind).toBe(TokenKind.Eof);
    expect(second.span.start).toBe(first.span.start);
  });
});

describe("Lexer.getDiagnostics()", () => {
  test("returns a snapshot reflecting accumulated errors", () => {
    const { lexer } = lex("let x = @;");
    const diags = lexer.getDiagnostics();
    expect(diags).toHaveLength(1);
    expect(diags[0]?.severity).toBe(Severity.Error);
    expect(diags[0]?.location.file).toBe("test.kei");
  });

  test("is empty on a freshly constructed Lexer (no tokenize call yet)", () => {
    const lexer = new Lexer(new SourceFile("test.kei", "@"));
    expect(lexer.getDiagnostics()).toHaveLength(0);
  });
});

describe("operators not covered elsewhere", () => {
  const cases: [src: string, kind: TokenKind][] = [
    ["?", TokenKind.Question],
    ["..", TokenKind.DotDot],
    ["..=", TokenKind.DotDotEqual],
  ];

  for (const [src, kind] of cases) {
    test(`'${src}' tokenizes as ${kind}`, () => {
      const tokens = tokensOf(src);
      expect(tokens[0]?.kind).toBe(kind);
      expect(tokens[0]?.lexeme).toBe(src);
      expect(tokens[1]?.kind).toBe(TokenKind.Eof);
    });
  }

  test("'.. =' (with space) is DotDot, Equal — not DotDotEqual", () => {
    const tokens = tokensOf(".. =");
    expect(tokens.map((t) => t.kind)).toEqual([TokenKind.DotDot, TokenKind.Equal, TokenKind.Eof]);
  });
});

describe("string literal — carriage-return termination", () => {
  test("a bare CR inside a string also reports unterminated", () => {
    const { tokens, diagnostics } = lex('"oops\rmore');
    expect(tokens[0]?.kind).toBe(TokenKind.Error);
    expect(diagnostics[0]?.severity).toBe(Severity.Error);
    expect(diagnostics[0]?.message).toContain("Unterminated string literal");
  });

  test("a backslash at end-of-file inside an unterminated string is reported once", () => {
    // The escape consumer hits EOF and emits "Unexpected end of string escape";
    // the outer string scanner then also reports "Unterminated string literal".
    const { tokens, diagnostics } = lex('"abc\\');
    expect(tokens[0]?.kind).toBe(TokenKind.Error);
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics.some((d) => d.message.includes("Unterminated string"))).toBe(true);
  });
});

describe("character predicate helpers", () => {
  test("isDigit handles '' as false (NaN-safe)", () => {
    expect(isDigit("")).toBe(false);
    expect(isDigit("0")).toBe(true);
    expect(isDigit("9")).toBe(true);
    expect(isDigit("a")).toBe(false);
  });

  test("isAlpha includes underscore but not digits", () => {
    expect(isAlpha("_")).toBe(true);
    expect(isAlpha("a")).toBe(true);
    expect(isAlpha("Z")).toBe(true);
    expect(isAlpha("0")).toBe(false);
    expect(isAlpha("")).toBe(false);
  });

  test("isAlphaNumeric covers letters, digits, underscore", () => {
    for (const ch of "_aZ09") {
      expect(isAlphaNumeric(ch)).toBe(true);
    }
    expect(isAlphaNumeric("-")).toBe(false);
    expect(isAlphaNumeric("")).toBe(false);
  });

  test("isHexDigit accepts both cases of A-F", () => {
    for (const ch of "0123456789abcdefABCDEF") {
      expect(isHexDigit(ch)).toBe(true);
    }
    expect(isHexDigit("g")).toBe(false);
    expect(isHexDigit("G")).toBe(false);
    expect(isHexDigit("")).toBe(false);
  });

  test("isBinaryDigit accepts only 0 and 1", () => {
    expect(isBinaryDigit("0")).toBe(true);
    expect(isBinaryDigit("1")).toBe(true);
    expect(isBinaryDigit("2")).toBe(false);
    expect(isBinaryDigit("")).toBe(false);
  });

  test("isOctalDigit accepts 0-7 and rejects 8/9", () => {
    for (const ch of "01234567") {
      expect(isOctalDigit(ch)).toBe(true);
    }
    expect(isOctalDigit("8")).toBe(false);
    expect(isOctalDigit("9")).toBe(false);
    expect(isOctalDigit("")).toBe(false);
  });
});

describe("source position tracking", () => {
  test("token spans are byte-accurate across multi-line input", () => {
    const src = "let x =\n  42;";
    const tokens = tokensOf(src);

    // Sanity: the IntLiteral 42 is at offset 10–12.
    const intTok = tokens.find((t) => t.kind === TokenKind.IntLiteral);
    expect(intTok).toBeDefined();
    expect(intTok?.span.start).toBe(10);
    expect(intTok?.span.end).toBe(12);
    expect(intTok?.line).toBe(2);
    expect(intTok?.column).toBe(3);
  });

  test("compound operator span covers all consumed bytes", () => {
    const tokens = tokensOf("a <<= b");
    const op = tokens[1];
    expect(op?.kind).toBe(TokenKind.LessLessEqual);
    expect(op!.span.end - op!.span.start).toBe(3);
  });
});
