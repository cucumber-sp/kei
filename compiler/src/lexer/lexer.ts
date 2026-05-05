/**
 * Lexer for the Kei language.
 *
 * Converts a {@link SourceFile} into a stream of {@link Token}s. The lexer
 * performs error recovery: when it encounters an invalid character or malformed
 * literal it emits a {@link TokenKind.Error} token, records a diagnostic, and
 * continues scanning so that downstream passes receive as many valid tokens as
 * possible.
 *
 * Number- and string-literal scanning live in `lexer-numbers.ts` and
 * `lexer-strings.ts` as free functions that take the {@link Lexer} as their
 * first argument. Mirrors the parser/checker convention.
 */

import { type Diagnostic, Severity } from "../errors";
import type { SourceFile } from "../utils/source";
import { readNumber } from "./lexer-numbers";
import { readString } from "./lexer-strings";
import {
  getReservedTokenKind,
  isReservedKeyword,
  lookupKeyword,
  type Token,
  TokenKind,
} from "./token";

// ─── Character helpers ────────────────────────────────────────────────────
//
// `charCodeAt(0)` returns NaN for the empty string, and every NaN-vs-number
// comparison is false. That means each predicate below safely returns `false`
// for "" without an explicit guard — relied on by callers that probe one past
// end-of-input.

const CHAR_0 = 0x30;
const CHAR_7 = 0x37;
const CHAR_9 = 0x39;
const CHAR_A = 0x41;
const CHAR_F = 0x46;
const CHAR_Z = 0x5a;
const CHAR_UNDERSCORE = 0x5f;
const CHAR_a = 0x61;
const CHAR_f = 0x66;
const CHAR_z = 0x7a;

export function isDigit(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= CHAR_0 && code <= CHAR_9;
}

export function isAlpha(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= CHAR_a && code <= CHAR_z) ||
    (code >= CHAR_A && code <= CHAR_Z) ||
    code === CHAR_UNDERSCORE
  );
}

export function isAlphaNumeric(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch);
}

export function isHexDigit(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= CHAR_0 && code <= CHAR_9) ||
    (code >= CHAR_a && code <= CHAR_f) ||
    (code >= CHAR_A && code <= CHAR_F)
  );
}

export function isBinaryDigit(ch: string): boolean {
  return ch === "0" || ch === "1";
}

export function isOctalDigit(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= CHAR_0 && code <= CHAR_7;
}

// ─── Lexer ────────────────────────────────────────────────────────────────

export class Lexer {
  readonly source: SourceFile;
  pos: number;
  private diagnostics: Diagnostic[];

  constructor(source: SourceFile) {
    this.source = source;
    this.pos = 0;
    this.diagnostics = [];
  }

  /** Returns all diagnostics accumulated during the most recent tokenization. */
  getDiagnostics(): ReadonlyArray<Diagnostic> {
    return this.diagnostics;
  }

  /**
   * Scans the entire source file and returns an array of tokens.
   *
   * The returned array always ends with a {@link TokenKind.Eof} token. Calling
   * this method resets the lexer position and accumulated diagnostics, so it
   * is safe to invoke more than once on the same instance.
   */
  tokenize(): Token[] {
    this.pos = 0;
    this.diagnostics = [];
    const tokens: Token[] = [];
    let token = this.nextToken();
    while (token.kind !== TokenKind.Eof) {
      tokens.push(token);
      token = this.nextToken();
    }
    tokens.push(token);
    return tokens;
  }

  /**
   * Scans and returns the next token from the source.
   *
   * Returns {@link TokenKind.Eof} when the end of input is reached.
   */
  nextToken(): Token {
    this.skipWhitespaceAndComments();

    if (this.pos >= this.source.length) {
      return this.makeToken(TokenKind.Eof, this.pos, this.pos);
    }

    const ch = this.peek();

    if (isAlpha(ch)) {
      return this.readIdentifierOrKeyword();
    }

    if (isDigit(ch) || (ch === "." && isDigit(this.peek(1)))) {
      return readNumber(this);
    }

    if (ch === '"') {
      return readString(this);
    }

    return this.readOperatorOrPunctuation();
  }

  // ─── Cursor primitives (used by extracted modules) ──────────────────────

  /** Returns the character at `pos + offset`, or `""` past end-of-input. */
  peek(offset = 0): string {
    return this.source.charAt(this.pos + offset);
  }

  /** Consumes and returns the current character. */
  advance(): string {
    const ch = this.source.charAt(this.pos);
    this.pos++;
    return ch;
  }

  /** Reads a substring of the source between two positions. */
  slice(start: number, end: number): string {
    return this.source.content.slice(start, end);
  }

  /** Builds a token with span/line/column derived from `start` and `end`. */
  makeToken(kind: TokenKind, start: number, end: number): Token {
    const { line, column } = this.source.lineCol(start);
    return {
      kind,
      lexeme: this.source.content.slice(start, end),
      span: { start, end },
      line,
      column,
    };
  }

  /** Pushes a diagnostic anchored at `offset`. */
  addDiagnostic(severity: Severity, message: string, offset: number): void {
    const { line, column } = this.source.lineCol(offset);
    this.diagnostics.push({
      severity,
      message,
      location: {
        file: this.source.filename,
        line,
        column,
        offset,
      },
    });
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private skipWhitespaceAndComments(): void {
    while (this.pos < this.source.length) {
      const ch = this.peek();

      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        this.pos++;
        continue;
      }

      if (ch === "/" && this.peek(1) === "/") {
        this.skipSingleLineComment();
        continue;
      }

      if (ch === "/" && this.peek(1) === "*") {
        this.skipMultiLineComment();
        continue;
      }

      break;
    }
  }

  private skipSingleLineComment(): void {
    this.pos += 2; // skip //
    while (this.pos < this.source.length) {
      const ch = this.peek();
      if (ch === "\n" || ch === "\r") return;
      this.pos++;
    }
  }

  private skipMultiLineComment(): void {
    const start = this.pos;
    this.pos += 2; // skip /*
    while (this.pos < this.source.length) {
      if (this.peek() === "*" && this.peek(1) === "/") {
        this.pos += 2;
        return;
      }
      this.pos++;
    }
    const { line, column } = this.source.lineCol(start);
    this.addDiagnostic(
      Severity.Error,
      `Unterminated multi-line comment (started at ${line}:${column})`,
      start
    );
  }

  private readIdentifierOrKeyword(): Token {
    const start = this.pos;
    while (this.pos < this.source.length && isAlphaNumeric(this.peek())) {
      this.pos++;
    }
    const lexeme = this.slice(start, this.pos);

    const keywordKind = lookupKeyword(lexeme);
    if (keywordKind !== undefined) {
      const token = this.makeToken(keywordKind, start, this.pos);
      if (keywordKind === TokenKind.True) return { ...token, value: true };
      if (keywordKind === TokenKind.False) return { ...token, value: false };
      return token;
    }

    if (isReservedKeyword(lexeme)) {
      this.addDiagnostic(Severity.Error, `'${lexeme}' is reserved for future use`, start);
      const reservedKind = getReservedTokenKind(lexeme);
      return this.makeToken(reservedKind ?? TokenKind.Error, start, this.pos);
    }

    return this.makeToken(TokenKind.Identifier, start, this.pos);
  }

  private readOperatorOrPunctuation(): Token {
    const start = this.pos;
    const ch = this.advance();

    switch (ch) {
      case "+":
        return this.peek() === "="
          ? this.consume(TokenKind.PlusEqual, start)
          : this.makeToken(TokenKind.Plus, start, this.pos);
      case "-":
        if (this.peek() === "=") return this.consume(TokenKind.MinusEqual, start);
        if (this.peek() === ">") return this.consume(TokenKind.Arrow, start);
        return this.makeToken(TokenKind.Minus, start, this.pos);
      case "*":
        return this.peek() === "="
          ? this.consume(TokenKind.StarEqual, start)
          : this.makeToken(TokenKind.Star, start, this.pos);
      case "/":
        return this.peek() === "="
          ? this.consume(TokenKind.SlashEqual, start)
          : this.makeToken(TokenKind.Slash, start, this.pos);
      case "%":
        return this.peek() === "="
          ? this.consume(TokenKind.PercentEqual, start)
          : this.makeToken(TokenKind.Percent, start, this.pos);
      case "=":
        if (this.peek() === "=") return this.consume(TokenKind.EqualEqual, start);
        if (this.peek() === ">") return this.consume(TokenKind.FatArrow, start);
        return this.makeToken(TokenKind.Equal, start, this.pos);
      case "!":
        return this.peek() === "="
          ? this.consume(TokenKind.BangEqual, start)
          : this.makeToken(TokenKind.Bang, start, this.pos);
      case "<":
        if (this.peek() === "<") {
          this.pos++;
          return this.peek() === "="
            ? this.consume(TokenKind.LessLessEqual, start)
            : this.makeToken(TokenKind.LessLess, start, this.pos);
        }
        return this.peek() === "="
          ? this.consume(TokenKind.LessEqual, start)
          : this.makeToken(TokenKind.Less, start, this.pos);
      case ">":
        if (this.peek() === ">") {
          this.pos++;
          return this.peek() === "="
            ? this.consume(TokenKind.GreaterGreaterEqual, start)
            : this.makeToken(TokenKind.GreaterGreater, start, this.pos);
        }
        return this.peek() === "="
          ? this.consume(TokenKind.GreaterEqual, start)
          : this.makeToken(TokenKind.Greater, start, this.pos);
      case "&":
        if (this.peek() === "&") return this.consume(TokenKind.AmpAmp, start);
        if (this.peek() === "=") return this.consume(TokenKind.AmpEqual, start);
        return this.makeToken(TokenKind.Amp, start, this.pos);
      case "|":
        if (this.peek() === "|") return this.consume(TokenKind.PipePipe, start);
        if (this.peek() === "=") return this.consume(TokenKind.PipeEqual, start);
        return this.makeToken(TokenKind.Pipe, start, this.pos);
      case "^":
        return this.peek() === "="
          ? this.consume(TokenKind.CaretEqual, start)
          : this.makeToken(TokenKind.Caret, start, this.pos);
      case "~":
        return this.makeToken(TokenKind.Tilde, start, this.pos);
      case ".":
        if (this.peek() === ".") {
          this.pos++;
          return this.peek() === "="
            ? this.consume(TokenKind.DotDotEqual, start)
            : this.makeToken(TokenKind.DotDot, start, this.pos);
        }
        return this.makeToken(TokenKind.Dot, start, this.pos);
      case "{":
        return this.makeToken(TokenKind.LeftBrace, start, this.pos);
      case "}":
        return this.makeToken(TokenKind.RightBrace, start, this.pos);
      case "(":
        return this.makeToken(TokenKind.LeftParen, start, this.pos);
      case ")":
        return this.makeToken(TokenKind.RightParen, start, this.pos);
      case "[":
        return this.makeToken(TokenKind.LeftBracket, start, this.pos);
      case "]":
        return this.makeToken(TokenKind.RightBracket, start, this.pos);
      case ";":
        return this.makeToken(TokenKind.Semicolon, start, this.pos);
      case ":":
        return this.makeToken(TokenKind.Colon, start, this.pos);
      case ",":
        return this.makeToken(TokenKind.Comma, start, this.pos);
      case "?":
        return this.makeToken(TokenKind.Question, start, this.pos);
      default:
        this.addDiagnostic(Severity.Error, `Unexpected character '${ch}'`, start);
        return this.makeToken(TokenKind.Error, start, this.pos);
    }
  }

  /** Advance once and emit `kind` over [start, this.pos). */
  private consume(kind: TokenKind, start: number): Token {
    this.pos++;
    return this.makeToken(kind, start, this.pos);
  }
}
