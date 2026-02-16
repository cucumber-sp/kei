/**
 * AST → KIR lowering pass.
 *
 * Takes a type-checked AST (Program + CheckResult) and produces a KirModule.
 * Uses simple per-block variable tracking (no phi nodes / full SSA yet).
 */

import type { CheckResult, MultiModuleCheckResult, ModuleCheckInfo } from "../checker/checker.ts";
import type { MonomorphizedFunction, MonomorphizedStruct } from "../checker/generics.ts";
import { mangleGenericName } from "../checker/generics.ts";
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
  ArrayLiteral,
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
  CatchExpr,
  ThrowExpr,
  CastExpr,
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

  /** Set of imported function names that are overloaded in their source module */
  private importedOverloads: Set<string> = new Set();

  /** Throws types for the current function being lowered (empty = non-throwing) */
  private currentFunctionThrowsTypes: KirType[] = [];
  /** Original return type for throws functions (before transformation to i32 tag) */
  private currentFunctionOrigReturnType: KirType = { kind: "void" };

  /** Set of function names known to use the throws protocol */
  private throwsFunctions: Map<string, { throwsTypes: KirType[]; returnType: KirType }> = new Map();

  constructor(program: Program, checkResult: CheckResult, modulePrefix: string = "", importedNames?: Map<string, string>, importedOverloads?: Set<string>) {
    this.program = program;
    this.checkResult = checkResult;
    this.modulePrefix = modulePrefix;
    if (importedNames) this.importedNames = importedNames;
    if (importedOverloads) this.importedOverloads = importedOverloads;
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

    // Also mark imported overloaded names (e.g. print from io module)
    for (const name of this.importedOverloads) {
      this.overloadedNames.add(name);
    }

    // Pre-pass: discover which functions use throws protocol
    for (const decl of this.program.declarations) {
      if (decl.kind === "FunctionDecl" && decl.throwsTypes.length > 0) {
        const throwsKirTypes = decl.throwsTypes.map(t => this.lowerTypeNode(t));
        const retType = decl.returnType ? this.lowerTypeNode(decl.returnType) : { kind: "void" as const };
        // Compute the mangled name the same way lowerFunction does
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
        this.throwsFunctions.set(funcName, { throwsTypes: throwsKirTypes, returnType: retType });
      }
    }

    for (const decl of this.program.declarations) {
      this.lowerDeclaration(decl);
    }

    // Emit monomorphized struct definitions from generics
    for (const [mangledName, monoStruct] of this.checkResult.monomorphizedStructs) {
      this.typeDecls.push(this.lowerMonomorphizedStruct(mangledName, monoStruct));
      // Lower methods for monomorphized structs
      if (monoStruct.originalDecl) {
        for (const method of monoStruct.originalDecl.methods) {
          const structPrefix = this.modulePrefix ? `${this.modulePrefix}_${mangledName}` : mangledName;
          const methodMangledName = `${structPrefix}_${method.name}`;
          this.functions.push(this.lowerMethod(method, methodMangledName, mangledName));
        }
      }
    }

    // Emit monomorphized function definitions from generics
    for (const [_mangledName, monoFunc] of this.checkResult.monomorphizedFunctions) {
      if (monoFunc.declaration) {
        this.functions.push(this.lowerMonomorphizedFunction(monoFunc));
      }
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
        // Skip generic function templates — they are instantiated via monomorphization
        if (decl.genericParams.length > 0) break;
        this.functions.push(this.lowerFunction(decl));
        break;
      case "ExternFunctionDecl":
        this.externs.push(this.lowerExternFunction(decl));
        break;
      case "StructDecl":
      case "UnsafeStructDecl":
        // Skip generic struct templates — they are instantiated via monomorphization
        if (decl.genericParams.length > 0) break;
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

    // Detect throws function
    const isThrows = decl.throwsTypes.length > 0;
    const throwsKirTypes = isThrows ? decl.throwsTypes.map(t => this.lowerTypeNode(t)) : [];

    const originalReturnType = this.lowerCheckerType(
      this.getFunctionReturnType(decl)
    );

    // Set current function throws state
    this.currentFunctionThrowsTypes = throwsKirTypes;
    this.currentFunctionOrigReturnType = originalReturnType;

    // Push function-level scope
    this.pushScope();

    const params: KirParam[] = decl.params.map((p) => {
      const type = this.resolveParamType(decl, p.name);
      const varId = `%${p.name}`;
      this.varMap.set(p.name, varId);
      return { name: p.name, type };
    });

    // For throws functions: add __out and __err pointer params
    if (isThrows) {
      const outParamId = `%__out`;
      const errParamId = `%__err`;
      this.varMap.set("__out", outParamId);
      this.varMap.set("__err", errParamId);
      params.push({ name: "__out", type: { kind: "ptr", pointee: originalReturnType.kind === "void" ? { kind: "int", bits: 8, signed: false } : originalReturnType } });
      params.push({ name: "__err", type: { kind: "ptr", pointee: { kind: "void" } } });
    }

    // Track params with lifecycle hooks for destroy on function exit
    for (const p of decl.params) {
      const checkerType = this.resolveParamCheckerType(decl, p.name);
      this.trackScopeVarByType(p.name, `%${p.name}`, checkerType);
    }

    // For throws functions, the actual return type is i32 (tag)
    const returnType = isThrows ? { kind: "int" as const, bits: 32 as const, signed: true } : originalReturnType;

    // Lower body
    this.lowerBlock(decl.body);

    // Emit destroy for function-scope variables before implicit return
    if (!this.isBlockTerminated()) {
      this.popScopeWithDestroy();
    } else {
      this.scopeStack.pop(); // discard without emitting (already returned)
    }

    // Ensure the last block has a terminator
    if (isThrows) {
      // For throws functions, implicit return = success (tag 0)
      if (!this.isBlockTerminated()) {
        const zeroTag = this.emitConstInt(0);
        this.setTerminator({ kind: "ret", value: zeroTag });
      }
    } else {
      this.ensureTerminator(returnType);
    }

    // Seal last block
    this.sealCurrentBlock();

    // Clear throws state
    this.currentFunctionThrowsTypes = [];
    this.currentFunctionOrigReturnType = { kind: "void" };

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
      throwsTypes: isThrows ? throwsKirTypes : undefined,
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

  private lowerMonomorphizedStruct(mangledName: string, monoStruct: MonomorphizedStruct): KirTypeDecl {
    const concrete = monoStruct.concrete;
    const fields = Array.from(concrete.fields.entries()).map(([name, fieldType]) => ({
      name,
      type: this.lowerCheckerType(fieldType),
    }));
    return {
      name: mangledName,
      type: { kind: "struct", name: mangledName, fields },
    };
  }

  private lowerMonomorphizedFunction(monoFunc: MonomorphizedFunction): KirFunction {
    const decl = monoFunc.declaration!;
    const concreteType = monoFunc.concrete;

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

    // Detect throws function
    const isThrows = concreteType.throwsTypes.length > 0;
    const throwsKirTypes = isThrows ? concreteType.throwsTypes.map(t => this.lowerCheckerType(t)) : [];

    const originalReturnType = this.lowerCheckerType(concreteType.returnType);

    // Set current function throws state
    this.currentFunctionThrowsTypes = throwsKirTypes;
    this.currentFunctionOrigReturnType = originalReturnType;

    // Push function-level scope
    this.pushScope();

    const params: KirParam[] = [];
    for (let i = 0; i < decl.params.length; i++) {
      const p = decl.params[i]!;
      const type = this.lowerCheckerType(concreteType.params[i]!.type);
      const varId: VarId = `%${p.name}`;
      this.varMap.set(p.name, varId);
      params.push({ name: p.name, type });
    }

    // For throws functions: add __out and __err pointer params
    if (isThrows) {
      const outParamId: VarId = `%__out`;
      const errParamId: VarId = `%__err`;
      this.varMap.set("__out", outParamId);
      this.varMap.set("__err", errParamId);
      params.push({ name: "__out", type: { kind: "ptr", pointee: originalReturnType.kind === "void" ? { kind: "int", bits: 8, signed: false } : originalReturnType } });
      params.push({ name: "__err", type: { kind: "ptr", pointee: { kind: "void" } } });
    }

    // For throws functions, the actual return type is i32 (tag)
    const returnType = isThrows ? { kind: "int" as const, bits: 32 as const, signed: true } : originalReturnType;

    // Lower body
    this.lowerBlock(decl.body);

    // Emit destroy for function-scope variables before implicit return
    if (!this.isBlockTerminated()) {
      this.popScopeWithDestroy();
    } else {
      this.scopeStack.pop();
    }

    // Ensure the last block has a terminator
    if (isThrows) {
      if (!this.isBlockTerminated()) {
        const zeroTag = this.emitConstInt(0);
        this.setTerminator({ kind: "ret", value: zeroTag });
      }
    } else {
      this.ensureTerminator(returnType);
    }

    // Seal last block
    this.sealCurrentBlock();

    // Clear throws state
    this.currentFunctionThrowsTypes = [];
    this.currentFunctionOrigReturnType = { kind: "void" };

    // Apply module prefix if needed
    let funcName = monoFunc.mangledName;
    if (this.modulePrefix) {
      funcName = `${this.modulePrefix}_${funcName}`;
    }

    return {
      name: funcName,
      params,
      returnType,
      blocks: this.blocks,
      localCount: this.varCounter,
      throwsTypes: isThrows ? throwsKirTypes : undefined,
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
    if (this.currentFunctionThrowsTypes.length > 0) {
      // In a throws function: store value to __out pointer, return tag 0 (success)
      if (stmt.value) {
        const valueId = this.lowerExpr(stmt.value);
        const returnedVarName = stmt.value.kind === "Identifier" ? stmt.value.name : null;
        this.emitAllScopeDestroysExceptNamed(returnedVarName);
        // Store success value through __out pointer
        if (this.currentFunctionOrigReturnType.kind !== "void") {
          const outPtr = this.varMap.get("__out")!;
          this.emit({ kind: "store", ptr: outPtr, value: valueId });
        }
      } else {
        this.emitAllScopeDestroys();
      }
      const zeroTag = this.emitConstInt(0);
      this.setTerminator({ kind: "ret", value: zeroTag });
    } else {
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
      case "ThrowExpr":
        return this.lowerThrowExpr(expr);
      case "CatchExpr":
        return this.lowerCatchExpr(expr);
      case "CastExpr":
        return this.lowerCastExpr(expr);
      case "ArrayLiteral":
        return this.lowerArrayLiteral(expr);
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
    // Check for operator overloading
    const opMethod = this.checkResult.operatorMethods.get(expr);
    if (opMethod) {
      return this.lowerOperatorMethodCall(expr.left, opMethod.methodName, opMethod.structType, [expr.right]);
    }

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
      // For string equality/inequality, pass operandType so the C emitter knows
      const leftCheckerType = this.checkResult.typeMap.get(expr.left);
      if (leftCheckerType?.kind === "string" && (op === "eq" || op === "neq")) {
        this.emit({ kind: "bin_op", op, dest, lhs, rhs, type, operandType: { kind: "string" } });
      } else {
        this.emit({ kind: "bin_op", op, dest, lhs, rhs, type });
      }
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
    // Check for operator overloading (e.g., -a → a.op_neg())
    const opMethod = this.checkResult.operatorMethods.get(expr);
    if (opMethod) {
      return this.lowerOperatorMethodCall(expr.operand, opMethod.methodName, opMethod.structType, []);
    }

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
    // sizeof(Type) → KIR sizeof instruction (resolved by backend)
    if (expr.callee.kind === "Identifier" && expr.callee.name === "sizeof" && expr.args.length === 1) {
      const arg = expr.args[0];
      let kirType: import("./kir-types.ts").KirType;
      if (arg && arg.kind === "Identifier") {
        kirType = this.lowerTypeNode({ kind: "NamedType", name: arg.name, span: arg.span });
      } else {
        kirType = { kind: "int", bits: 32, signed: true };
      }
      const dest = this.freshVar();
      this.emit({ kind: "sizeof", dest, type: kirType });
      return dest;
    }

    const args = expr.args.map((a) => this.lowerExpr(a));
    const resultType = this.getExprKirType(expr);
    const isVoid = resultType.kind === "void";

    // Get the function name
    let funcName: string;

    // Check for generic call resolution (e.g. max<i32>(a, b) → max_i32)
    const genericName = this.checkResult.genericResolutions.get(expr);
    if (genericName) {
      funcName = this.modulePrefix ? `${this.modulePrefix}_${genericName}` : genericName;
    } else if (expr.callee.kind === "Identifier") {
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
    // Handle .len on arrays — emit compile-time constant
    if (expr.property === "len") {
      const objectType = this.checkResult.typeMap.get(expr.object);
      if (objectType?.kind === "array" && objectType.length != null) {
        const dest = this.freshVar();
        this.emit({ kind: "const_int", dest, type: { kind: "int", bits: 64, signed: false }, value: objectType.length });
        return dest;
      }
      // For strings, .len is a field access on the kei_string struct
      if (objectType?.kind === "string") {
        const baseId = this.lowerExpr(expr.object);
        const dest = this.freshVar();
        const resultType = this.getExprKirType(expr);
        const ptrDest = this.freshVar();
        this.emit({ kind: "field_ptr", dest: ptrDest, base: baseId, field: "len", type: resultType });
        this.emit({ kind: "load", dest, ptr: ptrDest, type: resultType });
        return dest;
      }
    }

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

    // Emit bounds check for arrays with known length
    const objectType = this.checkResult.typeMap.get(expr.object);
    if (objectType?.kind === "array" && objectType.length != null) {
      const lenId = this.freshVar();
      this.emit({ kind: "const_int", dest: lenId, type: { kind: "int", bits: 64, signed: false }, value: objectType.length });
      this.emit({ kind: "bounds_check", index: indexId, length: lenId });
    }

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

  private lowerArrayLiteral(expr: ArrayLiteral): VarId {
    const checkerType = this.checkResult.typeMap.get(expr);
    let elemType: KirType = { kind: "int", bits: 32, signed: true };
    if (checkerType?.kind === "array") {
      elemType = this.lowerCheckerType(checkerType.element);
    }

    const arrType: KirType = { kind: "array", element: elemType, length: expr.elements.length };
    const ptrId = this.freshVar();
    this.emit({ kind: "stack_alloc", dest: ptrId, type: arrType });

    // Store each element at its index
    for (let i = 0; i < expr.elements.length; i++) {
      const valueId = this.lowerExpr(expr.elements[i]!);
      const idxId = this.freshVar();
      this.emit({ kind: "const_int", dest: idxId, type: { kind: "int", bits: 64, signed: false }, value: i });
      const elemPtrId = this.freshVar();
      this.emit({ kind: "index_ptr", dest: elemPtrId, base: ptrId, index: idxId, type: elemType });
      this.emit({ kind: "store", ptr: elemPtrId, value: valueId });
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

  private lowerCastExpr(expr: CastExpr): VarId {
    const value = this.lowerExpr(expr.operand);
    const targetType = this.getExprKirType(expr);
    const dest = this.freshVar();
    this.emit({ kind: "cast", dest, value, targetType });
    return dest;
  }

  private lowerThrowExpr(expr: ThrowExpr): VarId {
    // throw ErrorType{} → cast __err to typed pointer, store error value, return error tag
    const valueId = this.lowerExpr(expr.value);
    const errPtr = this.varMap.get("__err")!;

    // Determine the error type for casting
    const errorKirType = this.getExprKirType(expr.value);

    // Only copy error data if the struct has fields (skip for empty structs)
    const hasFields = errorKirType.kind === "struct" && errorKirType.fields.length > 0;
    if (hasFields) {
      // Cast __err (void*) to the specific error struct pointer type
      const typedErrPtr = this.freshVar();
      this.emit({ kind: "cast", dest: typedErrPtr, value: errPtr, targetType: { kind: "ptr", pointee: errorKirType } });

      // The struct literal returns a pointer; load the actual struct value from it
      const structVal = this.freshVar();
      this.emit({ kind: "load", dest: structVal, ptr: valueId, type: errorKirType });

      // Store the struct value through the typed error pointer
      this.emit({ kind: "store", ptr: typedErrPtr, value: structVal });
    }

    // Determine the tag for this error type
    const checkerType = this.checkResult.typeMap.get(expr.value);
    let tag = 1; // default
    if (checkerType && checkerType.kind === "struct") {
      const idx = this.currentFunctionThrowsTypes.findIndex(
        t => t.kind === "struct" && t.name === checkerType.name
      );
      if (idx >= 0) tag = idx + 1;
    }

    this.emitAllScopeDestroys();
    const tagVal = this.emitConstInt(tag);
    this.setTerminator({ kind: "ret", value: tagVal });
    return tagVal;
  }

  private lowerCatchExpr(expr: CatchExpr): VarId {
    // The operand must be a function call to a throws function
    // We need to resolve the callee's throws info to generate the right code

    // Resolve the function name and its throws info
    const callExpr = expr.operand;
    const throwsInfo = this.resolveCallThrowsInfo(callExpr);
    if (!throwsInfo) {
      // Fallback: just lower the operand normally
      return this.lowerExpr(expr.operand);
    }

    const { funcName, args: callArgs, throwsTypes, returnType: successType } = throwsInfo;

    // Allocate buffers for out value and error value
    const outPtr = this.freshVar();
    const errPtr = this.freshVar();
    const outType = successType.kind === "void"
      ? { kind: "int" as const, bits: 8 as const, signed: false as const }
      : successType;
    this.emit({ kind: "stack_alloc", dest: outPtr, type: outType });
    // err buffer: use u8 placeholder (C backend will emit union-sized buffer)
    this.emit({ kind: "stack_alloc", dest: errPtr, type: { kind: "int", bits: 8, signed: false } });

    // Call the throws function — dest receives the i32 tag
    const tagVar = this.freshVar();
    this.emit({
      kind: "call_throws",
      dest: tagVar,
      func: funcName,
      args: callArgs,
      outPtr,
      errPtr,
      successType,
      errorTypes: throwsTypes,
    });

    if (expr.catchType === "panic") {
      // catch panic: if tag != 0 → kei_panic
      const zeroConst = this.emitConstInt(0);
      const isOk = this.freshVar();
      this.emit({ kind: "bin_op", op: "eq", dest: isOk, lhs: tagVar, rhs: zeroConst, type: { kind: "bool" } });
      const okLabel = this.freshBlockId("catch.ok");
      const panicLabel = this.freshBlockId("catch.panic");
      this.setTerminator({ kind: "br", cond: isOk, thenBlock: okLabel, elseBlock: panicLabel });

      this.sealCurrentBlock();
      this.startBlock(panicLabel);
      // Call kei_panic
      const panicMsg = this.freshVar();
      this.emit({ kind: "const_string", dest: panicMsg, value: "unhandled error" });
      this.emit({ kind: "call_extern_void", func: "kei_panic", args: [panicMsg] });
      this.setTerminator({ kind: "unreachable" });

      this.sealCurrentBlock();
      this.startBlock(okLabel);

      // Load and return the success value
      if (successType.kind === "void") {
        return this.emitConstInt(0);
      }
      const resultVal = this.freshVar();
      this.emit({ kind: "load", dest: resultVal, ptr: outPtr, type: successType });
      return resultVal;
    }

    if (expr.catchType === "throw") {
      // catch throw: pass caller's __err directly so callee writes to it
      // Re-emit the call with the caller's __err pointer
      // Remove the previous call_throws (it was the last emitted instruction)
      this.currentInsts.pop(); // remove the call_throws we just emitted

      const callerErrPtr = this.varMap.get("__err")!;
      this.emit({
        kind: "call_throws",
        dest: tagVar,
        func: funcName,
        args: callArgs,
        outPtr,
        errPtr: callerErrPtr, // pass caller's err buffer directly
        successType,
        errorTypes: throwsTypes,
      });

      const zeroConst = this.emitConstInt(0);
      const isOk = this.freshVar();
      this.emit({ kind: "bin_op", op: "eq", dest: isOk, lhs: tagVar, rhs: zeroConst, type: { kind: "bool" } });
      const okLabel = this.freshBlockId("catch.ok");
      const propagateLabel = this.freshBlockId("catch.throw");
      this.setTerminator({ kind: "br", cond: isOk, thenBlock: okLabel, elseBlock: propagateLabel });

      this.sealCurrentBlock();
      this.startBlock(propagateLabel);

      // Remap tags from callee to caller's tag space and propagate
      this.lowerCatchThrowPropagation(throwsTypes, tagVar, callerErrPtr);

      this.sealCurrentBlock();
      this.startBlock(okLabel);

      if (successType.kind === "void") {
        return this.emitConstInt(0);
      }
      const resultVal = this.freshVar();
      this.emit({ kind: "load", dest: resultVal, ptr: outPtr, type: successType });
      return resultVal;
    }

    // catch { clauses } — block catch with per-error-type handling
    const zeroConst = this.emitConstInt(0);
    const isOk = this.freshVar();
    this.emit({ kind: "bin_op", op: "eq", dest: isOk, lhs: tagVar, rhs: zeroConst, type: { kind: "bool" } });

    const okLabel = this.freshBlockId("catch.ok");
    const switchLabel = this.freshBlockId("catch.switch");
    const endLabel = this.freshBlockId("catch.end");
    this.setTerminator({ kind: "br", cond: isOk, thenBlock: okLabel, elseBlock: switchLabel });

    // Allocate result storage (the catch expr produces a value)
    const resultType = this.getExprKirType(expr);
    const resultPtr = this.freshVar();
    this.emit({ kind: "stack_alloc", dest: resultPtr, type: resultType });

    // Switch block: branch on tag value
    this.sealCurrentBlock();
    this.startBlock(switchLabel);

    // Build case blocks for each clause
    const caseInfos: { tagConst: VarId; label: BlockId }[] = [];

    for (const clause of expr.clauses) {
      if (clause.isDefault) continue; // handle default separately

      // Find the tag for this error type
      const errorTag = throwsTypes.findIndex(
        t => t.kind === "struct" && t.name === clause.errorType
      ) + 1;

      const clauseLabel = this.freshBlockId(`catch.clause.${clause.errorType}`);
      const tagConstVar = this.emitConstInt(errorTag);
      caseInfos.push({ tagConst: tagConstVar, label: clauseLabel });
    }

    // Default block (unreachable or user default clause)
    const defaultClause = expr.clauses.find(c => c.isDefault);
    const defaultLabel = defaultClause
      ? this.freshBlockId("catch.default")
      : this.freshBlockId("catch.unreachable");

    this.setTerminator({
      kind: "switch",
      value: tagVar,
      cases: caseInfos.map(ci => ({ value: ci.tagConst, target: ci.label })),
      defaultBlock: defaultLabel,
    });

    // Emit each clause block
    for (const clause of expr.clauses) {
      if (clause.isDefault) continue;

      const errorTag = throwsTypes.findIndex(
        t => t.kind === "struct" && t.name === clause.errorType
      ) + 1;
      const clauseLabel = caseInfos.find(ci => {
        // Match by tag value
        const inst = this.findConstIntInst(ci.tagConst);
        return inst?.value === errorTag;
      })?.label;
      if (!clauseLabel) continue;

      this.sealCurrentBlock();
      this.startBlock(clauseLabel);

      // If clause has a variable name, bind it to the error value in the err buffer
      if (clause.varName) {
        const errType = throwsTypes[errorTag - 1];
        // Cast errPtr to typed pointer — this becomes the variable's storage
        const typedErrPtr = this.freshVar();
        this.emit({ kind: "cast", dest: typedErrPtr, value: errPtr, targetType: { kind: "ptr", pointee: errType } });
        this.varMap.set(clause.varName, typedErrPtr);
      }

      // Lower clause body statements
      for (const stmt of clause.body) {
        this.lowerStatement(stmt);
      }

      if (!this.isBlockTerminated()) {
        this.setTerminator({ kind: "jump", target: endLabel });
      }
    }

    // Default clause block
    this.sealCurrentBlock();
    this.startBlock(defaultLabel);
    if (defaultClause) {
      if (defaultClause.varName) {
        // Bind the error variable to a typed pointer into the err buffer
        const firstErrType = throwsTypes[0] || { kind: "int" as const, bits: 8 as const, signed: false as const };
        const typedErrPtr = this.freshVar();
        this.emit({ kind: "cast", dest: typedErrPtr, value: errPtr, targetType: { kind: "ptr", pointee: firstErrType } });
        this.varMap.set(defaultClause.varName, typedErrPtr);
      }
      for (const stmt of defaultClause.body) {
        this.lowerStatement(stmt);
      }
    }
    if (!this.isBlockTerminated()) {
      this.setTerminator({ kind: "jump", target: endLabel });
    }

    // OK path: load success value
    this.sealCurrentBlock();
    this.startBlock(okLabel);
    if (successType.kind !== "void") {
      const successVal = this.freshVar();
      this.emit({ kind: "load", dest: successVal, ptr: outPtr, type: successType });
      this.emit({ kind: "store", ptr: resultPtr, value: successVal });
    }
    this.setTerminator({ kind: "jump", target: endLabel });

    // End block
    this.sealCurrentBlock();
    this.startBlock(endLabel);

    if (resultType.kind === "void") {
      return this.emitConstInt(0);
    }
    const finalResult = this.freshVar();
    this.emit({ kind: "load", dest: finalResult, ptr: resultPtr, type: resultType });
    return finalResult;
  }

  /** Resolve the function name, args, and throws info for a call expression used in catch */
  private resolveCallThrowsInfo(callExpr: Expression): {
    funcName: string;
    args: VarId[];
    throwsTypes: KirType[];
    returnType: KirType;
  } | null {
    if (callExpr.kind !== "CallExpr") return null;

    const args = callExpr.args.map(a => this.lowerExpr(a));
    const resultType = this.getExprKirType(callExpr);

    // Resolve function name (same logic as lowerCallExpr)
    let funcName: string;
    if (callExpr.callee.kind === "Identifier") {
      const baseName = callExpr.callee.name;
      const importedName = this.importedNames.get(baseName);
      const resolvedBase = importedName ?? baseName;

      if (this.overloadedNames.has(baseName)) {
        const calleeType = this.checkResult.typeMap.get(callExpr.callee);
        if (calleeType && calleeType.kind === "function") {
          funcName = this.mangleFunctionNameFromType(resolvedBase, calleeType as FunctionType);
        } else {
          funcName = resolvedBase;
        }
      } else {
        funcName = resolvedBase;
      }
    } else if (callExpr.callee.kind === "MemberExpr") {
      const objType = this.checkResult.typeMap.get(callExpr.callee.object);
      if (objType?.kind === "module") {
        const modulePrefix = objType.name.replace(/\./g, "_");
        funcName = `${modulePrefix}_${callExpr.callee.property}`;
      } else {
        funcName = callExpr.callee.property;
      }
    } else {
      return null;
    }

    // Look up throws info from pre-registered throws functions
    const throwsInfo = this.throwsFunctions.get(funcName);
    if (throwsInfo) {
      return {
        funcName,
        args,
        throwsTypes: throwsInfo.throwsTypes,
        returnType: throwsInfo.returnType,
      };
    }

    // Fallback: try to get from checker's type info
    const calleeType = this.checkResult.typeMap.get(callExpr.callee);
    if (calleeType && calleeType.kind === "function" && (calleeType as FunctionType).throwsTypes.length > 0) {
      const ft = calleeType as FunctionType;
      return {
        funcName,
        args,
        throwsTypes: ft.throwsTypes.map(t => this.lowerCheckerType(t)),
        returnType: this.lowerCheckerType(ft.returnType),
      };
    }

    return null;
  }

  /** For catch throw: propagate errors from callee to caller's error protocol.
   *  The callee already wrote the error value to the caller's __err buffer,
   *  so we only need to remap tags if the error type ordering differs. */
  private lowerCatchThrowPropagation(calleeThrowsTypes: KirType[], tagVar: VarId, _errPtr: VarId): void {
    const callerThrowsTypes = this.currentFunctionThrowsTypes;

    // Check if all callee types exist in caller types at same indices
    let needsRemap = false;
    for (let i = 0; i < calleeThrowsTypes.length; i++) {
      const calleeType = calleeThrowsTypes[i];
      const callerIdx = callerThrowsTypes.findIndex(
        ct => ct.kind === "struct" && calleeType.kind === "struct" && ct.name === calleeType.name
      );
      if (callerIdx !== i) {
        needsRemap = true;
        break;
      }
    }

    if (!needsRemap) {
      // Direct propagation: same tag numbering, error already in caller's buffer
      this.emitAllScopeDestroys();
      this.setTerminator({ kind: "ret", value: tagVar });
    } else {
      // Remap: switch on callee tag, return caller's tag
      const cases: { value: VarId; target: BlockId }[] = [];
      const endPropLabel = this.freshBlockId("catch.prop.end");

      for (let i = 0; i < calleeThrowsTypes.length; i++) {
        const calleeTag = this.emitConstInt(i + 1);
        const caseLabel = this.freshBlockId(`catch.prop.${i}`);
        cases.push({ value: calleeTag, target: caseLabel });
      }

      this.setTerminator({
        kind: "switch",
        value: tagVar,
        cases,
        defaultBlock: endPropLabel,
      });

      for (let i = 0; i < calleeThrowsTypes.length; i++) {
        const calleeType = calleeThrowsTypes[i];
        const callerIdx = callerThrowsTypes.findIndex(
          ct => ct.kind === "struct" && calleeType.kind === "struct" && ct.name === calleeType.name
        );
        if (callerIdx < 0) continue;

        this.sealCurrentBlock();
        this.startBlock(cases[i].target);
        this.emitAllScopeDestroys();
        const callerTag = this.emitConstInt(callerIdx + 1);
        this.setTerminator({ kind: "ret", value: callerTag });
      }

      this.sealCurrentBlock();
      this.startBlock(endPropLabel);
      this.setTerminator({ kind: "unreachable" });
    }
  }

  /** Find a const_int instruction by its dest VarId (for tag matching) */
  private findConstIntInst(varId: VarId): { value: number } | null {
    for (const block of this.blocks) {
      for (const inst of block.instructions) {
        if (inst.kind === "const_int" && inst.dest === varId) {
          return { value: inst.value };
        }
      }
    }
    for (const inst of this.currentInsts) {
      if (inst.kind === "const_int" && inst.dest === varId) {
        return { value: inst.value };
      }
    }
    return null;
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

  // ─── Sizeof Resolution ─────────────────────────────────────────────────

  /** Resolve the byte size of a sizeof argument at compile time. */
  private resolveSizeofArg(arg: Expression): number {
    if (arg.kind === "Identifier") {
      return this.sizeofTypeName(arg.name);
    }
    // For non-identifier args, use the checker type
    const checkerType = this.checkResult.typeMap.get(arg);
    if (checkerType) {
      return this.sizeofCheckerType(checkerType);
    }
    return 0;
  }

  /** Get size from a type name string. */
  private sizeofTypeName(name: string): number {
    switch (name) {
      case "i8": case "u8": case "bool": return 1;
      case "i16": case "u16": return 2;
      case "i32": case "u32": case "int": case "f32": case "float": return 4;
      case "i64": case "u64": case "f64": case "double":
      case "usize": case "isize":
        return 8;
      case "string":
        return 32; // kei_string struct: data(8) + len(8) + cap(8) + ref(8)
      default: {
        // Look up struct in program declarations
        for (const decl of this.program.declarations) {
          if ((decl.kind === "StructDecl" || decl.kind === "UnsafeStructDecl") && decl.name === name) {
            let size = 0;
            for (const field of decl.fields) {
              size += this.sizeofTypeName(field.typeAnnotation.name);
            }
            return size;
          }
        }
        return 0;
      }
    }
  }

  /** Get size from a checker Type. */
  private sizeofCheckerType(t: Type): number {
    switch (t.kind) {
      case "bool": return 1;
      case "int": return t.bits / 8;
      case "float": return t.bits / 8;
      case "string": return 32; // kei_string struct: data(8) + len(8) + cap(8) + ref(8)
      case "ptr": return 8;
      case "struct": {
        let size = 0;
        for (const [, fieldType] of t.fields) {
          size += this.sizeofCheckerType(fieldType);
        }
        return size;
      }
      default: return 8;
    }
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
        return { kind: "array", element: this.lowerCheckerType(t.element), length: t.length ?? 0 };
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
    const importedOverloads = new Set<string>();
    for (const importDecl of mod.importDecls) {
      const importModulePrefix = importDecl.path.replace(/\./g, "_");
      if (importDecl.items.length > 0) {
        // Selective import: import { add } from math → add → math_add
        for (const item of importDecl.items) {
          importedNames.set(item, `${importModulePrefix}_${item}`);
        }
      }
      // Whole-module imports are handled via MemberExpr in lowerCallExpr

      // Detect overloaded exports: check if the source module has multiple
      // FunctionDecls with the same name
      const importedMod = modules.find((m) => m.name === importDecl.path);
      if (importedMod) {
        const funcCounts = new Map<string, number>();
        for (const decl of importedMod.program.declarations) {
          if (decl.kind === "FunctionDecl") {
            funcCounts.set(decl.name, (funcCounts.get(decl.name) ?? 0) + 1);
          }
        }
        for (const [name, count] of funcCounts) {
          if (count > 1) {
            importedOverloads.add(name);
          }
        }
      }
    }

    const lowerer = new KirLowerer(mod.program, result, modulePrefix, importedNames, importedOverloads);
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
