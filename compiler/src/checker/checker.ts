/**
 * Main Checker class — orchestrates all semantic analysis.
 */

import type {
  BlockStmt,
  CallExpr,
  Declaration,
  Expression,
  ImportDecl,
  Program,
  Statement,
  TypeNode,
} from "../ast/nodes.ts";
import type { Diagnostic, SourceLocation } from "../errors/diagnostic.ts";
import { Severity } from "../errors/diagnostic.ts";
import type { Span } from "../lexer/token.ts";
import type { SourceFile } from "../utils/source.ts";
import { registerBuiltins } from "./builtins.ts";
import { DeclarationChecker } from "./decl-checker.ts";
import { ExpressionChecker } from "./expr-checker.ts";
import type { MonomorphizedFunction, MonomorphizedStruct } from "./generics.ts";
import { Scope } from "./scope.ts";
import { StatementChecker } from "./stmt-checker.ts";
import type { ScopeSymbol } from "./symbols.ts";
import { SymbolKind, typeSymbol, variableSymbol } from "./symbols.ts";
import { TypeResolver } from "./type-resolver.ts";
import type { FunctionType, StructType, Type } from "./types";
import { TypeKind, typeToString } from "./types";

export interface CheckResult {
  diagnostics: Diagnostic[];
  typeMap: Map<Expression, Type>;
  operatorMethods: Map<Expression, { methodName: string; structType: StructType }>;
  monomorphizedStructs: Map<string, MonomorphizedStruct>;
  monomorphizedFunctions: Map<string, MonomorphizedFunction>;
  /** Maps generic call/struct literal expressions to their resolved mangled names */
  genericResolutions: Map<Expression, string>;
}

/** Info about a module to check in multi-module mode */
export interface ModuleCheckInfo {
  name: string;
  program: Program;
  source: SourceFile;
  importDecls: ImportDecl[];
}

/** Result of multi-module checking */
export interface MultiModuleCheckResult {
  /** Per-module check results, keyed by module name */
  results: Map<string, CheckResult>;
  /** Combined type map across all modules */
  typeMap: Map<Expression, Type>;
  /** Combined diagnostics across all modules */
  diagnostics: Diagnostic[];
  /** Public symbols exported by each module */
  moduleExports: Map<string, Map<string, ScopeSymbol>>;
  /** Combined operator method resolution info */
  operatorMethods: Map<Expression, { methodName: string; structType: StructType }>;
  /** Combined monomorphized structs */
  monomorphizedStructs: Map<string, MonomorphizedStruct>;
  /** Combined monomorphized functions */
  monomorphizedFunctions: Map<string, MonomorphizedFunction>;
  /** Combined generic resolution info */
  genericResolutions: Map<Expression, string>;
}

export class Checker {
  private program: Program;
  private source: SourceFile;
  private diagnostics: Diagnostic[] = [];
  private typeMap: Map<Expression, Type> = new Map();
  private scopeStack: Scope[] = [];
  private typeResolver: TypeResolver;
  private exprChecker: ExpressionChecker;
  private stmtChecker: StatementChecker;
  private declChecker: DeclarationChecker;

  /** Tracks function calls that throw but haven't been wrapped in catch */
  private pendingThrowsCalls: Map<CallExpr, FunctionType> = new Map();

  /** Module exports available for import resolution (set externally for multi-module) */
  private moduleExports: Map<string, Map<string, ScopeSymbol>> = new Map();

  /** Cache of monomorphized struct types, keyed by mangled name */
  private monomorphizedStructs: Map<string, MonomorphizedStruct> = new Map();

  /** Cache of monomorphized function types, keyed by mangled name */
  private monomorphizedFunctions: Map<string, MonomorphizedFunction> = new Map();

  /** Operator overload resolution info: maps expression nodes to their resolved operator method */
  operatorMethods: Map<Expression, { methodName: string; structType: StructType }> = new Map();

  /** Maps generic call/struct literal expressions to their resolved mangled names */
  genericResolutions: Map<Expression, string> = new Map();

  /** Per-instantiation type map, set during checkMonomorphizedBodies */
  private currentBodyTypeMap: Map<Expression, Type> | null = null;
  /** Per-instantiation generic resolutions, set during checkMonomorphizedBodies */
  private currentBodyGenericResolutions: Map<Expression, string> | null = null;

  constructor(program: Program, source: SourceFile) {
    this.program = program;
    this.source = source;
    this.typeResolver = new TypeResolver();
    this.exprChecker = new ExpressionChecker(this);
    this.stmtChecker = new StatementChecker(this);
    this.declChecker = new DeclarationChecker(this);

    // Create global scope with builtins
    const globalScope = new Scope();
    registerBuiltins(globalScope);
    this.scopeStack.push(globalScope);
  }

  /** Set available module exports for import resolution */
  setModuleExports(exports: Map<string, Map<string, ScopeSymbol>>): void {
    this.moduleExports = exports;
  }

  /** Get module exports (used by decl-checker) */
  getModuleExports(): Map<string, Map<string, ScopeSymbol>> {
    return this.moduleExports;
  }

  /**
   * Collect public symbols from this checker's program after checking.
   * Returns a map of public symbol name → ScopeSymbol.
   */
  collectPublicSymbols(): Map<string, ScopeSymbol> {
    const pubSymbols = new Map<string, ScopeSymbol>();
    for (const decl of this.program.declarations) {
      this.collectDeclPublicSymbol(decl, pubSymbols);
    }
    return pubSymbols;
  }

  private collectDeclPublicSymbol(decl: Declaration, out: Map<string, ScopeSymbol>): void {
    switch (decl.kind) {
      case "FunctionDecl":
        if (decl.isPublic) {
          const sym = this.currentScope.lookup(decl.name);
          if (sym) out.set(decl.name, sym);
        }
        break;
      case "StructDecl":
      case "UnsafeStructDecl":
        if (decl.isPublic) {
          const sym = this.currentScope.lookupType(decl.name);
          if (sym) out.set(decl.name, sym);
        }
        break;
      case "EnumDecl":
        if (decl.isPublic) {
          const sym = this.currentScope.lookupType(decl.name);
          if (sym) out.set(decl.name, sym);
        }
        break;
      case "TypeAlias":
        if (decl.isPublic) {
          const sym = this.currentScope.lookupType(decl.name);
          if (sym) out.set(decl.name, sym);
        }
        break;
      case "StaticDecl":
        if (decl.isPublic) {
          const sym = this.currentScope.lookup(decl.name);
          if (sym) out.set(decl.name, sym);
        }
        break;
      case "ExternFunctionDecl":
        // Extern functions are always accessible (they don't have pub yet)
        // In multi-module, they won't be exported unless the module re-exports them
        break;
      case "ImportDecl":
        // Imports are not re-exported
        break;
    }
  }

  /** Main entry point — check entire program. */
  check(): CheckResult {
    // Pass 1: Register all top-level declarations
    for (const decl of this.program.declarations) {
      this.declChecker.registerDeclaration(decl);
    }

    // Pass 2: Check all declarations
    for (const decl of this.program.declarations) {
      this.declChecker.checkDeclaration(decl);
    }

    // Check for unhandled throws calls
    for (const [callExpr, funcType] of this.pendingThrowsCalls) {
      const throwNames = funcType.throwsTypes.map((t) => typeToString(t)).join(", ");
      this.error(`call to function that throws (${throwNames}) must use 'catch'`, callExpr.span);
    }

    // Pass 3: Check bodies of monomorphized generic functions
    this.checkMonomorphizedBodies();

    return {
      diagnostics: this.diagnostics,
      typeMap: this.typeMap,
      operatorMethods: this.operatorMethods,
      monomorphizedStructs: this.monomorphizedStructs,
      monomorphizedFunctions: this.monomorphizedFunctions,
      genericResolutions: this.genericResolutions,
    };
  }

  /**
   * Check the bodies of monomorphized generic functions so that all expressions
   * inside them get entries in the typeMap (needed for KIR lowering).
   */
  private checkMonomorphizedBodies(): void {
    for (const [_mangledName, monoFunc] of this.monomorphizedFunctions) {
      if (!monoFunc.declaration) {
        // Try to find the declaration from the program
        for (const decl of this.program.declarations) {
          if (
            decl.kind === "FunctionDecl" &&
            decl.name === monoFunc.originalName &&
            decl.genericParams.length > 0
          ) {
            monoFunc.declaration = decl;
            break;
          }
        }
      }
      if (!monoFunc.declaration) continue;

      const decl = monoFunc.declaration;
      const concreteType = monoFunc.concrete;

      // Build type parameter substitution map (e.g. A→i32, B→bool)
      // so that struct literals like Pair<A, B>{...} resolve correctly
      const typeSubs = new Map<string, Type>();
      for (let i = 0; i < decl.genericParams.length; i++) {
        const paramName = decl.genericParams[i];
        const concreteArg = monoFunc.typeArgs[i];
        if (paramName && concreteArg) {
          typeSubs.set(paramName, concreteArg);
        }
      }
      this.typeResolver.setSubstitutions(typeSubs);

      // Set up per-instantiation type map to avoid shared-AST conflicts
      const bodyTypeMap = new Map<Expression, Type>();
      const bodyGenericResolutions = new Map<Expression, string>();
      this.currentBodyTypeMap = bodyTypeMap;
      this.currentBodyGenericResolutions = bodyGenericResolutions;

      // Push a function scope with concrete param types
      this.pushScope({ functionContext: concreteType });

      for (let i = 0; i < decl.params.length; i++) {
        // biome-ignore lint/style/noNonNullAssertion: index is bounded by decl.params.length
        const param = decl.params[i]!;
        const paramType = concreteType.params[i]?.type ?? ({ kind: TypeKind.Void } as Type);
        this.defineVariable(param.name, paramType, param.isMut, false, param.span);
      }

      // Check body statements — this populates typeMap for all expressions
      for (const stmt of decl.body.statements) {
        this.checkStatement(stmt);
      }

      this.popScope();
      this.typeResolver.clearSubstitutions();
      this.currentBodyTypeMap = null;
      this.currentBodyGenericResolutions = null;

      // Store per-instantiation maps on the monomorphized function
      monoFunc.bodyTypeMap = bodyTypeMap;
      monoFunc.bodyGenericResolutions = bodyGenericResolutions;
    }

    // Also store struct declarations in MonomorphizedStruct
    for (const [_mangledName, monoStruct] of this.monomorphizedStructs) {
      if (!monoStruct.originalDecl) {
        for (const decl of this.program.declarations) {
          if (
            (decl.kind === "StructDecl" || decl.kind === "UnsafeStructDecl") &&
            decl.name === monoStruct.original.name &&
            decl.genericParams.length > 0
          ) {
            monoStruct.originalDecl = decl;
            break;
          }
        }
      }
    }
  }

  /**
   * Check multiple modules in topological order (dependencies first).
   * Returns combined results for all modules.
   */
  static checkModules(modules: ModuleCheckInfo[]): MultiModuleCheckResult {
    const moduleExports = new Map<string, Map<string, ScopeSymbol>>();
    const allResults = new Map<string, CheckResult>();
    const combinedTypeMap = new Map<Expression, Type>();
    const combinedDiags: Diagnostic[] = [];
    const combinedOpMethods = new Map<Expression, { methodName: string; structType: StructType }>();
    const combinedMonoStructs = new Map<string, MonomorphizedStruct>();
    const combinedMonoFuncs = new Map<string, MonomorphizedFunction>();
    const combinedGenericResolutions = new Map<Expression, string>();

    for (const mod of modules) {
      const checker = new Checker(mod.program, mod.source);
      checker.setModuleExports(moduleExports);

      const result = checker.check();
      allResults.set(mod.name, result);

      // Merge type maps, diagnostics, operator methods, and monomorphized maps
      for (const [expr, type] of result.typeMap) {
        combinedTypeMap.set(expr, type);
      }
      for (const [expr, info] of result.operatorMethods) {
        combinedOpMethods.set(expr, info);
      }
      for (const [name, mono] of result.monomorphizedStructs) {
        combinedMonoStructs.set(name, mono);
      }
      for (const [name, mono] of result.monomorphizedFunctions) {
        combinedMonoFuncs.set(name, mono);
      }
      for (const [expr, name] of result.genericResolutions) {
        combinedGenericResolutions.set(expr, name);
      }
      combinedDiags.push(...result.diagnostics);

      // Collect this module's public symbols for use by later modules
      const pubSymbols = checker.collectPublicSymbols();
      moduleExports.set(mod.name, pubSymbols);
    }

    return {
      results: allResults,
      typeMap: combinedTypeMap,
      diagnostics: combinedDiags,
      moduleExports,
      operatorMethods: combinedOpMethods,
      monomorphizedStructs: combinedMonoStructs,
      monomorphizedFunctions: combinedMonoFuncs,
      genericResolutions: combinedGenericResolutions,
    };
  }

  // ─── Scope Management ─────────────────────────────────────────────────

  get currentScope(): Scope {
    const scope = this.scopeStack[this.scopeStack.length - 1];
    if (!scope) throw new Error("scope stack is empty");
    return scope;
  }

  pushScope(
    options: { isUnsafe?: boolean; isLoop?: boolean; functionContext?: FunctionType | null } = {}
  ): void {
    const newScope = new Scope(this.currentScope, options);
    this.scopeStack.push(newScope);
  }

  popScope(): void {
    if (this.scopeStack.length > 1) {
      this.scopeStack.pop();
    }
  }

  // ─── Delegated Checking Methods ───────────────────────────────────────

  checkExpression(expr: Expression): Type {
    return this.exprChecker.checkExpression(expr);
  }

  checkStatement(stmt: Statement): boolean {
    return this.stmtChecker.checkStatement(stmt);
  }

  /** Resolve an AST TypeNode to an internal Type. */
  resolveType(node: TypeNode): Type {
    const type = this.typeResolver.resolve(node, this.currentScope);
    // Collect resolver diagnostics
    for (const diag of this.typeResolver.getDiagnostics()) {
      const loc = this.spanToLocation(diag.span);
      this.diagnostics.push({
        severity: Severity.Error,
        message: diag.message,
        location: loc,
      });
    }
    this.typeResolver.clearDiagnostics();
    return type;
  }

  /** Check a block and return the type of the last expression (for if expressions). */
  checkBlockExpressionType(block: BlockStmt): Type {
    this.pushScope({});
    let lastType: Type = { kind: TypeKind.Void };

    for (const stmt of block.statements) {
      if (stmt.kind === "ExprStmt") {
        lastType = this.checkExpression(stmt.expression);
      } else {
        this.checkStatement(stmt);
        lastType = { kind: TypeKind.Void };
      }
    }

    this.popScope();
    return lastType;
  }

  // ─── Symbol Management ────────────────────────────────────────────────

  defineVariable(name: string, type: Type, isMutable: boolean, isConst: boolean, span: Span): void {
    const sym = variableSymbol(name, type, isMutable, isConst);
    if (!this.currentScope.define(sym)) {
      this.error(`duplicate variable '${name}' in same scope`, span);
    }
  }

  markVariableMoved(name: string): void {
    // Walk up scopes to find the variable
    let scope: Scope | null = this.currentScope;
    while (scope) {
      const sym = scope.symbols.get(name);
      if (sym && sym.kind === SymbolKind.Variable) {
        sym.isMoved = true;
        return;
      }
      scope = scope.parent;
    }
  }

  // ─── Type Map ─────────────────────────────────────────────────────────

  setExprType(expr: Expression, type: Type): void {
    this.typeMap.set(expr, type);
    if (this.currentBodyTypeMap) {
      this.currentBodyTypeMap.set(expr, type);
    }
  }

  setGenericResolution(expr: Expression, mangledName: string): void {
    this.genericResolutions.set(expr, mangledName);
    if (this.currentBodyGenericResolutions) {
      this.currentBodyGenericResolutions.set(expr, mangledName);
    }
  }

  // ─── Throws Tracking ──────────────────────────────────────────────────

  flagThrowsCall(callExpr: CallExpr, funcType: FunctionType): void {
    this.pendingThrowsCalls.set(callExpr, funcType);
  }

  clearThrowsCall(callExpr: CallExpr): void {
    this.pendingThrowsCalls.delete(callExpr);
  }

  getThrowsInfo(expr: Expression): Type[] | null {
    if (expr.kind === "CallExpr") {
      const ft = this.pendingThrowsCalls.get(expr);
      if (ft) return ft.throwsTypes;

      // Try to re-derive from callee type
      const calleeType = this.typeMap.get(expr);
      if (calleeType && calleeType.kind === TypeKind.Function) {
        return calleeType.throwsTypes;
      }

      // Check if callee is an identifier pointing to a function
      if (expr.callee.kind === "Identifier") {
        const sym = this.currentScope.lookup(expr.callee.name);
        if (sym && sym.kind === SymbolKind.Function) {
          return sym.type.throwsTypes;
        }
      }
    }
    return null;
  }

  // ─── Monomorphization Cache ─────────────────────────────────────────

  getMonomorphizedStruct(mangledName: string): MonomorphizedStruct | undefined {
    return this.monomorphizedStructs.get(mangledName);
  }

  registerMonomorphizedStruct(mangledName: string, info: MonomorphizedStruct): void {
    this.monomorphizedStructs.set(mangledName, info);
    // Also register the concrete struct as a type in the current scope so KIR can find it
    const sym = typeSymbol(mangledName, info.concrete);
    this.currentScope.define(sym);
  }

  getMonomorphizedFunction(mangledName: string): MonomorphizedFunction | undefined {
    return this.monomorphizedFunctions.get(mangledName);
  }

  registerMonomorphizedFunction(mangledName: string, info: MonomorphizedFunction): void {
    this.monomorphizedFunctions.set(mangledName, info);
  }

  getAllMonomorphizedStructs(): Map<string, MonomorphizedStruct> {
    return this.monomorphizedStructs;
  }

  getAllMonomorphizedFunctions(): Map<string, MonomorphizedFunction> {
    return this.monomorphizedFunctions;
  }

  // ─── Diagnostics ──────────────────────────────────────────────────────

  error(message: string, span: Span): void {
    this.diagnostics.push({
      severity: Severity.Error,
      message,
      location: this.spanToLocation(span),
    });
  }

  warning(message: string, span: Span): void {
    this.diagnostics.push({
      severity: Severity.Warning,
      message,
      location: this.spanToLocation(span),
    });
  }

  private spanToLocation(span: Span): SourceLocation {
    const lc = this.source.lineCol(span.start);
    return {
      file: this.source.filename,
      line: lc.line,
      column: lc.column,
      offset: span.start,
    };
  }
}
