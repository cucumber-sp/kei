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

describe("numeric literal suffixes", () => {
  test("integer with i32 suffix", () => {
    const { tokens } = tokenize("42i32");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(42);
    expect(tokens[0]?.suffix).toBe("i32");
  });

  test("integer with u8 suffix", () => {
    const { tokens } = tokenize("255u8");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(255);
    expect(tokens[0]?.suffix).toBe("u8");
  });

  test("integer with i64 suffix", () => {
    const { tokens } = tokenize("100i64");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(100);
    expect(tokens[0]?.suffix).toBe("i64");
  });

  test("integer with usize suffix", () => {
    const { tokens } = tokenize("10usize");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(10);
    expect(tokens[0]?.suffix).toBe("usize");
  });

  test("integer with isize suffix", () => {
    const { tokens } = tokenize("10isize");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(10);
    expect(tokens[0]?.suffix).toBe("isize");
  });

  test("integer with f32 suffix promotes to float", () => {
    const { tokens } = tokenize("42f32");
    expect(tokens[0]?.kind).toBe(TokenKind.FloatLiteral);
    expect(tokens[0]?.value).toBe(42);
    expect(tokens[0]?.suffix).toBe("f32");
  });

  test("integer with f64 suffix promotes to float", () => {
    const { tokens } = tokenize("42f64");
    expect(tokens[0]?.kind).toBe(TokenKind.FloatLiteral);
    expect(tokens[0]?.value).toBe(42);
    expect(tokens[0]?.suffix).toBe("f64");
  });

  test("float with f32 suffix", () => {
    const { tokens } = tokenize("2.5f32");
    expect(tokens[0]?.kind).toBe(TokenKind.FloatLiteral);
    expect(tokens[0]?.value).toBeCloseTo(2.5);
    expect(tokens[0]?.suffix).toBe("f32");
  });

  test("float with f64 suffix", () => {
    const { tokens } = tokenize("3.14f64");
    expect(tokens[0]?.kind).toBe(TokenKind.FloatLiteral);
    expect(tokens[0]?.value).toBeCloseTo(3.14);
    expect(tokens[0]?.suffix).toBe("f64");
  });

  test("hex with suffix", () => {
    const { tokens } = tokenize("0xFFu32");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(255);
    expect(tokens[0]?.suffix).toBe("u32");
  });

  test("binary with suffix", () => {
    const { tokens } = tokenize("0b1010i8");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(10);
    expect(tokens[0]?.suffix).toBe("i8");
  });

  test("no suffix produces undefined", () => {
    const { tokens } = tokenize("42");
    expect(tokens[0]?.suffix).toBeUndefined();
  });

  test("suffix not consumed when followed by alphanumeric", () => {
    const { tokens } = tokenize("42i32x");
    // "42" should be IntLiteral (no suffix), "i32x" should be Identifier
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.suffix).toBeUndefined();
    expect(tokens[1]?.kind).toBe(TokenKind.Identifier);
  });

  test("integer with underscores and suffix", () => {
    const { tokens } = tokenize("1_000u32");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(1000);
    expect(tokens[0]?.suffix).toBe("u32");
  });
});
