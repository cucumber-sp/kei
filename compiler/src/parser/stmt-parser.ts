/**
 * Statement parsing for Kei.
 * Extracted from parser.ts — all functions operate on a ParserContext.
 */

import type {
  AssertStmt,
  BreakStmt,
  CForStmt,
  ConstStmt,
  ContinueStmt,
  DeferStmt,
  Expression,
  ExprStmt,
  ForStmt,
  IfStmt,
  LetStmt,
  RequireStmt,
  ReturnStmt,
  Statement,
  SwitchCase,
  SwitchStmt,
  TypeNode,
  UnsafeBlock,
  WhileStmt,
} from "../ast/nodes.ts";
import { TokenKind } from "../lexer/token.ts";
import type { ParserContext } from "./parser.ts";

export function parseLetStatement(ctx: ParserContext): LetStmt {
  const start = ctx.expect(TokenKind.Let);
  const name = ctx.expectIdentifier().lexeme;
  let typeAnnotation: TypeNode | null = null;
  if (ctx.match(TokenKind.Colon)) {
    typeAnnotation = ctx.parseType();
  }
  ctx.expect(TokenKind.Equal);
  const initializer = ctx.parseExpression();
  const end = ctx.expect(TokenKind.Semicolon);

  return {
    kind: "LetStmt",
    name,
    typeAnnotation,
    initializer,
    span: { start: start.span.start, end: end.span.end },
  };
}

export function parseConstStatement(ctx: ParserContext): ConstStmt {
  const start = ctx.expect(TokenKind.Const);
  const name = ctx.expectIdentifier().lexeme;
  let typeAnnotation: TypeNode | null = null;
  if (ctx.match(TokenKind.Colon)) {
    typeAnnotation = ctx.parseType();
  }
  ctx.expect(TokenKind.Equal);
  const initializer = ctx.parseExpression();
  const end = ctx.expect(TokenKind.Semicolon);

  return {
    kind: "ConstStmt",
    name,
    typeAnnotation,
    initializer,
    span: { start: start.span.start, end: end.span.end },
  };
}

export function parseReturnStatement(ctx: ParserContext): ReturnStmt {
  const start = ctx.expect(TokenKind.Return);
  let value: Expression | null = null;
  if (!ctx.check(TokenKind.Semicolon)) {
    value = ctx.parseExpression();
  }
  const end = ctx.expect(TokenKind.Semicolon);

  return {
    kind: "ReturnStmt",
    value,
    span: { start: start.span.start, end: end.span.end },
  };
}

export function parseIfStatement(ctx: ParserContext): IfStmt {
  const start = ctx.expect(TokenKind.If);
  const condition = ctx.parseExpression();
  const thenBlock = ctx.parseBlockStatement();

  let elseBlock: IfStmt["elseBlock"] = null;
  if (ctx.match(TokenKind.Else)) {
    if (ctx.check(TokenKind.If)) {
      elseBlock = parseIfStatement(ctx);
    } else {
      elseBlock = ctx.parseBlockStatement();
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

export function parseWhileStatement(ctx: ParserContext): WhileStmt {
  const start = ctx.expect(TokenKind.While);
  const condition = ctx.parseExpression();
  const body = ctx.parseBlockStatement();

  return {
    kind: "WhileStmt",
    condition,
    body,
    span: { start: start.span.start, end: body.span.end },
  };
}

export function parseForStatement(ctx: ParserContext): ForStmt | CForStmt {
  const start = ctx.expect(TokenKind.For);

  // C-style for: for (let i = 0; i < 10; i = i + 1) { }
  if (ctx.check(TokenKind.LeftParen)) {
    return parseCForStatement(ctx, start);
  }

  // For-in loop: for item in collection { }
  const variable = ctx.expectIdentifier().lexeme;

  let index: string | null = null;
  if (ctx.match(TokenKind.Comma)) {
    index = ctx.expectIdentifier().lexeme;
  }

  ctx.expect(TokenKind.In);
  const iterable = ctx.parseExpression();
  const body = ctx.parseBlockStatement();

  return {
    kind: "ForStmt",
    variable,
    index,
    iterable,
    body,
    span: { start: start.span.start, end: body.span.end },
  };
}

function parseCForStatement(
  ctx: ParserContext,
  start: { span: { start: number } }
): CForStmt {
  ctx.expect(TokenKind.LeftParen);

  // Init: let i = 0 (or let i: int = 0)
  ctx.expect(TokenKind.Let);
  const name = ctx.expectIdentifier().lexeme;
  let typeAnnotation: TypeNode | null = null;
  if (ctx.match(TokenKind.Colon)) {
    typeAnnotation = ctx.parseType();
  }
  ctx.expect(TokenKind.Equal);
  const initializer = ctx.parseExpression();
  const initEnd = ctx.expect(TokenKind.Semicolon);

  const init = {
    kind: "LetStmt" as const,
    name,
    typeAnnotation,
    initializer,
    span: { start: start.span.start, end: initEnd.span.end },
  };

  // Condition: i < 10
  const condition = ctx.parseExpression();
  ctx.expect(TokenKind.Semicolon);

  // Update: i = i + 1
  const update = ctx.parseExpression();
  ctx.expect(TokenKind.RightParen);

  const body = ctx.parseBlockStatement();

  return {
    kind: "CForStmt",
    init,
    condition,
    update,
    body,
    span: { start: start.span.start, end: body.span.end },
  };
}

export function parseSwitchStatement(ctx: ParserContext): SwitchStmt {
  const start = ctx.expect(TokenKind.Switch);
  const subject = ctx.parseExpression();
  ctx.expect(TokenKind.LeftBrace);

  const cases: SwitchCase[] = [];
  while (!ctx.check(TokenKind.RightBrace) && !ctx.isAtEnd()) {
    cases.push(parseSwitchCase(ctx));
  }

  const end = ctx.expect(TokenKind.RightBrace);
  return {
    kind: "SwitchStmt",
    subject,
    cases,
    span: { start: start.span.start, end: end.span.end },
  };
}

export function parseSwitchCase(ctx: ParserContext): SwitchCase {
  if (ctx.match(TokenKind.Default)) {
    ctx.expect(TokenKind.Colon);
    const body = parseCaseBody(ctx);
    return {
      kind: "SwitchCase",
      values: [],
      bindings: null,
      body,
      isDefault: true,
      span: {
        start: ctx.previous().span.start,
        end: body.length > 0 ? body[body.length - 1]?.span.end : ctx.previous().span.end,
      },
    };
  }

  const startToken = ctx.expect(TokenKind.Case);

  // Check for destructuring: case VariantName(binding1, binding2):
  // Must lookahead before parseExpression, which would consume `Name(...)` as CallExpr
  let bindings: string[] | null = null;
  const values: Expression[] = [];

  if (ctx.check(TokenKind.Identifier) && ctx.peekNext()?.kind === TokenKind.LeftParen) {
    // Parse as destructuring: identifier + parenthesized bindings
    const identToken = ctx.expectIdentifier();
    values.push({
      kind: "Identifier",
      name: identToken.lexeme,
      span: identToken.span,
    } as Expression);
    ctx.expect(TokenKind.LeftParen);
    bindings = [];
    while (!ctx.check(TokenKind.RightParen) && !ctx.isAtEnd()) {
      bindings.push(ctx.expectIdentifier().lexeme);
      if (!ctx.check(TokenKind.RightParen)) {
        ctx.expect(TokenKind.Comma);
      }
    }
    ctx.expect(TokenKind.RightParen);
  } else {
    values.push(ctx.parseExpression());
    while (ctx.match(TokenKind.Comma)) {
      values.push(ctx.parseExpression());
    }
  }

  ctx.expect(TokenKind.Colon);
  const body = parseCaseBody(ctx);

  return {
    kind: "SwitchCase",
    values,
    bindings,
    body,
    isDefault: false,
    span: {
      start: startToken.span.start,
      end: body.length > 0 ? body[body.length - 1]?.span.end : ctx.previous().span.end,
    },
  };
}

function parseCaseBody(ctx: ParserContext): Statement[] {
  const stmts: Statement[] = [];
  while (
    !ctx.check(TokenKind.Case) &&
    !ctx.check(TokenKind.Default) &&
    !ctx.check(TokenKind.RightBrace) &&
    !ctx.isAtEnd()
  ) {
    stmts.push(ctx.parseStatement());
  }
  return stmts;
}

export function parseDeferStatement(ctx: ParserContext): DeferStmt {
  const start = ctx.expect(TokenKind.Defer);
  const statement = ctx.parseStatement();
  return {
    kind: "DeferStmt",
    statement,
    span: { start: start.span.start, end: statement.span.end },
  };
}

export function parseBreakStatement(ctx: ParserContext): BreakStmt {
  const start = ctx.expect(TokenKind.Break);
  const end = ctx.expect(TokenKind.Semicolon);
  return { kind: "BreakStmt", span: { start: start.span.start, end: end.span.end } };
}

export function parseContinueStatement(ctx: ParserContext): ContinueStmt {
  const start = ctx.expect(TokenKind.Continue);
  const end = ctx.expect(TokenKind.Semicolon);
  return { kind: "ContinueStmt", span: { start: start.span.start, end: end.span.end } };
}

export function parseAssertStatement(ctx: ParserContext): AssertStmt {
  const start = ctx.expect(TokenKind.Assert);
  ctx.expect(TokenKind.LeftParen);
  const condition = ctx.parseExpression();
  let message: Expression | null = null;
  if (ctx.match(TokenKind.Comma)) {
    message = ctx.parseExpression();
  }
  ctx.expect(TokenKind.RightParen);
  const end = ctx.expect(TokenKind.Semicolon);

  return {
    kind: "AssertStmt",
    condition,
    message,
    span: { start: start.span.start, end: end.span.end },
  };
}

export function parseRequireStatement(ctx: ParserContext): RequireStmt {
  const start = ctx.expect(TokenKind.Require);
  ctx.expect(TokenKind.LeftParen);
  const condition = ctx.parseExpression();
  let message: Expression | null = null;
  if (ctx.match(TokenKind.Comma)) {
    message = ctx.parseExpression();
  }
  ctx.expect(TokenKind.RightParen);
  const end = ctx.expect(TokenKind.Semicolon);

  return {
    kind: "RequireStmt",
    condition,
    message,
    span: { start: start.span.start, end: end.span.end },
  };
}

export function parseUnsafeBlockStatement(ctx: ParserContext): UnsafeBlock {
  const start = ctx.expect(TokenKind.Unsafe);
  const body = ctx.parseBlockStatement();
  return {
    kind: "UnsafeBlock",
    body,
    span: { start: start.span.start, end: body.span.end },
  };
}

export function parseExpressionStatement(ctx: ParserContext): ExprStmt {
  const expression = ctx.parseExpression();
  const end = ctx.expect(TokenKind.Semicolon);
  return {
    kind: "ExprStmt",
    expression,
    span: { start: expression.span.start, end: end.span.end },
  };
}
