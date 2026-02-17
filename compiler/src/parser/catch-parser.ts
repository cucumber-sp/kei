/**
 * Catch expression parsing for Kei.
 * Extracted from expr-parser.ts.
 */

import type {
  CatchClause,
  CatchExpr,
  Expression,
  Statement,
} from "../ast/nodes.ts";
import { TokenKind } from "../lexer/token.ts";
import type { ParserContext } from "./parser.ts";

export function parseCatchExpression(ctx: ParserContext, operand: Expression): CatchExpr {
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
