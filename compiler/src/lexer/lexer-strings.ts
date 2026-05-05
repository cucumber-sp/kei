/**
 * String literal scanning. Free functions taking the {@link Lexer} as their
 * first argument — the same convention as the parser's per-domain modules.
 */

import { Severity } from "../errors";
import type { Lexer } from "./lexer";
import { isHexDigit } from "./lexer";
import type { Token } from "./token";
import { TokenKind } from "./token";

export function readString(lexer: Lexer): Token {
  const start = lexer.pos;
  lexer.pos++; // skip opening quote
  let value = "";

  while (lexer.pos < lexer.source.length) {
    const ch = lexer.peek();

    if (ch === '"') {
      lexer.pos++;
      const base = lexer.makeToken(TokenKind.StringLiteral, start, lexer.pos);
      return { ...base, value };
    }

    if (ch === "\n" || ch === "\r") {
      lexer.addDiagnostic(
        Severity.Error,
        "Unterminated string literal (strings cannot contain unescaped newlines)",
        start
      );
      return lexer.makeToken(TokenKind.Error, start, lexer.pos);
    }

    if (ch === "\\") {
      lexer.pos++;
      const escaped = readEscapeSequence(lexer, start);
      if (escaped !== undefined) value += escaped;
      continue;
    }

    value += ch;
    lexer.pos++;
  }

  lexer.addDiagnostic(Severity.Error, "Unterminated string literal (missing closing '\"')", start);
  return lexer.makeToken(TokenKind.Error, start, lexer.pos);
}

function readEscapeSequence(lexer: Lexer, stringStart: number): string | undefined {
  if (lexer.pos >= lexer.source.length) {
    lexer.addDiagnostic(Severity.Error, "Unexpected end of string escape", stringStart);
    return undefined;
  }

  const ch = lexer.advance();
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
      const hex1 = lexer.peek();
      const hex2 = lexer.peek(1);
      if (isHexDigit(hex1) && isHexDigit(hex2)) {
        lexer.pos += 2;
        return String.fromCharCode(Number.parseInt(hex1 + hex2, 16));
      }
      lexer.addDiagnostic(
        Severity.Error,
        "Invalid hex escape sequence, expected \\xHH",
        lexer.pos - 2
      );
      return undefined;
    }
    default:
      lexer.addDiagnostic(Severity.Error, `Invalid escape sequence '\\${ch}'`, lexer.pos - 2);
      return undefined;
  }
}
