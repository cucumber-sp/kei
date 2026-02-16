/**
 * AST node types for the Kei language.
 * Uses discriminated unions with a `kind` field.
 */

import type { Span } from "../lexer/token.ts";

// ─── Base ────────────────────────────────────────────────────────────────────

export interface BaseNode {
  kind: string;
  span: Span;
}

// ─── Program ─────────────────────────────────────────────────────────────────

export interface Program extends BaseNode {
  kind: "Program";
  declarations: Declaration[];
}

// ─── Type Nodes ──────────────────────────────────────────────────────────────

export enum TypeNodeKind {
  Named = "NamedType",
  Generic = "GenericType",
}

export interface NamedType extends BaseNode {
  kind: "NamedType";
  name: string;
}

export interface GenericType extends BaseNode {
  kind: "GenericType";
  name: string;
  typeArgs: TypeNode[];
}

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

export interface Param extends BaseNode {
  kind: "Param";
  name: string;
  typeAnnotation: TypeNode;
  isMut: boolean;
  isMove: boolean;
}

export interface Field extends BaseNode {
  kind: "Field";
  name: string;
  typeAnnotation: TypeNode;
}

export interface FunctionDecl extends BaseNode {
  kind: "FunctionDecl";
  name: string;
  isPublic: boolean;
  genericParams: string[];
  params: Param[];
  returnType: TypeNode | null;
  throwsTypes: TypeNode[];
  body: BlockStmt;
}

export interface ExternFunctionDecl extends BaseNode {
  kind: "ExternFunctionDecl";
  name: string;
  params: Param[];
  returnType: TypeNode | null;
}

export interface StructDecl extends BaseNode {
  kind: "StructDecl";
  name: string;
  isPublic: boolean;
  genericParams: string[];
  fields: Field[];
  methods: FunctionDecl[];
}

export interface UnsafeStructDecl extends BaseNode {
  kind: "UnsafeStructDecl";
  name: string;
  isPublic: boolean;
  genericParams: string[];
  fields: Field[];
  methods: FunctionDecl[];
}

export interface EnumVariant extends BaseNode {
  kind: "EnumVariant";
  name: string;
  fields: Field[];
  value: Expression | null;
}

export interface EnumDecl extends BaseNode {
  kind: "EnumDecl";
  name: string;
  isPublic: boolean;
  baseType: TypeNode | null;
  variants: EnumVariant[];
}

export interface TypeAlias extends BaseNode {
  kind: "TypeAlias";
  name: string;
  isPublic: boolean;
  typeValue: TypeNode;
}

export interface ImportDecl extends BaseNode {
  kind: "ImportDecl";
  path: string;
  items: string[];
}

export interface StaticDecl extends BaseNode {
  kind: "StaticDecl";
  name: string;
  isPublic: boolean;
  typeAnnotation: TypeNode | null;
  initializer: Expression;
}

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

export interface BlockStmt extends BaseNode {
  kind: "BlockStmt";
  statements: Statement[];
}

export interface LetStmt extends BaseNode {
  kind: "LetStmt";
  name: string;
  typeAnnotation: TypeNode | null;
  initializer: Expression;
}

export interface ConstStmt extends BaseNode {
  kind: "ConstStmt";
  name: string;
  typeAnnotation: TypeNode | null;
  initializer: Expression;
}

export interface ReturnStmt extends BaseNode {
  kind: "ReturnStmt";
  value: Expression | null;
}

export interface IfStmt extends BaseNode {
  kind: "IfStmt";
  condition: Expression;
  thenBlock: BlockStmt;
  elseBlock: BlockStmt | IfStmt | null;
}

export interface WhileStmt extends BaseNode {
  kind: "WhileStmt";
  condition: Expression;
  body: BlockStmt;
}

export interface ForStmt extends BaseNode {
  kind: "ForStmt";
  variable: string;
  index: string | null;
  iterable: Expression;
  body: BlockStmt;
}

export interface SwitchCase extends BaseNode {
  kind: "SwitchCase";
  values: Expression[];
  body: Statement[];
  isDefault: boolean;
}

export interface SwitchStmt extends BaseNode {
  kind: "SwitchStmt";
  subject: Expression;
  cases: SwitchCase[];
}

export interface DeferStmt extends BaseNode {
  kind: "DeferStmt";
  statement: Statement;
}

export interface BreakStmt extends BaseNode {
  kind: "BreakStmt";
}

export interface ContinueStmt extends BaseNode {
  kind: "ContinueStmt";
}

export interface ExprStmt extends BaseNode {
  kind: "ExprStmt";
  expression: Expression;
}

export interface AssertStmt extends BaseNode {
  kind: "AssertStmt";
  condition: Expression;
  message: Expression | null;
}

export interface RequireStmt extends BaseNode {
  kind: "RequireStmt";
  condition: Expression;
  message: Expression | null;
}

export interface UnsafeBlock extends BaseNode {
  kind: "UnsafeBlock";
  body: BlockStmt;
}

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
}

export interface BinaryExpr extends BaseNode {
  kind: "BinaryExpr";
  left: Expression;
  operator: string;
  right: Expression;
}

export interface UnaryExpr extends BaseNode {
  kind: "UnaryExpr";
  operator: string;
  operand: Expression;
}

export interface CallExpr extends BaseNode {
  kind: "CallExpr";
  callee: Expression;
  args: Expression[];
}

export interface MemberExpr extends BaseNode {
  kind: "MemberExpr";
  object: Expression;
  property: string;
}

export interface IndexExpr extends BaseNode {
  kind: "IndexExpr";
  object: Expression;
  index: Expression;
}

export interface DerefExpr extends BaseNode {
  kind: "DerefExpr";
  operand: Expression;
}

export interface AssignExpr extends BaseNode {
  kind: "AssignExpr";
  target: Expression;
  operator: string;
  value: Expression;
}

export interface FieldInit extends BaseNode {
  kind: "FieldInit";
  name: string;
  value: Expression;
}

export interface StructLiteral extends BaseNode {
  kind: "StructLiteral";
  name: string;
  typeArgs: TypeNode[];
  fields: FieldInit[];
}

export interface IfExpr extends BaseNode {
  kind: "IfExpr";
  condition: Expression;
  thenBlock: BlockStmt;
  elseBlock: BlockStmt;
}

export interface IntLiteral extends BaseNode {
  kind: "IntLiteral";
  value: number;
}

export interface FloatLiteral extends BaseNode {
  kind: "FloatLiteral";
  value: number;
}

export interface StringLiteral extends BaseNode {
  kind: "StringLiteral";
  value: string;
}

export interface BoolLiteral extends BaseNode {
  kind: "BoolLiteral";
  value: boolean;
}

export interface NullLiteral extends BaseNode {
  kind: "NullLiteral";
}

export interface Identifier extends BaseNode {
  kind: "Identifier";
  name: string;
}

export interface MoveExpr extends BaseNode {
  kind: "MoveExpr";
  operand: Expression;
}

export interface CatchClause extends BaseNode {
  kind: "CatchClause";
  errorType: string;
  varName: string | null;
  body: Statement[];
  isDefault: boolean;
}

export interface CatchExpr extends BaseNode {
  kind: "CatchExpr";
  operand: Expression;
  catchType: "block" | "panic" | "throw";
  clauses: CatchClause[];
}

export interface ThrowExpr extends BaseNode {
  kind: "ThrowExpr";
  value: Expression;
}

export interface GroupExpr extends BaseNode {
  kind: "GroupExpr";
  expression: Expression;
}

export interface IncrementExpr extends BaseNode {
  kind: "IncrementExpr";
  operand: Expression;
}

export interface DecrementExpr extends BaseNode {
  kind: "DecrementExpr";
  operand: Expression;
}

export interface RangeExpr extends BaseNode {
  kind: "RangeExpr";
  start: Expression;
  end: Expression;
  inclusive: boolean;
}

export interface UnsafeExpr extends BaseNode {
  kind: "UnsafeExpr";
  body: BlockStmt;
}

export interface CastExpr extends BaseNode {
  kind: "CastExpr";
  operand: Expression;
  targetType: TypeNode;
}

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
  | CastExpr;
