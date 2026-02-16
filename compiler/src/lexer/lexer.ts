import { type Diagnostic, Severity } from "../errors/index.ts";
import type { SourceFile } from "../utils/source.ts";
import {
  getReservedTokenKind,
  isReservedKeyword,
  lookupKeyword,
  type Token,
  TokenKind,
} from "./token.ts";

const CHAR_0 = 48; // '0'
const CHAR_9 = 57; // '9'
const CHAR_a = 97;
const CHAR_f = 102;
const CHAR_A = 65;
const CHAR_F = 70;
const CHAR_UNDERSCORE = 95;

function isDigit(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= CHAR_0 && code <= CHAR_9;
}

function isAlpha(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= CHAR_a && code <= 122) || (code >= CHAR_A && code <= 90) || code === CHAR_UNDERSCORE
  );
}

function isAlphaNumeric(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch);
}

function isHexDigit(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= CHAR_0 && code <= CHAR_9) ||
    (code >= CHAR_a && code <= CHAR_f) ||
    (code >= CHAR_A && code <= CHAR_F)
  );
}

function isBinaryDigit(ch: string): boolean {
  return ch === "0" || ch === "1";
}

function isOctalDigit(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= CHAR_0 && code <= 55; // '7' = 55
}

export class Lexer {
  private source: SourceFile;
  private pos: number;
  private diagnostics: Diagnostic[];

  constructor(source: SourceFile) {
    this.source = source;
    this.pos = 0;
    this.diagnostics = [];
  }

  getDiagnostics(): ReadonlyArray<Diagnostic> {
    return this.diagnostics;
  }

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

  private peek(offset = 0): string {
    return this.source.charAt(this.pos + offset);
  }

  private advance(): string {
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
    this.addDiagnostic(Severity.Error, "Unterminated multi-line comment", start);
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

  private readNumber(): Token {
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
          this.consumeExponent();
          return this.makeNumberToken(TokenKind.FloatLiteral, start);
        }
      }
    }

    if (this.peek() === "e" || this.peek() === "E") {
      this.consumeExponent();
      return this.makeNumberToken(TokenKind.FloatLiteral, start);
    }

    return this.makeNumberToken(TokenKind.IntLiteral, start);
  }

  private readDecimalFraction(start: number): Token {
    this.pos++; // consume dot
    this.consumeDigits(isDigit);
    this.consumeExponent();
    return this.makeNumberToken(TokenKind.FloatLiteral, start);
  }

  private readHexNumber(start: number): Token {
    this.pos += 2; // skip 0x
    if (!isHexDigit(this.peek())) {
      this.addDiagnostic(Severity.Error, "Expected hex digit after '0x'", start);
      return this.makeToken(TokenKind.Error, start, this.pos);
    }
    this.consumeDigits(isHexDigit);
    return this.makeNumberToken(TokenKind.IntLiteral, start);
  }

  private readBinaryNumber(start: number): Token {
    this.pos += 2; // skip 0b
    if (!isBinaryDigit(this.peek()) && this.peek() !== "_") {
      this.addDiagnostic(Severity.Error, "Expected binary digit after '0b'", start);
      return this.makeToken(TokenKind.Error, start, this.pos);
    }
    this.consumeDigits(isBinaryDigit);
    return this.makeNumberToken(TokenKind.IntLiteral, start);
  }

  private readOctalNumber(start: number): Token {
    this.pos += 2; // skip 0o
    if (!isOctalDigit(this.peek()) && this.peek() !== "_") {
      this.addDiagnostic(Severity.Error, "Expected octal digit after '0o'", start);
      return this.makeToken(TokenKind.Error, start, this.pos);
    }
    this.consumeDigits(isOctalDigit);
    return this.makeNumberToken(TokenKind.IntLiteral, start);
  }

  private consumeDigits(isValidDigit: (ch: string) => boolean): void {
    while (this.pos < this.source.length) {
      const ch = this.peek();
      if (isValidDigit(ch) || ch === "_") {
        this.pos++;
      } else {
        break;
      }
    }
  }

  private consumeExponent(): void {
    if (this.peek() === "e" || this.peek() === "E") {
      this.pos++;
      if (this.peek() === "+" || this.peek() === "-") {
        this.pos++;
      }
      this.consumeDigits(isDigit);
    }
  }

  private makeNumberToken(kind: TokenKind, start: number): Token {
    const lexeme = this.source.content.slice(start, this.pos);
    const cleaned = lexeme.replace(/_/g, "");
    let value: number;

    if (kind === TokenKind.FloatLiteral) {
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
    return {
      kind,
      lexeme,
      span: { start, end: this.pos },
      line,
      column,
      value,
    };
  }

  private readString(): Token {
    const start = this.pos;
    this.pos++; // skip opening quote
    let value = "";

    while (this.pos < this.source.length) {
      const ch = this.peek();

      if (ch === '"') {
        this.pos++;
        const { line, column } = this.source.lineCol(start);
        return {
          kind: TokenKind.StringLiteral,
          lexeme: this.source.content.slice(start, this.pos),
          span: { start, end: this.pos },
          line,
          column,
          value,
        };
      }

      if (ch === "\n" || ch === "\r") {
        this.addDiagnostic(Severity.Error, "Unterminated string literal", start);
        return this.makeToken(TokenKind.Error, start, this.pos);
      }

      if (ch === "\\") {
        this.pos++;
        const escaped = this.readEscapeSequence(start);
        if (escaped !== undefined) {
          value += escaped;
        }
        continue;
      }

      value += ch;
      this.pos++;
    }

    this.addDiagnostic(Severity.Error, "Unterminated string literal", start);
    return this.makeToken(TokenKind.Error, start, this.pos);
  }

  private readEscapeSequence(stringStart: number): string | undefined {
    if (this.pos >= this.source.length) {
      this.addDiagnostic(Severity.Error, "Unexpected end of string escape", stringStart);
      return undefined;
    }

    const ch = this.advance();
    switch (ch) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case "\\":
        return "\\";
      case '"':
        return '"';
      case "0":
        return "\0";
      case "x": {
        const hex1 = this.peek();
        const hex2 = this.peek(1);
        if (isHexDigit(hex1) && isHexDigit(hex2)) {
          this.pos += 2;
          return String.fromCharCode(Number.parseInt(hex1 + hex2, 16));
        }
        this.addDiagnostic(
          Severity.Error,
          "Invalid hex escape sequence, expected \\xHH",
          this.pos - 2
        );
        return undefined;
      }
      default:
        this.addDiagnostic(Severity.Error, `Invalid escape sequence '\\${ch}'`, this.pos - 2);
        return undefined;
    }
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
        if (this.peek() === "*") {
          this.pos++;
          return this.makeToken(TokenKind.DotStar, start, this.pos);
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

  private makeToken(kind: TokenKind, start: number, end: number): Token {
    const { line, column } = this.source.lineCol(start);
    return {
      kind,
      lexeme: this.source.content.slice(start, end),
      span: { start, end },
      line,
      column,
    };
  }

  private addDiagnostic(severity: Severity, message: string, offset: number): void {
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
}
