/**
 * Lexer for the Kei language.
 *
 * Converts a {@link SourceFile} into a stream of {@link Token}s.  The lexer
 * performs error recovery: when it encounters an invalid character or malformed
 * literal it emits a {@link TokenKind.Error} token, records a diagnostic, and
 * continues scanning so that downstream passes receive as many valid tokens as
 * possible.
 *
 * Method implementations are split across:
 *   - lexer-numbers.ts  (number literal scanning)
 *   - lexer-strings.ts  (string literal scanning)
 */

import { type Diagnostic, Severity } from "../errors/index.ts";
import type { SourceFile } from "../utils/source.ts";
import * as numberMethods from "./lexer-numbers.ts";
import * as stringMethods from "./lexer-strings.ts";
import {
  getReservedTokenKind,
  isReservedKeyword,
  lookupKeyword,
  type Token,
  TokenKind,
} from "./token.ts";

// ─── Character helpers ────────────────────────────────────────────────────

const CHAR_0 = 48; // '0'
const CHAR_9 = 57; // '9'
const CHAR_a = 97;
const CHAR_f = 102;
const CHAR_A = 65;
const CHAR_F = 70;
const CHAR_7 = 55;
const CHAR_UNDERSCORE = 95;

export function isDigit(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= CHAR_0 && code <= CHAR_9;
}

export function isAlpha(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= CHAR_a && code <= 122) || (code >= CHAR_A && code <= 90) || code === CHAR_UNDERSCORE
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

// ─── Lexer class ──────────────────────────────────────────────────────────

export class Lexer {
  source: SourceFile;
  pos: number;
  diagnostics: Diagnostic[];

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
   * The returned array always ends with a {@link TokenKind.Eof} token.
   * Calling this method resets the lexer position and diagnostics.
   */
  tokenize(): Token[] {
    const tokens: Token[] = [];
    this.pos = 0;
    this.diagnostics = [];
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

    const ch = this.source.charAt(this.pos);

    if (isAlpha(ch)) {
      return this.readIdentifierOrKeyword();
    }

    if (isDigit(ch)) {
      return this.readNumber();
    }

    if (
      ch === "." &&
      this.pos + 1 < this.source.length &&
      isDigit(this.source.charAt(this.pos + 1))
    ) {
      return this.readNumber();
    }

    if (ch === '"') {
      return this.readString();
    }

    return this.readOperatorOrPunctuation();
  }

  peek(offset = 0): string {
    return this.source.charAt(this.pos + offset);
  }

  advance(): string {
    const ch = this.source.charAt(this.pos);
    this.pos++;
    return ch;
  }

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
      if (ch === "\n" || ch === "\r") {
        break;
      }
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
    const lexeme = this.source.content.slice(start, this.pos);

    const keywordKind = lookupKeyword(lexeme);
    if (keywordKind !== undefined) {
      const token = this.makeToken(keywordKind, start, this.pos);
      if (keywordKind === TokenKind.True) {
        return { ...token, value: true };
      }
      if (keywordKind === TokenKind.False) {
        return { ...token, value: false };
      }
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
        if (this.peek() === "+") {
          this.pos++;
          return this.makeToken(TokenKind.PlusPlus, start, this.pos);
        }
        if (this.peek() === "=") {
          this.pos++;
          return this.makeToken(TokenKind.PlusEqual, start, this.pos);
        }
        return this.makeToken(TokenKind.Plus, start, this.pos);
      case "-":
        if (this.peek() === "-") {
          this.pos++;
          return this.makeToken(TokenKind.MinusMinus, start, this.pos);
        }
        if (this.peek() === "=") {
          this.pos++;
          return this.makeToken(TokenKind.MinusEqual, start, this.pos);
        }
        if (this.peek() === ">") {
          this.pos++;
          return this.makeToken(TokenKind.Arrow, start, this.pos);
        }
        return this.makeToken(TokenKind.Minus, start, this.pos);
      case "*":
        if (this.peek() === "=") {
          this.pos++;
          return this.makeToken(TokenKind.StarEqual, start, this.pos);
        }
        return this.makeToken(TokenKind.Star, start, this.pos);
      case "/":
        if (this.peek() === "=") {
          this.pos++;
          return this.makeToken(TokenKind.SlashEqual, start, this.pos);
        }
        return this.makeToken(TokenKind.Slash, start, this.pos);
      case "%":
        if (this.peek() === "=") {
          this.pos++;
          return this.makeToken(TokenKind.PercentEqual, start, this.pos);
        }
        return this.makeToken(TokenKind.Percent, start, this.pos);
      case "=":
        if (this.peek() === "=") {
          this.pos++;
          return this.makeToken(TokenKind.EqualEqual, start, this.pos);
        }
        if (this.peek() === ">") {
          this.pos++;
          return this.makeToken(TokenKind.FatArrow, start, this.pos);
        }
        return this.makeToken(TokenKind.Equal, start, this.pos);
      case "!":
        if (this.peek() === "=") {
          this.pos++;
          return this.makeToken(TokenKind.BangEqual, start, this.pos);
        }
        return this.makeToken(TokenKind.Bang, start, this.pos);
      case "<":
        if (this.peek() === "<") {
          this.pos++;
          if (this.peek() === "=") {
            this.pos++;
            return this.makeToken(TokenKind.LessLessEqual, start, this.pos);
          }
          return this.makeToken(TokenKind.LessLess, start, this.pos);
        }
        if (this.peek() === "=") {
          this.pos++;
          return this.makeToken(TokenKind.LessEqual, start, this.pos);
        }
        return this.makeToken(TokenKind.Less, start, this.pos);
      case ">":
        if (this.peek() === ">") {
          this.pos++;
          if (this.peek() === "=") {
            this.pos++;
            return this.makeToken(TokenKind.GreaterGreaterEqual, start, this.pos);
          }
          return this.makeToken(TokenKind.GreaterGreater, start, this.pos);
        }
        if (this.peek() === "=") {
          this.pos++;
          return this.makeToken(TokenKind.GreaterEqual, start, this.pos);
        }
        return this.makeToken(TokenKind.Greater, start, this.pos);
      case "&":
        if (this.peek() === "&") {
          this.pos++;
          return this.makeToken(TokenKind.AmpAmp, start, this.pos);
        }
        if (this.peek() === "=") {
          this.pos++;
          return this.makeToken(TokenKind.AmpEqual, start, this.pos);
        }
        return this.makeToken(TokenKind.Amp, start, this.pos);
      case "|":
        if (this.peek() === "|") {
          this.pos++;
          return this.makeToken(TokenKind.PipePipe, start, this.pos);
        }
        if (this.peek() === "=") {
          this.pos++;
          return this.makeToken(TokenKind.PipeEqual, start, this.pos);
        }
        return this.makeToken(TokenKind.Pipe, start, this.pos);
      case "^":
        if (this.peek() === "=") {
          this.pos++;
          return this.makeToken(TokenKind.CaretEqual, start, this.pos);
        }
        return this.makeToken(TokenKind.Caret, start, this.pos);
      case "~":
        return this.makeToken(TokenKind.Tilde, start, this.pos);
      case ".":
        if (this.peek() === ".") {
          this.pos++;
          if (this.peek() === "=") {
            this.pos++;
            return this.makeToken(TokenKind.DotDotEqual, start, this.pos);
          }
          return this.makeToken(TokenKind.DotDot, start, this.pos);
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
      default:
        this.addDiagnostic(Severity.Error, `Unexpected character '${ch}'`, start);
        return this.makeToken(TokenKind.Error, start, this.pos);
    }
  }

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

  // ─── Number scanning methods (from lexer-numbers.ts) ──────────────────────
  declare readNumber: typeof numberMethods.readNumber;
  declare readDecimalFraction: typeof numberMethods.readDecimalFraction;
  declare readHexNumber: typeof numberMethods.readHexNumber;
  declare readBinaryNumber: typeof numberMethods.readBinaryNumber;
  declare readOctalNumber: typeof numberMethods.readOctalNumber;
  declare consumeDigits: typeof numberMethods.consumeDigits;
  declare consumeExponent: typeof numberMethods.consumeExponent;
  declare consumeSuffix: typeof numberMethods.consumeSuffix;
  declare makeNumberToken: typeof numberMethods.makeNumberToken;

  // ─── String scanning methods (from lexer-strings.ts) ──────────────────────
  declare readString: typeof stringMethods.readString;
  declare readEscapeSequence: typeof stringMethods.readEscapeSequence;
}

// ─── Attach extracted methods to Lexer prototype ──────────────────────────────

// Number scanning methods
Lexer.prototype.readNumber = numberMethods.readNumber;
Lexer.prototype.readDecimalFraction = numberMethods.readDecimalFraction;
Lexer.prototype.readHexNumber = numberMethods.readHexNumber;
Lexer.prototype.readBinaryNumber = numberMethods.readBinaryNumber;
Lexer.prototype.readOctalNumber = numberMethods.readOctalNumber;
Lexer.prototype.consumeDigits = numberMethods.consumeDigits;
Lexer.prototype.consumeExponent = numberMethods.consumeExponent;
Lexer.prototype.consumeSuffix = numberMethods.consumeSuffix;
Lexer.prototype.makeNumberToken = numberMethods.makeNumberToken;

// String scanning methods
Lexer.prototype.readString = stringMethods.readString;
Lexer.prototype.readEscapeSequence = stringMethods.readEscapeSequence;
