import type { BaseNode } from "./base.ts";
import type { Expression } from "./expressions.ts";
import type { TypeNode } from "./types.ts";

export enum StmtKind {
  Block = "BlockStmt",
  Let = "LetStmt",
  Const = "ConstStmt",
  Return = "ReturnStmt",
  If = "IfStmt",
  While = "WhileStmt",
  For = "ForStmt",
  Switch = "SwitchStmt",
  Defer = "DeferStmt",
  Break = "BreakStmt",
  Continue = "ContinueStmt",
  Expr = "ExprStmt",
  Assert = "AssertStmt",
  Require = "RequireStmt",
  UnsafeBlock = "UnsafeBlock",
}

/** Braced block of statements `{ ... }`. */
export interface BlockStmt extends BaseNode {
  kind: "BlockStmt";
  statements: Statement[];
}

/** Variable binding (`let x = expr` or `let x: T = expr`). */
export interface LetStmt extends BaseNode {
  kind: "LetStmt";
  name: string;
  typeAnnotation: TypeNode | null;
  initializer: Expression;
}

/** Immutable binding (`const x = expr`). */
export interface ConstStmt extends BaseNode {
  kind: "ConstStmt";
  name: string;
  typeAnnotation: TypeNode | null;
  initializer: Expression;
}

/** Return from the enclosing function, optionally with a value. */
export interface ReturnStmt extends BaseNode {
  kind: "ReturnStmt";
  value: Expression | null;
}

/** If statement with optional else/else-if chain. */
export interface IfStmt extends BaseNode {
  kind: "IfStmt";
  condition: Expression;
  thenBlock: BlockStmt;
  /** `null` for no else, `BlockStmt` for else, `IfStmt` for else-if. */
  elseBlock: BlockStmt | IfStmt | null;
}

/** While loop. */
export interface WhileStmt extends BaseNode {
  kind: "WhileStmt";
  condition: Expression;
  body: BlockStmt;
}

/** For-in loop over an iterable (`for x in expr { ... }`). */
export interface ForStmt extends BaseNode {
  kind: "ForStmt";
  variable: string;
  /** Optional loop index variable name. */
  index: string | null;
  iterable: Expression;
  body: BlockStmt;
}

/** A single case arm in a switch statement. */
export interface SwitchCase extends BaseNode {
  kind: "SwitchCase";
  /** Match values (empty when `isDefault` is true). */
  values: Expression[];
  body: Statement[];
  isDefault: boolean;
}

/** Switch statement with exhaustive case matching. */
export interface SwitchStmt extends BaseNode {
  kind: "SwitchStmt";
  subject: Expression;
  cases: SwitchCase[];
}

/** Deferred statement executed at scope exit. */
export interface DeferStmt extends BaseNode {
  kind: "DeferStmt";
  statement: Statement;
}

/** Break out of the enclosing loop. */
export interface BreakStmt extends BaseNode {
  kind: "BreakStmt";
}

/** Continue to the next iteration of the enclosing loop. */
export interface ContinueStmt extends BaseNode {
  kind: "ContinueStmt";
}

/** Expression used as a statement (e.g. a function call). */
export interface ExprStmt extends BaseNode {
  kind: "ExprStmt";
  expression: Expression;
}

/** Runtime assertion — aborts if condition is false. */
export interface AssertStmt extends BaseNode {
  kind: "AssertStmt";
  condition: Expression;
  message: Expression | null;
}

/** Precondition check — returns error if condition is false. */
export interface RequireStmt extends BaseNode {
  kind: "RequireStmt";
  condition: Expression;
  message: Expression | null;
}

/** Unsafe block — permits calling extern functions and raw pointer ops. */
export interface UnsafeBlock extends BaseNode {
  kind: "UnsafeBlock";
  body: BlockStmt;
}

/** Union of all statement nodes. */
export type Statement =
  | BlockStmt
  | LetStmt
  | ConstStmt
  | ReturnStmt
  | IfStmt
  | WhileStmt
  | ForStmt
  | SwitchStmt
  | DeferStmt
  | BreakStmt
  | ContinueStmt
  | ExprStmt
  | AssertStmt
  | RequireStmt
  | UnsafeBlock;
