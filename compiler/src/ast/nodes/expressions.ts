import type { BaseNode } from "./base.ts";
import type { BlockStmt, Statement, SwitchCase } from "./statements.ts";
import type { TypeNode } from "./types.ts";

export enum ExprKind {
  Binary = "BinaryExpr",
  Unary = "UnaryExpr",
  Call = "CallExpr",
  Member = "MemberExpr",
  Index = "IndexExpr",
  Deref = "DerefExpr",
  Assign = "AssignExpr",
  StructLiteral = "StructLiteral",
  IfExpr = "IfExpr",
  IntLiteral = "IntLiteral",
  FloatLiteral = "FloatLiteral",
  StringLiteral = "StringLiteral",
  BoolLiteral = "BoolLiteral",
  NullLiteral = "NullLiteral",
  Identifier = "Identifier",
  Move = "MoveExpr",
  Catch = "CatchExpr",
  Throw = "ThrowExpr",
  Group = "GroupExpr",
  Increment = "IncrementExpr",
  Decrement = "DecrementExpr",
  Range = "RangeExpr",
  Unsafe = "UnsafeExpr",
  Cast = "CastExpr",
  ArrayLiteral = "ArrayLiteral",
  SwitchExpr = "SwitchExpr",
}

/** Binary operation (`a + b`, `x == y`, `p && q`). */
export interface BinaryExpr extends BaseNode {
  kind: "BinaryExpr";
  left: Expression;
  operator: string;
  right: Expression;
}

/** Unary prefix operation (`-x`, `!flag`, `~bits`). */
export interface UnaryExpr extends BaseNode {
  kind: "UnaryExpr";
  operator: string;
  operand: Expression;
}

/** Function or method call with optional type arguments. */
export interface CallExpr extends BaseNode {
  kind: "CallExpr";
  callee: Expression;
  typeArgs: TypeNode[];
  args: Expression[];
}

/** Member access (`obj.field`). */
export interface MemberExpr extends BaseNode {
  kind: "MemberExpr";
  object: Expression;
  property: string;
}

/** Indexed access (`arr[i]`). */
export interface IndexExpr extends BaseNode {
  kind: "IndexExpr";
  object: Expression;
  index: Expression;
}

/** Pointer dereference (`*ptr`). */
export interface DerefExpr extends BaseNode {
  kind: "DerefExpr";
  operand: Expression;
}

/** Assignment or compound assignment (`x = v`, `x += v`). */
export interface AssignExpr extends BaseNode {
  kind: "AssignExpr";
  target: Expression;
  /** `"="`, `"+="`, `"-="`, etc. */
  operator: string;
  value: Expression;
}

/** Field initializer within a struct literal. */
export interface FieldInit extends BaseNode {
  kind: "FieldInit";
  name: string;
  value: Expression;
}

/** Struct literal (`Point{ x: 1, y: 2 }`). */
export interface StructLiteral extends BaseNode {
  kind: "StructLiteral";
  name: string;
  typeArgs: TypeNode[];
  fields: FieldInit[];
}

/** Ternary if-expression (`if cond { a } else { b }`). Both branches required. */
export interface IfExpr extends BaseNode {
  kind: "IfExpr";
  condition: Expression;
  thenBlock: BlockStmt;
  elseBlock: BlockStmt;
}

/** Integer literal (e.g. `42`, `0xFF`). */
export interface IntLiteral extends BaseNode {
  kind: "IntLiteral";
  value: number;
}

/** Floating-point literal (e.g. `3.14`). */
export interface FloatLiteral extends BaseNode {
  kind: "FloatLiteral";
  value: number;
}

/** String literal (e.g. `"hello"`). */
export interface StringLiteral extends BaseNode {
  kind: "StringLiteral";
  value: string;
}

/** Boolean literal (`true` or `false`). */
export interface BoolLiteral extends BaseNode {
  kind: "BoolLiteral";
  value: boolean;
}

/** Null literal. */
export interface NullLiteral extends BaseNode {
  kind: "NullLiteral";
}

/** Variable or function reference by name. */
export interface Identifier extends BaseNode {
  kind: "Identifier";
  name: string;
}

/** Explicit ownership transfer (`move x`). */
export interface MoveExpr extends BaseNode {
  kind: "MoveExpr";
  operand: Expression;
}

/** A single arm in a catch expression. */
export interface CatchClause extends BaseNode {
  kind: "CatchClause";
  errorType: string;
  /** Bound variable name for the caught error value, or null. */
  varName: string | null;
  body: Statement[];
  /** True for the default/wildcard catch arm. */
  isDefault: boolean;
}

/**
 * Catch expression — handles errors from a throwing call.
 * - `"block"`: pattern-match on error types with clauses
 * - `"panic"`: abort on any error
 * - `"throw"`: re-throw to the caller
 */
export interface CatchExpr extends BaseNode {
  kind: "CatchExpr";
  operand: Expression;
  catchType: "block" | "panic" | "throw";
  clauses: CatchClause[];
}

/** Throw expression — raise an error value. */
export interface ThrowExpr extends BaseNode {
  kind: "ThrowExpr";
  value: Expression;
}

/** Parenthesized expression for explicit grouping. */
export interface GroupExpr extends BaseNode {
  kind: "GroupExpr";
  expression: Expression;
}

/** Post-increment (`x++`). */
export interface IncrementExpr extends BaseNode {
  kind: "IncrementExpr";
  operand: Expression;
}

/** Post-decrement (`x--`). */
export interface DecrementExpr extends BaseNode {
  kind: "DecrementExpr";
  operand: Expression;
}

/** Range expression (`start..end` or `start..=end`). */
export interface RangeExpr extends BaseNode {
  kind: "RangeExpr";
  start: Expression;
  end: Expression;
  /** True for `..=` (inclusive end), false for `..` (exclusive end). */
  inclusive: boolean;
}

/** Unsafe expression — wraps a block that permits unsafe operations. */
export interface UnsafeExpr extends BaseNode {
  kind: "UnsafeExpr";
  body: BlockStmt;
}

/** Explicit type cast (`expr as T`). */
export interface CastExpr extends BaseNode {
  kind: "CastExpr";
  operand: Expression;
  targetType: TypeNode;
}

/** Array literal (`[1, 2, 3]`). */
export interface ArrayLiteral extends BaseNode {
  kind: "ArrayLiteral";
  elements: Expression[];
}

/** Switch expression — produces a value from the matched case branch. */
export interface SwitchExpr extends BaseNode {
  kind: "SwitchExpr";
  subject: Expression;
  cases: SwitchCase[];
}

/** Union of all expression nodes. */
export type Expression =
  | BinaryExpr
  | UnaryExpr
  | CallExpr
  | MemberExpr
  | IndexExpr
  | DerefExpr
  | AssignExpr
  | StructLiteral
  | IfExpr
  | IntLiteral
  | FloatLiteral
  | StringLiteral
  | BoolLiteral
  | NullLiteral
  | Identifier
  | MoveExpr
  | CatchExpr
  | ThrowExpr
  | GroupExpr
  | IncrementExpr
  | DecrementExpr
  | RangeExpr
  | UnsafeExpr
  | CastExpr
  | ArrayLiteral
  | SwitchExpr;
