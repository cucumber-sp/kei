import type { Span } from "../../lexer/token";

/** Common fields shared by all AST nodes. */
export interface BaseNode {
  kind: string;
  span: Span;
}
