/**
 * Declaration parsing for Kei.
 * Extracted from parser.ts — all methods operate on a ParserContext.
 */

import type {
  Declaration,
  EnumDecl,
  EnumVariant,
  Expression,
  ExternFunctionDecl,
  Field,
  FunctionDecl,
  ImportDecl,
  Param,
  StaticDecl,
  StructDecl,
  TypeAlias,
  TypeNode,
  UnsafeStructDecl,
} from "../ast/nodes.ts";
import type { Token } from "../lexer/token.ts";
import { TokenKind } from "../lexer/token.ts";
import type { ParserContext } from "./parser.ts";

export function parseDeclaration(ctx: ParserContext): Declaration {
  const isPublic = ctx.match(TokenKind.Pub);
  const startToken = isPublic ? ctx.previous() : ctx.current();

  if (ctx.check(TokenKind.Fn)) {
    return parseFunctionDeclaration(ctx, isPublic, startToken);
  }
  if (ctx.check(TokenKind.Struct)) {
    return parseStructDeclaration(ctx, isPublic, false, startToken);
  }
  if (ctx.check(TokenKind.Unsafe)) {
    ctx.advance();
    if (ctx.check(TokenKind.Struct)) {
      return parseStructDeclaration(ctx, isPublic, true, startToken);
    }
    ctx.addError("Expected 'struct' after 'unsafe'", ctx.current());
    ctx.throwParseError();
  }
  if (ctx.check(TokenKind.Enum)) {
    return parseEnumDeclaration(ctx, isPublic, startToken);
  }
  if (ctx.check(TokenKind.Type)) {
    return parseTypeAlias(ctx, isPublic, startToken);
  }
  if (ctx.check(TokenKind.Static)) {
    return parseStaticDeclaration(ctx, isPublic, startToken);
  }
  if (ctx.check(TokenKind.Import)) {
    if (isPublic) {
      ctx.addError("'pub' is not allowed on import declarations", startToken);
    }
    return parseImportDeclaration(ctx, startToken);
  }
  if (ctx.check(TokenKind.Extern)) {
    if (isPublic) {
      ctx.addError("'pub' is not allowed on extern declarations", startToken);
    }
    return parseExternFunctionDeclaration(ctx, startToken);
  }

  ctx.addError(`Unexpected token '${ctx.current().kind}' at top level`, ctx.current());
  ctx.throwParseError();
}

function parseFunctionDeclaration(
  ctx: ParserContext,
  isPublic: boolean,
  startToken: Token
): FunctionDecl {
  ctx.expect(TokenKind.Fn);
  const name = ctx.expectIdentifier().lexeme;
  const genericParams = parseOptionalGenericParams(ctx);
  ctx.expect(TokenKind.LeftParen);
  const params = parseParamList(ctx);
  ctx.expect(TokenKind.RightParen);
  const returnType = parseOptionalReturnType(ctx);
  const throwsTypes = parseOptionalThrows(ctx);
  const body = ctx.parseBlockStatement();

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

function parseExternFunctionDeclaration(ctx: ParserContext, startToken: Token): ExternFunctionDecl {
  ctx.expect(TokenKind.Extern);
  ctx.expect(TokenKind.Fn);
  const name = ctx.expectIdentifier().lexeme;
  ctx.expect(TokenKind.LeftParen);
  const params = parseParamList(ctx);
  ctx.expect(TokenKind.RightParen);
  const returnType = parseOptionalReturnType(ctx);
  const end = ctx.expect(TokenKind.Semicolon);

  return {
    kind: "ExternFunctionDecl",
    name,
    params,
    returnType,
    span: { start: startToken.span.start, end: end.span.end },
  };
}

function parseStructDeclaration(
  ctx: ParserContext,
  isPublic: boolean,
  isUnsafe: boolean,
  startToken: Token
): StructDecl | UnsafeStructDecl {
  ctx.expect(TokenKind.Struct);
  const name = ctx.expectIdentifier().lexeme;
  const genericParams = parseOptionalGenericParams(ctx);
  ctx.expect(TokenKind.LeftBrace);

  const fields: Field[] = [];
  const methods: FunctionDecl[] = [];

  while (!ctx.check(TokenKind.RightBrace) && !ctx.isAtEnd()) {
    if (ctx.check(TokenKind.Fn)) {
      methods.push(parseMethodDeclaration(ctx));
    } else {
      fields.push(parseFieldDeclaration(ctx));
    }
  }

  const end = ctx.expect(TokenKind.RightBrace);
  const span = { start: startToken.span.start, end: end.span.end };

  if (isUnsafe) {
    return { kind: "UnsafeStructDecl", name, isPublic, genericParams, fields, methods, span };
  }
  return { kind: "StructDecl", name, isPublic, genericParams, fields, methods, span };
}

function parseMethodDeclaration(ctx: ParserContext): FunctionDecl {
  const fnToken = ctx.expect(TokenKind.Fn);
  const name = ctx.expectIdentifier().lexeme;
  const genericParams = parseOptionalGenericParams(ctx);
  ctx.expect(TokenKind.LeftParen);
  const params = parseParamList(ctx);
  ctx.expect(TokenKind.RightParen);
  const returnType = parseOptionalReturnType(ctx);
  const throwsTypes = parseOptionalThrows(ctx);
  const body = ctx.parseBlockStatement();

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

function parseFieldDeclaration(ctx: ParserContext): Field {
  const nameToken = ctx.expectIdentifier();
  ctx.expect(TokenKind.Colon);
  const typeAnnotation = ctx.parseType();
  const end = ctx.expect(TokenKind.Semicolon);

  return {
    kind: "Field",
    name: nameToken.lexeme,
    typeAnnotation,
    span: { start: nameToken.span.start, end: end.span.end },
  };
}

function parseEnumDeclaration(ctx: ParserContext, isPublic: boolean, startToken: Token): EnumDecl {
  ctx.expect(TokenKind.Enum);
  const name = ctx.expectIdentifier().lexeme;

  let baseType: TypeNode | null = null;
  if (ctx.match(TokenKind.Colon)) {
    baseType = ctx.parseType();
  }

  ctx.expect(TokenKind.LeftBrace);
  const variants: EnumVariant[] = [];

  while (!ctx.check(TokenKind.RightBrace) && !ctx.isAtEnd()) {
    variants.push(parseEnumVariant(ctx));
    // Allow comma or semicolon as separator, or nothing before }
    if (!ctx.check(TokenKind.RightBrace)) {
      if (!ctx.match(TokenKind.Comma) && !ctx.match(TokenKind.Semicolon)) {
        // If next is not }, expect a separator
        if (!ctx.check(TokenKind.RightBrace)) {
          ctx.addError("Expected ',' or '}' after enum variant", ctx.current());
          ctx.throwParseError();
        }
      }
    }
  }

  const end = ctx.expect(TokenKind.RightBrace);
  return {
    kind: "EnumDecl",
    name,
    isPublic,
    baseType,
    variants,
    span: { start: startToken.span.start, end: end.span.end },
  };
}

function parseEnumVariant(ctx: ParserContext): EnumVariant {
  const nameToken = ctx.expectIdentifier();
  const fields: Field[] = [];
  let value: Expression | null = null;

  if (ctx.match(TokenKind.LeftParen)) {
    // Data variant: Name(field: Type, ...)
    while (!ctx.check(TokenKind.RightParen) && !ctx.isAtEnd()) {
      const fieldName = ctx.expectIdentifier();
      ctx.expect(TokenKind.Colon);
      const fieldType = ctx.parseType();
      fields.push({
        kind: "Field",
        name: fieldName.lexeme,
        typeAnnotation: fieldType,
        span: { start: fieldName.span.start, end: fieldType.span.end },
      });
      if (!ctx.check(TokenKind.RightParen)) {
        ctx.expect(TokenKind.Comma);
      }
    }
    const end = ctx.expect(TokenKind.RightParen);
    return {
      kind: "EnumVariant",
      name: nameToken.lexeme,
      fields,
      value: null,
      span: { start: nameToken.span.start, end: end.span.end },
    };
  }

  if (ctx.match(TokenKind.Equal)) {
    value = ctx.parseExpression();
  }

  return {
    kind: "EnumVariant",
    name: nameToken.lexeme,
    fields,
    value,
    span: { start: nameToken.span.start, end: ctx.previous().span.end },
  };
}

function parseTypeAlias(ctx: ParserContext, isPublic: boolean, startToken: Token): TypeAlias {
  ctx.expect(TokenKind.Type);
  const name = ctx.expectIdentifier().lexeme;
  ctx.expect(TokenKind.Equal);
  const typeValue = ctx.parseType();
  const end = ctx.expect(TokenKind.Semicolon);

  return {
    kind: "TypeAlias",
    name,
    isPublic,
    typeValue,
    span: { start: startToken.span.start, end: end.span.end },
  };
}

function parseStaticDeclaration(
  ctx: ParserContext,
  isPublic: boolean,
  startToken: Token
): StaticDecl {
  ctx.expect(TokenKind.Static);
  const name = ctx.expectIdentifier().lexeme;

  let typeAnnotation: TypeNode | null = null;
  if (ctx.match(TokenKind.Colon)) {
    typeAnnotation = ctx.parseType();
  }

  ctx.expect(TokenKind.Equal);
  const initializer = ctx.parseExpression();
  const end = ctx.expect(TokenKind.Semicolon);

  return {
    kind: "StaticDecl",
    name,
    isPublic,
    typeAnnotation,
    initializer,
    span: { start: startToken.span.start, end: end.span.end },
  };
}

function parseImportDeclaration(ctx: ParserContext, startToken: Token): ImportDecl {
  ctx.expect(TokenKind.Import);

  // Check for selective import: import { ... } from path;
  if (ctx.check(TokenKind.LeftBrace)) {
    ctx.advance();
    const items: string[] = [];
    while (!ctx.check(TokenKind.RightBrace) && !ctx.isAtEnd()) {
      items.push(ctx.expectIdentifier().lexeme);
      if (!ctx.check(TokenKind.RightBrace)) {
        ctx.expect(TokenKind.Comma);
      }
    }
    ctx.expect(TokenKind.RightBrace);

    // Expect 'from' as identifier
    const fromToken = ctx.current();
    if (fromToken.kind !== TokenKind.Identifier || fromToken.lexeme !== "from") {
      ctx.addError("Expected 'from' after import items", fromToken);
      ctx.throwParseError();
    }
    ctx.advance();

    const path = parseImportPath(ctx);
    const end = ctx.expect(TokenKind.Semicolon);

    return {
      kind: "ImportDecl",
      path,
      items,
      span: { start: startToken.span.start, end: end.span.end },
    };
  }

  // Simple import: import path;
  const path = parseImportPath(ctx);
  const end = ctx.expect(TokenKind.Semicolon);

  return {
    kind: "ImportDecl",
    path,
    items: [],
    span: { start: startToken.span.start, end: end.span.end },
  };
}

function parseImportPath(ctx: ParserContext): string {
  let path = ctx.expectIdentifier().lexeme;
  while (ctx.match(TokenKind.Dot)) {
    path += `.${ctx.expectIdentifier().lexeme}`;
  }
  return path;
}

function parseOptionalReturnType(ctx: ParserContext): TypeNode | null {
  if (ctx.match(TokenKind.Arrow)) {
    return ctx.parseType();
  }
  return null;
}

function parseOptionalThrows(ctx: ParserContext): TypeNode[] {
  if (!ctx.match(TokenKind.Throws)) return [];
  const types: TypeNode[] = [ctx.parseType()];
  while (ctx.match(TokenKind.Comma)) {
    types.push(ctx.parseType());
  }
  return types;
}

function parseOptionalGenericParams(ctx: ParserContext): string[] {
  if (!ctx.match(TokenKind.Less)) return [];
  const params: string[] = [ctx.expectIdentifier().lexeme];
  while (ctx.match(TokenKind.Comma)) {
    params.push(ctx.expectIdentifier().lexeme);
  }
  ctx.expect(TokenKind.Greater);
  return params;
}

function parseParamList(ctx: ParserContext): Param[] {
  const params: Param[] = [];
  if (ctx.check(TokenKind.RightParen)) return params;

  params.push(parseParam(ctx));
  while (ctx.match(TokenKind.Comma)) {
    params.push(parseParam(ctx));
  }
  return params;
}

function parseParam(ctx: ParserContext): Param {
  const startToken = ctx.current();
  const isMut = ctx.match(TokenKind.Mut);
  const isMove = ctx.match(TokenKind.Move);
  const name = ctx.expectIdentifier().lexeme;
  ctx.expect(TokenKind.Colon);
  const typeAnnotation = ctx.parseType();

  return {
    kind: "Param",
    name,
    typeAnnotation,
    isMut,
    isMove,
    span: { start: startToken.span.start, end: typeAnnotation.span.end },
  };
}
