/**
 * AST visitor interface for future compiler passes.
 */

import type {
  AssertStmt,
  AssignExpr,
  BinaryExpr,
  BlockStmt,
  BoolLiteral,
  BreakStmt,
  CallExpr,
  CatchExpr,
  ConstStmt,
  ContinueStmt,
  DecrementExpr,
  DeferStmt,
  DerefExpr,
  EnumDecl,
  ExprStmt,
  ExternFunctionDecl,
  FloatLiteral,
  ForStmt,
  FunctionDecl,
  GroupExpr,
  Identifier,
  IfExpr,
  IfStmt,
  ImportDecl,
  IncrementExpr,
  IndexExpr,
  IntLiteral,
  LetStmt,
  MemberExpr,
  MoveExpr,
  NullLiteral,
  Program,
  RangeExpr,
  RequireStmt,
  ReturnStmt,
  StaticDecl,
  StringLiteral,
  StructDecl,
  StructLiteral,
  SwitchStmt,
  ThrowExpr,
  TypeAlias,
  UnaryExpr,
  UnsafeBlock,
  UnsafeStructDecl,
  WhileStmt,
} from "./nodes.ts";

export interface AstVisitor<T = void> {
  visitProgram(node: Program): T;

  // Declarations
  visitFunctionDecl(node: FunctionDecl): T;
  visitExternFunctionDecl(node: ExternFunctionDecl): T;
  visitStructDecl(node: StructDecl): T;
  visitUnsafeStructDecl(node: UnsafeStructDecl): T;
  visitEnumDecl(node: EnumDecl): T;
  visitTypeAlias(node: TypeAlias): T;
  visitImportDecl(node: ImportDecl): T;
  visitStaticDecl(node: StaticDecl): T;

  // Statements
  visitBlockStmt(node: BlockStmt): T;
  visitLetStmt(node: LetStmt): T;
  visitConstStmt(node: ConstStmt): T;
  visitReturnStmt(node: ReturnStmt): T;
  visitIfStmt(node: IfStmt): T;
  visitWhileStmt(node: WhileStmt): T;
  visitForStmt(node: ForStmt): T;
  visitSwitchStmt(node: SwitchStmt): T;
  visitDeferStmt(node: DeferStmt): T;
  visitBreakStmt(node: BreakStmt): T;
  visitContinueStmt(node: ContinueStmt): T;
  visitExprStmt(node: ExprStmt): T;
  visitAssertStmt(node: AssertStmt): T;
  visitRequireStmt(node: RequireStmt): T;
  visitUnsafeBlock(node: UnsafeBlock): T;

  // Expressions
  visitBinaryExpr(node: BinaryExpr): T;
  visitUnaryExpr(node: UnaryExpr): T;
  visitCallExpr(node: CallExpr): T;
  visitMemberExpr(node: MemberExpr): T;
  visitIndexExpr(node: IndexExpr): T;
  visitDerefExpr(node: DerefExpr): T;
  visitAssignExpr(node: AssignExpr): T;
  visitStructLiteral(node: StructLiteral): T;
  visitIfExpr(node: IfExpr): T;
  visitIntLiteral(node: IntLiteral): T;
  visitFloatLiteral(node: FloatLiteral): T;
  visitStringLiteral(node: StringLiteral): T;
  visitBoolLiteral(node: BoolLiteral): T;
  visitNullLiteral(node: NullLiteral): T;
  visitIdentifier(node: Identifier): T;
  visitMoveExpr(node: MoveExpr): T;
  visitCatchExpr(node: CatchExpr): T;
  visitThrowExpr(node: ThrowExpr): T;
  visitGroupExpr(node: GroupExpr): T;
  visitIncrementExpr(node: IncrementExpr): T;
  visitDecrementExpr(node: DecrementExpr): T;
  visitRangeExpr(node: RangeExpr): T;
}
