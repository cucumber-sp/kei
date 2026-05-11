/**
 * Bake — produce a fully-substituted AST clone of a generic declaration.
 *
 * Path A (revised) of the Monomorphization migration (see
 * `docs/design/monomorphization-module.md` §4). The bake operation is
 * structured as two cooperating halves:
 *
 * 1. **AST clone (this file, pure).** A walker over the template
 *    `Declaration` produces a fresh AST subtree. Every nested
 *    `Expression`, `Statement`, `TypeNode`, and decl-internal node
 *    (`Param`, `Field`, `EnumVariant`, …) gets a new identity. The clone
 *    walker writes *no* type-side-map entries — it produces pure AST.
 *
 * 2. **Body type-check (`Checker.checkBody`, populates the global maps
 *    by clone identity).** Monomorphization's pass-3 driver
 *    (`checkBodies`) calls `checker.checkBody(clonedDecl, typeSubs)`
 *    against the cloned AST, with the substitution map passed in
 *    explicitly. The checker walks the clone with
 *    `typeResolver.setSubstitutions(typeSubs)` set; `setExprType`
 *    populates `Checker.typeMap` keyed by the cloned expression nodes.
 *
 * **Why no Type-node substitution inline.** AST type annotations are
 * `TypeNode`s (surface syntax), not `Type`s (checker internals). The
 * checker's `TypeResolver.setSubstitutions(typeSubs)` performs the
 * `T → i32` substitution by name during type-resolution of the clone —
 * so there's no need to rewrite the AST type nodes themselves. The
 * resulting `Type` ends up in `Checker.typeMap` keyed by the cloned
 * expression nodes, and KIR lowering reads from there.
 *
 * **`genericParams` on the clone is empty.** The baked decl is
 * concrete; downstream consumers gate on `genericParams.length > 0` to
 * decide "is this a template I should skip?", so the clone must say
 * "I am not a template."
 *
 * **Spans on cloned nodes point at the template.** Per design doc §4 /
 * §9, the instantiation site goes into diagnostic `secondarySpans` at
 * error-emission time, not onto the AST node.
 */

import type {
  ArrayLiteral,
  AssignExpr,
  BinaryExpr,
  BlockStmt,
  BoolLiteral,
  CallExpr,
  CastExpr,
  CatchClause,
  CatchExpr,
  Declaration,
  DerefExpr,
  EnumDecl,
  EnumVariant,
  Expression,
  Field,
  FieldInit,
  FloatLiteral,
  FunctionDecl,
  GroupExpr,
  Identifier,
  IfExpr,
  IfStmt,
  IndexExpr,
  IntLiteral,
  MemberExpr,
  MoveExpr,
  NullLiteral,
  Param,
  RangeExpr,
  Statement,
  StringLiteral,
  StructDecl,
  StructLiteral,
  SwitchCase,
  SwitchExpr,
  ThrowExpr,
  TypeNode,
  UnaryExpr,
  UnsafeBlock,
  UnsafeExpr,
  UnsafeStructDecl,
} from "../ast/nodes";
import type { Type } from "../checker/types";

// The substitution map is accepted as a parameter for forward-compatibility
// with name-mangling of nested generic references (see §4 walker scope).
// Today the bake walker is a deep clone; substitution is performed by the
// checker re-walk under `typeResolver.setSubstitutions(typeSubs)`.
// `substitutionMap` is unused for now but kept on the signature so
// downstream extensions (e.g. mangling `Bar<T>` → `Bar_i32` at the AST
// level for diagnostics) have a place to plug in.
export function bake(decl: Declaration, substitutionMap: Map<string, Type>): Declaration {
  // Suppress unused-param lint without changing the public signature.
  void substitutionMap;
  return cloneDeclaration(decl);
}

// ─── Declaration cloning ─────────────────────────────────────────────────

function cloneDeclaration(decl: Declaration): Declaration {
  switch (decl.kind) {
    case "FunctionDecl":
      return cloneFunctionDecl(decl);
    case "StructDecl":
      return cloneStructDecl(decl);
    case "UnsafeStructDecl":
      return cloneUnsafeStructDecl(decl);
    case "EnumDecl":
      return cloneEnumDecl(decl);
    case "ExternFunctionDecl":
    case "TypeAlias":
    case "ImportDecl":
    case "StaticDecl":
      // Non-generic declaration shapes never reach the baker (they're not
      // monomorphizable). Returning a shallow copy keeps the function total
      // for the discriminated union.
      return { ...decl };
  }
}

function cloneFunctionDecl(decl: FunctionDecl): FunctionDecl {
  return {
    kind: "FunctionDecl",
    span: decl.span,
    name: decl.name,
    isPublic: decl.isPublic,
    // Baked decl is concrete — strip generic params so downstream
    // consumers don't mistake it for a template.
    genericParams: [],
    params: decl.params.map(cloneParam),
    returnType: decl.returnType === null ? null : cloneTypeNode(decl.returnType),
    throwsTypes: decl.throwsTypes.map(cloneTypeNode),
    body: cloneBlockStmt(decl.body),
  };
}

function cloneStructDecl(decl: StructDecl): StructDecl {
  return {
    kind: "StructDecl",
    span: decl.span,
    name: decl.name,
    isPublic: decl.isPublic,
    genericParams: [],
    fields: decl.fields.map(cloneField),
    methods: decl.methods.map(cloneFunctionDecl),
  };
}

function cloneUnsafeStructDecl(decl: UnsafeStructDecl): UnsafeStructDecl {
  return {
    kind: "UnsafeStructDecl",
    span: decl.span,
    name: decl.name,
    isPublic: decl.isPublic,
    genericParams: [],
    fields: decl.fields.map(cloneField),
    methods: decl.methods.map(cloneFunctionDecl),
  };
}

function cloneEnumDecl(decl: EnumDecl): EnumDecl {
  return {
    kind: "EnumDecl",
    span: decl.span,
    name: decl.name,
    isPublic: decl.isPublic,
    genericParams: [],
    baseType: decl.baseType === null ? null : cloneTypeNode(decl.baseType),
    variants: decl.variants.map(cloneEnumVariant),
  };
}

function cloneParam(p: Param): Param {
  return {
    kind: "Param",
    span: p.span,
    name: p.name,
    typeAnnotation: cloneTypeNode(p.typeAnnotation),
    isReadonly: p.isReadonly,
  };
}

function cloneField(f: Field): Field {
  return {
    kind: "Field",
    span: f.span,
    name: f.name,
    typeAnnotation: cloneTypeNode(f.typeAnnotation),
    isReadonly: f.isReadonly,
  };
}

function cloneEnumVariant(v: EnumVariant): EnumVariant {
  return {
    kind: "EnumVariant",
    span: v.span,
    name: v.name,
    fields: v.fields.map(cloneField),
    value: v.value === null ? null : cloneExpression(v.value),
  };
}

// ─── TypeNode cloning ────────────────────────────────────────────────────

function cloneTypeNode(node: TypeNode): TypeNode {
  switch (node.kind) {
    case "NamedType":
      return { kind: "NamedType", span: node.span, name: node.name };
    case "GenericType":
      return {
        kind: "GenericType",
        span: node.span,
        name: node.name,
        typeArgs: node.typeArgs.map(cloneTypeNode),
      };
    case "RefType":
      return {
        kind: "RefType",
        span: node.span,
        pointee: cloneTypeNode(node.pointee),
        readonly: node.readonly,
      };
    case "RawPtrType":
      return {
        kind: "RawPtrType",
        span: node.span,
        pointee: cloneTypeNode(node.pointee),
      };
  }
}

// ─── Statement cloning ───────────────────────────────────────────────────

function cloneStatement(stmt: Statement): Statement {
  switch (stmt.kind) {
    case "BlockStmt":
      return cloneBlockStmt(stmt);
    case "LetStmt":
      return {
        kind: "LetStmt",
        span: stmt.span,
        name: stmt.name,
        typeAnnotation: stmt.typeAnnotation === null ? null : cloneTypeNode(stmt.typeAnnotation),
        initializer: cloneExpression(stmt.initializer),
      };
    case "ConstStmt":
      return {
        kind: "ConstStmt",
        span: stmt.span,
        name: stmt.name,
        typeAnnotation: stmt.typeAnnotation === null ? null : cloneTypeNode(stmt.typeAnnotation),
        initializer: cloneExpression(stmt.initializer),
      };
    case "ReturnStmt":
      return {
        kind: "ReturnStmt",
        span: stmt.span,
        value: stmt.value === null ? null : cloneExpression(stmt.value),
      };
    case "IfStmt":
      return cloneIfStmt(stmt);
    case "WhileStmt":
      return {
        kind: "WhileStmt",
        span: stmt.span,
        condition: cloneExpression(stmt.condition),
        body: cloneBlockStmt(stmt.body),
      };
    case "ForStmt":
      return {
        kind: "ForStmt",
        span: stmt.span,
        variable: stmt.variable,
        index: stmt.index,
        iterable: cloneExpression(stmt.iterable),
        body: cloneBlockStmt(stmt.body),
      };
    case "CForStmt":
      return {
        kind: "CForStmt",
        span: stmt.span,
        // LetStmt is a Statement; widen-then-narrow to satisfy the LetStmt
        // field on CForStmt.
        init: cloneStatement(stmt.init) as typeof stmt.init,
        condition: cloneExpression(stmt.condition),
        update: cloneExpression(stmt.update),
        body: cloneBlockStmt(stmt.body),
      };
    case "SwitchStmt":
      return {
        kind: "SwitchStmt",
        span: stmt.span,
        subject: cloneExpression(stmt.subject),
        cases: stmt.cases.map(cloneSwitchCase),
      };
    case "DeferStmt":
      return {
        kind: "DeferStmt",
        span: stmt.span,
        statement: cloneStatement(stmt.statement),
      };
    case "BreakStmt":
      return { kind: "BreakStmt", span: stmt.span };
    case "ContinueStmt":
      return { kind: "ContinueStmt", span: stmt.span };
    case "ExprStmt":
      return {
        kind: "ExprStmt",
        span: stmt.span,
        expression: cloneExpression(stmt.expression),
      };
    case "AssertStmt":
      return {
        kind: "AssertStmt",
        span: stmt.span,
        condition: cloneExpression(stmt.condition),
        message: stmt.message === null ? null : cloneExpression(stmt.message),
      };
    case "RequireStmt":
      return {
        kind: "RequireStmt",
        span: stmt.span,
        condition: cloneExpression(stmt.condition),
        message: stmt.message === null ? null : cloneExpression(stmt.message),
      };
    case "UnsafeBlock":
      return cloneUnsafeBlock(stmt);
  }
}

function cloneBlockStmt(block: BlockStmt): BlockStmt {
  return {
    kind: "BlockStmt",
    span: block.span,
    statements: block.statements.map(cloneStatement),
  };
}

function cloneIfStmt(stmt: IfStmt): IfStmt {
  const elseBlock = stmt.elseBlock;
  let clonedElse: BlockStmt | IfStmt | null;
  if (elseBlock === null) {
    clonedElse = null;
  } else if (elseBlock.kind === "BlockStmt") {
    clonedElse = cloneBlockStmt(elseBlock);
  } else {
    clonedElse = cloneIfStmt(elseBlock);
  }
  return {
    kind: "IfStmt",
    span: stmt.span,
    condition: cloneExpression(stmt.condition),
    thenBlock: cloneBlockStmt(stmt.thenBlock),
    elseBlock: clonedElse,
  };
}

function cloneSwitchCase(c: SwitchCase): SwitchCase {
  return {
    kind: "SwitchCase",
    span: c.span,
    values: c.values.map(cloneExpression),
    bindings: c.bindings === null ? null : [...c.bindings],
    body: c.body.map(cloneStatement),
    isDefault: c.isDefault,
  };
}

function cloneUnsafeBlock(stmt: UnsafeBlock): UnsafeBlock {
  return {
    kind: "UnsafeBlock",
    span: stmt.span,
    body: cloneBlockStmt(stmt.body),
  };
}

// ─── Expression cloning ──────────────────────────────────────────────────

function cloneExpression(expr: Expression): Expression {
  switch (expr.kind) {
    case "BinaryExpr": {
      const e: BinaryExpr = {
        kind: "BinaryExpr",
        span: expr.span,
        left: cloneExpression(expr.left),
        operator: expr.operator,
        right: cloneExpression(expr.right),
      };
      return e;
    }
    case "UnaryExpr": {
      const e: UnaryExpr = {
        kind: "UnaryExpr",
        span: expr.span,
        operator: expr.operator,
        operand: cloneExpression(expr.operand),
      };
      return e;
    }
    case "CallExpr": {
      const e: CallExpr = {
        kind: "CallExpr",
        span: expr.span,
        callee: cloneExpression(expr.callee),
        typeArgs: expr.typeArgs.map(cloneTypeNode),
        args: expr.args.map(cloneExpression),
      };
      return e;
    }
    case "MemberExpr": {
      const e: MemberExpr = {
        kind: "MemberExpr",
        span: expr.span,
        object: cloneExpression(expr.object),
        property: expr.property,
        typeArgs: expr.typeArgs === undefined ? undefined : expr.typeArgs.map(cloneTypeNode),
      };
      return e;
    }
    case "IndexExpr": {
      const e: IndexExpr = {
        kind: "IndexExpr",
        span: expr.span,
        object: cloneExpression(expr.object),
        index: cloneExpression(expr.index),
      };
      return e;
    }
    case "DerefExpr": {
      const e: DerefExpr = {
        kind: "DerefExpr",
        span: expr.span,
        operand: cloneExpression(expr.operand),
      };
      return e;
    }
    case "AssignExpr": {
      const e: AssignExpr = {
        kind: "AssignExpr",
        span: expr.span,
        target: cloneExpression(expr.target),
        operator: expr.operator,
        value: cloneExpression(expr.value),
      };
      return e;
    }
    case "StructLiteral": {
      const e: StructLiteral = {
        kind: "StructLiteral",
        span: expr.span,
        name: expr.name,
        typeArgs: expr.typeArgs.map(cloneTypeNode),
        fields: expr.fields.map(cloneFieldInit),
      };
      return e;
    }
    case "IfExpr": {
      const e: IfExpr = {
        kind: "IfExpr",
        span: expr.span,
        condition: cloneExpression(expr.condition),
        thenBlock: cloneBlockStmt(expr.thenBlock),
        elseBlock: cloneBlockStmt(expr.elseBlock),
      };
      return e;
    }
    case "IntLiteral": {
      const e: IntLiteral = {
        kind: "IntLiteral",
        span: expr.span,
        value: expr.value,
        suffix: expr.suffix,
      };
      return e;
    }
    case "FloatLiteral": {
      const e: FloatLiteral = {
        kind: "FloatLiteral",
        span: expr.span,
        value: expr.value,
        suffix: expr.suffix,
      };
      return e;
    }
    case "StringLiteral": {
      const e: StringLiteral = {
        kind: "StringLiteral",
        span: expr.span,
        value: expr.value,
      };
      return e;
    }
    case "BoolLiteral": {
      const e: BoolLiteral = {
        kind: "BoolLiteral",
        span: expr.span,
        value: expr.value,
      };
      return e;
    }
    case "NullLiteral": {
      const e: NullLiteral = { kind: "NullLiteral", span: expr.span };
      return e;
    }
    case "Identifier": {
      const e: Identifier = {
        kind: "Identifier",
        span: expr.span,
        name: expr.name,
      };
      return e;
    }
    case "MoveExpr": {
      const e: MoveExpr = {
        kind: "MoveExpr",
        span: expr.span,
        operand: cloneExpression(expr.operand),
      };
      return e;
    }
    case "CatchExpr": {
      const e: CatchExpr = {
        kind: "CatchExpr",
        span: expr.span,
        operand: cloneExpression(expr.operand),
        catchType: expr.catchType,
        clauses: expr.clauses.map(cloneCatchClause),
      };
      return e;
    }
    case "ThrowExpr": {
      const e: ThrowExpr = {
        kind: "ThrowExpr",
        span: expr.span,
        value: cloneExpression(expr.value),
      };
      return e;
    }
    case "GroupExpr": {
      const e: GroupExpr = {
        kind: "GroupExpr",
        span: expr.span,
        expression: cloneExpression(expr.expression),
      };
      return e;
    }
    case "RangeExpr": {
      const e: RangeExpr = {
        kind: "RangeExpr",
        span: expr.span,
        start: cloneExpression(expr.start),
        end: cloneExpression(expr.end),
        inclusive: expr.inclusive,
      };
      return e;
    }
    case "UnsafeExpr": {
      const e: UnsafeExpr = {
        kind: "UnsafeExpr",
        span: expr.span,
        body: cloneBlockStmt(expr.body),
      };
      return e;
    }
    case "CastExpr": {
      const e: CastExpr = {
        kind: "CastExpr",
        span: expr.span,
        operand: cloneExpression(expr.operand),
        targetType: cloneTypeNode(expr.targetType),
      };
      return e;
    }
    case "ArrayLiteral": {
      const e: ArrayLiteral = {
        kind: "ArrayLiteral",
        span: expr.span,
        elements: expr.elements.map(cloneExpression),
      };
      return e;
    }
    case "SwitchExpr": {
      const e: SwitchExpr = {
        kind: "SwitchExpr",
        span: expr.span,
        subject: cloneExpression(expr.subject),
        cases: expr.cases.map(cloneSwitchCase),
      };
      return e;
    }
  }
}

function cloneFieldInit(f: FieldInit): FieldInit {
  return {
    kind: "FieldInit",
    span: f.span,
    name: f.name,
    value: cloneExpression(f.value),
  };
}

function cloneCatchClause(c: CatchClause): CatchClause {
  return {
    kind: "CatchClause",
    span: c.span,
    errorType: c.errorType,
    varName: c.varName,
    body: c.body.map(cloneStatement),
    isDefault: c.isDefault,
  };
}
