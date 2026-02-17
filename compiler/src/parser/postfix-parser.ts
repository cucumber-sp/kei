/**
 * Postfix expression parsing for Kei.
 * Handles member access, calls, indexing, casts, struct literals, generics, etc.
 * Extracted from expr-parser.ts.
 */

import type {
  CastExpr,
  Expression,
  FieldInit,
  TypeNode,
} from "../ast/nodes.ts";
import { TokenKind } from "../lexer/token.ts";
import { parseExpression } from "./expr-parser.ts";
import { parseCatchExpression } from "./catch-parser.ts";
import type { ParserContext } from "./parser.ts";

export function parsePostfixExpression(ctx: ParserContext, left: Expression): Expression {
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
