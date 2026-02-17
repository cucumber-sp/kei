/**
 * Expression parsing (Pratt parser) for Kei.
 * Extracted from parser.ts — all methods operate on a ParserContext.
 */

import type {
  ArrayLiteral,
  AssignExpr,
  BlockStmt,
  CastExpr,
  CatchClause,
  CatchExpr,
  Expression,
  FieldInit,
  Statement,
  TypeNode,
} from "../ast/nodes.ts";
import type { Token } from "../lexer/token.ts";
import { TokenKind } from "../lexer/token.ts";
import {
  Associativity,
  getBinaryAssociativity,
  getBinaryPrecedence,
  isAssignmentOperator,
  Precedence,
} from "./precedence.ts";
import type { ParserContext } from "./parser.ts";

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

function parsePostfixExpression(ctx: ParserContext, left: Expression): Expression {
  while (true) {
    // Member access: .field
    if (ctx.check(TokenKind.Dot)) {
      // Check it's not a range (..)
      const next = ctx.peekNext();
      if (next?.kind === TokenKind.Dot) break;

      ctx.advance();
      const prop = ctx.expectIdentifier();
      left = {
        kind: "MemberExpr",
        object: left,
        property: prop.lexeme,
        span: { start: left.span.start, end: prop.span.end },
      };
      continue;
    }

    // Dereference: .*
    if (ctx.check(TokenKind.DotStar)) {
      const end = ctx.advance();
      left = {
        kind: "DerefExpr",
        operand: left,
        span: { start: left.span.start, end: end.span.end },
      };
      continue;
    }

    // Index: [expr]
    if (ctx.check(TokenKind.LeftBracket)) {
      ctx.advance();
      const index = parseExpression(ctx);
      const end = ctx.expect(TokenKind.RightBracket);
      left = {
        kind: "IndexExpr",
        object: left,
        index,
        span: { start: left.span.start, end: end.span.end },
      };
      continue;
    }

    // Generic type args: foo<i32, string>( or Pair<i32, bool>{
    // Use speculative parsing since < is also comparison operator
    if (
      ctx.check(TokenKind.Less) &&
      (left.kind === "Identifier" || left.kind === "MemberExpr")
    ) {
      const typeArgsResult = tryParseTypeArgs(ctx);
      if (typeArgsResult !== null) {
        // Generic call: foo<i32>(args)
        if (ctx.check(TokenKind.LeftParen)) {
          ctx.advance();
          const args: Expression[] = [];
          if (!ctx.check(TokenKind.RightParen)) {
            args.push(parseExpression(ctx));
            while (ctx.match(TokenKind.Comma)) {
              args.push(parseExpression(ctx));
            }
          }
          const end = ctx.expect(TokenKind.RightParen);
          left = {
            kind: "CallExpr",
            callee: left,
            typeArgs: typeArgsResult,
            args,
            span: { start: left.span.start, end: end.span.end },
          };
          continue;
        }

        // Generic struct literal: Pair<i32, bool>{ first: 1, second: true }
        if (left.kind === "Identifier" && ctx.check(TokenKind.LeftBrace)) {
          if (isStructLiteral(ctx)) {
            left = parseStructLiteralFromIdentifier(ctx, left, typeArgsResult);
            continue;
          }
        }

        // Type args parsed but not followed by ( or { — this shouldn't
        // happen with correct speculative parsing, but treat as error
      }
    }

    // Call: (args)
    if (ctx.check(TokenKind.LeftParen)) {
      ctx.advance();
      const args: Expression[] = [];
      if (!ctx.check(TokenKind.RightParen)) {
        args.push(parseExpression(ctx));
        while (ctx.match(TokenKind.Comma)) {
          args.push(parseExpression(ctx));
        }
      }
      const end = ctx.expect(TokenKind.RightParen);
      left = {
        kind: "CallExpr",
        callee: left,
        typeArgs: [],
        args,
        span: { start: left.span.start, end: end.span.end },
      };
      continue;
    }

    // Postfix increment: ++
    if (ctx.check(TokenKind.PlusPlus)) {
      const end = ctx.advance();
      left = {
        kind: "IncrementExpr",
        operand: left,
        span: { start: left.span.start, end: end.span.end },
      };
      continue;
    }

    // Postfix decrement: --
    if (ctx.check(TokenKind.MinusMinus)) {
      const end = ctx.advance();
      left = {
        kind: "DecrementExpr",
        operand: left,
        span: { start: left.span.start, end: end.span.end },
      };
      continue;
    }

    // cast: expr as Type
    if (ctx.check(TokenKind.As)) {
      left = parseCastExpression(ctx, left);
      continue;
    }

    // catch
    if (ctx.check(TokenKind.Catch)) {
      left = parseCatchExpression(ctx, left);
      continue;
    }

    // Struct literal: Identifier { field: value }
    // Only if left is an Identifier and next is {
    if (left.kind === "Identifier" && ctx.check(TokenKind.LeftBrace)) {
      // Look ahead to distinguish struct literal from block
      if (isStructLiteral(ctx)) {
        left = parseStructLiteralFromIdentifier(ctx, left, []);
        continue;
      }
    }

    break;
  }
  return left;
}

/**
 * Speculatively try to parse `<Type, Type, ...>` as generic type arguments.
 * Returns the parsed TypeNode[] if successful and followed by `(` or `{`,
 * otherwise backtracks and returns null.
 */
function tryParseTypeArgs(ctx: ParserContext): TypeNode[] | null {
  const saved = ctx.savePos();
  const savedDiagLen = ctx.saveDiagnosticsLength();

  try {
    ctx.advance(); // consume <
    const typeArgs: TypeNode[] = [ctx.parseType()];
    while (ctx.match(TokenKind.Comma)) {
      typeArgs.push(ctx.parseType());
    }
    if (!ctx.check(TokenKind.Greater)) {
      ctx.restorePos(saved);
      ctx.restoreDiagnosticsLength(savedDiagLen);
      return null;
    }
    ctx.advance(); // consume >

    // Only commit if followed by ( or {
    if (ctx.check(TokenKind.LeftParen) || ctx.check(TokenKind.LeftBrace)) {
      return typeArgs;
    }

    // Not followed by ( or { — backtrack
    ctx.restorePos(saved);
    ctx.restoreDiagnosticsLength(savedDiagLen);
    return null;
  } catch {
    // parseType threw — backtrack
    ctx.restorePos(saved);
    ctx.restoreDiagnosticsLength(savedDiagLen);
    return null;
  }
}

function isStructLiteral(ctx: ParserContext): boolean {
  const saved = ctx.savePos();
  ctx.advance(); // skip {

  // Empty {} after identifier is struct literal
  if (ctx.check(TokenKind.RightBrace)) {
    ctx.restorePos(saved);
    return true;
  }

  // Check if pattern is: identifier ':'
  const isStruct = ctx.check(TokenKind.Identifier) && ctx.peekNext()?.kind === TokenKind.Colon;

  ctx.restorePos(saved);
  return isStruct;
}

function parseStructLiteralFromIdentifier(
  ctx: ParserContext,
  ident: Expression & { kind: "Identifier" },
  typeArgs: TypeNode[],
): Expression {
  ctx.advance(); // skip {
  const fields: FieldInit[] = [];

  while (!ctx.check(TokenKind.RightBrace) && !ctx.isAtEnd()) {
    const fieldName = ctx.expectIdentifier();
    ctx.expect(TokenKind.Colon);
    const value = parseExpression(ctx);
    fields.push({
      kind: "FieldInit",
      name: fieldName.lexeme,
      value,
      span: { start: fieldName.span.start, end: value.span.end },
    });
    if (!ctx.check(TokenKind.RightBrace)) {
      ctx.expect(TokenKind.Comma);
    }
  }

  const end = ctx.expect(TokenKind.RightBrace);
  return {
    kind: "StructLiteral",
    name: ident.name,
    typeArgs,
    fields,
    span: { start: ident.span.start, end: end.span.end },
  };
}

function parseCastExpression(ctx: ParserContext, operand: Expression): CastExpr {
  ctx.expect(TokenKind.As);
  const targetType = ctx.parseType();
  return {
    kind: "CastExpr",
    operand,
    targetType,
    span: { start: operand.span.start, end: targetType.span.end },
  };
}

function parseCatchExpression(ctx: ParserContext, operand: Expression): CatchExpr {
  ctx.expect(TokenKind.Catch);

  // catch panic
  if (ctx.check(TokenKind.Panic)) {
    const end = ctx.advance();
    return {
      kind: "CatchExpr",
      operand,
      catchType: "panic",
      clauses: [],
      span: { start: operand.span.start, end: end.span.end },
    };
  }

  // catch throw
  if (ctx.check(TokenKind.Throw)) {
    const end = ctx.advance();
    return {
      kind: "CatchExpr",
      operand,
      catchType: "throw",
      clauses: [],
      span: { start: operand.span.start, end: end.span.end },
    };
  }

  // catch { clauses }
  ctx.expect(TokenKind.LeftBrace);
  const clauses: CatchClause[] = [];

  while (!ctx.check(TokenKind.RightBrace) && !ctx.isAtEnd()) {
    if (ctx.check(TokenKind.Default)) {
      ctx.advance();
      let varName: string | null = null;
      if (ctx.check(TokenKind.Identifier)) {
        varName = ctx.advance().lexeme;
      }
      ctx.expect(TokenKind.Colon);
      const body = parseCatchClauseBody(ctx);
      clauses.push({
        kind: "CatchClause",
        errorType: "default",
        varName,
        body,
        isDefault: true,
        span: {
          start: operand.span.start,
          end: body.length > 0 ? body[body.length - 1]?.span.end : ctx.previous().span.end,
        },
      });
    } else {
      const errorType = ctx.expectIdentifier().lexeme;
      let varName: string | null = null;
      if (ctx.check(TokenKind.Identifier)) {
        varName = ctx.advance().lexeme;
      }
      ctx.expect(TokenKind.Colon);
      const body = parseCatchClauseBody(ctx);
      clauses.push({
        kind: "CatchClause",
        errorType,
        varName,
        body,
        isDefault: false,
        span: {
          start: operand.span.start,
          end: body.length > 0 ? body[body.length - 1]?.span.end : ctx.previous().span.end,
        },
      });
    }
  }

  const end = ctx.expect(TokenKind.RightBrace);
  return {
    kind: "CatchExpr",
    operand,
    catchType: "block",
    clauses,
    span: { start: operand.span.start, end: end.span.end },
  };
}

function parseCatchClauseBody(ctx: ParserContext): Statement[] {
  // A catch clause body is either a block { ... } or a single statement ending with ;
  if (ctx.check(TokenKind.LeftBrace)) {
    const block = ctx.parseBlockStatement();
    // Consume optional semicolon after block in catch clause
    ctx.match(TokenKind.Semicolon);
    return block.statements;
  }
  const stmt = ctx.parseStatement();
  return [stmt];
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
