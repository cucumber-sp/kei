/**
 * Number literal scanning methods for Lexer.
 * Extracted from lexer.ts for modularity.
 */

import { Severity } from "../errors/index.ts";
import type { Token } from "./token.ts";
import { TokenKind } from "./token.ts";
import type { Lexer } from "./lexer.ts";
import { isAlpha, isAlphaNumeric, isDigit, isHexDigit, isBinaryDigit, isOctalDigit } from "./lexer.ts";

// ─── Number scanning ──────────────────────────────────────────────────────

export function readNumber(this: Lexer): Token {
  const start = this.pos;

  // Handle leading dot (.75)
  if (this.peek() === ".") {
    return this.readDecimalFraction(start);
  }

  // Check for prefix: 0x, 0b, 0o
  if (this.peek() === "0" && this.pos + 1 < this.source.length) {
    const next = this.peek(1);
    if (next === "x" || next === "X") {
      return this.readHexNumber(start);
    }
    if (next === "b" || next === "B") {
      return this.readBinaryNumber(start);
    }
    if (next === "o" || next === "O") {
      return this.readOctalNumber(start);
    }
  }

  // Decimal number
  this.consumeDigits(isDigit);

  // Check for float (but not range `..` or deref `.*`)
  if (this.peek() === "." && this.peek(1) !== "*" && this.peek(1) !== ".") {
    // Could be float or just integer followed by dot
    const nextAfterDot = this.peek(1);
    if (
      nextAfterDot === "" ||
      !isAlpha(nextAfterDot) ||
      nextAfterDot === "e" ||
      nextAfterDot === "E"
    ) {
      if (
        isDigit(nextAfterDot) ||
        nextAfterDot === "e" ||
        nextAfterDot === "E" ||
        nextAfterDot === "" ||
        nextAfterDot === " " ||
        nextAfterDot === ";" ||
        nextAfterDot === ")" ||
        nextAfterDot === "}" ||
        nextAfterDot === "," ||
        nextAfterDot === "\n" ||
        nextAfterDot === "\r" ||
        nextAfterDot === "\t"
      ) {
        this.pos++; // consume dot
        if (isDigit(this.peek())) {
          this.consumeDigits(isDigit);
        }
        if (!this.consumeExponent()) {
          this.addDiagnostic(Severity.Error, "Expected digit in exponent", start);
          return this.makeToken(TokenKind.Error, start, this.pos);
        }
        return this.makeNumberToken(TokenKind.FloatLiteral, start);
      }
    }
  }

  if (this.peek() === "e" || this.peek() === "E") {
    if (!this.consumeExponent()) {
      this.addDiagnostic(Severity.Error, "Expected digit in exponent", start);
      return this.makeToken(TokenKind.Error, start, this.pos);
    }
    return this.makeNumberToken(TokenKind.FloatLiteral, start);
  }

  return this.makeNumberToken(TokenKind.IntLiteral, start);
}

export function readDecimalFraction(this: Lexer, start: number): Token {
  this.pos++; // consume dot
  this.consumeDigits(isDigit);
  if (!this.consumeExponent()) {
    this.addDiagnostic(Severity.Error, "Expected digit in exponent", start);
    return this.makeToken(TokenKind.Error, start, this.pos);
  }
  return this.makeNumberToken(TokenKind.FloatLiteral, start);
}

export function readHexNumber(this: Lexer, start: number): Token {
  this.pos += 2; // skip 0x
  if (!isHexDigit(this.peek())) {
    this.addDiagnostic(Severity.Error, "Expected hex digit after '0x'", start);
    return this.makeToken(TokenKind.Error, start, this.pos);
  }
  this.consumeDigits(isHexDigit);
  return this.makeNumberToken(TokenKind.IntLiteral, start);
}

export function readBinaryNumber(this: Lexer, start: number): Token {
  this.pos += 2; // skip 0b
  if (!isBinaryDigit(this.peek()) && this.peek() !== "_") {
    this.addDiagnostic(Severity.Error, "Expected binary digit after '0b'", start);
    return this.makeToken(TokenKind.Error, start, this.pos);
  }
  this.consumeDigits(isBinaryDigit);
  return this.makeNumberToken(TokenKind.IntLiteral, start);
}

export function readOctalNumber(this: Lexer, start: number): Token {
  this.pos += 2; // skip 0o
  if (!isOctalDigit(this.peek()) && this.peek() !== "_") {
    this.addDiagnostic(Severity.Error, "Expected octal digit after '0o'", start);
    return this.makeToken(TokenKind.Error, start, this.pos);
  }
  this.consumeDigits(isOctalDigit);
  return this.makeNumberToken(TokenKind.IntLiteral, start);
}

export function consumeDigits(this: Lexer, isValidDigit: (ch: string) => boolean): void {
  while (this.pos < this.source.length) {
    const ch = this.peek();
    if (isValidDigit(ch) || ch === "_") {
      this.pos++;
    } else {
      break;
    }
  }
}

export function consumeExponent(this: Lexer): boolean {
  if (this.peek() === "e" || this.peek() === "E") {
    this.pos++;
    if (this.peek() === "+" || this.peek() === "-") {
      this.pos++;
    }
    if (!isDigit(this.peek())) {
      return false;
    }
    this.consumeDigits(isDigit);
  }
  return true;
}

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

export function consumeSuffix(this: Lexer): string | undefined {
  // Try to match a type suffix immediately after the number digits.
  // We look ahead without advancing, then consume if we find a valid suffix.
  const remaining = this.source.content.slice(this.pos);

  // Try longest suffixes first (isize, usize are 5 chars; others are 2-3)
  for (const len of [5, 3, 2]) {
    const candidate = remaining.slice(0, len);
    if (NUMERIC_SUFFIXES.has(candidate)) {
      // Make sure the suffix isn't followed by more alphanumeric chars
      // (e.g. `42i32x` should NOT match `i32` as a suffix)
      const afterSuffix = remaining.charAt(len);
      if (afterSuffix === "" || !isAlphaNumeric(afterSuffix)) {
        this.pos += len;
        return candidate;
      }
    }
  }
  return undefined;
}

export function makeNumberToken(this: Lexer, kind: TokenKind, start: number): Token {
  // Try to consume a type suffix
  const suffix = this.consumeSuffix();

  // If an integer literal has a float suffix, promote to FloatLiteral
  let effectiveKind = kind;
  if (suffix && kind === TokenKind.IntLiteral && FLOAT_SUFFIXES.has(suffix)) {
    effectiveKind = TokenKind.FloatLiteral;
  }

  const lexeme = this.source.content.slice(start, this.pos);
  // Strip both underscores and suffix from the numeric part for parsing
  const numericPart = suffix ? lexeme.slice(0, lexeme.length - suffix.length) : lexeme;
  const cleaned = numericPart.replace(/_/g, "");
  let value: number;

  if (effectiveKind === TokenKind.FloatLiteral) {
    value = Number.parseFloat(cleaned);
  } else if (cleaned.startsWith("0x") || cleaned.startsWith("0X")) {
    value = Number.parseInt(cleaned.slice(2), 16);
  } else if (cleaned.startsWith("0b") || cleaned.startsWith("0B")) {
    value = Number.parseInt(cleaned.slice(2), 2);
  } else if (cleaned.startsWith("0o") || cleaned.startsWith("0O")) {
    value = Number.parseInt(cleaned.slice(2), 8);
  } else {
    value = Number.parseInt(cleaned, 10);
  }

  const { line, column } = this.source.lineCol(start);
  const token: Token = {
    kind: effectiveKind,
    lexeme,
    span: { start, end: this.pos },
    line,
    column,
    value,
  };
  if (suffix) {
    token.suffix = suffix;
  }
  return token;
}
