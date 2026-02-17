/**
 * Recursive descent parser with Pratt expression parsing for Kei.
 *
 * Expression parsing lives in expr-parser.ts, declaration parsing in
 * decl-parser.ts, statement parsing in stmt-parser.ts. All operate on the
 * ParserContext interface implemented by the Parser class below.
 */

import type {
  BlockStmt,
  Declaration,
  Expression,
  Program,
  Statement,
  TypeNode,
} from "../ast/nodes.ts";
import type { Diagnostic } from "../errors/diagnostic.ts";
import { Severity } from "../errors/diagnostic.ts";
import type { Token } from "../lexer/token.ts";
import { TokenKind } from "../lexer/token.ts";
import { parseDeclaration } from "./decl-parser.ts";
import { parseExpression } from "./expr-parser.ts";
import {
  parseAssertStatement,
  parseBreakStatement,
  parseConstStatement,
  parseContinueStatement,
  parseDeferStatement,
  parseExpressionStatement,
  parseForStatement,
  parseIfStatement,
  parseLetStatement,
  parseRequireStatement,
  parseReturnStatement,
  parseSwitchStatement,
  parseUnsafeBlockStatement,
  parseWhileStatement,
} from "./stmt-parser.ts";

/** Token kinds that start a type annotation (used for type parsing context) */
const TYPE_KEYWORDS: ReadonlySet<TokenKind> = new Set([
  TokenKind.Int,
  TokenKind.Uint,
  TokenKind.Bool,
  TokenKind.String,
  TokenKind.Void,
  TokenKind.I8,
  TokenKind.I16,
  TokenKind.I32,
  TokenKind.I64,
  TokenKind.U8,
  TokenKind.U16,
  TokenKind.U32,
  TokenKind.U64,
  TokenKind.F32,
  TokenKind.F64,
  TokenKind.Isize,
  TokenKind.Usize,
  TokenKind.Byte,
  TokenKind.Short,
  TokenKind.Long,
  TokenKind.Float,
  TokenKind.Double,
  TokenKind.Ptr,
  TokenKind.Array,
  TokenKind.Slice,
  TokenKind.Dynarray,
]);

/** Keywords that can synchronize after an error */
const SYNC_KEYWORDS: ReadonlySet<TokenKind> = new Set([
  TokenKind.Fn,
  TokenKind.Struct,
  TokenKind.Enum,
  TokenKind.Import,
  TokenKind.Let,
  TokenKind.Const,
  TokenKind.Return,
  TokenKind.If,
  TokenKind.While,
  TokenKind.For,
  TokenKind.Switch,
  TokenKind.Pub,
  TokenKind.Static,
  TokenKind.Extern,
  TokenKind.Type,
  TokenKind.Unsafe,
]);

/**
 * Interface exposed to the extracted expression and declaration parsers.
 * Keeps the extracted modules decoupled from the Parser class internals.
 */
export interface ParserContext {
  current(): Token;
  previous(): Token;
  peekNext(): Token | undefined;
  isAtEnd(): boolean;
  check(kind: TokenKind): boolean;
  advance(): Token;
  match(...kinds: TokenKind[]): boolean;
  expect(kind: TokenKind): Token;
  expectIdentifier(): Token;
  addError(message: string, token: Token): void;
  throwParseError(): never;

  // Position save/restore for speculative parsing
  savePos(): number;
  restorePos(pos: number): void;
  saveDiagnosticsLength(): number;
  restoreDiagnosticsLength(len: number): void;

  // Cross-module callbacks
  parseExpression(): Expression;
  parseType(): TypeNode;
  parseStatement(): Statement;
  parseBlockStatement(): BlockStmt;
}

export class Parser implements ParserContext {
  private tokens: Token[];
  private pos: number;
  private diagnostics: Diagnostic[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
    this.diagnostics = [];
  }

  getDiagnostics(): ReadonlyArray<Diagnostic> {
    return this.diagnostics;
  }

  parse(): Program {
    const declarations: Declaration[] = [];
    const startSpan = this.current().span.start;

    while (!this.isAtEnd()) {
      try {
        declarations.push(parseDeclaration(this));
      } catch {
        this.synchronize();
      }
    }

    const endSpan = this.previous().span.end;
    return {
      kind: "Program",
      declarations,
      span: { start: startSpan, end: endSpan },
    };
  }

  // ─── Helpers (ParserContext implementation) ────────────────────────

  current(): Token {
    return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1]!;
  }

  previous(): Token {
    return this.tokens[this.pos > 0 ? this.pos - 1 : 0]!;
  }

  peekNext(): Token | undefined {
    return this.tokens[this.pos + 1];
  }

  isAtEnd(): boolean {
    return this.current().kind === TokenKind.Eof;
  }

  check(kind: TokenKind): boolean {
    return this.current().kind === kind;
  }

  advance(): Token {
    const token = this.current();
    if (!this.isAtEnd()) {
      this.pos++;
    }
    return token;
  }

  match(...kinds: TokenKind[]): boolean {
    for (const kind of kinds) {
      if (this.check(kind)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  expect(kind: TokenKind): Token {
    if (this.check(kind)) {
      return this.advance();
    }
    const token = this.current();
    this.addError(`Expected '${kind}' but found '${token.kind}'`, token);
    throw new ParseError();
  }

  expectIdentifier(): Token {
    if (this.check(TokenKind.Identifier)) {
      return this.advance();
    }
    // Allow 'self' as identifier in certain contexts (e.g., parameter names)
    if (this.check(TokenKind.Self)) {
      return this.advance();
    }
    const token = this.current();
    this.addError(`Expected identifier but found '${token.kind}'`, token);
    throw new ParseError();
  }

  addError(message: string, token: Token): void {
    this.diagnostics.push({
      severity: Severity.Error,
      message,
      location: {
        file: "",
        line: token.line,
        column: token.column,
        offset: token.span.start,
      },
    });
  }

  throwParseError(): never {
    throw new ParseError();
  }

  savePos(): number {
    return this.pos;
  }

  restorePos(pos: number): void {
    this.pos = pos;
  }

  saveDiagnosticsLength(): number {
    return this.diagnostics.length;
  }

  restoreDiagnosticsLength(len: number): void {
    this.diagnostics.length = len;
  }

  private synchronize(): void {
    this.advance();
    while (!this.isAtEnd()) {
      if (this.previous().kind === TokenKind.Semicolon) return;
      if (this.previous().kind === TokenKind.RightBrace) return;
      if (SYNC_KEYWORDS.has(this.current().kind)) return;
      this.advance();
    }
  }

  // ─── Types ──────────────────────────────────────────────────────────

  parseType(): TypeNode {
    const token = this.current();

    // Handle generic type keywords: ptr<T>, array<T, N>, slice<T>, dynarray<T>
    if (
      token.kind === TokenKind.Ptr ||
      token.kind === TokenKind.Array ||
      token.kind === TokenKind.Slice ||
      token.kind === TokenKind.Dynarray
    ) {
      this.advance();
      if (this.check(TokenKind.Less)) {
        this.advance();
        const typeArgs: TypeNode[] = [this.parseType()];
        while (this.match(TokenKind.Comma)) {
          // For array<T, N>, second arg could be a number — treat as named type
          if (this.check(TokenKind.IntLiteral)) {
            const numToken = this.advance();
            typeArgs.push({
              kind: "NamedType",
              name: numToken.lexeme,
              span: numToken.span,
            });
          } else {
            typeArgs.push(this.parseType());
          }
        }
        const end = this.expect(TokenKind.Greater);
        return {
          kind: "GenericType",
          name: token.lexeme,
          typeArgs,
          span: { start: token.span.start, end: end.span.end },
        };
      }
      return { kind: "NamedType", name: token.lexeme, span: token.span };
    }

    // Primitive type keywords
    if (TYPE_KEYWORDS.has(token.kind)) {
      this.advance();
      return { kind: "NamedType", name: token.lexeme, span: token.span };
    }

    // Named type (identifier, possibly generic)
    if (token.kind === TokenKind.Identifier) {
      this.advance();
      if (this.check(TokenKind.Less)) {
        // Generic type: Name<T, U>
        this.advance();
        const typeArgs: TypeNode[] = [this.parseType()];
        while (this.match(TokenKind.Comma)) {
          typeArgs.push(this.parseType());
        }
        const end = this.expect(TokenKind.Greater);
        return {
          kind: "GenericType",
          name: token.lexeme,
          typeArgs,
          span: { start: token.span.start, end: end.span.end },
        };
      }
      return { kind: "NamedType", name: token.lexeme, span: token.span };
    }

    this.addError(`Expected type but found '${token.kind}'`, token);
    throw new ParseError();
  }

  // ─── Statements ─────────────────────────────────────────────────────

  parseStatement(): Statement {
    if (this.check(TokenKind.Let)) return parseLetStatement(this);
    if (this.check(TokenKind.Const)) return parseConstStatement(this);
    if (this.check(TokenKind.Return)) return parseReturnStatement(this);
    if (this.check(TokenKind.If)) return parseIfStatement(this);
    if (this.check(TokenKind.While)) return parseWhileStatement(this);
    if (this.check(TokenKind.For)) return parseForStatement(this);
    if (this.check(TokenKind.Switch)) return parseSwitchStatement(this);
    if (this.check(TokenKind.Defer)) return parseDeferStatement(this);
    if (this.check(TokenKind.Break)) return parseBreakStatement(this);
    if (this.check(TokenKind.Continue)) return parseContinueStatement(this);
    if (this.check(TokenKind.Assert)) return parseAssertStatement(this);
    if (this.check(TokenKind.Require)) return parseRequireStatement(this);
    if (this.check(TokenKind.Unsafe)) return parseUnsafeBlockStatement(this);
    if (this.check(TokenKind.LeftBrace)) return this.parseBlockStatement();

    return parseExpressionStatement(this);
  }

  parseBlockStatement(): BlockStmt {
    const start = this.expect(TokenKind.LeftBrace);
    const statements: Statement[] = [];

    while (!this.check(TokenKind.RightBrace) && !this.isAtEnd()) {
      try {
        statements.push(this.parseStatement());
      } catch {
        this.synchronize();
      }
    }

    const end = this.expect(TokenKind.RightBrace);
    return {
      kind: "BlockStmt",
      statements,
      span: { start: start.span.start, end: end.span.end },
    };
  }

  parseExpression(): Expression {
    return parseExpression(this);
  }

}

class ParseError extends Error {
  constructor() {
    super("Parse error");
  }
}
