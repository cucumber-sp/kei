/**
 * Expression parsing (Pratt parser) for Kei.
 * Extracted from parser.ts — all methods operate on a ParserContext.
 */

import type {
  ArrayLiteral,
  AssignExpr,
  BlockStmt,
  Expression,
  Statement,
} from "../ast/nodes.ts";
import { TokenKind } from "../lexer/token.ts";
import {
  Associativity,
  getBinaryAssociativity,
  getBinaryPrecedence,
  isAssignmentOperator,
  Precedence,
} from "./precedence.ts";
import type { ParserContext } from "./parser.ts";
import { parsePostfixExpression } from "./postfix-parser.ts";

export function parseExpression(ctx: ParserContext): Expression {
  return parsePrattExpression(ctx, Precedence.None);
}

function parsePrattExpression(ctx: ParserContext, minPrecedence: Precedence): Expression {
  let left = parsePrefixExpression(ctx);

  while (true) {
    // Postfix: . .* [] () ++ -- catch
    left = parsePostfixExpression(ctx, left);

    // Range operators (.., ..=)
    if (
      (ctx.check(TokenKind.DotDot) || ctx.check(TokenKind.DotDotEqual)) &&
      minPrecedence < Precedence.Additive
    ) {
      left = parseRangeExpression(ctx, left);
      continue;
    }

    const kind = ctx.current().kind;
    const prec = getBinaryPrecedence(kind);
    if (prec === Precedence.None || prec <= minPrecedence) {
      break;
    }

    // For right-associative, use prec - 1 so same-precedence binds right
    const assoc = getBinaryAssociativity(kind);
    const nextMinPrec = assoc === Associativity.Right ? (prec as number) - 1 : (prec as number);

    if (isAssignmentOperator(kind)) {
      const opToken = ctx.advance();
      const right = parsePrattExpression(ctx, nextMinPrec as Precedence);
      const assignExpr: AssignExpr = {
        kind: "AssignExpr",
        target: left,
        operator: opToken.lexeme,
        value: right,
        span: { start: left.span.start, end: right.span.end },
      };
      left = assignExpr;
    } else {
      const opToken = ctx.advance();
      const right = parsePrattExpression(ctx, nextMinPrec as Precedence);
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

function parseRangeExpression(ctx: ParserContext, left: Expression): Expression {
  const inclusive = ctx.check(TokenKind.DotDotEqual);
  ctx.advance(); // consume .. or ..=

  const right = parsePrattExpression(ctx, Precedence.Additive);
  return {
    kind: "RangeExpr",
    start: left,
    end: right,
    inclusive,
    span: { start: left.span.start, end: right.span.end },
  };
}

function parsePrefixExpression(ctx: ParserContext): Expression {
  const token = ctx.current();

  // Unary prefix operators
  if (
    token.kind === TokenKind.Bang ||
    token.kind === TokenKind.Tilde ||
    token.kind === TokenKind.Minus ||
    token.kind === TokenKind.Amp
  ) {
    ctx.advance();
    const operand = parsePrattExpression(ctx, Precedence.Unary);
    return {
      kind: "UnaryExpr",
      operator: token.lexeme,
      operand,
      span: { start: token.span.start, end: operand.span.end },
    };
  }

  // move expr
  if (token.kind === TokenKind.Move) {
    ctx.advance();
    const operand = parsePrattExpression(ctx, Precedence.Unary);
    return {
      kind: "MoveExpr",
      operand,
      span: { start: token.span.start, end: operand.span.end },
    };
  }

  // throw expr
  if (token.kind === TokenKind.Throw) {
    ctx.advance();
    const value = parsePrattExpression(ctx, Precedence.Unary);
    return {
      kind: "ThrowExpr",
      value,
      span: { start: token.span.start, end: value.span.end },
    };
  }

  // if expression
  if (token.kind === TokenKind.If) {
    return parseIfExpression(ctx);
  }

  // unsafe { expr } expression
  if (token.kind === TokenKind.Unsafe) {
    return parseUnsafeExpression(ctx);
  }

  return parsePrimaryExpression(ctx);
}

function parseIfExpression(ctx: ParserContext): Expression {
  const start = ctx.expect(TokenKind.If);
  const condition = parseExpression(ctx);
  const thenBlock = parseExpressionBlock(ctx);
  ctx.expect(TokenKind.Else);
  const elseBlock = parseExpressionBlock(ctx);

  return {
    kind: "IfExpr",
    condition,
    thenBlock,
    elseBlock,
    span: { start: start.span.start, end: elseBlock.span.end },
  };
}

function parseUnsafeExpression(ctx: ParserContext): Expression {
  const start = ctx.expect(TokenKind.Unsafe);
  const body = parseExpressionBlock(ctx);

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
function parseExpressionBlock(ctx: ParserContext): BlockStmt {
  const start = ctx.expect(TokenKind.LeftBrace);
  const statements: Statement[] = [];

  while (!ctx.check(TokenKind.RightBrace) && !ctx.isAtEnd()) {
    const expr = parseExpression(ctx);
    if (ctx.check(TokenKind.RightBrace)) {
      // Bare expression at end of block — wrap as ExprStmt without semicolon
      statements.push({
        kind: "ExprStmt",
        expression: expr,
        span: expr.span,
      });
    } else if (ctx.match(TokenKind.Semicolon)) {
      statements.push({
        kind: "ExprStmt",
        expression: expr,
        span: { start: expr.span.start, end: ctx.previous().span.end },
      });
    } else {
      ctx.addError("Expected ';' or '}'", ctx.current());
      ctx.throwParseError();
    }
  }

  const end = ctx.expect(TokenKind.RightBrace);
  return {
    kind: "BlockStmt",
    statements,
    span: { start: start.span.start, end: end.span.end },
  };
}

function parsePrimaryExpression(ctx: ParserContext): Expression {
  const token = ctx.current();

  // Integer literal
  if (token.kind === TokenKind.IntLiteral) {
    ctx.advance();
    return {
      kind: "IntLiteral",
      value: token.value as number,
      span: token.span,
    };
  }

  // Float literal
  if (token.kind === TokenKind.FloatLiteral) {
    ctx.advance();
    return {
      kind: "FloatLiteral",
      value: token.value as number,
      span: token.span,
    };
  }

  // String literal
  if (token.kind === TokenKind.StringLiteral) {
    ctx.advance();
    return {
      kind: "StringLiteral",
      value: token.value as string,
      span: token.span,
    };
  }

  // Bool literals
  if (token.kind === TokenKind.True) {
    ctx.advance();
    return { kind: "BoolLiteral", value: true, span: token.span };
  }
  if (token.kind === TokenKind.False) {
    ctx.advance();
    return { kind: "BoolLiteral", value: false, span: token.span };
  }

  // Null literal
  if (token.kind === TokenKind.Null) {
    ctx.advance();
    return { kind: "NullLiteral", span: token.span };
  }

  // Identifier (including 'self' keyword used as variable)
  if (token.kind === TokenKind.Identifier || token.kind === TokenKind.Self) {
    ctx.advance();
    return { kind: "Identifier", name: token.lexeme, span: token.span };
  }

  // Grouped expression: (expr)
  if (token.kind === TokenKind.LeftParen) {
    ctx.advance();
    const expression = parseExpression(ctx);
    const end = ctx.expect(TokenKind.RightParen);
    return {
      kind: "GroupExpr",
      expression,
      span: { start: token.span.start, end: end.span.end },
    };
  }

  // Array literal: [expr, expr, ...]
  if (token.kind === TokenKind.LeftBracket) {
    ctx.advance();
    const elements: Expression[] = [];
    if (!ctx.check(TokenKind.RightBracket)) {
      elements.push(parseExpression(ctx));
      while (ctx.match(TokenKind.Comma)) {
        if (ctx.check(TokenKind.RightBracket)) break; // trailing comma
        elements.push(parseExpression(ctx));
      }
    }
    const end = ctx.expect(TokenKind.RightBracket);
    return {
      kind: "ArrayLiteral",
      elements,
      span: { start: token.span.start, end: end.span.end },
    } as ArrayLiteral;
  }

  ctx.addError(`Unexpected token '${token.kind}' in expression`, token);
  ctx.throwParseError();
}
