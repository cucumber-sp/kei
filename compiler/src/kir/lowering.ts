/**
 * AST → KIR lowering pass.
 *
 * Takes a type-checked AST (Program + CheckResult) and produces a KirModule.
 * Uses simple per-block variable tracking (no phi nodes / full SSA yet).
 *
 * Method implementations are split across:
 *   - lowering-decl.ts  (declaration lowering)
 *   - lowering-stmt.ts  (statement lowering)
 *   - lowering-expr.ts  (expression lowering)
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

// Import extracted method implementations
import * as declMethods from "./lowering-decl.ts";
import * as stmtMethods from "./lowering-stmt.ts";
import * as exprMethods from "./lowering-expr.ts";

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
  private structLifecycleCache: Map<string, { hasDestroy: boolean; hasOncopy: boolean }> = new Map();

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
  declare lowerIntLiteral: typeof exprMethods.lowerIntLiteral;
  declare lowerFloatLiteral: typeof exprMethods.lowerFloatLiteral;
  declare lowerStringLiteral: typeof exprMethods.lowerStringLiteral;
  declare lowerBoolLiteral: typeof exprMethods.lowerBoolLiteral;
  declare lowerNullLiteral: typeof exprMethods.lowerNullLiteral;
  declare lowerExprAsPtr: typeof exprMethods.lowerExprAsPtr;
  declare lowerIdentifier: typeof exprMethods.lowerIdentifier;
  declare lowerBinaryExpr: typeof exprMethods.lowerBinaryExpr;
  declare lowerShortCircuitAnd: typeof exprMethods.lowerShortCircuitAnd;
  declare lowerShortCircuitOr: typeof exprMethods.lowerShortCircuitOr;
  declare lowerUnaryExpr: typeof exprMethods.lowerUnaryExpr;
  declare lowerOperatorMethodCall: typeof exprMethods.lowerOperatorMethodCall;
  declare lowerCallExpr: typeof exprMethods.lowerCallExpr;
  declare lowerMemberExpr: typeof exprMethods.lowerMemberExpr;
  declare lowerIndexExpr: typeof exprMethods.lowerIndexExpr;
  declare lowerAssignExpr: typeof exprMethods.lowerAssignExpr;
  declare lowerStructLiteral: typeof exprMethods.lowerStructLiteral;
  declare lowerArrayLiteral: typeof exprMethods.lowerArrayLiteral;
  declare lowerIfExpr: typeof exprMethods.lowerIfExpr;
  declare lowerIncrementExpr: typeof exprMethods.lowerIncrementExpr;
  declare lowerDecrementExpr: typeof exprMethods.lowerDecrementExpr;
  declare lowerMoveExpr: typeof exprMethods.lowerMoveExpr;
  declare lowerCastExpr: typeof exprMethods.lowerCastExpr;
  declare lowerThrowExpr: typeof exprMethods.lowerThrowExpr;
  declare lowerCatchExpr: typeof exprMethods.lowerCatchExpr;
  declare resolveCallThrowsInfo: typeof exprMethods.resolveCallThrowsInfo;
  declare lowerCatchThrowPropagation: typeof exprMethods.lowerCatchThrowPropagation;
  declare findConstIntInst: typeof exprMethods.findConstIntInst;

  // ─── Helpers ─────────────────────────────────────────────────────────────

  freshVar(): VarId {
    return `%${this.varCounter++}`;
  }

  freshBlockId(prefix: string): BlockId {
    return `${prefix}.${this.blockCounter++}`;
  }

  emit(inst: KirInst): void {
    this.currentInsts.push(inst);
  }

  emitConstInt(value: number): VarId {
    const dest = this.freshVar();
    this.emit({ kind: "const_int", dest, type: { kind: "int", bits: 32, signed: true }, value });
    return dest;
  }

  setTerminator(term: KirTerminator): void {
    // Only set terminator if block hasn't been terminated yet
    if (!this.isBlockTerminated()) {
      (this as any)._pendingTerminator = term;
    }
  }

  isBlockTerminated(): boolean {
    return (this as any)._pendingTerminator != null;
  }

  sealCurrentBlock(): void {
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

  startBlock(id: BlockId): void {
    this.currentBlockId = id;
    this.currentInsts = [];
    (this as any)._pendingTerminator = null;
  }

  ensureTerminator(returnType: KirType): void {
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

  isStackAllocVar(varId: VarId): boolean {
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
  getStructLifecycle(checkerType: Type | undefined): { hasDestroy: boolean; hasOncopy: boolean; structName: string } | null {
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
  pushScope(): void {
    this.scopeStack.push([]);
  }

  /** Pop scope and emit destroy for all live variables in reverse declaration order */
  popScopeWithDestroy(): void {
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
  emitAllScopeDestroys(): void {
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      this.emitScopeDestroys(this.scopeStack[i]);
    }
  }

  /** Emit destroys for all scopes, but skip a named variable (the returned value) */
  emitAllScopeDestroysExceptNamed(skipName: string | null): void {
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
  trackScopeVar(name: string, varId: VarId, expr: Expression): void {
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
  trackScopeVarByType(name: string, varId: VarId, checkerType: Type | undefined): void {
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

  getExprKirType(expr: Expression): KirType {
    const checkerType = this.checkResult.typeMap.get(expr);
    if (checkerType) {
      return this.lowerCheckerType(checkerType);
    }
    // Default fallback
    return { kind: "int", bits: 32, signed: true };
  }

  lowerCheckerType(t: Type): KirType {
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

  lowerTypeNode(typeNode: { kind: string; name: string }): KirType {
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

  resolveParamType(decl: FunctionDecl, paramName: string): KirType {
    const param = decl.params.find((p) => p.name === paramName);
    if (param) {
      return this.lowerTypeNode(param.typeAnnotation);
    }
    return { kind: "int", bits: 32, signed: true };
  }

  resolveParamCheckerType(decl: FunctionDecl, paramName: string): Type | undefined {
    const param = decl.params.find((p) => p.name === paramName);
    if (param) {
      return this.nameToCheckerType(param.typeAnnotation.name) as Type;
    }
    return undefined;
  }

  getFunctionReturnType(decl: FunctionDecl): Type {
    // Try to get from the checker's type map
    // The function decl itself isn't in typeMap, but we can derive from return type annotation
    if (decl.returnType) {
      const name = decl.returnType.name;
      const checkerType = this.nameToCheckerType(name);
      // If nameToCheckerType didn't recognize it (returns void for struct names),
      // treat it as a struct type so lowerMethod gets the correct KIR return type
      if (checkerType.kind === "void" && name !== "void") {
        return { kind: "struct" as const, name, fields: new Map(), methods: new Map(), isUnsafe: false, genericParams: [] };
      }
      return checkerType;
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

  mapBinOp(op: string): BinOp | null {
    const map: Record<string, BinOp> = {
      "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "mod",
      "==": "eq", "!=": "neq", "<": "lt", ">": "gt", "<=": "lte", ">=": "gte",
      "&": "bit_and", "|": "bit_or", "^": "bit_xor", "<<": "shl", ">>": "shr",
      "&&": "and", "||": "or",
    };
    return map[op] ?? null;
  }

  /** Build a mangled function name from a FunctionDecl (for overloaded definitions). */
  mangleFunctionName(baseName: string, decl: FunctionDecl): string {
    const paramSuffixes = decl.params.map((p) => this.typeNameSuffix(p.typeAnnotation.name));
    return `${baseName}_${paramSuffixes.join("_")}`;
  }

  /** Build a mangled function name from a resolved FunctionType (for overloaded calls). */
  mangleFunctionNameFromType(baseName: string, funcType: FunctionType): string {
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

  mapCompoundAssignOp(op: string): BinOp | null {
    const map: Record<string, BinOp> = {
      "+=": "add", "-=": "sub", "*=": "mul", "/=": "div", "%=": "mod",
      "&=": "bit_and", "|=": "bit_or", "^=": "bit_xor", "<<=": "shl", ">>=": "shr",
    };
    return map[op] ?? null;
  }
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
KirLowerer.prototype.lowerIntLiteral = exprMethods.lowerIntLiteral;
KirLowerer.prototype.lowerFloatLiteral = exprMethods.lowerFloatLiteral;
KirLowerer.prototype.lowerStringLiteral = exprMethods.lowerStringLiteral;
KirLowerer.prototype.lowerBoolLiteral = exprMethods.lowerBoolLiteral;
KirLowerer.prototype.lowerNullLiteral = exprMethods.lowerNullLiteral;
KirLowerer.prototype.lowerExprAsPtr = exprMethods.lowerExprAsPtr;
KirLowerer.prototype.lowerIdentifier = exprMethods.lowerIdentifier;
KirLowerer.prototype.lowerBinaryExpr = exprMethods.lowerBinaryExpr;
KirLowerer.prototype.lowerShortCircuitAnd = exprMethods.lowerShortCircuitAnd;
KirLowerer.prototype.lowerShortCircuitOr = exprMethods.lowerShortCircuitOr;
KirLowerer.prototype.lowerUnaryExpr = exprMethods.lowerUnaryExpr;
KirLowerer.prototype.lowerOperatorMethodCall = exprMethods.lowerOperatorMethodCall;
KirLowerer.prototype.lowerCallExpr = exprMethods.lowerCallExpr;
KirLowerer.prototype.lowerMemberExpr = exprMethods.lowerMemberExpr;
KirLowerer.prototype.lowerIndexExpr = exprMethods.lowerIndexExpr;
KirLowerer.prototype.lowerAssignExpr = exprMethods.lowerAssignExpr;
KirLowerer.prototype.lowerStructLiteral = exprMethods.lowerStructLiteral;
KirLowerer.prototype.lowerArrayLiteral = exprMethods.lowerArrayLiteral;
KirLowerer.prototype.lowerIfExpr = exprMethods.lowerIfExpr;
KirLowerer.prototype.lowerIncrementExpr = exprMethods.lowerIncrementExpr;
KirLowerer.prototype.lowerDecrementExpr = exprMethods.lowerDecrementExpr;
KirLowerer.prototype.lowerMoveExpr = exprMethods.lowerMoveExpr;
KirLowerer.prototype.lowerCastExpr = exprMethods.lowerCastExpr;
KirLowerer.prototype.lowerThrowExpr = exprMethods.lowerThrowExpr;
KirLowerer.prototype.lowerCatchExpr = exprMethods.lowerCatchExpr;
KirLowerer.prototype.resolveCallThrowsInfo = exprMethods.resolveCallThrowsInfo;
KirLowerer.prototype.lowerCatchThrowPropagation = exprMethods.lowerCatchThrowPropagation;
KirLowerer.prototype.findConstIntInst = exprMethods.findConstIntInst;

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
