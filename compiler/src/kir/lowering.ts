/**
 * AST → KIR lowering pass.
 *
 * Takes a type-checked AST (Program + CheckResult) and produces a KirModule.
 * Uses simple per-block variable tracking (no phi nodes / full SSA yet).
 *
 * Method implementations are split across:
 *   - lowering-decl.ts       (declaration lowering)
 *   - lowering-stmt.ts       (statement lowering)
 *   - lowering-expr.ts       (expression lowering)
 *   - lowering-literals.ts   (literal expression lowering)
 *   - lowering-operators.ts  (operator expression lowering)
 *   - lowering-error.ts      (error handling lowering)
 *   - lowering-types.ts      (type conversion helpers)
 *   - lowering-scope.ts      (scope/lifecycle helpers)
 *   - lowering-utils.ts      (basic emit helpers)
 */

import type { Program } from "../ast/nodes.ts";
import type { CheckResult, ModuleCheckInfo, MultiModuleCheckResult } from "../checker/checker.ts";
import type {
  BlockId,
  KirBlock,
  KirExtern,
  KirFunction,
  KirGlobal,
  KirInst,
  KirModule,
  KirType,
  KirTypeDecl,
  VarId,
} from "./kir-types.ts";

// Import extracted method implementations
import * as declMethods from "./lowering-decl.ts";
import * as errorMethods from "./lowering-error.ts";
import * as exprMethods from "./lowering-expr.ts";
import * as literalMethods from "./lowering-literals.ts";
import * as operatorMethods from "./lowering-operators.ts";
import * as scopeMethods from "./lowering-scope.ts";
import * as stmtMethods from "./lowering-stmt.ts";
import * as typeMethods from "./lowering-types.ts";
import * as utilMethods from "./lowering-utils.ts";

// ─── Scope variable tracking for lifecycle ───────────────────────────────────

interface ScopeVar {
  name: string;
  varId: VarId;
  structName: string; // struct type name (for __destroy/__oncopy dispatch)
}

// ─── Lowerer ─────────────────────────────────────────────────────────────────

export class KirLowerer {
  program: Program;
  checkResult: CheckResult;

  // Current function state
  blocks: KirBlock[] = [];
  currentBlockId: BlockId = "entry";
  currentInsts: KirInst[] = [];
  varCounter = 0;
  blockCounter = 0;

  // Variable name → current SSA VarId mapping per scope
  varMap: Map<string, VarId> = new Map();

  // Track break/continue targets for loops
  loopBreakTarget: BlockId | null = null;
  loopContinueTarget: BlockId | null = null;

  // Scope stack for lifecycle tracking: each scope has a list of vars needing destroy
  scopeStack: ScopeVar[][] = [];

  // Set of variable names that have been moved (no destroy on scope exit)
  movedVars: Set<string> = new Set();

  // Map from struct name → whether it has __destroy/__oncopy methods
  structLifecycleCache: Map<string, { hasDestroy: boolean; hasOncopy: boolean }> = new Map();

  // Collected module-level items
  functions: KirFunction[] = [];
  externs: KirExtern[] = [];
  typeDecls: KirTypeDecl[] = [];
  globals: KirGlobal[] = [];

  // Track which function names are overloaded (name → count of declarations)
  overloadedNames: Set<string> = new Set();

  /** Module prefix for name mangling in multi-module builds (e.g. "math" → "math_add") */
  modulePrefix: string = "";

  /** Map of imported function names → their mangled names (e.g. "add" → "math_add") */
  importedNames: Map<string, string> = new Map();

  /** Set of imported function names that are overloaded in their source module */
  private importedOverloads: Set<string> = new Set();

  /** Throws types for the current function being lowered (empty = non-throwing) */
  currentFunctionThrowsTypes: KirType[] = [];
  /** Original return type for throws functions (before transformation to i32 tag) */
  currentFunctionOrigReturnType: KirType = { kind: "void" };

  /** Set of function names known to use the throws protocol */
  throwsFunctions: Map<string, { throwsTypes: KirType[]; returnType: KirType }> = new Map();

  constructor(
    program: Program,
    checkResult: CheckResult,
    modulePrefix: string = "",
    importedNames?: Map<string, string>,
    importedOverloads?: Set<string>
  ) {
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
        const throwsKirTypes = decl.throwsTypes.map((t) => this.lowerTypeNode(t));
        const retType = decl.returnType
          ? this.lowerTypeNode(decl.returnType)
          : { kind: "void" as const };
        // Compute the mangled name the same way lowerFunction does
        let funcName: string;
        if (this.overloadedNames.has(decl.name)) {
          const baseName = this.modulePrefix ? `${this.modulePrefix}_${decl.name}` : decl.name;
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
          const structPrefix = this.modulePrefix
            ? `${this.modulePrefix}_${mangledName}`
            : mangledName;
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

  // ─── Declaration methods (from lowering-decl.ts) ────────────────────────
  declare lowerDeclaration: typeof declMethods.lowerDeclaration;
  declare lowerFunction: typeof declMethods.lowerFunction;
  declare lowerMethod: typeof declMethods.lowerMethod;
  declare lowerExternFunction: typeof declMethods.lowerExternFunction;
  declare lowerStructDecl: typeof declMethods.lowerStructDecl;
  declare lowerMonomorphizedStruct: typeof declMethods.lowerMonomorphizedStruct;
  declare lowerMonomorphizedFunction: typeof declMethods.lowerMonomorphizedFunction;
  declare lowerEnumDecl: typeof declMethods.lowerEnumDecl;
  declare lowerStaticDecl: typeof declMethods.lowerStaticDecl;

  // ─── Statement methods (from lowering-stmt.ts) ─────────────────────────
  declare lowerBlock: typeof stmtMethods.lowerBlock;
  declare lowerScopedBlock: typeof stmtMethods.lowerScopedBlock;
  declare lowerStatement: typeof stmtMethods.lowerStatement;
  declare lowerLetStmt: typeof stmtMethods.lowerLetStmt;
  declare lowerConstStmt: typeof stmtMethods.lowerConstStmt;
  declare lowerReturnStmt: typeof stmtMethods.lowerReturnStmt;
  declare lowerIfStmt: typeof stmtMethods.lowerIfStmt;
  declare lowerWhileStmt: typeof stmtMethods.lowerWhileStmt;
  declare lowerForStmt: typeof stmtMethods.lowerForStmt;
  declare lowerSwitchStmt: typeof stmtMethods.lowerSwitchStmt;
  declare lowerExprStmt: typeof stmtMethods.lowerExprStmt;
  declare lowerAssertStmt: typeof stmtMethods.lowerAssertStmt;
  declare lowerRequireStmt: typeof stmtMethods.lowerRequireStmt;

  // ─── Expression methods (from lowering-expr.ts) ────────────────────────
  declare lowerExpr: typeof exprMethods.lowerExpr;
  declare lowerExprAsPtr: typeof exprMethods.lowerExprAsPtr;
  declare lowerIdentifier: typeof exprMethods.lowerIdentifier;
  declare lowerCallExpr: typeof exprMethods.lowerCallExpr;
  declare lowerMemberExpr: typeof exprMethods.lowerMemberExpr;
  declare lowerIndexExpr: typeof exprMethods.lowerIndexExpr;
  declare lowerAssignExpr: typeof exprMethods.lowerAssignExpr;
  declare lowerIfExpr: typeof exprMethods.lowerIfExpr;
  declare lowerMoveExpr: typeof exprMethods.lowerMoveExpr;
  declare lowerCastExpr: typeof exprMethods.lowerCastExpr;
  declare findConstIntInst: typeof exprMethods.findConstIntInst;

  // ─── Literal methods (from lowering-literals.ts) ────────────────────────
  declare lowerIntLiteral: typeof literalMethods.lowerIntLiteral;
  declare lowerFloatLiteral: typeof literalMethods.lowerFloatLiteral;
  declare lowerStringLiteral: typeof literalMethods.lowerStringLiteral;
  declare lowerBoolLiteral: typeof literalMethods.lowerBoolLiteral;
  declare lowerNullLiteral: typeof literalMethods.lowerNullLiteral;
  declare lowerStructLiteral: typeof literalMethods.lowerStructLiteral;
  declare lowerArrayLiteral: typeof literalMethods.lowerArrayLiteral;

  // ─── Operator methods (from lowering-operators.ts) ──────────────────────
  declare lowerBinaryExpr: typeof operatorMethods.lowerBinaryExpr;
  declare lowerShortCircuitAnd: typeof operatorMethods.lowerShortCircuitAnd;
  declare lowerShortCircuitOr: typeof operatorMethods.lowerShortCircuitOr;
  declare lowerUnaryExpr: typeof operatorMethods.lowerUnaryExpr;
  declare lowerOperatorMethodCall: typeof operatorMethods.lowerOperatorMethodCall;
  declare lowerIncrementExpr: typeof operatorMethods.lowerIncrementExpr;
  declare lowerDecrementExpr: typeof operatorMethods.lowerDecrementExpr;

  // ─── Error handling methods (from lowering-error.ts) ────────────────────
  declare lowerThrowExpr: typeof errorMethods.lowerThrowExpr;
  declare lowerCatchExpr: typeof errorMethods.lowerCatchExpr;
  declare resolveCallThrowsInfo: typeof errorMethods.resolveCallThrowsInfo;
  declare lowerCatchThrowPropagation: typeof errorMethods.lowerCatchThrowPropagation;

  // ─── Type conversion methods (from lowering-types.ts) ───────────────────
  declare getExprKirType: typeof typeMethods.getExprKirType;
  declare lowerCheckerType: typeof typeMethods.lowerCheckerType;
  declare lowerTypeNode: typeof typeMethods.lowerTypeNode;
  declare resolveParamType: typeof typeMethods.resolveParamType;
  declare resolveParamCheckerType: typeof typeMethods.resolveParamCheckerType;
  declare getFunctionReturnType: typeof typeMethods.getFunctionReturnType;
  declare nameToCheckerType: typeof typeMethods.nameToCheckerType;
  declare resolveSizeofArg: typeof typeMethods.resolveSizeofArg;
  declare sizeofTypeName: typeof typeMethods.sizeofTypeName;
  declare sizeofCheckerType: typeof typeMethods.sizeofCheckerType;
  declare mangleFunctionName: typeof typeMethods.mangleFunctionName;
  declare mangleFunctionNameFromType: typeof typeMethods.mangleFunctionNameFromType;
  declare typeNameSuffix: typeof typeMethods.typeNameSuffix;
  declare checkerTypeSuffix: typeof typeMethods.checkerTypeSuffix;

  // ─── Scope/lifecycle methods (from lowering-scope.ts) ───────────────────
  declare getStructLifecycle: typeof scopeMethods.getStructLifecycle;
  declare pushScope: typeof scopeMethods.pushScope;
  declare popScopeWithDestroy: typeof scopeMethods.popScopeWithDestroy;
  declare emitScopeDestroys: typeof scopeMethods.emitScopeDestroys;
  declare emitAllScopeDestroys: typeof scopeMethods.emitAllScopeDestroys;
  declare emitAllScopeDestroysExceptNamed: typeof scopeMethods.emitAllScopeDestroysExceptNamed;
  declare trackScopeVar: typeof scopeMethods.trackScopeVar;
  declare trackScopeVarByType: typeof scopeMethods.trackScopeVarByType;

  // ─── Utility methods (from lowering-utils.ts) ──────────────────────────
  declare freshVar: typeof utilMethods.freshVar;
  declare freshBlockId: typeof utilMethods.freshBlockId;
  declare emit: typeof utilMethods.emit;
  declare emitConstInt: typeof utilMethods.emitConstInt;
  declare setTerminator: typeof utilMethods.setTerminator;
  declare isBlockTerminated: typeof utilMethods.isBlockTerminated;
  declare sealCurrentBlock: typeof utilMethods.sealCurrentBlock;
  declare startBlock: typeof utilMethods.startBlock;
  declare ensureTerminator: typeof utilMethods.ensureTerminator;
  declare isStackAllocVar: typeof utilMethods.isStackAllocVar;
  declare mapBinOp: typeof utilMethods.mapBinOp;
  declare mapCompoundAssignOp: typeof utilMethods.mapCompoundAssignOp;
  declare emitStackAlloc: typeof utilMethods.emitStackAlloc;
  declare emitFieldLoad: typeof utilMethods.emitFieldLoad;
  declare emitTagIsSuccess: typeof utilMethods.emitTagIsSuccess;
  declare emitCastToPtr: typeof utilMethods.emitCastToPtr;
  declare emitLoadModifyStore: typeof utilMethods.emitLoadModifyStore;
}

// ─── Attach extracted methods to KirLowerer prototype ─────────────────────────

// Declaration methods
KirLowerer.prototype.lowerDeclaration = declMethods.lowerDeclaration;
KirLowerer.prototype.lowerFunction = declMethods.lowerFunction;
KirLowerer.prototype.lowerMethod = declMethods.lowerMethod;
KirLowerer.prototype.lowerExternFunction = declMethods.lowerExternFunction;
KirLowerer.prototype.lowerStructDecl = declMethods.lowerStructDecl;
KirLowerer.prototype.lowerMonomorphizedStruct = declMethods.lowerMonomorphizedStruct;
KirLowerer.prototype.lowerMonomorphizedFunction = declMethods.lowerMonomorphizedFunction;
KirLowerer.prototype.lowerEnumDecl = declMethods.lowerEnumDecl;
KirLowerer.prototype.lowerStaticDecl = declMethods.lowerStaticDecl;

// Statement methods
KirLowerer.prototype.lowerBlock = stmtMethods.lowerBlock;
KirLowerer.prototype.lowerScopedBlock = stmtMethods.lowerScopedBlock;
KirLowerer.prototype.lowerStatement = stmtMethods.lowerStatement;
KirLowerer.prototype.lowerLetStmt = stmtMethods.lowerLetStmt;
KirLowerer.prototype.lowerConstStmt = stmtMethods.lowerConstStmt;
KirLowerer.prototype.lowerReturnStmt = stmtMethods.lowerReturnStmt;
KirLowerer.prototype.lowerIfStmt = stmtMethods.lowerIfStmt;
KirLowerer.prototype.lowerWhileStmt = stmtMethods.lowerWhileStmt;
KirLowerer.prototype.lowerForStmt = stmtMethods.lowerForStmt;
KirLowerer.prototype.lowerSwitchStmt = stmtMethods.lowerSwitchStmt;
KirLowerer.prototype.lowerExprStmt = stmtMethods.lowerExprStmt;
KirLowerer.prototype.lowerAssertStmt = stmtMethods.lowerAssertStmt;
KirLowerer.prototype.lowerRequireStmt = stmtMethods.lowerRequireStmt;

// Expression methods
KirLowerer.prototype.lowerExpr = exprMethods.lowerExpr;
KirLowerer.prototype.lowerExprAsPtr = exprMethods.lowerExprAsPtr;
KirLowerer.prototype.lowerIdentifier = exprMethods.lowerIdentifier;
KirLowerer.prototype.lowerCallExpr = exprMethods.lowerCallExpr;
KirLowerer.prototype.lowerMemberExpr = exprMethods.lowerMemberExpr;
KirLowerer.prototype.lowerIndexExpr = exprMethods.lowerIndexExpr;
KirLowerer.prototype.lowerAssignExpr = exprMethods.lowerAssignExpr;
KirLowerer.prototype.lowerIfExpr = exprMethods.lowerIfExpr;
KirLowerer.prototype.lowerMoveExpr = exprMethods.lowerMoveExpr;
KirLowerer.prototype.lowerCastExpr = exprMethods.lowerCastExpr;
KirLowerer.prototype.findConstIntInst = exprMethods.findConstIntInst;

// Literal methods
KirLowerer.prototype.lowerIntLiteral = literalMethods.lowerIntLiteral;
KirLowerer.prototype.lowerFloatLiteral = literalMethods.lowerFloatLiteral;
KirLowerer.prototype.lowerStringLiteral = literalMethods.lowerStringLiteral;
KirLowerer.prototype.lowerBoolLiteral = literalMethods.lowerBoolLiteral;
KirLowerer.prototype.lowerNullLiteral = literalMethods.lowerNullLiteral;
KirLowerer.prototype.lowerStructLiteral = literalMethods.lowerStructLiteral;
KirLowerer.prototype.lowerArrayLiteral = literalMethods.lowerArrayLiteral;

// Operator methods
KirLowerer.prototype.lowerBinaryExpr = operatorMethods.lowerBinaryExpr;
KirLowerer.prototype.lowerShortCircuitAnd = operatorMethods.lowerShortCircuitAnd;
KirLowerer.prototype.lowerShortCircuitOr = operatorMethods.lowerShortCircuitOr;
KirLowerer.prototype.lowerUnaryExpr = operatorMethods.lowerUnaryExpr;
KirLowerer.prototype.lowerOperatorMethodCall = operatorMethods.lowerOperatorMethodCall;
KirLowerer.prototype.lowerIncrementExpr = operatorMethods.lowerIncrementExpr;
KirLowerer.prototype.lowerDecrementExpr = operatorMethods.lowerDecrementExpr;

// Error handling methods
KirLowerer.prototype.lowerThrowExpr = errorMethods.lowerThrowExpr;
KirLowerer.prototype.lowerCatchExpr = errorMethods.lowerCatchExpr;
KirLowerer.prototype.resolveCallThrowsInfo = errorMethods.resolveCallThrowsInfo;
KirLowerer.prototype.lowerCatchThrowPropagation = errorMethods.lowerCatchThrowPropagation;

// Type conversion methods
KirLowerer.prototype.getExprKirType = typeMethods.getExprKirType;
KirLowerer.prototype.lowerCheckerType = typeMethods.lowerCheckerType;
KirLowerer.prototype.lowerTypeNode = typeMethods.lowerTypeNode;
KirLowerer.prototype.resolveParamType = typeMethods.resolveParamType;
KirLowerer.prototype.resolveParamCheckerType = typeMethods.resolveParamCheckerType;
KirLowerer.prototype.getFunctionReturnType = typeMethods.getFunctionReturnType;
KirLowerer.prototype.nameToCheckerType = typeMethods.nameToCheckerType;
KirLowerer.prototype.resolveSizeofArg = typeMethods.resolveSizeofArg;
KirLowerer.prototype.sizeofTypeName = typeMethods.sizeofTypeName;
KirLowerer.prototype.sizeofCheckerType = typeMethods.sizeofCheckerType;
KirLowerer.prototype.mangleFunctionName = typeMethods.mangleFunctionName;
KirLowerer.prototype.mangleFunctionNameFromType = typeMethods.mangleFunctionNameFromType;
KirLowerer.prototype.typeNameSuffix = typeMethods.typeNameSuffix;
KirLowerer.prototype.checkerTypeSuffix = typeMethods.checkerTypeSuffix;

// Scope/lifecycle methods
KirLowerer.prototype.getStructLifecycle = scopeMethods.getStructLifecycle;
KirLowerer.prototype.pushScope = scopeMethods.pushScope;
KirLowerer.prototype.popScopeWithDestroy = scopeMethods.popScopeWithDestroy;
KirLowerer.prototype.emitScopeDestroys = scopeMethods.emitScopeDestroys;
KirLowerer.prototype.emitAllScopeDestroys = scopeMethods.emitAllScopeDestroys;
KirLowerer.prototype.emitAllScopeDestroysExceptNamed = scopeMethods.emitAllScopeDestroysExceptNamed;
KirLowerer.prototype.trackScopeVar = scopeMethods.trackScopeVar;
KirLowerer.prototype.trackScopeVarByType = scopeMethods.trackScopeVarByType;

// Utility methods
KirLowerer.prototype.freshVar = utilMethods.freshVar;
KirLowerer.prototype.freshBlockId = utilMethods.freshBlockId;
KirLowerer.prototype.emit = utilMethods.emit;
KirLowerer.prototype.emitConstInt = utilMethods.emitConstInt;
KirLowerer.prototype.setTerminator = utilMethods.setTerminator;
KirLowerer.prototype.isBlockTerminated = utilMethods.isBlockTerminated;
KirLowerer.prototype.sealCurrentBlock = utilMethods.sealCurrentBlock;
KirLowerer.prototype.startBlock = utilMethods.startBlock;
KirLowerer.prototype.ensureTerminator = utilMethods.ensureTerminator;
KirLowerer.prototype.isStackAllocVar = utilMethods.isStackAllocVar;
KirLowerer.prototype.mapBinOp = utilMethods.mapBinOp;
KirLowerer.prototype.mapCompoundAssignOp = utilMethods.mapCompoundAssignOp;
KirLowerer.prototype.emitStackAlloc = utilMethods.emitStackAlloc;
KirLowerer.prototype.emitFieldLoad = utilMethods.emitFieldLoad;
KirLowerer.prototype.emitTagIsSuccess = utilMethods.emitTagIsSuccess;
KirLowerer.prototype.emitCastToPtr = utilMethods.emitCastToPtr;
KirLowerer.prototype.emitLoadModifyStore = utilMethods.emitLoadModifyStore;

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

    const lowerer = new KirLowerer(
      mod.program,
      result,
      modulePrefix,
      importedNames,
      importedOverloads
    );
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
