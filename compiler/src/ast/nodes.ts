/**
 * AST node types for the Kei language.
 * Uses discriminated unions with a `kind` field.
 */

import type { Span } from "../lexer/token.ts";

// ─── Base ────────────────────────────────────────────────────────────────────

/** Common fields shared by all AST nodes. */
export interface BaseNode {
  kind: string;
  span: Span;
}

// ─── Type Nodes ──────────────────────────────────────────────────────────────

export enum TypeNodeKind {
  Named = "NamedType",
  Generic = "GenericType",
}

/** A simple named type reference, e.g. `i32`, `MyStruct`. */
export interface NamedType extends BaseNode {
  kind: "NamedType";
  name: string;
}

/** A generic type with type arguments, e.g. `ptr<i32>`, `Pair<i32, bool>`. */
export interface GenericType extends BaseNode {
  kind: "GenericType";
  name: string;
  typeArgs: TypeNode[];
}

/** Any type annotation in surface syntax. */
export type TypeNode = NamedType | GenericType;

// ─── Declarations ────────────────────────────────────────────────────────────

export enum DeclKind {
  Function = "FunctionDecl",
  ExternFunction = "ExternFunctionDecl",
  Struct = "StructDecl",
  UnsafeStruct = "UnsafeStructDecl",
  Enum = "EnumDecl",
  TypeAlias = "TypeAlias",
  Import = "ImportDecl",
  Static = "StaticDecl",
}

/** Function parameter with optional `mut` and `move` modifiers. */
export interface Param extends BaseNode {
  kind: "Param";
  name: string;
  typeAnnotation: TypeNode;
  isMut: boolean;
  isMove: boolean;
}

/** Struct field declaration. */
export interface Field extends BaseNode {
  kind: "Field";
  name: string;
  typeAnnotation: TypeNode;
}

/** Named function declaration, possibly generic and/or throwing. */
export interface FunctionDecl extends BaseNode {
  kind: "FunctionDecl";
  name: string;
  isPublic: boolean;
  genericParams: string[];
  params: Param[];
  returnType: TypeNode | null;
  /** Error types this function may throw (empty if non-throwing). */
  throwsTypes: TypeNode[];
  body: BlockStmt;
}

/** Foreign function declaration (`extern fn`). No body. */
export interface ExternFunctionDecl extends BaseNode {
  kind: "ExternFunctionDecl";
  name: string;
  params: Param[];
  returnType: TypeNode | null;
}

/** Struct type declaration with fields and methods. */
export interface StructDecl extends BaseNode {
  kind: "StructDecl";
  name: string;
  isPublic: boolean;
  genericParams: string[];
  fields: Field[];
  methods: FunctionDecl[];
}

/** Unsafe struct — fields accessed without safety checks, permits raw layout. */
export interface UnsafeStructDecl extends BaseNode {
  kind: "UnsafeStructDecl";
  name: string;
  isPublic: boolean;
  genericParams: string[];
  fields: Field[];
  methods: FunctionDecl[];
}

/** A single variant within an enum declaration. */
export interface EnumVariant extends BaseNode {
  kind: "EnumVariant";
  name: string;
  /** Named fields (empty for C-style variants). */
  fields: Field[];
  /** Explicit discriminant value, if provided. */
  value: Expression | null;
}

/** Enum type declaration with variants and an optional base type. */
export interface EnumDecl extends BaseNode {
  kind: "EnumDecl";
  name: string;
  isPublic: boolean;
  /** Underlying integer type (e.g. `i32`), null for default. */
  baseType: TypeNode | null;
  variants: EnumVariant[];
}

/** Type alias (`type Name = ExistingType`). */
export interface TypeAlias extends BaseNode {
  kind: "TypeAlias";
  name: string;
  isPublic: boolean;
  typeValue: TypeNode;
}

/** Module import declaration. `items` is empty for whole-module imports. */
export interface ImportDecl extends BaseNode {
  kind: "ImportDecl";
  path: string;
  /** Specific names to import; empty means import entire module. */
  items: string[];
}

/** Top-level static variable declaration. */
export interface StaticDecl extends BaseNode {
  kind: "StaticDecl";
  name: string;
  isPublic: boolean;
  typeAnnotation: TypeNode | null;
  initializer: Expression;
}

/** Union of all top-level declaration nodes. */
export type Declaration =
  | FunctionDecl
  | ExternFunctionDecl
  | StructDecl
  | UnsafeStructDecl
  | EnumDecl
  | TypeAlias
  | ImportDecl
  | StaticDecl;

// ─── Statements ──────────────────────────────────────────────────────────────

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

// ─── Expressions ─────────────────────────────────────────────────────────────

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
  | ArrayLiteral;
