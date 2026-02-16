/**
 * AST → KIR lowering pass.
 *
 * Takes a type-checked AST (Program + CheckResult) and produces a KirModule.
 * Uses simple per-block variable tracking (no phi nodes / full SSA yet).
 */

import type { CheckResult, MultiModuleCheckResult, ModuleCheckInfo } from "../checker/checker.ts";
import type {
  Type,
  IntType,
  FloatType,
  StructType,
  EnumType,
  FunctionType,
} from "../checker/types.ts";
import { TypeKind, I32_TYPE, typeToString, typesEqual } from "../checker/types.ts";
import type {
  Program,
  Declaration,
  FunctionDecl,
  ExternFunctionDecl,
  StructDecl,
  UnsafeStructDecl,
  EnumDecl,
  StaticDecl,
  Statement,
  BlockStmt,
  LetStmt,
  ConstStmt,
  ReturnStmt,
  IfStmt,
  WhileStmt,
  ForStmt,
  SwitchStmt,
  ExprStmt,
  AssertStmt,
  RequireStmt,
  Expression,
  BinaryExpr,
  UnaryExpr,
  CallExpr,
  MemberExpr,
  IndexExpr,
  AssignExpr,
  StructLiteral,
  IntLiteral,
  FloatLiteral,
  StringLiteral,
  BoolLiteral,
  Identifier,
  IfExpr,
  IncrementExpr,
  DecrementExpr,
  GroupExpr,
  RangeExpr,
  MoveExpr,
} from "../ast/nodes.ts";
import type {
  KirModule,
  KirFunction,
  KirBlock,
  KirInst,
  KirTerminator,
  KirType,
  KirParam,
  KirExtern,
  KirTypeDecl,
  KirGlobal,
  VarId,
  BlockId,
  BinOp,
  KirIntType,
  KirFloatType,
} from "./kir-types.ts";

// ─── Scope variable tracking for lifecycle ───────────────────────────────────

interface ScopeVar {
  name: string;
  varId: VarId;
  structName: string; // struct type name (for __destroy/__oncopy dispatch)
}

// ─── Lowerer ─────────────────────────────────────────────────────────────────

export class KirLowerer {
  private program: Program;
  private checkResult: CheckResult;

  // Current function state
  private blocks: KirBlock[] = [];
  private currentBlockId: BlockId = "entry";
  private currentInsts: KirInst[] = [];
  private varCounter = 0;
  private blockCounter = 0;

  // Variable name → current SSA VarId mapping per scope
  private varMap: Map<string, VarId> = new Map();

  // Track break/continue targets for loops
  private loopBreakTarget: BlockId | null = null;
  private loopContinueTarget: BlockId | null = null;

  // Scope stack for lifecycle tracking: each scope has a list of vars needing destroy
  private scopeStack: ScopeVar[][] = [];

  // Set of variable names that have been moved (no destroy on scope exit)
  private movedVars: Set<string> = new Set();

  // Map from struct name → whether it has __destroy/__oncopy methods
  private structLifecycleCache: Map<string, { hasDestroy: boolean; hasOncopy: boolean }> = new Map();

  // Collected module-level items
  private functions: KirFunction[] = [];
  private externs: KirExtern[] = [];
  private typeDecls: KirTypeDecl[] = [];
  private globals: KirGlobal[] = [];

  // Track which function names are overloaded (name → count of declarations)
  private overloadedNames: Set<string> = new Set();

  /** Module prefix for name mangling in multi-module builds (e.g. "math" → "math_add") */
  private modulePrefix: string = "";

  /** Map of imported function names → their mangled names (e.g. "add" → "math_add") */
  private importedNames: Map<string, string> = new Map();

  constructor(program: Program, checkResult: CheckResult, modulePrefix: string = "", importedNames?: Map<string, string>) {
    this.program = program;
    this.checkResult = checkResult;
    this.modulePrefix = modulePrefix;
    if (importedNames) this.importedNames = importedNames;
  }

  lower(): KirModule {
    // Detect which function names are overloaded
    const funcNameCounts = new Map<string, number>();
    for (const decl of this.program.declarations) {
      if (decl.kind === "FunctionDecl") {
        funcNameCounts.set(decl.name, (funcNameCounts.get(decl.name) ?? 0) + 1);
      }
    }
    for (const [name, count] of funcNameCounts) {
      if (count > 1) this.overloadedNames.add(name);
    }
    // Built-in overloaded names
    this.overloadedNames.add("print");

    for (const decl of this.program.declarations) {
      this.lowerDeclaration(decl);
    }

    return {
      name: "main",
      globals: this.globals,
      functions: this.functions,
      types: this.typeDecls,
      externs: this.externs,
    };
  }

  // ─── Declarations ────────────────────────────────────────────────────────

  private lowerDeclaration(decl: Declaration): void {
    switch (decl.kind) {
      case "FunctionDecl":
        this.functions.push(this.lowerFunction(decl));
        break;
      case "ExternFunctionDecl":
        this.externs.push(this.lowerExternFunction(decl));
        break;
      case "StructDecl":
      case "UnsafeStructDecl":
        this.typeDecls.push(this.lowerStructDecl(decl));
        // Lower methods as top-level functions with mangled names
        for (const method of decl.methods) {
          const structPrefix = this.modulePrefix ? `${this.modulePrefix}_${decl.name}` : decl.name;
          const mangledName = `${structPrefix}_${method.name}`;
          this.functions.push(this.lowerMethod(method, mangledName, decl.name));
        }
        break;
      case "EnumDecl":
        this.typeDecls.push(this.lowerEnumDecl(decl));
        break;
      case "StaticDecl":
        this.globals.push(this.lowerStaticDecl(decl));
        break;
      case "TypeAlias":
      case "ImportDecl":
        // No KIR output needed
        break;
    }
  }

  private lowerFunction(decl: FunctionDecl): KirFunction {
    // Reset per-function state
    this.blocks = [];
    this.currentInsts = [];
    this.varCounter = 0;
    this.blockCounter = 0;
    this.varMap = new Map();
    this.currentBlockId = "entry";
    this.loopBreakTarget = null;
    this.loopContinueTarget = null;
    this.scopeStack = [];
    this.movedVars = new Set();

    // Push function-level scope
    this.pushScope();

    const params: KirParam[] = decl.params.map((p) => {
      const type = this.resolveParamType(decl, p.name);
      const varId = `%${p.name}`;
      this.varMap.set(p.name, varId);
      return { name: p.name, type };
    });

    // Track params with lifecycle hooks for destroy on function exit
    for (const p of decl.params) {
      const checkerType = this.resolveParamCheckerType(decl, p.name);
      this.trackScopeVarByType(p.name, `%${p.name}`, checkerType);
    }

    const returnType = this.lowerCheckerType(
      this.getFunctionReturnType(decl)
    );

    // Lower body
    this.lowerBlock(decl.body);

    // Emit destroy for function-scope variables before implicit return
    if (!this.isBlockTerminated()) {
      this.popScopeWithDestroy();
    } else {
      this.scopeStack.pop(); // discard without emitting (already returned)
    }

    // Ensure the last block has a terminator
    this.ensureTerminator(returnType);

    // Seal last block
    this.sealCurrentBlock();

    // Use mangled name for overloaded functions, and apply module prefix
    let funcName: string;
    if (this.overloadedNames.has(decl.name)) {
      const baseName = this.modulePrefix
        ? `${this.modulePrefix}_${decl.name}`
        : decl.name;
      funcName = this.mangleFunctionName(baseName, decl);
    } else if (this.modulePrefix && decl.name !== "main") {
      funcName = `${this.modulePrefix}_${decl.name}`;
    } else {
      funcName = decl.name;
    }

    return {
      name: funcName,
      params,
      returnType,
      blocks: this.blocks,
      localCount: this.varCounter,
    };
  }

  private lowerMethod(decl: FunctionDecl, mangledName: string, structName: string): KirFunction {
    // Reset per-function state
    this.blocks = [];
    this.currentInsts = [];
    this.varCounter = 0;
    this.blockCounter = 0;
    this.varMap = new Map();
    this.currentBlockId = "entry";
    this.loopBreakTarget = null;
    this.loopContinueTarget = null;
    this.scopeStack = [];
    this.movedVars = new Set();

    // Push function-level scope
    this.pushScope();

    const params: KirParam[] = decl.params.map((p) => {
      const type = this.resolveParamType(decl, p.name);
      // The self parameter is passed as a pointer to the struct
      const paramType: KirType =
        p.name === "self" || type.kind === "struct"
          ? { kind: "ptr", pointee: type }
          : type;
      const varId = `%${p.name}`;
      this.varMap.set(p.name, varId);
      return { name: p.name, type: paramType };
    });

    const returnType = this.lowerCheckerType(
      this.getFunctionReturnType(decl)
    );

    // Lower body
    this.lowerBlock(decl.body);

    // Emit destroy for function-scope variables before implicit return
    if (!this.isBlockTerminated()) {
      this.popScopeWithDestroy();
    } else {
      this.scopeStack.pop();
    }

    // Ensure the last block has a terminator
    this.ensureTerminator(returnType);

    // Seal last block
    this.sealCurrentBlock();

    return {
      name: mangledName,
      params,
      returnType,
      blocks: this.blocks,
      localCount: this.varCounter,
    };
  }

  private lowerExternFunction(decl: ExternFunctionDecl): KirExtern {
    const params: KirParam[] = decl.params.map((p) => ({
      name: p.name,
      type: this.lowerTypeNode(p.typeAnnotation),
    }));

    const returnType = decl.returnType
      ? this.lowerTypeNode(decl.returnType)
      : ({ kind: "void" } as KirType);

    return { name: decl.name, params, returnType };
  }

  private lowerStructDecl(decl: StructDecl | UnsafeStructDecl): KirTypeDecl {
    const fields = decl.fields.map((f) => ({
      name: f.name,
      type: this.lowerTypeNode(f.typeAnnotation),
    }));

    return {
      name: decl.name,
      type: { kind: "struct", name: decl.name, fields },
    };
  }

  private lowerEnumDecl(decl: EnumDecl): KirTypeDecl {
    const variants = decl.variants.map((v) => ({
      name: v.name,
      fields: v.fields.map((f) => ({
        name: f.name,
        type: this.lowerTypeNode(f.typeAnnotation),
      })),
      value: v.value?.kind === "IntLiteral" ? v.value.value : null,
    }));

    return {
      name: decl.name,
      type: { kind: "enum", name: decl.name, variants },
    };
  }

  private lowerStaticDecl(decl: StaticDecl): KirGlobal {
    const type = decl.typeAnnotation
      ? this.lowerTypeNode(decl.typeAnnotation)
      : this.getExprKirType(decl.initializer);

    return {
      name: decl.name,
      type,
      initializer: null,
    };
  }

  // ─── Statements ──────────────────────────────────────────────────────────

  private lowerBlock(block: BlockStmt): void {
    for (const stmt of block.statements) {
      this.lowerStatement(stmt);
    }
  }

  /** Lower a block statement that introduces its own scope (e.g., nested { } blocks) */
  private lowerScopedBlock(block: BlockStmt): void {
    this.pushScope();
    for (const stmt of block.statements) {
      this.lowerStatement(stmt);
    }
    if (!this.isBlockTerminated()) {
      this.popScopeWithDestroy();
    } else {
      this.scopeStack.pop();
    }
  }

  private lowerStatement(stmt: Statement): void {
    // If current block is already terminated, skip
    if (this.isBlockTerminated()) return;

    switch (stmt.kind) {
      case "LetStmt":
        this.lowerLetStmt(stmt);
        break;
      case "ConstStmt":
        this.lowerConstStmt(stmt);
        break;
      case "ReturnStmt":
        this.lowerReturnStmt(stmt);
        break;
      case "IfStmt":
        this.lowerIfStmt(stmt);
        break;
      case "WhileStmt":
        this.lowerWhileStmt(stmt);
        break;
      case "ForStmt":
        this.lowerForStmt(stmt);
        break;
      case "SwitchStmt":
        this.lowerSwitchStmt(stmt);
        break;
      case "ExprStmt":
        this.lowerExprStmt(stmt);
        break;
      case "BlockStmt":
        this.lowerScopedBlock(stmt);
        break;
      case "BreakStmt":
        if (this.loopBreakTarget) {
          this.emitAllScopeDestroys();
          this.setTerminator({ kind: "jump", target: this.loopBreakTarget });
        }
        break;
      case "ContinueStmt":
        if (this.loopContinueTarget) {
          this.emitAllScopeDestroys();
          this.setTerminator({ kind: "jump", target: this.loopContinueTarget });
        }
        break;
      case "AssertStmt":
        this.lowerAssertStmt(stmt);
        break;
      case "RequireStmt":
        this.lowerRequireStmt(stmt);
        break;
      case "DeferStmt":
        // Defer is not yet implemented in KIR
        break;
      case "UnsafeBlock":
        this.lowerScopedBlock(stmt.body);
        break;
    }
  }

  private lowerLetStmt(stmt: LetStmt): void {
    const type = this.getExprKirType(stmt.initializer);
    const ptrId = this.freshVar();

    // stack_alloc
    this.emit({ kind: "stack_alloc", dest: ptrId, type });

    // Evaluate initializer
    const valueId = this.lowerExpr(stmt.initializer);

    // Emit oncopy if this is a copy of a struct with __oncopy (not a move)
    if (stmt.initializer.kind !== "MoveExpr") {
      const checkerType = this.checkResult.typeMap.get(stmt.initializer);
      const lifecycle = this.getStructLifecycle(checkerType);
      if (lifecycle?.hasOncopy) {
        this.emit({ kind: "oncopy", value: valueId, structName: lifecycle.structName });
      }
    }

    // store
    this.emit({ kind: "store", ptr: ptrId, value: valueId });

    // Map variable name to its stack pointer
    this.varMap.set(stmt.name, ptrId);

    // Track for scope-exit destroy
    this.trackScopeVar(stmt.name, ptrId, stmt.initializer);
  }

  private lowerConstStmt(stmt: ConstStmt): void {
    // Const is just like let but immutable — same lowering
    const valueId = this.lowerExpr(stmt.initializer);
    this.varMap.set(stmt.name, valueId);
  }

  private lowerReturnStmt(stmt: ReturnStmt): void {
    if (stmt.value) {
      const valueId = this.lowerExpr(stmt.value);
      // Emit destroys for all scope variables, but skip the returned variable
      const returnedVarName = stmt.value.kind === "Identifier" ? stmt.value.name : null;
      this.emitAllScopeDestroysExceptNamed(returnedVarName);
      this.setTerminator({ kind: "ret", value: valueId });
    } else {
      this.emitAllScopeDestroys();
      this.setTerminator({ kind: "ret_void" });
    }
  }

  private lowerIfStmt(stmt: IfStmt): void {
    const condId = this.lowerExpr(stmt.condition);
    const thenLabel = this.freshBlockId("if.then");
    const elseLabel = stmt.elseBlock
      ? this.freshBlockId("if.else")
      : this.freshBlockId("if.end");
    const endLabel = stmt.elseBlock
      ? this.freshBlockId("if.end")
      : elseLabel;

    this.setTerminator({
      kind: "br",
      cond: condId,
      thenBlock: thenLabel,
      elseBlock: stmt.elseBlock ? elseLabel : endLabel,
    });

    // Then block
    this.sealCurrentBlock();
    this.startBlock(thenLabel);
    this.lowerBlock(stmt.thenBlock);
    if (!this.isBlockTerminated()) {
      this.setTerminator({ kind: "jump", target: endLabel });
    }

    // Else block
    if (stmt.elseBlock) {
      this.sealCurrentBlock();
      this.startBlock(elseLabel);
      if (stmt.elseBlock.kind === "IfStmt") {
        this.lowerIfStmt(stmt.elseBlock);
      } else {
        this.lowerBlock(stmt.elseBlock);
      }
      if (!this.isBlockTerminated()) {
        this.setTerminator({ kind: "jump", target: endLabel });
      }
    }

    // End block
    this.sealCurrentBlock();
    this.startBlock(endLabel);
  }

  private lowerWhileStmt(stmt: WhileStmt): void {
    const headerLabel = this.freshBlockId("while.header");
    const bodyLabel = this.freshBlockId("while.body");
    const endLabel = this.freshBlockId("while.end");

    this.setTerminator({ kind: "jump", target: headerLabel });

    // Header: evaluate condition
    this.sealCurrentBlock();
    this.startBlock(headerLabel);
    const condId = this.lowerExpr(stmt.condition);
    this.setTerminator({
      kind: "br",
      cond: condId,
      thenBlock: bodyLabel,
      elseBlock: endLabel,
    });

    // Body
    this.sealCurrentBlock();
    this.startBlock(bodyLabel);

    const prevBreak = this.loopBreakTarget;
    const prevContinue = this.loopContinueTarget;
    this.loopBreakTarget = endLabel;
    this.loopContinueTarget = headerLabel;

    this.lowerBlock(stmt.body);

    this.loopBreakTarget = prevBreak;
    this.loopContinueTarget = prevContinue;

    if (!this.isBlockTerminated()) {
      this.setTerminator({ kind: "jump", target: headerLabel });
    }

    // End
    this.sealCurrentBlock();
    this.startBlock(endLabel);
  }

  private lowerForStmt(stmt: ForStmt): void {
    // For loops over ranges: for x in start..end { body }
    // Lower as: init → header (condition) → body → latch (increment) → header
    const initLabel = this.freshBlockId("for.init");
    const headerLabel = this.freshBlockId("for.header");
    const bodyLabel = this.freshBlockId("for.body");
    const latchLabel = this.freshBlockId("for.latch");
    const endLabel = this.freshBlockId("for.end");

    this.setTerminator({ kind: "jump", target: initLabel });

    // Init: evaluate iterable (range), set up loop var
    this.sealCurrentBlock();
    this.startBlock(initLabel);

    const iterableType = this.getExprKirType(stmt.iterable);

    // For range-based: iterable is a RangeExpr, we extract start/end
    if (stmt.iterable.kind === "RangeExpr") {
      const startId = this.lowerExpr(stmt.iterable.start);
      const endId = this.lowerExpr(stmt.iterable.end);

      // Allocate loop variable
      const loopVarType: KirType = { kind: "int", bits: 32, signed: true };
      const loopVarPtr = this.freshVar();
      this.emit({ kind: "stack_alloc", dest: loopVarPtr, type: loopVarType });
      this.emit({ kind: "store", ptr: loopVarPtr, value: startId });
      this.varMap.set(stmt.variable, loopVarPtr);

      // Index variable if present
      if (stmt.index) {
        const indexPtr = this.freshVar();
        const zeroId = this.freshVar();
        this.emit({ kind: "stack_alloc", dest: indexPtr, type: loopVarType });
        this.emit({ kind: "const_int", dest: zeroId, type: { kind: "int", bits: 32, signed: true }, value: 0 });
        this.emit({ kind: "store", ptr: indexPtr, value: zeroId });
        this.varMap.set(stmt.index, indexPtr);
      }

      this.setTerminator({ kind: "jump", target: headerLabel });

      // Header: check condition
      this.sealCurrentBlock();
      this.startBlock(headerLabel);
      const curVal = this.freshVar();
      this.emit({ kind: "load", dest: curVal, ptr: loopVarPtr, type: loopVarType });
      const condId = this.freshVar();
      this.emit({
        kind: "bin_op", op: "lt", dest: condId,
        lhs: curVal, rhs: endId,
        type: { kind: "bool" },
      });
      this.setTerminator({
        kind: "br",
        cond: condId,
        thenBlock: bodyLabel,
        elseBlock: endLabel,
      });

      // Body
      this.sealCurrentBlock();
      this.startBlock(bodyLabel);

      const prevBreak = this.loopBreakTarget;
      const prevContinue = this.loopContinueTarget;
      this.loopBreakTarget = endLabel;
      this.loopContinueTarget = latchLabel;

      this.lowerBlock(stmt.body);

      this.loopBreakTarget = prevBreak;
      this.loopContinueTarget = prevContinue;

      if (!this.isBlockTerminated()) {
        this.setTerminator({ kind: "jump", target: latchLabel });
      }

      // Latch: increment loop var
      this.sealCurrentBlock();
      this.startBlock(latchLabel);
      const curVal2 = this.freshVar();
      this.emit({ kind: "load", dest: curVal2, ptr: loopVarPtr, type: loopVarType });
      const oneId = this.freshVar();
      this.emit({ kind: "const_int", dest: oneId, type: { kind: "int", bits: 32, signed: true }, value: 1 });
      const nextVal = this.freshVar();
      this.emit({
        kind: "bin_op", op: "add", dest: nextVal,
        lhs: curVal2, rhs: oneId,
        type: loopVarType,
      });
      this.emit({ kind: "store", ptr: loopVarPtr, value: nextVal });

      // Increment index if present
      if (stmt.index) {
        const indexPtr = this.varMap.get(stmt.index)!;
        const idxVal = this.freshVar();
        this.emit({ kind: "load", dest: idxVal, ptr: indexPtr, type: loopVarType });
        const oneId2 = this.freshVar();
        this.emit({ kind: "const_int", dest: oneId2, type: { kind: "int", bits: 32, signed: true }, value: 1 });
        const nextIdx = this.freshVar();
        this.emit({
          kind: "bin_op", op: "add", dest: nextIdx,
          lhs: idxVal, rhs: oneId2,
          type: loopVarType,
        });
        this.emit({ kind: "store", ptr: indexPtr, value: nextIdx });
      }

      this.setTerminator({ kind: "jump", target: headerLabel });
    } else {
      // Fallback: just treat as a while-like loop with the iterable
      // This handles array/slice iteration in the future
      this.setTerminator({ kind: "jump", target: headerLabel });
      this.sealCurrentBlock();
      this.startBlock(headerLabel);
      this.setTerminator({ kind: "jump", target: endLabel });
    }

    // End
    this.sealCurrentBlock();
    this.startBlock(endLabel);
  }

  private lowerSwitchStmt(stmt: SwitchStmt): void {
    const subjectId = this.lowerExpr(stmt.subject);
    const endLabel = this.freshBlockId("switch.end");

    const caseLabels: { value: VarId; target: BlockId }[] = [];
    let defaultLabel = endLabel;
    const caseBlocks: { label: BlockId; stmts: Statement[]; isDefault: boolean }[] = [];

    for (const c of stmt.cases) {
      const label = c.isDefault
        ? this.freshBlockId("switch.default")
        : this.freshBlockId("switch.case");

      if (c.isDefault) {
        defaultLabel = label;
      }

      for (const val of c.values) {
        const valId = this.lowerExpr(val);
        caseLabels.push({ value: valId, target: label });
      }

      caseBlocks.push({ label, stmts: c.body, isDefault: c.isDefault });
    }

    this.setTerminator({
      kind: "switch",
      value: subjectId,
      cases: caseLabels,
      defaultBlock: defaultLabel,
    });

    // Emit case blocks
    for (const cb of caseBlocks) {
      this.sealCurrentBlock();
      this.startBlock(cb.label);
      for (const s of cb.stmts) {
        this.lowerStatement(s);
      }
      if (!this.isBlockTerminated()) {
        this.setTerminator({ kind: "jump", target: endLabel });
      }
    }

    this.sealCurrentBlock();
    this.startBlock(endLabel);
  }

  private lowerExprStmt(stmt: ExprStmt): void {
    this.lowerExpr(stmt.expression);
  }

  private lowerAssertStmt(stmt: AssertStmt): void {
    const condId = this.lowerExpr(stmt.condition);
    const msg = stmt.message?.kind === "StringLiteral"
      ? stmt.message.value
      : "assertion failed";
    this.emit({ kind: "assert_check", cond: condId, message: msg });
  }

  private lowerRequireStmt(stmt: RequireStmt): void {
    const condId = this.lowerExpr(stmt.condition);
    const msg = stmt.message?.kind === "StringLiteral"
      ? stmt.message.value
      : "requirement failed";
    this.emit({ kind: "require_check", cond: condId, message: msg });
  }

  // ─── Expressions ─────────────────────────────────────────────────────────

  private lowerExpr(expr: Expression): VarId {
    switch (expr.kind) {
      case "IntLiteral":
        return this.lowerIntLiteral(expr);
      case "FloatLiteral":
        return this.lowerFloatLiteral(expr);
      case "StringLiteral":
        return this.lowerStringLiteral(expr);
      case "BoolLiteral":
        return this.lowerBoolLiteral(expr);
      case "NullLiteral":
        return this.lowerNullLiteral();
      case "Identifier":
        return this.lowerIdentifier(expr);
      case "BinaryExpr":
        return this.lowerBinaryExpr(expr);
      case "UnaryExpr":
        return this.lowerUnaryExpr(expr);
      case "CallExpr":
        return this.lowerCallExpr(expr);
      case "MemberExpr":
        return this.lowerMemberExpr(expr);
      case "IndexExpr":
        return this.lowerIndexExpr(expr);
      case "AssignExpr":
        return this.lowerAssignExpr(expr);
      case "StructLiteral":
        return this.lowerStructLiteral(expr);
      case "IfExpr":
        return this.lowerIfExpr(expr);
      case "GroupExpr":
        return this.lowerExpr(expr.expression);
      case "IncrementExpr":
        return this.lowerIncrementExpr(expr);
      case "DecrementExpr":
        return this.lowerDecrementExpr(expr);
      case "MoveExpr":
        return this.lowerMoveExpr(expr);
      default:
        // Unhandled expression types return a placeholder
        return this.emitConstInt(0);
    }
  }

  private lowerIntLiteral(expr: IntLiteral): VarId {
    const dest = this.freshVar();
    const checkerType = this.checkResult.typeMap.get(expr);
    let type: KirIntType = { kind: "int", bits: 32, signed: true };
    if (checkerType?.kind === "int") {
      type = { kind: "int", bits: checkerType.bits, signed: checkerType.signed };
    }
    this.emit({ kind: "const_int", dest, type, value: expr.value });
    return dest;
  }

  private lowerFloatLiteral(expr: FloatLiteral): VarId {
    const dest = this.freshVar();
    const checkerType = this.checkResult.typeMap.get(expr);
    let type: KirFloatType = { kind: "float", bits: 64 };
    if (checkerType?.kind === "float") {
      type = { kind: "float", bits: checkerType.bits };
    }
    this.emit({ kind: "const_float", dest, type, value: expr.value });
    return dest;
  }

  private lowerStringLiteral(expr: StringLiteral): VarId {
    const dest = this.freshVar();
    this.emit({ kind: "const_string", dest, value: expr.value });
    return dest;
  }

  private lowerBoolLiteral(expr: BoolLiteral): VarId {
    const dest = this.freshVar();
    this.emit({ kind: "const_bool", dest, value: expr.value });
    return dest;
  }

  private lowerNullLiteral(): VarId {
    const dest = this.freshVar();
    this.emit({ kind: "const_null", dest, type: { kind: "ptr", pointee: { kind: "void" } } });
    return dest;
  }

  private lowerIdentifier(expr: Identifier): VarId {
    const varId = this.varMap.get(expr.name);
    if (!varId) {
      // Could be a function name or unknown — just return a symbolic reference
      return `%${expr.name}`;
    }

    // If the var is a stack_alloc pointer, load it
    // Check if it's a param (params don't need loading)
    if (varId.startsWith("%") && this.isStackAllocVar(varId)) {
      const dest = this.freshVar();
      const type = this.getExprKirType(expr);
      this.emit({ kind: "load", dest, ptr: varId, type });
      return dest;
    }

    return varId;
  }

  private lowerBinaryExpr(expr: BinaryExpr): VarId {
    // Short-circuit for logical AND/OR
    if (expr.operator === "&&") {
      return this.lowerShortCircuitAnd(expr);
    }
    if (expr.operator === "||") {
      return this.lowerShortCircuitOr(expr);
    }

    const lhs = this.lowerExpr(expr.left);
    const rhs = this.lowerExpr(expr.right);
    const dest = this.freshVar();

    const op = this.mapBinOp(expr.operator);
    if (op) {
      const type = this.getExprKirType(expr);
      this.emit({ kind: "bin_op", op, dest, lhs, rhs, type });
      return dest;
    }

    // Fallback
    return lhs;
  }

  private lowerShortCircuitAnd(expr: BinaryExpr): VarId {
    const lhs = this.lowerExpr(expr.left);
    const rhsLabel = this.freshBlockId("and.rhs");
    const endLabel = this.freshBlockId("and.end");

    this.setTerminator({ kind: "br", cond: lhs, thenBlock: rhsLabel, elseBlock: endLabel });

    this.sealCurrentBlock();
    this.startBlock(rhsLabel);
    const rhs = this.lowerExpr(expr.right);
    this.setTerminator({ kind: "jump", target: endLabel });

    this.sealCurrentBlock();
    this.startBlock(endLabel);

    // Without phi nodes, we use a stack_alloc + stores approach
    // For simplicity, just return rhs (correct when both paths converge)
    // In full SSA this would be a phi node
    return rhs;
  }

  private lowerShortCircuitOr(expr: BinaryExpr): VarId {
    const lhs = this.lowerExpr(expr.left);
    const rhsLabel = this.freshBlockId("or.rhs");
    const endLabel = this.freshBlockId("or.end");

    this.setTerminator({ kind: "br", cond: lhs, thenBlock: endLabel, elseBlock: rhsLabel });

    this.sealCurrentBlock();
    this.startBlock(rhsLabel);
    const rhs = this.lowerExpr(expr.right);
    this.setTerminator({ kind: "jump", target: endLabel });

    this.sealCurrentBlock();
    this.startBlock(endLabel);

    return lhs;
  }

  private lowerUnaryExpr(expr: UnaryExpr): VarId {
    const operand = this.lowerExpr(expr.operand);
    const dest = this.freshVar();

    switch (expr.operator) {
      case "-": {
        const type = this.getExprKirType(expr);
        this.emit({ kind: "neg", dest, operand, type });
        return dest;
      }
      case "!":
        this.emit({ kind: "not", dest, operand });
        return dest;
      case "~": {
        const type = this.getExprKirType(expr);
        this.emit({ kind: "bit_not", dest, operand, type });
        return dest;
      }
      default:
        return operand;
    }
  }

  private lowerCallExpr(expr: CallExpr): VarId {
    const args = expr.args.map((a) => this.lowerExpr(a));
    const resultType = this.getExprKirType(expr);
    const isVoid = resultType.kind === "void";

    // Get the function name
    let funcName: string;
    if (expr.callee.kind === "Identifier") {
      const baseName = expr.callee.name;
      // Check if this is an imported function that needs module-prefixed name
      const importedName = this.importedNames.get(baseName);
      const resolvedBase = importedName ?? baseName;

      // Mangle overloaded function calls using the resolved callee type
      if (this.overloadedNames.has(baseName)) {
        const calleeType = this.checkResult.typeMap.get(expr.callee);
        if (calleeType && calleeType.kind === "function") {
          funcName = this.mangleFunctionNameFromType(resolvedBase, calleeType as FunctionType);
        } else {
          funcName = resolvedBase;
        }
      } else {
        funcName = resolvedBase;
      }
    } else if (expr.callee.kind === "MemberExpr") {
      // Check if this is a module-qualified call: module.function(args)
      const objType = this.checkResult.typeMap.get(expr.callee.object);
      if (objType?.kind === "module") {
        // Module-qualified call: math.add(args) → math_add(args)
        const modulePath = objType.name; // e.g., "math" or "net.http"
        const modulePrefix = modulePath.replace(/\./g, "_");
        const callName = expr.callee.property;
        const baseMangledName = `${modulePrefix}_${callName}`;

        // Check if the function is overloaded
        const calleeResolvedType = this.checkResult.typeMap.get(expr.callee);
        if (calleeResolvedType && calleeResolvedType.kind === "function") {
          if (this.overloadedNames.has(callName)) {
            funcName = this.mangleFunctionNameFromType(baseMangledName, calleeResolvedType as FunctionType);
          } else {
            funcName = baseMangledName;
          }
        } else {
          funcName = baseMangledName;
        }
      } else {
        // Instance method call: obj.method(args) → StructName_method(obj, args)
        const objId = this.lowerExpr(expr.callee.object);
        const methodName = expr.callee.property;

        if (objType?.kind === "struct") {
          funcName = `${objType.name}_${methodName}`;
        } else {
          funcName = methodName;
        }

        if (isVoid) {
          this.emit({ kind: "call_void", func: funcName, args: [objId, ...args] });
          return objId; // void calls return nothing meaningful
        }

        const dest = this.freshVar();
        this.emit({ kind: "call", dest, func: funcName, args: [objId, ...args], type: resultType });
        return dest;
      }
    } else {
      funcName = "<unknown>";
    }

    if (isVoid) {
      this.emit({ kind: "call_void", func: funcName, args });
      return this.emitConstInt(0); // void calls; return a dummy
    }

    const dest = this.freshVar();
    this.emit({ kind: "call", dest, func: funcName, args, type: resultType });
    return dest;
  }

  private lowerMemberExpr(expr: MemberExpr): VarId {
    const baseId = this.lowerExpr(expr.object);
    const dest = this.freshVar();
    const resultType = this.getExprKirType(expr);

    // Get pointer to field, then load
    const ptrDest = this.freshVar();
    this.emit({ kind: "field_ptr", dest: ptrDest, base: baseId, field: expr.property, type: resultType });
    this.emit({ kind: "load", dest, ptr: ptrDest, type: resultType });
    return dest;
  }

  private lowerIndexExpr(expr: IndexExpr): VarId {
    const baseId = this.lowerExpr(expr.object);
    const indexId = this.lowerExpr(expr.index);
    const resultType = this.getExprKirType(expr);

    const ptrDest = this.freshVar();
    this.emit({ kind: "index_ptr", dest: ptrDest, base: baseId, index: indexId, type: resultType });

    const dest = this.freshVar();
    this.emit({ kind: "load", dest, ptr: ptrDest, type: resultType });
    return dest;
  }

  private lowerAssignExpr(expr: AssignExpr): VarId {
    const valueId = this.lowerExpr(expr.value);

    if (expr.target.kind === "Identifier") {
      const ptrId = this.varMap.get(expr.target.name);
      if (ptrId) {
        // Handle compound assignment operators
        if (expr.operator !== "=") {
          const op = this.mapCompoundAssignOp(expr.operator);
          if (op) {
            const currentVal = this.freshVar();
            const type = this.getExprKirType(expr.target);
            this.emit({ kind: "load", dest: currentVal, ptr: ptrId, type });
            const result = this.freshVar();
            this.emit({ kind: "bin_op", op, dest: result, lhs: currentVal, rhs: valueId, type });
            this.emit({ kind: "store", ptr: ptrId, value: result });
            return result;
          }
        }

        // For simple assignment to struct with lifecycle: destroy old, store new, oncopy new
        const checkerType = this.checkResult.typeMap.get(expr.target);
        const lifecycle = this.getStructLifecycle(checkerType);
        if (lifecycle?.hasDestroy) {
          // Load old value and destroy it
          const oldVal = this.freshVar();
          const type = this.getExprKirType(expr.target);
          this.emit({ kind: "load", dest: oldVal, ptr: ptrId, type });
          this.emit({ kind: "destroy", value: oldVal, structName: lifecycle.structName });
        }

        this.emit({ kind: "store", ptr: ptrId, value: valueId });

        // Oncopy the new value (unless it's a move)
        if (lifecycle?.hasOncopy && expr.value.kind !== "MoveExpr") {
          this.emit({ kind: "oncopy", value: valueId, structName: lifecycle.structName });
        }
      }
    } else if (expr.target.kind === "MemberExpr") {
      const baseId = this.lowerExpr(expr.target.object);
      const ptrDest = this.freshVar();
      const fieldType = this.getExprKirType(expr.target);
      this.emit({ kind: "field_ptr", dest: ptrDest, base: baseId, field: expr.target.property, type: fieldType });

      // Destroy old field value if it has lifecycle hooks
      const checkerType = this.checkResult.typeMap.get(expr.target);
      const lifecycle = this.getStructLifecycle(checkerType);
      if (lifecycle?.hasDestroy) {
        const oldVal = this.freshVar();
        this.emit({ kind: "load", dest: oldVal, ptr: ptrDest, type: fieldType });
        this.emit({ kind: "destroy", value: oldVal, structName: lifecycle.structName });
      }

      this.emit({ kind: "store", ptr: ptrDest, value: valueId });

      if (lifecycle?.hasOncopy && expr.value.kind !== "MoveExpr") {
        this.emit({ kind: "oncopy", value: valueId, structName: lifecycle.structName });
      }
    } else if (expr.target.kind === "IndexExpr") {
      const baseId = this.lowerExpr(expr.target.object);
      const indexId = this.lowerExpr(expr.target.index);
      const elemType = this.getExprKirType(expr.target);
      const ptrDest = this.freshVar();
      this.emit({ kind: "index_ptr", dest: ptrDest, base: baseId, index: indexId, type: elemType });
      this.emit({ kind: "store", ptr: ptrDest, value: valueId });
    }

    return valueId;
  }

  private lowerStructLiteral(expr: StructLiteral): VarId {
    const type = this.getExprKirType(expr);
    const ptrId = this.freshVar();
    this.emit({ kind: "stack_alloc", dest: ptrId, type });

    for (const field of expr.fields) {
      const valueId = this.lowerExpr(field.value);
      const fieldPtrId = this.freshVar();
      const fieldType = this.getExprKirType(field.value);
      this.emit({ kind: "field_ptr", dest: fieldPtrId, base: ptrId, field: field.name, type: fieldType });
      this.emit({ kind: "store", ptr: fieldPtrId, value: valueId });
    }

    return ptrId;
  }

  private lowerIfExpr(expr: IfExpr): VarId {
    const condId = this.lowerExpr(expr.condition);
    const resultType = this.getExprKirType(expr);

    const thenLabel = this.freshBlockId("ifexpr.then");
    const elseLabel = this.freshBlockId("ifexpr.else");
    const endLabel = this.freshBlockId("ifexpr.end");

    // Allocate result on stack
    const resultPtr = this.freshVar();
    this.emit({ kind: "stack_alloc", dest: resultPtr, type: resultType });

    this.setTerminator({ kind: "br", cond: condId, thenBlock: thenLabel, elseBlock: elseLabel });

    // Then
    this.sealCurrentBlock();
    this.startBlock(thenLabel);
    const thenStmts = expr.thenBlock.statements;
    for (const s of thenStmts) {
      if (s.kind === "ExprStmt") {
        const val = this.lowerExpr(s.expression);
        this.emit({ kind: "store", ptr: resultPtr, value: val });
      } else {
        this.lowerStatement(s);
      }
    }
    if (!this.isBlockTerminated()) {
      this.setTerminator({ kind: "jump", target: endLabel });
    }

    // Else
    this.sealCurrentBlock();
    this.startBlock(elseLabel);
    const elseStmts = expr.elseBlock.statements;
    for (const s of elseStmts) {
      if (s.kind === "ExprStmt") {
        const val = this.lowerExpr(s.expression);
        this.emit({ kind: "store", ptr: resultPtr, value: val });
      } else {
        this.lowerStatement(s);
      }
    }
    if (!this.isBlockTerminated()) {
      this.setTerminator({ kind: "jump", target: endLabel });
    }

    // End
    this.sealCurrentBlock();
    this.startBlock(endLabel);

    const dest = this.freshVar();
    this.emit({ kind: "load", dest, ptr: resultPtr, type: resultType });
    return dest;
  }

  private lowerIncrementExpr(expr: IncrementExpr): VarId {
    if (expr.operand.kind === "Identifier") {
      const ptrId = this.varMap.get(expr.operand.name);
      if (ptrId) {
        const type = this.getExprKirType(expr.operand);
        const currentVal = this.freshVar();
        this.emit({ kind: "load", dest: currentVal, ptr: ptrId, type });
        const oneId = this.emitConstInt(1);
        const result = this.freshVar();
        this.emit({ kind: "bin_op", op: "add", dest: result, lhs: currentVal, rhs: oneId, type });
        this.emit({ kind: "store", ptr: ptrId, value: result });
        return currentVal; // post-increment: return old value
      }
    }
    return this.emitConstInt(0);
  }

  private lowerDecrementExpr(expr: DecrementExpr): VarId {
    if (expr.operand.kind === "Identifier") {
      const ptrId = this.varMap.get(expr.operand.name);
      if (ptrId) {
        const type = this.getExprKirType(expr.operand);
        const currentVal = this.freshVar();
        this.emit({ kind: "load", dest: currentVal, ptr: ptrId, type });
        const oneId = this.emitConstInt(1);
        const result = this.freshVar();
        this.emit({ kind: "bin_op", op: "sub", dest: result, lhs: currentVal, rhs: oneId, type });
        this.emit({ kind: "store", ptr: ptrId, value: result });
        return currentVal; // post-decrement: return old value
      }
    }
    return this.emitConstInt(0);
  }

  private lowerMoveExpr(expr: MoveExpr): VarId {
    const sourceId = this.lowerExpr(expr.operand);
    const dest = this.freshVar();
    const type = this.getExprKirType(expr.operand);
    this.emit({ kind: "move", dest, source: sourceId, type });

    // Mark the source variable as moved so it won't be destroyed at scope exit
    if (expr.operand.kind === "Identifier") {
      this.movedVars.add(expr.operand.name);
    }

    return dest;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private freshVar(): VarId {
    return `%${this.varCounter++}`;
  }

  private freshBlockId(prefix: string): BlockId {
    return `${prefix}.${this.blockCounter++}`;
  }

  private emit(inst: KirInst): void {
    this.currentInsts.push(inst);
  }

  private emitConstInt(value: number): VarId {
    const dest = this.freshVar();
    this.emit({ kind: "const_int", dest, type: { kind: "int", bits: 32, signed: true }, value });
    return dest;
  }

  private setTerminator(term: KirTerminator): void {
    // Only set terminator if block hasn't been terminated yet
    if (!this.isBlockTerminated()) {
      (this as any)._pendingTerminator = term;
    }
  }

  private isBlockTerminated(): boolean {
    return (this as any)._pendingTerminator != null;
  }

  private sealCurrentBlock(): void {
    const terminator: KirTerminator = (this as any)._pendingTerminator ?? { kind: "unreachable" };
    this.blocks.push({
      id: this.currentBlockId,
      phis: [],
      instructions: this.currentInsts,
      terminator,
    });
    this.currentInsts = [];
    (this as any)._pendingTerminator = null;
  }

  private startBlock(id: BlockId): void {
    this.currentBlockId = id;
    this.currentInsts = [];
    (this as any)._pendingTerminator = null;
  }

  private ensureTerminator(returnType: KirType): void {
    if (!this.isBlockTerminated()) {
      if (returnType.kind === "void") {
        this.setTerminator({ kind: "ret_void" });
      } else {
        // Should not happen in well-typed code, but add unreachable as safety
        this.setTerminator({ kind: "unreachable" });
      }
    }
  }

  /** Track which vars are stack-allocated (to know when to load vs use directly) */
  private stackAllocVars = new Set<VarId>();

  private isStackAllocVar(varId: VarId): boolean {
    // Check if any instruction in current block or previous blocks allocated this var
    for (const block of this.blocks) {
      for (const inst of block.instructions) {
        if (inst.kind === "stack_alloc" && inst.dest === varId) return true;
      }
    }
    for (const inst of this.currentInsts) {
      if (inst.kind === "stack_alloc" && inst.dest === varId) return true;
    }
    return false;
  }

  // ─── Lifecycle Helpers ───────────────────────────────────────────────────

  /** Check if a checker Type is a struct that has __destroy or __oncopy methods */
  private getStructLifecycle(checkerType: Type | undefined): { hasDestroy: boolean; hasOncopy: boolean; structName: string } | null {
    if (!checkerType) return null;
    if (checkerType.kind !== "struct") return null;

    const cached = this.structLifecycleCache.get(checkerType.name);
    if (cached) return { ...cached, structName: checkerType.name };

    const hasDestroy = checkerType.methods.has("__destroy");
    const hasOncopy = checkerType.methods.has("__oncopy");

    this.structLifecycleCache.set(checkerType.name, { hasDestroy, hasOncopy });

    if (!hasDestroy && !hasOncopy) return null;
    return { hasDestroy, hasOncopy, structName: checkerType.name };
  }

  /** Push a new scope for lifecycle tracking */
  private pushScope(): void {
    this.scopeStack.push([]);
  }

  /** Pop scope and emit destroy for all live variables in reverse declaration order */
  private popScopeWithDestroy(): void {
    const scope = this.scopeStack.pop();
    if (!scope) return;
    this.emitScopeDestroys(scope);
  }

  /** Emit destroys for scope variables in reverse order, skipping moved vars */
  private emitScopeDestroys(scope: ScopeVar[]): void {
    for (let i = scope.length - 1; i >= 0; i--) {
      const sv = scope[i];
      if (this.movedVars.has(sv.name)) continue;
      this.emit({ kind: "destroy", value: sv.varId, structName: sv.structName });
    }
  }

  /** Emit destroys for all scopes (for early return) without popping */
  private emitAllScopeDestroys(): void {
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      this.emitScopeDestroys(this.scopeStack[i]);
    }
  }

  /** Emit destroys for all scopes, but skip a named variable (the returned value) */
  private emitAllScopeDestroysExceptNamed(skipName: string | null): void {
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      const scope = this.scopeStack[i];
      for (let j = scope.length - 1; j >= 0; j--) {
        const sv = scope[j];
        if (this.movedVars.has(sv.name)) continue;
        if (skipName !== null && sv.name === skipName) continue;
        this.emit({ kind: "destroy", value: sv.varId, structName: sv.structName });
      }
    }
  }

  /** Track a variable in the current scope if it has lifecycle hooks */
  private trackScopeVar(name: string, varId: VarId, expr: Expression): void {
    if (this.scopeStack.length === 0) return;
    const checkerType = this.checkResult.typeMap.get(expr);
    const lifecycle = this.getStructLifecycle(checkerType);
    if (lifecycle?.hasDestroy) {
      this.scopeStack[this.scopeStack.length - 1].push({
        name,
        varId,
        structName: lifecycle.structName,
      });
    }
  }

  /** Track a variable by its checker type directly */
  private trackScopeVarByType(name: string, varId: VarId, checkerType: Type | undefined): void {
    if (this.scopeStack.length === 0) return;
    const lifecycle = this.getStructLifecycle(checkerType);
    if (lifecycle?.hasDestroy) {
      this.scopeStack[this.scopeStack.length - 1].push({
        name,
        varId,
        structName: lifecycle.structName,
      });
    }
  }

  // ─── Type Conversions ────────────────────────────────────────────────────

  private getExprKirType(expr: Expression): KirType {
    const checkerType = this.checkResult.typeMap.get(expr);
    if (checkerType) {
      return this.lowerCheckerType(checkerType);
    }
    // Default fallback
    return { kind: "int", bits: 32, signed: true };
  }

  private lowerCheckerType(t: Type): KirType {
    switch (t.kind) {
      case "int":
        return { kind: "int", bits: t.bits, signed: t.signed };
      case "float":
        return { kind: "float", bits: t.bits };
      case "bool":
        return { kind: "bool" };
      case "void":
        return { kind: "void" };
      case "string":
        return { kind: "string" };
      case "ptr":
        return { kind: "ptr", pointee: this.lowerCheckerType(t.pointee) };
      case "struct":
        return {
          kind: "struct",
          name: t.name,
          fields: Array.from(t.fields.entries()).map(([name, fieldType]) => ({
            name,
            type: this.lowerCheckerType(fieldType),
          })),
        };
      case "enum":
        return {
          kind: "enum",
          name: t.name,
          variants: t.variants.map((v) => ({
            name: v.name,
            fields: v.fields.map((f) => ({
              name: f.name,
              type: this.lowerCheckerType(f.type),
            })),
            value: v.value,
          })),
        };
      case "array":
        return { kind: "array", element: this.lowerCheckerType(t.element), length: 0 };
      case "function":
        return {
          kind: "function",
          params: t.params.map((p) => this.lowerCheckerType(p.type)),
          returnType: this.lowerCheckerType(t.returnType),
        };
      case "null":
        return { kind: "ptr", pointee: { kind: "void" } };
      case "c_char":
        return { kind: "int", bits: 8, signed: true };
      case "slice":
        return { kind: "struct", name: "slice", fields: [
          { name: "ptr", type: { kind: "ptr", pointee: this.lowerCheckerType(t.element) } },
          { name: "len", type: { kind: "int", bits: 64, signed: false } },
        ]};
      case "range":
        return { kind: "struct", name: "Range", fields: [
          { name: "start", type: this.lowerCheckerType(t.element) },
          { name: "end", type: this.lowerCheckerType(t.element) },
        ]};
      default:
        return { kind: "int", bits: 32, signed: true };
    }
  }

  private lowerTypeNode(typeNode: { kind: string; name: string }): KirType {
    const name = typeNode.name;
    switch (name) {
      case "int": case "i32": return { kind: "int", bits: 32, signed: true };
      case "i8": return { kind: "int", bits: 8, signed: true };
      case "i16": return { kind: "int", bits: 16, signed: true };
      case "i64": case "isize": return { kind: "int", bits: 64, signed: true };
      case "u8": return { kind: "int", bits: 8, signed: false };
      case "u16": return { kind: "int", bits: 16, signed: false };
      case "u32": return { kind: "int", bits: 32, signed: false };
      case "u64": case "usize": return { kind: "int", bits: 64, signed: false };
      case "f32": return { kind: "float", bits: 32 };
      case "f64": case "float": case "double": return { kind: "float", bits: 64 };
      case "bool": return { kind: "bool" };
      case "void": return { kind: "void" };
      case "string": return { kind: "string" };
      default: return { kind: "struct", name, fields: [] };
    }
  }

  private resolveParamType(decl: FunctionDecl, paramName: string): KirType {
    const param = decl.params.find((p) => p.name === paramName);
    if (param) {
      return this.lowerTypeNode(param.typeAnnotation);
    }
    return { kind: "int", bits: 32, signed: true };
  }

  private resolveParamCheckerType(decl: FunctionDecl, paramName: string): Type | undefined {
    const param = decl.params.find((p) => p.name === paramName);
    if (param) {
      return this.nameToCheckerType(param.typeAnnotation.name) as Type;
    }
    return undefined;
  }

  private getFunctionReturnType(decl: FunctionDecl): Type {
    // Try to get from the checker's type map
    // The function decl itself isn't in typeMap, but we can derive from return type annotation
    if (decl.returnType) {
      const name = decl.returnType.name;
      return this.nameToCheckerType(name);
    }
    return { kind: "void" as const };
  }

  private nameToCheckerType(name: string): Type {
    switch (name) {
      case "int": case "i32": return { kind: "int" as const, bits: 32 as const, signed: true };
      case "i8": return { kind: "int" as const, bits: 8 as const, signed: true };
      case "i16": return { kind: "int" as const, bits: 16 as const, signed: true };
      case "i64": return { kind: "int" as const, bits: 64 as const, signed: true };
      case "u8": return { kind: "int" as const, bits: 8 as const, signed: false };
      case "u16": return { kind: "int" as const, bits: 16 as const, signed: false };
      case "u32": return { kind: "int" as const, bits: 32 as const, signed: false };
      case "u64": return { kind: "int" as const, bits: 64 as const, signed: false };
      case "f32": return { kind: "float" as const, bits: 32 as const };
      case "f64": case "float": return { kind: "float" as const, bits: 64 as const };
      case "bool": return { kind: "bool" as const };
      case "string": return { kind: "string" as const };
      case "void": return { kind: "void" as const };
      default: return { kind: "void" as const };
    }
  }

  private mapBinOp(op: string): BinOp | null {
    const map: Record<string, BinOp> = {
      "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "mod",
      "==": "eq", "!=": "neq", "<": "lt", ">": "gt", "<=": "lte", ">=": "gte",
      "&": "bit_and", "|": "bit_or", "^": "bit_xor", "<<": "shl", ">>": "shr",
      "&&": "and", "||": "or",
    };
    return map[op] ?? null;
  }

  /** Build a mangled function name from a FunctionDecl (for overloaded definitions). */
  private mangleFunctionName(baseName: string, decl: FunctionDecl): string {
    const paramSuffixes = decl.params.map((p) => this.typeNameSuffix(p.typeAnnotation.name));
    return `${baseName}_${paramSuffixes.join("_")}`;
  }

  /** Build a mangled function name from a resolved FunctionType (for overloaded calls). */
  private mangleFunctionNameFromType(baseName: string, funcType: FunctionType): string {
    const paramSuffixes = funcType.params.map((p) => this.checkerTypeSuffix(p.type));
    return `${baseName}_${paramSuffixes.join("_")}`;
  }

  /** Convert a type annotation name to a short suffix for mangling. */
  private typeNameSuffix(name: string): string {
    switch (name) {
      case "int": case "i32": return "i32";
      case "i8": return "i8";
      case "i16": return "i16";
      case "i64": case "long": return "i64";
      case "u8": case "byte": return "u8";
      case "u16": return "u16";
      case "u32": return "u32";
      case "u64": return "u64";
      case "isize": return "isize";
      case "usize": return "usize";
      case "f32": case "float": return "f32";
      case "f64": case "double": return "f64";
      case "bool": return "bool";
      case "string": return "string";
      case "void": return "void";
      default: return name;
    }
  }

  /** Convert a checker Type to a short suffix for mangling. */
  private checkerTypeSuffix(t: Type): string {
    switch (t.kind) {
      case "int":
        return `${t.signed ? "i" : "u"}${t.bits}`;
      case "float":
        return `f${t.bits}`;
      case "bool":
        return "bool";
      case "string":
        return "string";
      case "void":
        return "void";
      case "ptr":
        return `ptr_${this.checkerTypeSuffix(t.pointee)}`;
      case "struct":
        return t.name;
      case "enum":
        return t.name;
      default:
        return t.kind;
    }
  }

  private mapCompoundAssignOp(op: string): BinOp | null {
    const map: Record<string, BinOp> = {
      "+=": "add", "-=": "sub", "*=": "mul", "/=": "div", "%=": "mod",
      "&=": "bit_and", "|=": "bit_or", "^=": "bit_xor", "<<=": "shl", ">>=": "shr",
    };
    return map[op] ?? null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function lowerToKir(program: Program, checkResult: CheckResult): KirModule {
  const lowerer = new KirLowerer(program, checkResult);
  return lowerer.lower();
}

/**
 * Lower multiple modules into a single KirModule.
 * Modules must be in topological order (dependencies first).
 * The last module in the list is the main module (its "main" function is the entry point).
 */
export function lowerModulesToKir(
  modules: ModuleCheckInfo[],
  multiResult: MultiModuleCheckResult
): KirModule {
  const combined: KirModule = {
    name: "main",
    globals: [],
    functions: [],
    types: [],
    externs: [],
  };

  // Track extern names to avoid duplicates across modules
  const seenExterns = new Set<string>();

  for (const mod of modules) {
    const result = multiResult.results.get(mod.name);
    if (!result) continue;

    // The last module (main) gets no prefix, others get their module name as prefix
    const isMainModule = mod === modules[modules.length - 1];
    const modulePrefix = isMainModule ? "" : mod.name.replace(/\./g, "_");

    // Build importedNames map: for selective imports, map local name → mangled name
    const importedNames = new Map<string, string>();
    for (const importDecl of mod.importDecls) {
      const importModulePrefix = importDecl.path.replace(/\./g, "_");
      if (importDecl.items.length > 0) {
        // Selective import: import { add } from math → add → math_add
        for (const item of importDecl.items) {
          importedNames.set(item, `${importModulePrefix}_${item}`);
        }
      }
      // Whole-module imports are handled via MemberExpr in lowerCallExpr
    }

    const lowerer = new KirLowerer(mod.program, result, modulePrefix, importedNames);
    const kirModule = lowerer.lower();

    // Merge globals, functions, types, externs
    combined.globals.push(...kirModule.globals);
    combined.functions.push(...kirModule.functions);
    combined.types.push(...kirModule.types);

    // Deduplicate externs (e.g., printf might be declared in multiple modules)
    for (const ext of kirModule.externs) {
      if (!seenExterns.has(ext.name)) {
        seenExterns.add(ext.name);
        combined.externs.push(ext);
      }
    }
  }

  return combined;
}
