/**
 * Recursive descent parser with Pratt expression parsing for Kei.
 */

import type {
  AssertStmt,
  AssignExpr,
  BlockStmt,
  BreakStmt,
  CastExpr,
  CatchClause,
  CatchExpr,
  ConstStmt,
  ContinueStmt,
  Declaration,
  DeferStmt,
  EnumDecl,
  EnumVariant,
  Expression,
  ExprStmt,
  ExternFunctionDecl,
  Field,
  FieldInit,
  ForStmt,
  FunctionDecl,
  IfStmt,
  ImportDecl,
  LetStmt,
  Param,
  Program,
  RequireStmt,
  ReturnStmt,
  Statement,
  StaticDecl,
  StructDecl,
  SwitchCase,
  SwitchStmt,
  TypeAlias,
  TypeNode,
  UnsafeBlock,
  UnsafeStructDecl,
  WhileStmt,
} from "../ast/nodes.ts";
import type { Diagnostic } from "../errors/diagnostic.ts";
import { Severity } from "../errors/diagnostic.ts";
import type { Token } from "../lexer/token.ts";
import { TokenKind } from "../lexer/token.ts";
import {
  Associativity,
  getBinaryAssociativity,
  getBinaryPrecedence,
  isAssignmentOperator,
  Precedence,
} from "./precedence.ts";

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

export class Parser {
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
        declarations.push(this.parseDeclaration());
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

  // ─── Helpers ─────────────────────────────────────────────────────────

  private current(): Token {
    return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1]!;
  }

  private previous(): Token {
    return this.tokens[this.pos > 0 ? this.pos - 1 : 0]!;
  }

  private isAtEnd(): boolean {
    return this.current().kind === TokenKind.Eof;
  }

  private check(kind: TokenKind): boolean {
    return this.current().kind === kind;
  }

  private advance(): Token {
    const token = this.current();
    if (!this.isAtEnd()) {
      this.pos++;
    }
    return token;
  }

  private match(...kinds: TokenKind[]): boolean {
    for (const kind of kinds) {
      if (this.check(kind)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private expect(kind: TokenKind): Token {
    if (this.check(kind)) {
      return this.advance();
    }
    const token = this.current();
    this.addError(`Expected '${kind}' but found '${token.kind}'`, token);
    throw new ParseError();
  }

  private expectIdentifier(): Token {
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

  private addError(message: string, token: Token): void {
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

  private synchronize(): void {
    this.advance();
    while (!this.isAtEnd()) {
      if (this.previous().kind === TokenKind.Semicolon) return;
      if (this.previous().kind === TokenKind.RightBrace) return;
      if (SYNC_KEYWORDS.has(this.current().kind)) return;
      this.advance();
    }
  }

  // ─── Declarations ───────────────────────────────────────────────────

  private parseDeclaration(): Declaration {
    const isPublic = this.match(TokenKind.Pub);
    const startToken = isPublic ? this.previous() : this.current();

    if (this.check(TokenKind.Fn)) {
      return this.parseFunctionDeclaration(isPublic, startToken);
    }
    if (this.check(TokenKind.Struct)) {
      return this.parseStructDeclaration(isPublic, false, startToken);
    }
    if (this.check(TokenKind.Unsafe)) {
      this.advance();
      if (this.check(TokenKind.Struct)) {
        return this.parseStructDeclaration(isPublic, true, startToken);
      }
      this.addError("Expected 'struct' after 'unsafe'", this.current());
      throw new ParseError();
    }
    if (this.check(TokenKind.Enum)) {
      return this.parseEnumDeclaration(isPublic, startToken);
    }
    if (this.check(TokenKind.Type)) {
      return this.parseTypeAlias(isPublic, startToken);
    }
    if (this.check(TokenKind.Static)) {
      return this.parseStaticDeclaration(isPublic, startToken);
    }
    if (this.check(TokenKind.Import)) {
      if (isPublic) {
        this.addError("'pub' is not allowed on import declarations", startToken);
      }
      return this.parseImportDeclaration(startToken);
    }
    if (this.check(TokenKind.Extern)) {
      if (isPublic) {
        this.addError("'pub' is not allowed on extern declarations", startToken);
      }
      return this.parseExternFunctionDeclaration(startToken);
    }

    this.addError(`Unexpected token '${this.current().kind}' at top level`, this.current());
    throw new ParseError();
  }

  private parseFunctionDeclaration(isPublic: boolean, startToken: Token): FunctionDecl {
    this.expect(TokenKind.Fn);
    const name = this.expectIdentifier().lexeme;
    const genericParams = this.parseOptionalGenericParams();
    this.expect(TokenKind.LeftParen);
    const params = this.parseParamList();
    this.expect(TokenKind.RightParen);
    const returnType = this.parseOptionalReturnType();
    const throwsTypes = this.parseOptionalThrows();
    const body = this.parseBlockStatement();

    return {
      kind: "FunctionDecl",
      name,
      isPublic,
      genericParams,
      params,
      returnType,
      throwsTypes,
      body,
      span: { start: startToken.span.start, end: body.span.end },
    };
  }

  private parseExternFunctionDeclaration(startToken: Token): ExternFunctionDecl {
    this.expect(TokenKind.Extern);
    this.expect(TokenKind.Fn);
    const name = this.expectIdentifier().lexeme;
    this.expect(TokenKind.LeftParen);
    const params = this.parseParamList();
    this.expect(TokenKind.RightParen);
    const returnType = this.parseOptionalReturnType();
    const end = this.expect(TokenKind.Semicolon);

    return {
      kind: "ExternFunctionDecl",
      name,
      params,
      returnType,
      span: { start: startToken.span.start, end: end.span.end },
    };
  }

  private parseStructDeclaration(
    isPublic: boolean,
    isUnsafe: boolean,
    startToken: Token
  ): StructDecl | UnsafeStructDecl {
    this.expect(TokenKind.Struct);
    const name = this.expectIdentifier().lexeme;
    const genericParams = this.parseOptionalGenericParams();
    this.expect(TokenKind.LeftBrace);

    const fields: Field[] = [];
    const methods: FunctionDecl[] = [];

    while (!this.check(TokenKind.RightBrace) && !this.isAtEnd()) {
      if (this.check(TokenKind.Fn)) {
        methods.push(this.parseMethodDeclaration());
      } else {
        fields.push(this.parseFieldDeclaration());
      }
    }

    const end = this.expect(TokenKind.RightBrace);
    const span = { start: startToken.span.start, end: end.span.end };

    if (isUnsafe) {
      return { kind: "UnsafeStructDecl", name, isPublic, genericParams, fields, methods, span };
    }
    return { kind: "StructDecl", name, isPublic, genericParams, fields, methods, span };
  }

  private parseMethodDeclaration(): FunctionDecl {
    const fnToken = this.expect(TokenKind.Fn);
    const name = this.expectIdentifier().lexeme;
    const genericParams = this.parseOptionalGenericParams();
    this.expect(TokenKind.LeftParen);
    const params = this.parseParamList();
    this.expect(TokenKind.RightParen);
    const returnType = this.parseOptionalReturnType();
    const throwsTypes = this.parseOptionalThrows();
    const body = this.parseBlockStatement();

    return {
      kind: "FunctionDecl",
      name,
      isPublic: false,
      genericParams,
      params,
      returnType,
      throwsTypes,
      body,
      span: { start: fnToken.span.start, end: body.span.end },
    };
  }

  private parseFieldDeclaration(): Field {
    const nameToken = this.expectIdentifier();
    this.expect(TokenKind.Colon);
    const typeAnnotation = this.parseType();
    const end = this.expect(TokenKind.Semicolon);

    return {
      kind: "Field",
      name: nameToken.lexeme,
      typeAnnotation,
      span: { start: nameToken.span.start, end: end.span.end },
    };
  }

  private parseEnumDeclaration(isPublic: boolean, startToken: Token): EnumDecl {
    this.expect(TokenKind.Enum);
    const name = this.expectIdentifier().lexeme;

    let baseType: TypeNode | null = null;
    if (this.match(TokenKind.Colon)) {
      baseType = this.parseType();
    }

    this.expect(TokenKind.LeftBrace);
    const variants: EnumVariant[] = [];

    while (!this.check(TokenKind.RightBrace) && !this.isAtEnd()) {
      variants.push(this.parseEnumVariant());
      // Allow comma or semicolon as separator, or nothing before }
      if (!this.check(TokenKind.RightBrace)) {
        if (!this.match(TokenKind.Comma) && !this.match(TokenKind.Semicolon)) {
          // If next is not }, expect a separator
          if (!this.check(TokenKind.RightBrace)) {
            this.addError("Expected ',' or '}' after enum variant", this.current());
            throw new ParseError();
          }
        }
      }
    }

    const end = this.expect(TokenKind.RightBrace);
    return {
      kind: "EnumDecl",
      name,
      isPublic,
      baseType,
      variants,
      span: { start: startToken.span.start, end: end.span.end },
    };
  }

  private parseEnumVariant(): EnumVariant {
    const nameToken = this.expectIdentifier();
    const fields: Field[] = [];
    let value: Expression | null = null;

    if (this.match(TokenKind.LeftParen)) {
      // Data variant: Name(field: Type, ...)
      while (!this.check(TokenKind.RightParen) && !this.isAtEnd()) {
        const fieldName = this.expectIdentifier();
        this.expect(TokenKind.Colon);
        const fieldType = this.parseType();
        fields.push({
          kind: "Field",
          name: fieldName.lexeme,
          typeAnnotation: fieldType,
          span: { start: fieldName.span.start, end: fieldType.span.end },
        });
        if (!this.check(TokenKind.RightParen)) {
          this.expect(TokenKind.Comma);
        }
      }
      const end = this.expect(TokenKind.RightParen);
      return {
        kind: "EnumVariant",
        name: nameToken.lexeme,
        fields,
        value: null,
        span: { start: nameToken.span.start, end: end.span.end },
      };
    }

    if (this.match(TokenKind.Equal)) {
      value = this.parseExpression();
    }

    return {
      kind: "EnumVariant",
      name: nameToken.lexeme,
      fields,
      value,
      span: { start: nameToken.span.start, end: this.previous().span.end },
    };
  }

  private parseTypeAlias(isPublic: boolean, startToken: Token): TypeAlias {
    this.expect(TokenKind.Type);
    const name = this.expectIdentifier().lexeme;
    this.expect(TokenKind.Equal);
    const typeValue = this.parseType();
    const end = this.expect(TokenKind.Semicolon);

    return {
      kind: "TypeAlias",
      name,
      isPublic,
      typeValue,
      span: { start: startToken.span.start, end: end.span.end },
    };
  }

  private parseStaticDeclaration(isPublic: boolean, startToken: Token): StaticDecl {
    this.expect(TokenKind.Static);
    const name = this.expectIdentifier().lexeme;

    let typeAnnotation: TypeNode | null = null;
    if (this.match(TokenKind.Colon)) {
      typeAnnotation = this.parseType();
    }

    this.expect(TokenKind.Equal);
    const initializer = this.parseExpression();
    const end = this.expect(TokenKind.Semicolon);

    return {
      kind: "StaticDecl",
      name,
      isPublic,
      typeAnnotation,
      initializer,
      span: { start: startToken.span.start, end: end.span.end },
    };
  }

  private parseImportDeclaration(startToken: Token): ImportDecl {
    this.expect(TokenKind.Import);

    // Check for selective import: import { ... } from path;
    if (this.check(TokenKind.LeftBrace)) {
      this.advance();
      const items: string[] = [];
      while (!this.check(TokenKind.RightBrace) && !this.isAtEnd()) {
        items.push(this.expectIdentifier().lexeme);
        if (!this.check(TokenKind.RightBrace)) {
          this.expect(TokenKind.Comma);
        }
      }
      this.expect(TokenKind.RightBrace);

      // Expect 'from' as identifier
      const fromToken = this.current();
      if (fromToken.kind !== TokenKind.Identifier || fromToken.lexeme !== "from") {
        this.addError("Expected 'from' after import items", fromToken);
        throw new ParseError();
      }
      this.advance();

      const path = this.parseImportPath();
      const end = this.expect(TokenKind.Semicolon);

      return {
        kind: "ImportDecl",
        path,
        items,
        span: { start: startToken.span.start, end: end.span.end },
      };
    }

    // Simple import: import path;
    const path = this.parseImportPath();
    const end = this.expect(TokenKind.Semicolon);

    return {
      kind: "ImportDecl",
      path,
      items: [],
      span: { start: startToken.span.start, end: end.span.end },
    };
  }

  private parseImportPath(): string {
    let path = this.expectIdentifier().lexeme;
    while (this.match(TokenKind.Dot)) {
      path += `.${this.expectIdentifier().lexeme}`;
    }
    return path;
  }

  // ─── Types ──────────────────────────────────────────────────────────

  private parseType(): TypeNode {
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

  private parseOptionalReturnType(): TypeNode | null {
    if (this.match(TokenKind.Arrow)) {
      return this.parseType();
    }
    return null;
  }

  private parseOptionalThrows(): TypeNode[] {
    if (!this.match(TokenKind.Throws)) return [];
    const types: TypeNode[] = [this.parseType()];
    while (this.match(TokenKind.Comma)) {
      types.push(this.parseType());
    }
    return types;
  }

  private parseOptionalGenericParams(): string[] {
    if (!this.match(TokenKind.Less)) return [];
    const params: string[] = [this.expectIdentifier().lexeme];
    while (this.match(TokenKind.Comma)) {
      params.push(this.expectIdentifier().lexeme);
    }
    this.expect(TokenKind.Greater);
    return params;
  }

  private parseParamList(): Param[] {
    const params: Param[] = [];
    if (this.check(TokenKind.RightParen)) return params;

    params.push(this.parseParam());
    while (this.match(TokenKind.Comma)) {
      params.push(this.parseParam());
    }
    return params;
  }

  private parseParam(): Param {
    const startToken = this.current();
    const isMut = this.match(TokenKind.Mut);
    const isMove = this.match(TokenKind.Move);
    const name = this.expectIdentifier().lexeme;
    this.expect(TokenKind.Colon);
    const typeAnnotation = this.parseType();

    return {
      kind: "Param",
      name,
      typeAnnotation,
      isMut,
      isMove,
      span: { start: startToken.span.start, end: typeAnnotation.span.end },
    };
  }

  // ─── Statements ─────────────────────────────────────────────────────

  private parseStatement(): Statement {
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

  private parseBlockStatement(): BlockStmt {
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

  // ─── Expressions (Pratt Parser) ─────────────────────────────────────

  private parseExpression(): Expression {
    return this.parsePrattExpression(Precedence.None);
  }

  private parsePrattExpression(minPrecedence: Precedence): Expression {
    let left = this.parsePrefixExpression();

    while (true) {
      // Postfix: . .* [] () ++ -- catch
      left = this.parsePostfixExpression(left);

      // Range operators (.., ..=)
      if (
        (this.check(TokenKind.DotDot) || this.check(TokenKind.DotDotEqual)) &&
        minPrecedence < Precedence.Additive
      ) {
        left = this.parseRangeExpression(left);
        continue;
      }

      const kind = this.current().kind;
      const prec = getBinaryPrecedence(kind);
      if (prec === Precedence.None || prec <= minPrecedence) {
        break;
      }

      // For right-associative, use prec - 1 so same-precedence binds right
      const assoc = getBinaryAssociativity(kind);
      const nextMinPrec = assoc === Associativity.Right ? (prec as number) - 1 : (prec as number);

      if (isAssignmentOperator(kind)) {
        const opToken = this.advance();
        const right = this.parsePrattExpression(nextMinPrec as Precedence);
        const assignExpr: AssignExpr = {
          kind: "AssignExpr",
          target: left,
          operator: opToken.lexeme,
          value: right,
          span: { start: left.span.start, end: right.span.end },
        };
        left = assignExpr;
      } else {
        const opToken = this.advance();
        const right = this.parsePrattExpression(nextMinPrec as Precedence);
        left = {
          kind: "BinaryExpr",
          left,
          operator: opToken.lexeme,
          right,
          span: { start: left.span.start, end: right.span.end },
        };
      }
    }

    return left;
  }

  private peekNext(): Token | undefined {
    return this.tokens[this.pos + 1];
  }

  private parseRangeExpression(left: Expression): Expression {
    const inclusive = this.check(TokenKind.DotDotEqual);
    this.advance(); // consume .. or ..=

    const right = this.parsePrattExpression(Precedence.Additive);
    return {
      kind: "RangeExpr",
      start: left,
      end: right,
      inclusive,
      span: { start: left.span.start, end: right.span.end },
    };
  }

  private parsePrefixExpression(): Expression {
    const token = this.current();

    // Unary prefix operators
    if (
      token.kind === TokenKind.Bang ||
      token.kind === TokenKind.Tilde ||
      token.kind === TokenKind.Minus ||
      token.kind === TokenKind.Amp
    ) {
      this.advance();
      const operand = this.parsePrattExpression(Precedence.Unary);
      return {
        kind: "UnaryExpr",
        operator: token.lexeme,
        operand,
        span: { start: token.span.start, end: operand.span.end },
      };
    }

    // move expr
    if (token.kind === TokenKind.Move) {
      this.advance();
      const operand = this.parsePrattExpression(Precedence.Unary);
      return {
        kind: "MoveExpr",
        operand,
        span: { start: token.span.start, end: operand.span.end },
      };
    }

    // throw expr
    if (token.kind === TokenKind.Throw) {
      this.advance();
      const value = this.parsePrattExpression(Precedence.Unary);
      return {
        kind: "ThrowExpr",
        value,
        span: { start: token.span.start, end: value.span.end },
      };
    }

    // if expression
    if (token.kind === TokenKind.If) {
      return this.parseIfExpression();
    }

    // unsafe { expr } expression
    if (token.kind === TokenKind.Unsafe) {
      return this.parseUnsafeExpression();
    }

    return this.parsePrimaryExpression();
  }

  private parsePostfixExpression(left: Expression): Expression {
    while (true) {
      // Member access: .field
      if (this.check(TokenKind.Dot)) {
        // Check it's not a range (..)
        const next = this.peekNext();
        if (next?.kind === TokenKind.Dot) break;

        this.advance();
        const prop = this.expectIdentifier();
        left = {
          kind: "MemberExpr",
          object: left,
          property: prop.lexeme,
          span: { start: left.span.start, end: prop.span.end },
        };
        continue;
      }

      // Dereference: .*
      if (this.check(TokenKind.DotStar)) {
        const end = this.advance();
        left = {
          kind: "DerefExpr",
          operand: left,
          span: { start: left.span.start, end: end.span.end },
        };
        continue;
      }

      // Index: [expr]
      if (this.check(TokenKind.LeftBracket)) {
        this.advance();
        const index = this.parseExpression();
        const end = this.expect(TokenKind.RightBracket);
        left = {
          kind: "IndexExpr",
          object: left,
          index,
          span: { start: left.span.start, end: end.span.end },
        };
        continue;
      }

      // Call: (args)
      if (this.check(TokenKind.LeftParen)) {
        this.advance();
        const args: Expression[] = [];
        if (!this.check(TokenKind.RightParen)) {
          args.push(this.parseExpression());
          while (this.match(TokenKind.Comma)) {
            args.push(this.parseExpression());
          }
        }
        const end = this.expect(TokenKind.RightParen);
        left = {
          kind: "CallExpr",
          callee: left,
          args,
          span: { start: left.span.start, end: end.span.end },
        };
        continue;
      }

      // Postfix increment: ++
      if (this.check(TokenKind.PlusPlus)) {
        const end = this.advance();
        left = {
          kind: "IncrementExpr",
          operand: left,
          span: { start: left.span.start, end: end.span.end },
        };
        continue;
      }

      // Postfix decrement: --
      if (this.check(TokenKind.MinusMinus)) {
        const end = this.advance();
        left = {
          kind: "DecrementExpr",
          operand: left,
          span: { start: left.span.start, end: end.span.end },
        };
        continue;
      }

      // cast: expr as Type
      if (this.check(TokenKind.As)) {
        left = this.parseCastExpression(left);
        continue;
      }

      // catch
      if (this.check(TokenKind.Catch)) {
        left = this.parseCatchExpression(left);
        continue;
      }

      // Struct literal: Identifier { field: value }
      // Only if left is an Identifier and next is {
      if (left.kind === "Identifier" && this.check(TokenKind.LeftBrace)) {
        // Look ahead to distinguish struct literal from block
        if (this.isStructLiteral()) {
          left = this.parseStructLiteralFromIdentifier(left);
          continue;
        }
      }

      break;
    }
    return left;
  }

  private isStructLiteral(): boolean {
    // Save position and look ahead
    const saved = this.pos;
    this.advance(); // skip {

    // Empty {} after identifier is struct literal
    if (this.check(TokenKind.RightBrace)) {
      this.pos = saved;
      return true;
    }

    // Check if pattern is: identifier ':'
    const isStruct = this.check(TokenKind.Identifier) && this.peekNext()?.kind === TokenKind.Colon;

    this.pos = saved;
    return isStruct;
  }

  private parseStructLiteralFromIdentifier(ident: Expression & { kind: "Identifier" }): Expression {
    this.advance(); // skip {
    const fields: FieldInit[] = [];

    while (!this.check(TokenKind.RightBrace) && !this.isAtEnd()) {
      const fieldName = this.expectIdentifier();
      this.expect(TokenKind.Colon);
      const value = this.parseExpression();
      fields.push({
        kind: "FieldInit",
        name: fieldName.lexeme,
        value,
        span: { start: fieldName.span.start, end: value.span.end },
      });
      if (!this.check(TokenKind.RightBrace)) {
        this.expect(TokenKind.Comma);
      }
    }

    const end = this.expect(TokenKind.RightBrace);
    return {
      kind: "StructLiteral",
      name: ident.name,
      typeArgs: [],
      fields,
      span: { start: ident.span.start, end: end.span.end },
    };
  }

  private parseCastExpression(operand: Expression): CastExpr {
    this.expect(TokenKind.As);
    const targetType = this.parseType();
    return {
      kind: "CastExpr",
      operand,
      targetType,
      span: { start: operand.span.start, end: targetType.span.end },
    };
  }

  private parseCatchExpression(operand: Expression): CatchExpr {
    this.expect(TokenKind.Catch);

    // catch panic
    if (this.check(TokenKind.Panic)) {
      const end = this.advance();
      return {
        kind: "CatchExpr",
        operand,
        catchType: "panic",
        clauses: [],
        span: { start: operand.span.start, end: end.span.end },
      };
    }

    // catch throw
    if (this.check(TokenKind.Throw)) {
      const end = this.advance();
      return {
        kind: "CatchExpr",
        operand,
        catchType: "throw",
        clauses: [],
        span: { start: operand.span.start, end: end.span.end },
      };
    }

    // catch { clauses }
    this.expect(TokenKind.LeftBrace);
    const clauses: CatchClause[] = [];

    while (!this.check(TokenKind.RightBrace) && !this.isAtEnd()) {
      if (this.check(TokenKind.Default)) {
        this.advance();
        let varName: string | null = null;
        if (this.check(TokenKind.Identifier)) {
          varName = this.advance().lexeme;
        }
        this.expect(TokenKind.Colon);
        const body = this.parseCatchClauseBody();
        clauses.push({
          kind: "CatchClause",
          errorType: "default",
          varName,
          body,
          isDefault: true,
          span: {
            start: operand.span.start,
            end: body.length > 0 ? body[body.length - 1]?.span.end : this.previous().span.end,
          },
        });
      } else {
        const errorType = this.expectIdentifier().lexeme;
        let varName: string | null = null;
        if (this.check(TokenKind.Identifier)) {
          varName = this.advance().lexeme;
        }
        this.expect(TokenKind.Colon);
        const body = this.parseCatchClauseBody();
        clauses.push({
          kind: "CatchClause",
          errorType,
          varName,
          body,
          isDefault: false,
          span: {
            start: operand.span.start,
            end: body.length > 0 ? body[body.length - 1]?.span.end : this.previous().span.end,
          },
        });
      }
    }

    const end = this.expect(TokenKind.RightBrace);
    return {
      kind: "CatchExpr",
      operand,
      catchType: "block",
      clauses,
      span: { start: operand.span.start, end: end.span.end },
    };
  }

  private parseCatchClauseBody(): Statement[] {
    // A catch clause body is either a block { ... } or a single statement ending with ;
    if (this.check(TokenKind.LeftBrace)) {
      const block = this.parseBlockStatement();
      // Consume optional semicolon after block in catch clause
      this.match(TokenKind.Semicolon);
      return block.statements;
    }
    const stmt = this.parseStatement();
    return [stmt];
  }

  private parseIfExpression(): Expression {
    const start = this.expect(TokenKind.If);
    const condition = this.parseExpression();
    const thenBlock = this.parseExpressionBlock();
    this.expect(TokenKind.Else);
    const elseBlock = this.parseExpressionBlock();

    return {
      kind: "IfExpr",
      condition,
      thenBlock,
      elseBlock,
      span: { start: start.span.start, end: elseBlock.span.end },
    };
  }

  private parseUnsafeExpression(): Expression {
    const start = this.expect(TokenKind.Unsafe);
    const body = this.parseExpressionBlock();

    return {
      kind: "UnsafeExpr",
      body,
      span: { start: start.span.start, end: body.span.end },
    };
  }

  /**
   * Parse a block that may end with a bare expression (no semicolon).
   * Used for if-expressions and similar constructs.
   */
  private parseExpressionBlock(): BlockStmt {
    const start = this.expect(TokenKind.LeftBrace);
    const statements: Statement[] = [];

    while (!this.check(TokenKind.RightBrace) && !this.isAtEnd()) {
      // Try to parse as statement; if the last thing before } is a bare expression, wrap it
      const expr = this.parseExpression();
      if (this.check(TokenKind.RightBrace)) {
        // Bare expression at end of block — wrap as ExprStmt without semicolon
        statements.push({
          kind: "ExprStmt",
          expression: expr,
          span: expr.span,
        });
      } else if (this.match(TokenKind.Semicolon)) {
        statements.push({
          kind: "ExprStmt",
          expression: expr,
          span: { start: expr.span.start, end: this.previous().span.end },
        });
      } else {
        this.addError("Expected ';' or '}'", this.current());
        throw new ParseError();
      }
    }

    const end = this.expect(TokenKind.RightBrace);
    return {
      kind: "BlockStmt",
      statements,
      span: { start: start.span.start, end: end.span.end },
    };
  }

  private parsePrimaryExpression(): Expression {
    const token = this.current();

    // Integer literal
    if (token.kind === TokenKind.IntLiteral) {
      this.advance();
      return {
        kind: "IntLiteral",
        value: token.value as number,
        span: token.span,
      };
    }

    // Float literal
    if (token.kind === TokenKind.FloatLiteral) {
      this.advance();
      return {
        kind: "FloatLiteral",
        value: token.value as number,
        span: token.span,
      };
    }

    // String literal
    if (token.kind === TokenKind.StringLiteral) {
      this.advance();
      return {
        kind: "StringLiteral",
        value: token.value as string,
        span: token.span,
      };
    }

    // Bool literals
    if (token.kind === TokenKind.True) {
      this.advance();
      return { kind: "BoolLiteral", value: true, span: token.span };
    }
    if (token.kind === TokenKind.False) {
      this.advance();
      return { kind: "BoolLiteral", value: false, span: token.span };
    }

    // Null literal
    if (token.kind === TokenKind.Null) {
      this.advance();
      return { kind: "NullLiteral", span: token.span };
    }

    // Identifier (including 'self' keyword used as variable)
    if (token.kind === TokenKind.Identifier || token.kind === TokenKind.Self) {
      this.advance();
      return { kind: "Identifier", name: token.lexeme, span: token.span };
    }

    // Grouped expression: (expr)
    if (token.kind === TokenKind.LeftParen) {
      this.advance();
      const expression = this.parseExpression();
      const end = this.expect(TokenKind.RightParen);
      return {
        kind: "GroupExpr",
        expression,
        span: { start: token.span.start, end: end.span.end },
      };
    }

    this.addError(`Unexpected token '${token.kind}' in expression`, token);
    throw new ParseError();
  }
}

class ParseError extends Error {
  constructor() {
    super("Parse error");
  }
}
