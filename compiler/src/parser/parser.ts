/**
 * Recursive descent parser with Pratt expression parsing for Kei.
 *
 * Expression parsing lives in expr-parser.ts, declaration parsing in
 * decl-parser.ts. Both operate on the ParserContext interface implemented
 * by the Parser class below.
 */

import type {
  AssertStmt,
  BlockStmt,
  BreakStmt,
  ConstStmt,
  ContinueStmt,
  Declaration,
  DeferStmt,
  Expression,
  ExprStmt,
  ForStmt,
  IfStmt,
  LetStmt,
  Program,
  RequireStmt,
  ReturnStmt,
  Statement,
  SwitchCase,
  SwitchStmt,
  TypeNode,
  UnsafeBlock,
  WhileStmt,
} from "../ast/nodes.ts";
import type { Diagnostic } from "../errors/diagnostic.ts";
import { Severity } from "../errors/diagnostic.ts";
import type { Token } from "../lexer/token.ts";
import { TokenKind } from "../lexer/token.ts";
import { parseDeclaration } from "./decl-parser.ts";
import { parseExpression } from "./expr-parser.ts";

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
    if (this.check(TokenKind.Let)) return this.parseLetStatement();
    if (this.check(TokenKind.Const)) return this.parseConstStatement();
    if (this.check(TokenKind.Return)) return this.parseReturnStatement();
    if (this.check(TokenKind.If)) return this.parseIfStatement();
    if (this.check(TokenKind.While)) return this.parseWhileStatement();
    if (this.check(TokenKind.For)) return this.parseForStatement();
    if (this.check(TokenKind.Switch)) return this.parseSwitchStatement();
    if (this.check(TokenKind.Defer)) return this.parseDeferStatement();
    if (this.check(TokenKind.Break)) return this.parseBreakStatement();
    if (this.check(TokenKind.Continue)) return this.parseContinueStatement();
    if (this.check(TokenKind.Assert)) return this.parseAssertStatement();
    if (this.check(TokenKind.Require)) return this.parseRequireStatement();
    if (this.check(TokenKind.Unsafe)) return this.parseUnsafeBlockStatement();
    if (this.check(TokenKind.LeftBrace)) return this.parseBlockStatement();

    return this.parseExpressionStatement();
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

  private parseLetStatement(): LetStmt {
    const start = this.expect(TokenKind.Let);
    const name = this.expectIdentifier().lexeme;
    let typeAnnotation: TypeNode | null = null;
    if (this.match(TokenKind.Colon)) {
      typeAnnotation = this.parseType();
    }
    this.expect(TokenKind.Equal);
    const initializer = this.parseExpression();
    const end = this.expect(TokenKind.Semicolon);

    return {
      kind: "LetStmt",
      name,
      typeAnnotation,
      initializer,
      span: { start: start.span.start, end: end.span.end },
    };
  }

  private parseConstStatement(): ConstStmt {
    const start = this.expect(TokenKind.Const);
    const name = this.expectIdentifier().lexeme;
    let typeAnnotation: TypeNode | null = null;
    if (this.match(TokenKind.Colon)) {
      typeAnnotation = this.parseType();
    }
    this.expect(TokenKind.Equal);
    const initializer = this.parseExpression();
    const end = this.expect(TokenKind.Semicolon);

    return {
      kind: "ConstStmt",
      name,
      typeAnnotation,
      initializer,
      span: { start: start.span.start, end: end.span.end },
    };
  }

  private parseReturnStatement(): ReturnStmt {
    const start = this.expect(TokenKind.Return);
    let value: Expression | null = null;
    if (!this.check(TokenKind.Semicolon)) {
      value = this.parseExpression();
    }
    const end = this.expect(TokenKind.Semicolon);

    return {
      kind: "ReturnStmt",
      value,
      span: { start: start.span.start, end: end.span.end },
    };
  }

  private parseIfStatement(): IfStmt {
    const start = this.expect(TokenKind.If);
    const condition = this.parseExpression();
    const thenBlock = this.parseBlockStatement();

    let elseBlock: BlockStmt | IfStmt | null = null;
    if (this.match(TokenKind.Else)) {
      if (this.check(TokenKind.If)) {
        elseBlock = this.parseIfStatement();
      } else {
        elseBlock = this.parseBlockStatement();
      }
    }

    return {
      kind: "IfStmt",
      condition,
      thenBlock,
      elseBlock,
      span: { start: start.span.start, end: (elseBlock ?? thenBlock).span.end },
    };
  }

  private parseWhileStatement(): WhileStmt {
    const start = this.expect(TokenKind.While);
    const condition = this.parseExpression();
    const body = this.parseBlockStatement();

    return {
      kind: "WhileStmt",
      condition,
      body,
      span: { start: start.span.start, end: body.span.end },
    };
  }

  private parseForStatement(): ForStmt {
    const start = this.expect(TokenKind.For);
    const variable = this.expectIdentifier().lexeme;

    let index: string | null = null;
    if (this.match(TokenKind.Comma)) {
      index = this.expectIdentifier().lexeme;
    }

    this.expect(TokenKind.In);
    const iterable = this.parseExpression();
    const body = this.parseBlockStatement();

    return {
      kind: "ForStmt",
      variable,
      index,
      iterable,
      body,
      span: { start: start.span.start, end: body.span.end },
    };
  }

  private parseSwitchStatement(): SwitchStmt {
    const start = this.expect(TokenKind.Switch);
    const subject = this.parseExpression();
    this.expect(TokenKind.LeftBrace);

    const cases: SwitchCase[] = [];
    while (!this.check(TokenKind.RightBrace) && !this.isAtEnd()) {
      cases.push(this.parseSwitchCase());
    }

    const end = this.expect(TokenKind.RightBrace);
    return {
      kind: "SwitchStmt",
      subject,
      cases,
      span: { start: start.span.start, end: end.span.end },
    };
  }

  private parseSwitchCase(): SwitchCase {
    if (this.match(TokenKind.Default)) {
      this.expect(TokenKind.Colon);
      const body = this.parseCaseBody();
      return {
        kind: "SwitchCase",
        values: [],
        body,
        isDefault: true,
        span: {
          start: this.previous().span.start,
          end: body.length > 0 ? body[body.length - 1]?.span.end : this.previous().span.end,
        },
      };
    }

    const startToken = this.expect(TokenKind.Case);
    const values: Expression[] = [this.parseExpression()];
    while (this.match(TokenKind.Comma)) {
      values.push(this.parseExpression());
    }
    this.expect(TokenKind.Colon);
    const body = this.parseCaseBody();

    return {
      kind: "SwitchCase",
      values,
      body,
      isDefault: false,
      span: {
        start: startToken.span.start,
        end: body.length > 0 ? body[body.length - 1]?.span.end : this.previous().span.end,
      },
    };
  }

  private parseCaseBody(): Statement[] {
    const stmts: Statement[] = [];
    while (
      !this.check(TokenKind.Case) &&
      !this.check(TokenKind.Default) &&
      !this.check(TokenKind.RightBrace) &&
      !this.isAtEnd()
    ) {
      stmts.push(this.parseStatement());
    }
    return stmts;
  }

  private parseDeferStatement(): DeferStmt {
    const start = this.expect(TokenKind.Defer);
    const statement = this.parseStatement();
    return {
      kind: "DeferStmt",
      statement,
      span: { start: start.span.start, end: statement.span.end },
    };
  }

  private parseBreakStatement(): BreakStmt {
    const start = this.expect(TokenKind.Break);
    const end = this.expect(TokenKind.Semicolon);
    return { kind: "BreakStmt", span: { start: start.span.start, end: end.span.end } };
  }

  private parseContinueStatement(): ContinueStmt {
    const start = this.expect(TokenKind.Continue);
    const end = this.expect(TokenKind.Semicolon);
    return { kind: "ContinueStmt", span: { start: start.span.start, end: end.span.end } };
  }

  private parseAssertStatement(): AssertStmt {
    const start = this.expect(TokenKind.Assert);
    this.expect(TokenKind.LeftParen);
    const condition = this.parseExpression();
    let message: Expression | null = null;
    if (this.match(TokenKind.Comma)) {
      message = this.parseExpression();
    }
    this.expect(TokenKind.RightParen);
    const end = this.expect(TokenKind.Semicolon);

    return {
      kind: "AssertStmt",
      condition,
      message,
      span: { start: start.span.start, end: end.span.end },
    };
  }

  private parseRequireStatement(): RequireStmt {
    const start = this.expect(TokenKind.Require);
    this.expect(TokenKind.LeftParen);
    const condition = this.parseExpression();
    let message: Expression | null = null;
    if (this.match(TokenKind.Comma)) {
      message = this.parseExpression();
    }
    this.expect(TokenKind.RightParen);
    const end = this.expect(TokenKind.Semicolon);

    return {
      kind: "RequireStmt",
      condition,
      message,
      span: { start: start.span.start, end: end.span.end },
    };
  }

  private parseUnsafeBlockStatement(): UnsafeBlock {
    const start = this.expect(TokenKind.Unsafe);
    const body = this.parseBlockStatement();
    return {
      kind: "UnsafeBlock",
      body,
      span: { start: start.span.start, end: body.span.end },
    };
  }

  private parseExpressionStatement(): ExprStmt {
    const expression = this.parseExpression();
    const end = this.expect(TokenKind.Semicolon);
    return {
      kind: "ExprStmt",
      expression,
      span: { start: expression.span.start, end: end.span.end },
    };
  }
}

class ParseError extends Error {
  constructor() {
    super("Parse error");
  }
}
