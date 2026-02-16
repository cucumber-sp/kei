import { describe, expect, test } from "bun:test";
import { Lexer, TokenKind } from "../../src/lexer/index.ts";
import { SourceFile } from "../../src/utils/source.ts";

function tokenize(input: string) {
  const source = new SourceFile("test.kei", input);
  const lexer = new Lexer(source);
  return { tokens: lexer.tokenize(), diagnostics: lexer.getDiagnostics() };
}

describe("integer literals", () => {
  test("decimal", () => {
    const { tokens } = tokenize("42");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(42);
  });

  test("decimal with underscores", () => {
    const { tokens } = tokenize("1_000_000");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(1000000);
  });

  test("hex", () => {
    const { tokens } = tokenize("0xFF");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(255);
  });

  test("hex with underscores", () => {
    const { tokens } = tokenize("0xFF_EE");
    expect(tokens[0]?.value).toBe(0xffee);
  });

  test("binary", () => {
    const { tokens } = tokenize("0b1010");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(10);
  });

  test("binary with underscores", () => {
    const { tokens } = tokenize("0b1010_0001");
    expect(tokens[0]?.value).toBe(0b10100001);
  });

  test("octal", () => {
    const { tokens } = tokenize("0o77");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(63);
  });

  test("octal with underscores", () => {
    const { tokens } = tokenize("0o7_7");
    expect(tokens[0]?.value).toBe(63);
  });

  test("zero", () => {
    const { tokens } = tokenize("0");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(0);
  });

  test("invalid hex", () => {
    const { tokens, diagnostics } = tokenize("0x");
    expect(tokens[0]?.kind).toBe(TokenKind.Error);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  test("invalid binary", () => {
    const { tokens, diagnostics } = tokenize("0b");
    expect(tokens[0]?.kind).toBe(TokenKind.Error);
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});

describe("float literals", () => {
  test("standard decimal", () => {
    const { tokens } = tokenize("3.14");
    expect(tokens[0]?.kind).toBe(TokenKind.FloatLiteral);
    expect(tokens[0]?.value).toBeCloseTo(3.14);
  });

  test("scientific notation", () => {
    const { tokens } = tokenize("1.0e10");
    expect(tokens[0]?.kind).toBe(TokenKind.FloatLiteral);
    expect(tokens[0]?.value).toBe(1.0e10);
  });

  test("negative exponent", () => {
    const { tokens } = tokenize("2.5e-3");
    expect(tokens[0]?.kind).toBe(TokenKind.FloatLiteral);
    expect(tokens[0]?.value).toBeCloseTo(0.0025);
  });

  test("leading dot", () => {
    const { tokens } = tokenize(".75");
    expect(tokens[0]?.kind).toBe(TokenKind.FloatLiteral);
    expect(tokens[0]?.value).toBeCloseTo(0.75);
  });

  test("trailing dot", () => {
    const { tokens } = tokenize("1.");
    expect(tokens[0]?.kind).toBe(TokenKind.FloatLiteral);
    expect(tokens[0]?.value).toBe(1.0);
  });

  test("with underscores", () => {
    const { tokens } = tokenize("1_234.567_8");
    expect(tokens[0]?.kind).toBe(TokenKind.FloatLiteral);
    expect(tokens[0]?.value).toBeCloseTo(1234.5678);
  });
});
