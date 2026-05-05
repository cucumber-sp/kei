/**
 * Number literal scanning methods for Lexer.
 * Extracted from lexer.ts for modularity.
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

export function readNumber(this: Lexer): Token {
  const start = this.pos;

  // `.75` — leading dot.
  if (this.peek() === ".") {
    return this.readDecimalFraction(start);
  }

  // Radix prefixes: `0x…`, `0b…`, `0o…`.
  if (this.peek() === "0") {
    const next = this.peek(1);
    if (next === "x" || next === "X") return this.readHexNumber(start);
    if (next === "b" || next === "B") return this.readBinaryNumber(start);
    if (next === "o" || next === "O") return this.readOctalNumber(start);
  }

  // Decimal integer part.
  this.consumeDigits(isDigit);

  // Optional fractional part: `.<digits>?`. We only consume the dot when
  // what follows confirms a float — never field access, range, or deref.
  if (this.peek() === "." && canFollowTrailingDot(this.peek(1))) {
    this.pos++; // consume '.'
    this.consumeDigits(isDigit);
    return this.finishFloatWithExponent(start);
  }

  // No fraction, but a bare exponent (`1e10`).
  if (this.peek() === "e" || this.peek() === "E") {
    return this.finishFloatWithExponent(start);
  }

  return this.makeNumberToken(TokenKind.IntLiteral, start);
}

export function readDecimalFraction(this: Lexer, start: number): Token {
  this.pos++; // consume '.'
  this.consumeDigits(isDigit);
  return this.finishFloatWithExponent(start);
}

/**
 * Consume an optional exponent and emit a FloatLiteral token, or an Error
 * token if the exponent is malformed (`1e`, `1e+`).
 */
export function finishFloatWithExponent(this: Lexer, start: number): Token {
  if (!this.consumeExponent()) {
    this.addDiagnostic(Severity.Error, "Expected digit in exponent", start);
    return this.makeToken(TokenKind.Error, start, this.pos);
  }
  return this.makeNumberToken(TokenKind.FloatLiteral, start);
}

export function readHexNumber(this: Lexer, start: number): Token {
  return this.readPrefixedInt(start, "x", isHexDigit, "hex digit", false);
}

export function readBinaryNumber(this: Lexer, start: number): Token {
  return this.readPrefixedInt(start, "b", isBinaryDigit, "binary digit", true);
}

export function readOctalNumber(this: Lexer, start: number): Token {
  return this.readPrefixedInt(start, "o", isOctalDigit, "octal digit", true);
}

/**
 * Shared body for `0x` / `0b` / `0o` literals.
 *
 * `allowLeadingUnderscore` mirrors the original behaviour: binary and octal
 * accept `0b_…` / `0o_…` (an underscore in the very first position), while
 * hex does not.
 */
export function readPrefixedInt(
  this: Lexer,
  start: number,
  prefixLetter: string,
  isDigitInRadix: (ch: string) => boolean,
  digitDescription: string,
  allowLeadingUnderscore: boolean
): Token {
  this.pos += 2; // skip `0x` / `0b` / `0o`
  const first = this.peek();
  if (!isDigitInRadix(first) && !(allowLeadingUnderscore && first === "_")) {
    this.addDiagnostic(
      Severity.Error,
      `Expected ${digitDescription} after '0${prefixLetter}'`,
      start
    );
    return this.makeToken(TokenKind.Error, start, this.pos);
  }
  this.consumeDigits(isDigitInRadix);
  return this.makeNumberToken(TokenKind.IntLiteral, start);
}

export function consumeDigits(this: Lexer, isValidDigit: (ch: string) => boolean): void {
  while (this.pos < this.source.length) {
    const ch = this.peek();
    if (!isValidDigit(ch) && ch !== "_") break;
    this.pos++;
  }
}

/**
 * If positioned at `e`/`E`, consume the exponent (with optional sign and
 * required digits) and return true; an `e` with no following digits returns
 * false. If not at an exponent intro, returns true (no-op).
 */
export function consumeExponent(this: Lexer): boolean {
  if (this.peek() !== "e" && this.peek() !== "E") return true;
  this.pos++;
  if (this.peek() === "+" || this.peek() === "-") this.pos++;
  if (!isDigit(this.peek())) return false;
  this.consumeDigits(isDigit);
  return true;
}

/**
 * Try to consume a numeric type suffix (`i32`, `usize`, `f64`, …) immediately
 * after the digit sequence. Returns the matched suffix or `undefined`.
 */
export function consumeSuffix(this: Lexer): string | undefined {
  const remaining = this.source.content.slice(this.pos);

  for (const len of SUFFIX_LENGTHS) {
    const candidate = remaining.slice(0, len);
    if (!NUMERIC_SUFFIXES.has(candidate)) continue;
    // Reject `42i32x` — a suffix must be followed by a non-alphanumeric
    // boundary, otherwise `i32x` is the start of an identifier.
    if (isAlphaNumeric(remaining.charAt(len))) continue;
    this.pos += len;
    return candidate;
  }
  return undefined;
}

export function makeNumberToken(this: Lexer, kind: TokenKind, start: number): Token {
  const suffix = this.consumeSuffix();

  // An integer literal with `f32`/`f64` becomes a float.
  const effectiveKind =
    suffix && kind === TokenKind.IntLiteral && FLOAT_SUFFIXES.has(suffix)
      ? TokenKind.FloatLiteral
      : kind;

  const lexeme = this.source.content.slice(start, this.pos);
  const numericPart = suffix ? lexeme.slice(0, -suffix.length) : lexeme;
  const cleaned = numericPart.replace(/_/g, "");
  const value = parseNumericValue(cleaned, effectiveKind);

  const { line, column } = this.source.lineCol(start);
  const token: Token = {
    kind: effectiveKind,
    lexeme,
    span: { start, end: this.pos },
    line,
    column,
    value,
  };
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
