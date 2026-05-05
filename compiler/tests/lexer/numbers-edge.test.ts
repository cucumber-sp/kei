/**
 * Boundary cases for number-literal scanning.
 *
 * The cases here pin down the disambiguation rules that aren't otherwise
 * obvious from `literals.test.ts`:
 *   - When does `<digits>.` open a float vs. emit a Dot?
 *   - When is `e`/`E` an exponent vs. an identifier start?
 *   - Which radix-prefix variants are accepted?
 */

import { describe, expect, test } from "bun:test";
import { Severity } from "../../src/errors";
import { TokenKind } from "../../src/lexer";
import { lex } from "./helpers";

// ─── Trailing-dot disambiguation ──────────────────────────────────────────
//
// `<digits>.` is a float when followed by:
//   - more digits (`1.5`)
//   - an exponent intro (`1.e10`)
//   - end-of-input or a "terminator" (whitespace, `;` `)` `}` `,`)
// and is a plain `.` otherwise — preserving field access (`x.y`), range
// (`1..2`), and deref (`p.*`) for cases that combine with integer literals.

describe("number lexer — trailing dot is float at terminator", () => {
  const cases: [label: string, source: string, expectedLexeme: string][] = [
    ["EOF", "1.", "1."],
    ["space", "1. ", "1."],
    ["tab", "1.\t", "1."],
    ["newline", "1.\n", "1."],
    ["semicolon", "1.;", "1."],
    ["right-paren", "1.)", "1."],
    ["right-brace", "1.}", "1."],
    ["comma", "1.,", "1."],
  ];

  for (const [label, source, expectedLexeme] of cases) {
    test(`'1.' followed by ${label} → FloatLiteral`, () => {
      const { tokens } = lex(source);
      expect(tokens[0]?.kind).toBe(TokenKind.FloatLiteral);
      expect(tokens[0]?.lexeme).toBe(expectedLexeme);
      expect(tokens[0]?.value).toBe(1.0);
    });
  }
});

describe("number lexer — trailing dot is NOT float when ambiguous", () => {
  test("range '1..2' splits into IntLiteral, DotDot, IntLiteral", () => {
    const { tokens } = lex("1..2");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(1);
    expect(tokens[1]?.kind).toBe(TokenKind.DotDot);
    expect(tokens[2]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[2]?.value).toBe(2);
  });

  test("deref '1.*' splits into IntLiteral, Dot, Star", () => {
    const { tokens } = lex("1.*");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[1]?.kind).toBe(TokenKind.Dot);
    expect(tokens[2]?.kind).toBe(TokenKind.Star);
  });

  test("field '1.foo' splits into IntLiteral, Dot, Identifier", () => {
    const { tokens } = lex("1.foo");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(1);
    expect(tokens[1]?.kind).toBe(TokenKind.Dot);
    expect(tokens[2]?.kind).toBe(TokenKind.Identifier);
    expect(tokens[2]?.lexeme).toBe("foo");
  });

  // Deliberate quirk: `1.f32` does NOT pick up `f32` as a float suffix —
  // an `f` after the dot starts a fresh identifier (which here happens to
  // be the `f32` type keyword), not a suffix anchor. Use `1.0f32` (or write
  // the suffix on the integer: `1f32`) instead.
  test("'1.f32' splits — `f32` is lexed as a type keyword, not a float suffix", () => {
    const { tokens } = lex("1.f32");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[1]?.kind).toBe(TokenKind.Dot);
    expect(tokens[2]?.kind).toBe(TokenKind.F32);
    expect(tokens[2]?.lexeme).toBe("f32");
  });

  test("'1.+1' splits — `+` is not a float terminator", () => {
    const { tokens } = lex("1.+1");
    expect(tokens.map((t) => t.kind)).toEqual([
      TokenKind.IntLiteral,
      TokenKind.Dot,
      TokenKind.Plus,
      TokenKind.IntLiteral,
      TokenKind.Eof,
    ]);
  });

  test("trailing dot still works mid-expression: '1. + 2.'", () => {
    const { tokens } = lex("1. + 2.");
    expect(tokens.map((t) => t.kind)).toEqual([
      TokenKind.FloatLiteral,
      TokenKind.Plus,
      TokenKind.FloatLiteral,
      TokenKind.Eof,
    ]);
    expect(tokens[0]?.value).toBe(1.0);
    expect(tokens[2]?.value).toBe(2.0);
  });
});

// ─── Exponent forms ───────────────────────────────────────────────────────

describe("number lexer — exponent forms", () => {
  test("integer with bare exponent '1e10' → FloatLiteral", () => {
    const { tokens } = lex("1e10");
    expect(tokens[0]?.kind).toBe(TokenKind.FloatLiteral);
    expect(tokens[0]?.value).toBe(1e10);
  });

  test("uppercase 'E' is also an exponent", () => {
    const { tokens } = lex("1E10");
    expect(tokens[0]?.kind).toBe(TokenKind.FloatLiteral);
    expect(tokens[0]?.value).toBe(1e10);
  });

  test("positive sign in exponent", () => {
    const { tokens } = lex("1e+5");
    expect(tokens[0]?.kind).toBe(TokenKind.FloatLiteral);
    expect(tokens[0]?.value).toBe(1e5);
  });

  test("negative sign in exponent", () => {
    const { tokens } = lex("1e-5");
    expect(tokens[0]?.kind).toBe(TokenKind.FloatLiteral);
    expect(tokens[0]?.value).toBeCloseTo(1e-5);
  });

  test("dot then exponent without fractional digits ('1.e10')", () => {
    const { tokens } = lex("1.e10");
    expect(tokens[0]?.kind).toBe(TokenKind.FloatLiteral);
    expect(tokens[0]?.value).toBe(1e10);
  });
});

describe("number lexer — malformed exponent diagnostics", () => {
  const malformed: [label: string, source: string][] = [
    ["bare 'e'", "1e"],
    ["bare 'e+'", "1e+"],
    ["bare 'e-'", "1e-"],
    ["fraction with bare 'e'", "1.0e"],
    ["fraction with bare 'e+'", "1.0e+"],
    ["leading-dot with bare 'e'", ".5e"],
  ];

  for (const [label, source] of malformed) {
    test(`${label} (${JSON.stringify(source)}) → Error + diagnostic`, () => {
      const { tokens, diagnostics } = lex(source);
      expect(tokens[0]?.kind).toBe(TokenKind.Error);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.severity).toBe(Severity.Error);
      expect(diagnostics[0]?.message).toBe("Expected digit in exponent");
    });
  }
});

// ─── Leading-dot fractions ────────────────────────────────────────────────

describe("number lexer — leading-dot fractions", () => {
  test("'.5' is FloatLiteral 0.5", () => {
    const { tokens } = lex(".5");
    expect(tokens[0]?.kind).toBe(TokenKind.FloatLiteral);
    expect(tokens[0]?.value).toBe(0.5);
  });

  test("'.5e+2' applies the exponent", () => {
    const { tokens } = lex(".5e+2");
    expect(tokens[0]?.kind).toBe(TokenKind.FloatLiteral);
    expect(tokens[0]?.value).toBeCloseTo(50);
  });

  test("'.' alone (no digits) is just a Dot", () => {
    const { tokens } = lex(".");
    expect(tokens[0]?.kind).toBe(TokenKind.Dot);
  });
});

// ─── Radix prefixes (case + underscores) ──────────────────────────────────

describe("number lexer — radix prefix variants", () => {
  test("uppercase '0X' is accepted", () => {
    const { tokens } = lex("0X10");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(0x10);
  });

  test("uppercase '0B' is accepted", () => {
    const { tokens } = lex("0B10");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(0b10);
  });

  test("uppercase '0O' is accepted", () => {
    const { tokens } = lex("0O17");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(0o17);
  });

  test("hex accepts mixed case", () => {
    const { tokens } = lex("0xAbCd");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(0xabcd);
  });

  test("binary tolerates a leading underscore: '0b_1010'", () => {
    const { tokens, diagnostics } = lex("0b_1010");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(0b1010);
    expect(diagnostics).toHaveLength(0);
  });

  test("octal tolerates a leading underscore: '0o_77'", () => {
    const { tokens, diagnostics } = lex("0o_77");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(0o77);
    expect(diagnostics).toHaveLength(0);
  });

  test("hex rejects a leading underscore: '0x_FF'", () => {
    const { tokens, diagnostics } = lex("0x_FF");
    expect(tokens[0]?.kind).toBe(TokenKind.Error);
    expect(diagnostics[0]?.message).toBe("Expected hex digit after '0x'");
  });

  test("'0o' alone is an error", () => {
    const { tokens, diagnostics } = lex("0o");
    expect(tokens[0]?.kind).toBe(TokenKind.Error);
    expect(diagnostics[0]?.message).toBe("Expected octal digit after '0o'");
  });
});

// ─── Misc number boundary behavior ────────────────────────────────────────

describe("number lexer — zero and small numbers", () => {
  test("'0' alone is IntLiteral 0", () => {
    const { tokens } = lex("0");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(0);
  });

  test("'00' is a single IntLiteral 0 (leading zeros allowed)", () => {
    const { tokens } = lex("00");
    expect(tokens).toHaveLength(2); // IntLiteral + EOF
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(0);
    expect(tokens[0]?.lexeme).toBe("00");
  });

  test("'0a' splits into IntLiteral 0 and Identifier 'a'", () => {
    const { tokens } = lex("0a");
    expect(tokens.map((t) => t.kind)).toEqual([
      TokenKind.IntLiteral,
      TokenKind.Identifier,
      TokenKind.Eof,
    ]);
    expect(tokens[1]?.lexeme).toBe("a");
  });
});

// ─── Suffix boundary behavior ─────────────────────────────────────────────

describe("number lexer — suffix boundaries", () => {
  test("a partial suffix ('42i') is IntLiteral + Identifier", () => {
    const { tokens } = lex("42i");
    expect(tokens.map((t) => t.kind)).toEqual([
      TokenKind.IntLiteral,
      TokenKind.Identifier,
      TokenKind.Eof,
    ]);
    expect(tokens[0]?.suffix).toBeUndefined();
    expect(tokens[1]?.lexeme).toBe("i");
  });

  test("underscore-then-suffix ('42_i32') still recognises the suffix", () => {
    const { tokens } = lex("42_i32");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(42);
    expect(tokens[0]?.suffix).toBe("i32");
    expect(tokens[0]?.lexeme).toBe("42_i32");
  });

  test("hex literal accepts a suffix after underscores ('0xFF_u32')", () => {
    const { tokens } = lex("0xFF_u32");
    expect(tokens[0]?.kind).toBe(TokenKind.IntLiteral);
    expect(tokens[0]?.value).toBe(0xff);
    expect(tokens[0]?.suffix).toBe("u32");
  });

  test("float suffix on an integer literal promotes the kind to FloatLiteral", () => {
    const { tokens } = lex("42f32");
    expect(tokens[0]?.kind).toBe(TokenKind.FloatLiteral);
    expect(tokens[0]?.suffix).toBe("f32");
  });

  test("integer suffix on a float literal preserves FloatLiteral kind", () => {
    // Sanity check: only int→float promotion happens; the reverse doesn't.
    // Today this means `2.5i32` is accepted as FloatLiteral with suffix=i32,
    // even though that's semantically odd — the checker is the layer that
    // validates suffix/value compatibility.
    const { tokens } = lex("2.5i32");
    expect(tokens[0]?.kind).toBe(TokenKind.FloatLiteral);
    expect(tokens[0]?.suffix).toBe("i32");
  });
});
