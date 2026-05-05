/**
 * Number literal scanning. Free functions taking the {@link Lexer} as their
 * first argument — the same convention as the parser's per-domain modules.
 */

import { Severity } from "../errors";
import type { Lexer } from "./lexer";
import { isAlphaNumeric, isBinaryDigit, isDigit, isHexDigit, isOctalDigit } from "./lexer";
import type { Token } from "./token";
import { TokenKind } from "./token";

// ─── Predicates ───────────────────────────────────────────────────────────

/**
 * Characters that — when they immediately follow a `.` after integer digits —
 * confirm the dot is the decimal point of a float literal (rather than e.g.
 * field access, range, or a deref).
 *
 *   `1.`  at EOF / whitespace / `;` `)` `}` `,`   → float (`1.0`)
 *   `1.5`                                        → float (digit follows)
 *   `1.e10`                                      → float (exponent follows)
 *   `1.foo`                                      → IntLiteral, Dot, Ident
 *   `1..2`                                       → IntLiteral, DotDot, IntLiteral
 *   `1.*`                                        → IntLiteral, Dot, Star
 */
const FLOAT_TRAILING_TERMINATORS: ReadonlySet<string> = new Set([
  "",
  " ",
  "\t",
  "\n",
  "\r",
  ";",
  ")",
  "}",
  ",",
]);

function canFollowTrailingDot(ch: string): boolean {
  return isDigit(ch) || ch === "e" || ch === "E" || FLOAT_TRAILING_TERMINATORS.has(ch);
}

// ─── Suffix table ─────────────────────────────────────────────────────────

const NUMERIC_SUFFIXES: ReadonlySet<string> = new Set([
  "i8",
  "i16",
  "i32",
  "i64",
  "u8",
  "u16",
  "u32",
  "u64",
  "isize",
  "usize",
  "f32",
  "f64",
]);

const FLOAT_SUFFIXES: ReadonlySet<string> = new Set(["f32", "f64"]);

// Longest suffix is `isize`/`usize` (5); shortest is `i8`/`u8` (2). Try longest
// first so `i32` doesn't shadow a longer prefix match (none today, but safe).
const SUFFIX_LENGTHS = [5, 3, 2] as const;

// ─── Number scanning ──────────────────────────────────────────────────────

export function readNumber(lexer: Lexer): Token {
  const start = lexer.pos;

  // `.75` — leading dot.
  if (lexer.peek() === ".") {
    return readDecimalFraction(lexer, start);
  }

  // Radix prefixes: `0x…`, `0b…`, `0o…`.
  if (lexer.peek() === "0") {
    const next = lexer.peek(1);
    if (next === "x" || next === "X")
      return readPrefixedInt(lexer, start, "x", isHexDigit, "hex digit", false);
    if (next === "b" || next === "B")
      return readPrefixedInt(lexer, start, "b", isBinaryDigit, "binary digit", true);
    if (next === "o" || next === "O")
      return readPrefixedInt(lexer, start, "o", isOctalDigit, "octal digit", true);
  }

  // Decimal integer part.
  consumeDigits(lexer, isDigit);

  // Optional fractional part: `.<digits>?`. We only consume the dot when
  // what follows confirms a float — never field access, range, or deref.
  if (lexer.peek() === "." && canFollowTrailingDot(lexer.peek(1))) {
    lexer.pos++; // consume '.'
    consumeDigits(lexer, isDigit);
    return finishFloatWithExponent(lexer, start);
  }

  // No fraction, but a bare exponent (`1e10`).
  if (lexer.peek() === "e" || lexer.peek() === "E") {
    return finishFloatWithExponent(lexer, start);
  }

  return makeNumberToken(lexer, TokenKind.IntLiteral, start);
}

function readDecimalFraction(lexer: Lexer, start: number): Token {
  lexer.pos++; // consume '.'
  consumeDigits(lexer, isDigit);
  return finishFloatWithExponent(lexer, start);
}

/**
 * Consume an optional exponent and emit a FloatLiteral token, or an Error
 * token if the exponent is malformed (`1e`, `1e+`).
 */
function finishFloatWithExponent(lexer: Lexer, start: number): Token {
  if (!consumeExponent(lexer)) {
    lexer.addDiagnostic(Severity.Error, "Expected digit in exponent", start);
    return lexer.makeToken(TokenKind.Error, start, lexer.pos);
  }
  return makeNumberToken(lexer, TokenKind.FloatLiteral, start);
}

/**
 * Shared body for `0x` / `0b` / `0o` literals.
 *
 * `allowLeadingUnderscore` mirrors the original behaviour: binary and octal
 * accept `0b_…` / `0o_…` (an underscore in the very first position), while
 * hex does not.
 */
function readPrefixedInt(
  lexer: Lexer,
  start: number,
  prefixLetter: string,
  isDigitInRadix: (ch: string) => boolean,
  digitDescription: string,
  allowLeadingUnderscore: boolean
): Token {
  lexer.pos += 2; // skip `0x` / `0b` / `0o`
  const first = lexer.peek();
  if (!isDigitInRadix(first) && !(allowLeadingUnderscore && first === "_")) {
    lexer.addDiagnostic(
      Severity.Error,
      `Expected ${digitDescription} after '0${prefixLetter}'`,
      start
    );
    return lexer.makeToken(TokenKind.Error, start, lexer.pos);
  }
  consumeDigits(lexer, isDigitInRadix);
  return makeNumberToken(lexer, TokenKind.IntLiteral, start);
}

function consumeDigits(lexer: Lexer, isValidDigit: (ch: string) => boolean): void {
  while (lexer.pos < lexer.source.length) {
    const ch = lexer.peek();
    if (!isValidDigit(ch) && ch !== "_") break;
    lexer.pos++;
  }
}

/**
 * If positioned at `e`/`E`, consume the exponent (with optional sign and
 * required digits) and return true; an `e` with no following digits returns
 * false. If not at an exponent intro, returns true (no-op).
 */
function consumeExponent(lexer: Lexer): boolean {
  if (lexer.peek() !== "e" && lexer.peek() !== "E") return true;
  lexer.pos++;
  if (lexer.peek() === "+" || lexer.peek() === "-") lexer.pos++;
  if (!isDigit(lexer.peek())) return false;
  consumeDigits(lexer, isDigit);
  return true;
}

/**
 * Try to consume a numeric type suffix (`i32`, `usize`, `f64`, …) immediately
 * after the digit sequence. Returns the matched suffix or `undefined`.
 */
function consumeSuffix(lexer: Lexer): string | undefined {
  const remaining = lexer.source.content.slice(lexer.pos);

  for (const len of SUFFIX_LENGTHS) {
    const candidate = remaining.slice(0, len);
    if (!NUMERIC_SUFFIXES.has(candidate)) continue;
    // Reject `42i32x` — a suffix must be followed by a non-alphanumeric
    // boundary, otherwise `i32x` is the start of an identifier.
    if (isAlphaNumeric(remaining.charAt(len))) continue;
    lexer.pos += len;
    return candidate;
  }
  return undefined;
}

function makeNumberToken(lexer: Lexer, kind: TokenKind, start: number): Token {
  const suffix = consumeSuffix(lexer);

  // An integer literal with `f32`/`f64` becomes a float.
  const effectiveKind =
    suffix && kind === TokenKind.IntLiteral && FLOAT_SUFFIXES.has(suffix)
      ? TokenKind.FloatLiteral
      : kind;

  const lexeme = lexer.slice(start, lexer.pos);
  const numericPart = suffix ? lexeme.slice(0, -suffix.length) : lexeme;
  const cleaned = numericPart.replace(/_/g, "");
  const value = parseNumericValue(cleaned, effectiveKind);

  const base = lexer.makeToken(effectiveKind, start, lexer.pos);
  const token: Token = { ...base, value };
  if (suffix) token.suffix = suffix;
  return token;
}

function parseNumericValue(cleaned: string, kind: TokenKind): number {
  if (kind === TokenKind.FloatLiteral) {
    return Number.parseFloat(cleaned);
  }
  if (cleaned.length >= 2 && cleaned[0] === "0") {
    const marker = cleaned[1];
    if (marker === "x" || marker === "X") return Number.parseInt(cleaned.slice(2), 16);
    if (marker === "b" || marker === "B") return Number.parseInt(cleaned.slice(2), 2);
    if (marker === "o" || marker === "O") return Number.parseInt(cleaned.slice(2), 8);
  }
  return Number.parseInt(cleaned, 10);
}
