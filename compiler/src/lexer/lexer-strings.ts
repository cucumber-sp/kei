/**
 * String literal scanning methods for Lexer.
 * Extracted from lexer.ts for modularity.
 */

import { Severity } from "../errors/index.ts";
import type { Token } from "./token.ts";
import { TokenKind } from "./token.ts";
import type { Lexer } from "./lexer.ts";
import { isHexDigit } from "./lexer.ts";

// ─── String scanning ──────────────────────────────────────────────────────

export function readString(this: Lexer): Token {
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
      this.addDiagnostic(
        Severity.Error,
        "Unterminated string literal (strings cannot contain unescaped newlines)",
        start
      );
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

  this.addDiagnostic(Severity.Error, "Unterminated string literal (missing closing '\"')", start);
  return this.makeToken(TokenKind.Error, start, this.pos);
}

export function readEscapeSequence(this: Lexer, stringStart: number): string | undefined {
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
