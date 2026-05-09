/**
 * Position validation for `ref T` / `readonly ref T` type annotations.
 *
 * Per `docs/design/ref-redesign.md` §2.1, `ref T` is legal in:
 *   - function/method parameter types,
 *   - `unsafe struct` field types.
 *
 * It is rejected in every other position so the lifetime-safety rule
 * collapses to a syntactic check (no borrow analysis needed). Concretely:
 *   - return types (any function or method),
 *   - safe `struct` field types,
 *   - local variable bindings (`let x: ref T = …`),
 *   - generic argument positions in safe code (e.g. `List<ref T>`),
 *   - array/collection element types,
 *   - `static` global types.
 *
 * Each violation is reported as a checker error with a span pointing at
 * the offending RefType node. The checker continues validating other
 * positions to surface as many errors as possible per pass.
 */

import type {
  Declaration,
  EnumDecl,
  FunctionDecl,
  Param,
  Program,
  StaticDecl,
  StructDecl,
  TypeNode,
  UnsafeStructDecl,
} from "../ast/nodes";
import type { Span } from "../lexer/token";

/**
 * Raw `(message, span)` pair. Returned to the `Checker` so it can route
 * each through the diagnostics module (which knows how to convert the
 * lexer `Span` into a `SourceLocation` via the source file). Avoids the
 * historical fake `{file: "", line: 1, column: 1}` placeholder this
 * pass used to fabricate.
 */
export interface RefPositionError {
  message: string;
  span: Span;
}

export function validateRefPositions(program: Program): RefPositionError[] {
  const diags: RefPositionError[] = [];
  for (const decl of program.declarations) {
    visitDeclaration(decl, diags);
  }
  return diags;
}

function visitDeclaration(decl: Declaration, diags: RefPositionError[]): void {
  switch (decl.kind) {
    case "FunctionDecl":
      visitFunction(decl, diags);
      return;
    case "ExternFunctionDecl":
      // extern fn params are FFI boundaries; treat them like normal fn params
      // (legal positions). Return types still must not be `ref T`.
      for (const p of decl.params) visitParam(p, diags);
      if (decl.returnType) rejectRef(decl.returnType, "function return type", diags);
      return;
    case "StructDecl":
      visitStruct(decl, diags);
      return;
    case "UnsafeStructDecl":
      visitUnsafeStruct(decl, diags);
      return;
    case "EnumDecl":
      visitEnum(decl, diags);
      return;
    case "StaticDecl":
      visitStatic(decl, diags);
      return;
    case "TypeAlias":
      // `type X = ref T;` would be a way to smuggle `ref T` past the
      // surface restrictions. Reject it.
      rejectRef(decl.typeValue, "type alias", diags);
      return;
    case "ImportDecl":
      return;
  }
}

function visitFunction(decl: FunctionDecl, diags: RefPositionError[]): void {
  for (const p of decl.params) visitParam(p, diags);
  if (decl.returnType) rejectRef(decl.returnType, "function return type", diags);
  for (const t of decl.throwsTypes) rejectRef(t, "throws clause", diags);
  // Body local bindings: walked in stmt-checker via visitTypeAnnotation. To
  // keep this pass purely surface-level we re-walk here too — duplicate
  // diagnostics are harmless, and this lets the AST validation run
  // independently of full checking.
  for (const stmt of decl.body.statements) visitStatementForRef(stmt, diags);
}

function visitParam(param: Param, diags: RefPositionError[]): void {
  // Top-level `ref T` is legal here. Only reject ref T NESTED inside a
  // generic argument or pointer pointee (where it would escape the param
  // position).
  visitTypeForNested(param.typeAnnotation, diags);
}

function visitStruct(decl: StructDecl, diags: RefPositionError[]): void {
  for (const f of decl.fields) {
    rejectRef(f.typeAnnotation, "safe struct field", diags);
    visitTypeForNested(f.typeAnnotation, diags);
  }
  for (const m of decl.methods) visitFunction(m, diags);
}

function visitUnsafeStruct(decl: UnsafeStructDecl, diags: RefPositionError[]): void {
  for (const f of decl.fields) {
    // Top-level `ref T` is legal; reject nested-only.
    visitTypeForNested(f.typeAnnotation, diags);
  }
  for (const m of decl.methods) visitFunction(m, diags);
}

function visitEnum(decl: EnumDecl, diags: RefPositionError[]): void {
  for (const v of decl.variants) {
    for (const f of v.fields) {
      rejectRef(f.typeAnnotation, "enum variant field", diags);
      visitTypeForNested(f.typeAnnotation, diags);
    }
  }
}

function visitStatic(decl: StaticDecl, diags: RefPositionError[]): void {
  if (decl.typeAnnotation) {
    rejectRef(decl.typeAnnotation, "static global type", diags);
  }
}

/**
 * Reject `ref T` at the top of the given type annotation. Used at every
 * position that forbids `ref T` outright.
 */
function rejectRef(node: TypeNode, position: string, diags: RefPositionError[]): void {
  if (node.kind === "RefType") {
    pushError(`'ref T' is not allowed in ${position}`, node, diags);
  }
}

/**
 * Walk a type annotation looking for `ref T` in positions where it cannot
 * appear regardless of context: as a generic argument, as a pointer
 * pointee, or inside a nullable. The top-level annotation is the caller's
 * responsibility.
 */
function visitTypeForNested(node: TypeNode, diags: RefPositionError[]): void {
  switch (node.kind) {
    case "NamedType":
      return;
    case "GenericType":
      for (const arg of node.typeArgs) {
        if (arg.kind === "RefType") {
          pushError("'ref T' is not allowed in generic argument position", arg, diags);
        }
        visitTypeForNested(arg, diags);
      }
      return;
    case "RefType":
      // Top-level RefType — caller decides whether this is legal here.
      // Recurse into pointee in case there's a nested ref-of-generic.
      visitTypeForNested(node.pointee, diags);
      return;
    case "RawPtrType":
      if (node.pointee.kind === "RefType") {
        pushError("'ref T' is not allowed as a raw pointer pointee", node.pointee, diags);
      }
      visitTypeForNested(node.pointee, diags);
      return;
  }
}

/**
 * Walk statements in a function body to find `let x: ref T` and reject.
 */
function visitStatementForRef(
  stmt: import("../ast/nodes").Statement,
  diags: RefPositionError[]
): void {
  switch (stmt.kind) {
    case "LetStmt":
    case "ConstStmt":
      if (stmt.typeAnnotation) {
        rejectRef(stmt.typeAnnotation, "local binding", diags);
        visitTypeForNested(stmt.typeAnnotation, diags);
      }
      return;
    case "BlockStmt":
      for (const s of stmt.statements) visitStatementForRef(s, diags);
      return;
    case "IfStmt":
      for (const s of stmt.thenBlock.statements) visitStatementForRef(s, diags);
      if (stmt.elseBlock?.kind === "BlockStmt") {
        for (const s of stmt.elseBlock.statements) visitStatementForRef(s, diags);
      } else if (stmt.elseBlock?.kind === "IfStmt") {
        visitStatementForRef(stmt.elseBlock, diags);
      }
      return;
    case "WhileStmt":
      for (const s of stmt.body.statements) visitStatementForRef(s, diags);
      return;
    case "ForStmt":
      for (const s of stmt.body.statements) visitStatementForRef(s, diags);
      return;
    case "CForStmt":
      visitStatementForRef(stmt.init, diags);
      for (const s of stmt.body.statements) visitStatementForRef(s, diags);
      return;
    case "SwitchStmt":
      for (const c of stmt.cases) {
        for (const s of c.body) visitStatementForRef(s, diags);
      }
      return;
    case "DeferStmt":
      visitStatementForRef(stmt.statement, diags);
      return;
    case "UnsafeBlock":
      for (const s of stmt.body.statements) visitStatementForRef(s, diags);
      return;
    default:
      return;
  }
}

function pushError(message: string, node: { span: Span }, diags: RefPositionError[]): void {
  diags.push({ message, span: node.span });
}
