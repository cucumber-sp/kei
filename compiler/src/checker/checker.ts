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
  SwitchCase,
  TypeNode,
} from "../ast/nodes";
import type { Diagnostics } from "../diagnostics";
import { createDiagnostics } from "../diagnostics";
import type { Diagnostic, SourceLocation } from "../errors/diagnostic";
import { Severity } from "../errors/diagnostic";
import type { Span } from "../lexer/token";
import type { Lifecycle, LifecycleDecision } from "../lifecycle";
import { createLifecycle } from "../lifecycle";
import type {
  Monomorphization,
  MonomorphizedFunction,
  MonomorphizedProduct,
  MonomorphizedStruct,
} from "../monomorphization";
import { createMonomorphization, mangleGenericName, substituteType } from "../monomorphization";
import type { SourceFile } from "../utils/source";
import { registerBuiltins } from "./builtins";
import { DeclarationChecker } from "./decl-checker";
import { ExpressionChecker } from "./expr-checker";
import { validateRefPositions } from "./ref-position-checker";
import { Scope } from "./scope";
import { StatementChecker } from "./stmt-checker";
import type { ScopeSymbol } from "./symbols";
import { SymbolKind, typeSymbol, variableSymbol } from "./symbols";
import { TypeResolver } from "./type-resolver";
import type { EnumType, FunctionType, StructType, Type } from "./types";
import { ERROR_TYPE, TypeKind, typeToString } from "./types";

/** Per-expression resolution metadata produced by the checker. */
export interface CheckTypes {
  /** Resolved type for every checked expression. */
  typeMap: Map<Expression, Type>;
  /** Operator-overload resolution: which method satisfies an operator at a call site. */
  operatorMethods: Map<Expression, { methodName: string; structType: StructType }>;
  /** Destructuring bindings for switch cases on data enum variants. */
  switchCaseBindings: Map<
    SwitchCase,
    { variantName: string; fieldNames: string[]; fieldTypes: Type[] }
  >;
  /**
   * Calls dispatched as `Type.method(args)` or `Type<TypeArgs>.method(args)`
   * — i.e., static method calls on a type identifier rather than instance
   * method calls. KIR lowering reads this to skip the synthetic self-arg
   * and emit the StructName_method(args) form, optionally with type-arg
   * mangling for monomorphized generics.
   */
  staticMethodCalls: Map<Expression, { structName: string; mangledStructName: string }>;
}

/** Generic monomorphization output. */
export interface CheckGenerics {
  /**
   * The Monomorphization instance carrying every generic instantiation
   * discovered during this check. KIR lowering iterates
   * `monomorphization.products()` to emit type/function definitions; the
   * multi-module orchestrator merges instances across modules via
   * {@link Monomorphization.adoptStruct}/`adoptFunction`/`adoptEnum`.
   */
  monomorphization: Monomorphization;
  /** Maps generic call / struct literal expressions to their resolved mangled names. */
  resolutions: Map<Expression, string>;
}

/** Auto-generated lifecycle hook info (which structs got __destroy / __oncopy). */
export interface CheckLifecycle {
  autoDestroyStructs: Map<string, StructType>;
  autoOncopyStructs: Map<string, StructType>;
  /**
   * The Lifecycle module's decision lookup.  KIR lowering uses this
   * (via `lifecycle.synthesise(struct, decision)`) to drive
   * auto-generated `__destroy` / `__oncopy` body emission.  Returns
   * `undefined` when no auto-generation applies (the struct has no
   * managed fields, or the user wrote the hook explicitly).
   */
  getDecision(struct: StructType): LifecycleDecision | undefined;
}

/**
 * Optional injectable dependencies for the {@link Checker}.
 *
 * Mirrors the constructed-and-threaded pattern from ADR-0001's concept
 * modules. Multi-module builds construct a single `Monomorphization` per
 * module today (each Checker still owns its own instance, then the
 * orchestrator routes adoptions across them); future migrations will
 * thread a shared `Lifecycle` and Diagnostics `Collector` through here
 * too.
 */
export interface CheckerOptions {
  monomorphization?: Monomorphization;
}

export interface CheckResult {
  diagnostics: Diagnostic[];
  types: CheckTypes;
  generics: CheckGenerics;
  lifecycle: CheckLifecycle;
}

/** Info about a module to check in multi-module mode */
export interface ModuleCheckInfo {
  name: string;
  program: Program;
  source: SourceFile;
  importDecls: ImportDecl[];
}

/**
 * Result of multi-module checking.
 *
 * Per-module results are kept in `results`. The `types`/`generics`/`lifecycle`
 * fields hold the merged view across all modules, in the same shape as
 * `CheckResult`'s sub-objects.
 */
export interface MultiModuleCheckResult {
  results: Map<string, CheckResult>;
  diagnostics: Diagnostic[];
  /** Public symbols exported by each module. */
  moduleExports: Map<string, Map<string, ScopeSymbol>>;
  types: CheckTypes;
  generics: CheckGenerics;
  lifecycle: CheckLifecycle;
}

export class Checker {
  private program: Program;
  private source: SourceFile;
  /**
   * Diagnostics accumulator. Internally constructed for now; PR 3
   * externalises it (passed in via the `Checker` constructor so the
   * CLI driver owns the collector). The `error / warning` helpers
   * route here via `diag.untriaged({...})`. See
   * `docs/design/diagnostics-module.md` §5, §9 PR 2/3.
   */
  private diag: Diagnostics = createDiagnostics({});
  private typeMap: Map<Expression, Type> = new Map();
  private scopeStack: Scope[] = [];
  private typeResolver: TypeResolver;
  private exprChecker: ExpressionChecker;
  private stmtChecker: StatementChecker;
  private declChecker: DeclarationChecker;
  private lifecycle: Lifecycle;

  /** Tracks function calls that throw but haven't been wrapped in catch */
  private pendingThrowsCalls: Map<CallExpr, FunctionType> = new Map();

  /** Module exports available for import resolution (set externally for multi-module) */
  private moduleExports: Map<string, Map<string, ScopeSymbol>> = new Map();

  /**
   * Generic-instantiation registry. Owned by the Monomorphization
   * module; threaded in via the constructor's options bag (or constructed
   * fresh per-checker if the caller doesn't supply one — single-module
   * builds hit that path).
   */
  private monomorphization: Monomorphization;

  /**
   * When true, `check()` skips the per-instantiation body-check pass.
   * The multi-module orchestrator sets this before running each module's
   * `check()` and then drives the body-check pass externally after all
   * modules have pre-checked, so cross-module monomorphizations
   * (`B.kei` calls `A.Foo<i32>.method`) get re-checked under `A`'s
   * scope where A's imports are visible.
   */
  deferMonomorphizedBodyChecks = false;

  /** Operator overload resolution info: maps expression nodes to their resolved operator method */
  operatorMethods: Map<Expression, { methodName: string; structType: StructType }> = new Map();

  /** Maps generic call/struct literal expressions to their resolved mangled names */
  genericResolutions: Map<Expression, string> = new Map();

  /** Destructuring bindings for switch cases on data enum variants */
  switchCaseBindings: Map<
    SwitchCase,
    { variantName: string; fieldNames: string[]; fieldTypes: Type[] }
  > = new Map();

  /** Static method calls dispatched as `Type.method` / `Type<TypeArgs>.method` */
  staticMethodCalls: Map<Expression, { structName: string; mangledStructName: string }> = new Map();

  /** Per-instantiation type map, set while a body-check pass is running. */
  private currentBodyTypeMap: Map<Expression, Type> | null = null;
  /** Per-instantiation generic resolutions, set while a body-check pass is running. */
  private currentBodyGenericResolutions: Map<Expression, string> | null = null;

  /**
   * Mangled prefix for top-level symbols defined in this module — derived from
   * the dotted module name (`net.http` → `net_http`). Empty string for the main
   * module and for single-file mode. Used by struct-checker to stamp origin
   * onto `StructType.modulePrefix`, so destroy/oncopy call sites in other
   * modules can reconstruct the correct mangled function name.
   */
  modulePrefix: string;

  constructor(program: Program, source: SourceFile, moduleName = "", options: CheckerOptions = {}) {
    this.program = program;
    this.source = source;
    this.modulePrefix = moduleName.replace(/\./g, "_");
    this.typeResolver = new TypeResolver();
    this.lifecycle = createLifecycle();
    this.monomorphization = options.monomorphization ?? createMonomorphization();
    this.exprChecker = new ExpressionChecker(this);
    this.stmtChecker = new StatementChecker(this);
    this.declChecker = new DeclarationChecker(this, this.lifecycle);

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
    // Pass 0: Surface-level position validation for `ref T` annotations.
    // These are syntactic restrictions (return types, safe-struct fields,
    // local bindings, etc.) — running them up front gives clean errors
    // before later passes get confused by an out-of-position RefType.
    for (const d of validateRefPositions(this.program)) {
      this.error(d.message, d.span);
    }

    // Pass 1: Register all top-level declarations
    for (const decl of this.program.declarations) {
      this.declChecker.registerDeclaration(decl);
    }

    // Pass 1.5: Decide which structs need auto-generated __destroy /
    // __oncopy. Owned by the Lifecycle module; the checker just kicks
    // off the fixed point and lets the module mirror its decisions
    // back onto `StructType.methods` (transition shim — see
    // `docs/design/lifecycle-module.md` §7 PR 1; removed in PR 4).
    this.declChecker.runLifecycleDecide(this.program.declarations);

    // Pass 2: Check all declarations
    for (const decl of this.program.declarations) {
      this.declChecker.checkDeclaration(decl);
    }

    // Check for unhandled throws calls
    for (const [callExpr, funcType] of this.pendingThrowsCalls) {
      const throwNames = funcType.throwsTypes.map((t) => typeToString(t)).join(", ");
      this.error(`call to function that throws (${throwNames}) must use 'catch'`, callExpr.span);
    }

    // Pass 3: Check bodies of monomorphized generic functions/structs.
    // In multi-module mode the orchestrator runs this pass externally
    // after every module has pre-checked, so the body of a generic
    // method defined in module A but instantiated by module B is
    // checked under A's scope (where A's imports are visible).
    if (!this.deferMonomorphizedBodyChecks) {
      this.monomorphization.checkBodies((product) => this.checkBody(product));
    }

    // Collect auto-destroy struct types
    const autoDestroyStructs = new Map<string, StructType>();
    for (const decl of this.program.declarations) {
      if (decl.kind === "StructDecl" || decl.kind === "UnsafeStructDecl") {
        const sym = this.currentScope.lookupType(decl.name);
        if (sym?.kind === "type" && sym.type.kind === TypeKind.Struct && sym.type.autoDestroy) {
          autoDestroyStructs.set(decl.name, sym.type);
        }
      }
    }

    // Collect auto-oncopy struct types
    const autoOncopyStructs = new Map<string, StructType>();
    for (const decl of this.program.declarations) {
      if (decl.kind === "StructDecl" || decl.kind === "UnsafeStructDecl") {
        const sym = this.currentScope.lookupType(decl.name);
        if (sym?.kind === "type" && sym.type.kind === TypeKind.Struct && sym.type.autoOncopy) {
          autoOncopyStructs.set(decl.name, sym.type);
        }
      }
    }

    return {
      diagnostics: this.collectDiagnostics(),
      types: {
        typeMap: this.typeMap,
        operatorMethods: this.operatorMethods,
        switchCaseBindings: this.switchCaseBindings,
        staticMethodCalls: this.staticMethodCalls,
      },
      generics: {
        monomorphization: this.monomorphization,
        resolutions: this.genericResolutions,
      },
      lifecycle: {
        autoDestroyStructs,
        autoOncopyStructs,
        getDecision: (struct) => this.lifecycle.getDecision(struct),
      },
    };
  }

  /**
   * Public wrapper around the body-check pass so the multi-module
   * orchestrator can drive it after every module has pre-checked.
   * Delegates the iteration to the Monomorphization module; the
   * per-decl checking primitive stays on `Checker`.
   */
  runMonomorphizedBodyChecks(): void {
    this.monomorphization.checkBodies((product) => this.checkBody(product));
  }

  /** Module-internal accessor so the multi-module orchestrator can read this checker's products. */
  getMonomorphization(): Monomorphization {
    return this.monomorphization;
  }

  /**
   * Adopt a monomorphized enum registered by another module's checker
   * and make it visible in this checker's current scope. Used by the
   * multi-module orchestrator so a cross-module instantiation
   * (`Optional<i32>` from stdlib) is resolvable when the defining
   * module's body-check pass runs.
   */
  adoptMonomorphizedEnumInScope(mangledName: string, mono: EnumType): void {
    if (this.monomorphization.getMonomorphizedEnum(mangledName)) return;
    this.monomorphization.adoptEnum(mangledName, mono);
    this.currentScope.define(typeSymbol(mangledName, mono));
  }

  /**
   * Per-decl body-check primitive — invoked by the Monomorphization
   * driver once per registered instantiation.  The driver iterates the
   * products map(s); this method owns the per-instantiation setup
   * (substitution map, scope, per-body type-map override) and the
   * statement walk.  Splitting the responsibility this way keeps the
   * loop ordering in `Monomorphization.checkBodies()` and the
   * checker-internal machinery (scopes, type tables, type resolver)
   * here on the Checker.  See `docs/design/monomorphization-module.md`
   * §3, §7.4.
   */
  private checkBody(product: MonomorphizedProduct): void {
    if (product.kind === "function") {
      this.checkMonomorphizedFunctionBody(product.product);
    } else {
      this.checkMonomorphizedStructMethodBodies(product.product);
    }
  }

  /**
   * Type-check a single monomorphized function's body under its
   * per-instantiation substitution map and capture the resulting
   * per-body type-map / generic-resolution snapshots on the
   * `MonomorphizedFunction` record.
   */
  private checkMonomorphizedFunctionBody(monoFunc: MonomorphizedFunction): void {
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
    if (!monoFunc.declaration) return;

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
      this.defineVariable(param.name, paramType, !param.isReadonly, false, param.span);
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

  /**
   * Walk every method on a monomorphized generic struct under the type-
   * substitution map for this instantiation, populating per-method body
   * type maps so KIR lowering sees concrete types.
   *
   * The literal-checker registers struct instantiations without an
   * `originalDecl` reference; this method lazily backfills it by name +
   * arity match against the program before walking the methods.
   */
  private checkMonomorphizedStructMethodBodies(monoStruct: MonomorphizedStruct): void {
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
    const decl = monoStruct.originalDecl;
    if (!decl) return;
    if (decl.methods.length === 0) return;

    // Build the type-substitution map (e.g. T → i32).
    const typeSubs = new Map<string, Type>();
    for (let i = 0; i < decl.genericParams.length; i++) {
      const paramName = decl.genericParams[i];
      const concreteArg = monoStruct.typeArgs[i];
      if (paramName && concreteArg) typeSubs.set(paramName, concreteArg);
    }

    monoStruct.methodBodyTypeMaps ??= new Map();

    for (const method of decl.methods) {
      // Skip if we've already checked this method for this instantiation.
      if (monoStruct.methodBodyTypeMaps.has(method.name)) continue;

      this.typeResolver.setSubstitutions(typeSubs);
      const bodyTypeMap = new Map<Expression, Type>();
      const bodyGenericResolutions = new Map<Expression, string>();
      this.currentBodyTypeMap = bodyTypeMap;
      this.currentBodyGenericResolutions = bodyGenericResolutions;

      // Pull the method's already-substituted FunctionType from the
      // concrete struct so the param types match what KIR will emit.
      const concreteMethod = monoStruct.concrete.methods.get(method.name);

      // The pushed scope's `functionContext` carries the substituted
      // FunctionType through; that's what return-type checks read.
      this.pushScope({ functionContext: concreteMethod ?? null });
      for (let i = 0; i < method.params.length; i++) {
        const param = method.params[i];
        if (!param) continue;
        // For self-typed params (`self`, `self: ref Self`, etc.) the
        // concrete struct type was substituted into the method's
        // FunctionType; use it directly. Other params come from the
        // method type, which is already substituted.
        const paramType = concreteMethod?.params[i]?.type ?? this.resolveType(param.typeAnnotation);
        this.defineVariable(param.name, paramType, !param.isReadonly, false, param.span);
      }

      for (const stmt of method.body.statements) {
        this.checkStatement(stmt);
      }

      this.popScope();
      this.typeResolver.clearSubstitutions();
      this.currentBodyTypeMap = null;
      this.currentBodyGenericResolutions = null;

      monoStruct.methodBodyTypeMaps.set(method.name, bodyTypeMap);
    }
  }

  /**
   * Check multiple modules in topological order (dependencies first).
   * Returns combined results for all modules.
   */
  static checkModules(modules: ModuleCheckInfo[]): MultiModuleCheckResult {
    const moduleExports = new Map<string, Map<string, ScopeSymbol>>();
    const allResults = new Map<string, CheckResult>();
    const combinedDiags: Diagnostic[] = [];

    const types: CheckTypes = {
      typeMap: new Map(),
      operatorMethods: new Map(),
      switchCaseBindings: new Map(),
      staticMethodCalls: new Map(),
    };
    // Combined Monomorphization for the cross-module result. Each module's
    // Checker still owns its own instance during pre-check (so adoption can
    // be filtered by defining module); the merged view lives here and is
    // populated during the wave-3 merge below.
    const combinedMonomorphization = createMonomorphization();
    const generics: CheckGenerics = {
      monomorphization: combinedMonomorphization,
      resolutions: new Map(),
    };
    // Per-module decision lookups, registered during wave 3 so the
    // multi-module `getDecision` can chain through them.  Each entry is
    // the per-module `lifecycle.getDecision` from a `CheckResult`; we
    // walk them in order until one returns a hit.  StructType identities
    // are unique across modules, so order doesn't affect correctness —
    // it does keep the lookup O(modules) which is fine.
    const decisionLookups: Array<(struct: StructType) => LifecycleDecision | undefined> = [];
    const lifecycle: CheckLifecycle = {
      autoDestroyStructs: new Map(),
      autoOncopyStructs: new Map(),
      getDecision(struct) {
        for (const lookup of decisionLookups) {
          const decision = lookup(struct);
          if (decision !== undefined) return decision;
        }
        return undefined;
      },
    };

    // The lowering pipeline treats the last module in topological order as
    // "main" and emits its top-level symbols without a module prefix. We
    // mirror that rule here so structs declared in main keep modulePrefix "".
    const mainModule = modules[modules.length - 1];

    // Wave 1: pre-check every module (passes 1 + 1.5 + 2). The
    // per-instantiation body-check pass is deferred so cross-module
    // monomorphizations can be routed to the defining module's checker.
    const checkers = new Map<string, Checker>();
    const moduleNameForPrefix = new Map<string, string>(); // modulePrefix → module name
    const preResults = new Map<string, CheckResult>();
    for (const mod of modules) {
      const moduleName = mod === mainModule ? "" : mod.name;
      const checker = new Checker(mod.program, mod.source, moduleName);
      checker.setModuleExports(moduleExports);
      checker.deferMonomorphizedBodyChecks = true;
      const result = checker.check();
      preResults.set(mod.name, result);
      checkers.set(mod.name, checker);
      moduleNameForPrefix.set(moduleName, mod.name);
      const pubSymbols = checker.collectPublicSymbols();
      moduleExports.set(mod.name, pubSymbols);
    }

    // Wave 2: route each monomorphization to its defining module's checker
    // and run its body-check pass there. The defining module's scope has
    // its imports in place, so a generic struct method that uses
    // `import { alloc } from mem` resolves correctly.
    for (const [, checker] of checkers) {
      // Adopt monomorphizations registered in OTHER modules but whose
      // original struct/function lives in THIS module.
      for (const [otherModName, otherChecker] of checkers) {
        if (otherChecker === checker) continue;
        const otherResult = preResults.get(otherModName);
        if (!otherResult) continue;
        const otherProducts = otherResult.generics.monomorphization.products();
        for (const [name, mono] of otherProducts.structs) {
          const definingPrefix = mono.original.modulePrefix ?? "";
          if (definingPrefix === checker.modulePrefix) {
            checker.getMonomorphization().adoptStruct(name, mono);
          }
        }
        for (const [name, mono] of otherProducts.enums) {
          const definingPrefix = mono.modulePrefix ?? "";
          if (definingPrefix === checker.modulePrefix) {
            checker.adoptMonomorphizedEnumInScope(name, mono);
          }
        }
      }
      checker.runMonomorphizedBodyChecks();
    }

    // Wave 3: merge results. Pull from each checker (which now has any
    // adopted monomorphizations) plus the original pre-result diagnostics.
    for (const mod of modules) {
      const checker = checkers.get(mod.name);
      const result = preResults.get(mod.name);
      if (!checker || !result) continue;
      // The pre-check result holds map references that the wave-2
      // body checks mutated in place — same map identity, updated
      // contents. Just merge them.
      allResults.set(mod.name, result);

      for (const [expr, type] of result.types.typeMap) types.typeMap.set(expr, type);
      for (const [expr, info] of result.types.operatorMethods) {
        types.operatorMethods.set(expr, info);
      }
      for (const [sc, info] of result.types.switchCaseBindings) {
        types.switchCaseBindings.set(sc, info);
      }
      for (const [expr, info] of result.types.staticMethodCalls) {
        types.staticMethodCalls.set(expr, info);
      }
      combinedMonomorphization.adopt(result.generics.monomorphization);
      for (const [expr, name] of result.generics.resolutions) {
        generics.resolutions.set(expr, name);
      }
      for (const [name, st] of result.lifecycle.autoDestroyStructs) {
        lifecycle.autoDestroyStructs.set(name, st);
      }
      for (const [name, st] of result.lifecycle.autoOncopyStructs) {
        lifecycle.autoOncopyStructs.set(name, st);
      }
      decisionLookups.push(result.lifecycle.getDecision);
      combinedDiags.push(...result.diagnostics);
    }
    void moduleNameForPrefix;

    return {
      results: allResults,
      diagnostics: combinedDiags,
      moduleExports,
      types,
      generics,
      lifecycle,
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
      this.error(diag.message, diag.span);
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

  getExprType(expr: Expression): Type | undefined {
    return this.typeMap.get(expr);
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
  // Thin delegators to `this.monomorphization`. The maps live privately
  // inside the module; these stay on Checker so the per-pass checkers
  // (literal-checker, call-checker, etc.) keep a single call-site API.

  getMonomorphizedStruct(mangledName: string): MonomorphizedStruct | undefined {
    return this.monomorphization.getMonomorphizedStruct(mangledName);
  }

  registerMonomorphizedStruct(mangledName: string, info: MonomorphizedStruct): void {
    this.monomorphization.registerStruct(mangledName, info);
    // Also register the concrete struct as a type in the current scope so KIR can find it
    const sym = typeSymbol(mangledName, info.concrete);
    this.currentScope.define(sym);
  }

  /**
   * Instantiate a generic enum with concrete type arguments. Returns the
   * monomorphized EnumType (cached by mangled name). Called by
   * `checkCallExpression` for `Optional<i32>.Some(...)` and by
   * `resolveType` for type references like `Optional<i32>` in fn params.
   */
  instantiateGenericEnum(base: EnumType, typeArgNodes: import("../ast/nodes").TypeNode[]): Type {
    if (typeArgNodes.length !== base.genericParams.length) {
      return ERROR_TYPE;
    }
    const typeArgs: Type[] = [];
    const subs = new Map<string, Type>();
    for (let i = 0; i < typeArgNodes.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: typeArgNodes.length checked above
      const node = typeArgNodes[i]!;
      const t = this.resolveType(node);
      if (t.kind === TypeKind.Error) return ERROR_TYPE;
      typeArgs.push(t);
      // biome-ignore lint/style/noNonNullAssertion: same length as typeArgNodes
      subs.set(base.genericParams[i]!, t);
    }
    const mangledName = mangleGenericName(base.name, typeArgs);
    const cached = this.monomorphization.getMonomorphizedEnum(mangledName);
    if (cached) return cached;
    const concrete: EnumType = {
      kind: TypeKind.Enum,
      name: mangledName,
      baseType: base.baseType,
      variants: base.variants.map((v) => ({
        name: v.name,
        fields: v.fields.map((f) => ({ name: f.name, type: substituteType(f.type, subs) })),
        value: v.value,
      })),
      genericParams: [],
      modulePrefix: base.modulePrefix,
      genericBaseName: base.name,
      genericTypeArgs: typeArgs,
    };
    this.monomorphization.registerEnum(mangledName, concrete);
    // Register so subsequent type references resolve to the same type.
    this.currentScope.define(typeSymbol(mangledName, concrete));
    return concrete;
  }

  getMonomorphizedEnum(mangledName: string): EnumType | undefined {
    return this.monomorphization.getMonomorphizedEnum(mangledName);
  }

  getMonomorphizedFunction(mangledName: string): MonomorphizedFunction | undefined {
    return this.monomorphization.getMonomorphizedFunction(mangledName);
  }

  registerMonomorphizedFunction(mangledName: string, info: MonomorphizedFunction): void {
    this.monomorphization.registerFunction(mangledName, info);
  }

  // ─── Diagnostics ──────────────────────────────────────────────────────

  error(message: string, span: Span): void {
    this.diag.untriaged({
      severity: "error",
      span: this.spanToLocation(span),
      message,
    });
  }

  warning(message: string, span: Span): void {
    this.diag.untriaged({
      severity: "warning",
      span: this.spanToLocation(span),
      message,
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

  /**
   * Snapshot the current diagnostics as the legacy
   * `{ severity, message, location }` shape that `CheckResult` and the
   * rest of the pipeline still consume. PR 4+ migrates consumers onto
   * the new union shape; until then we adapt at the boundary. The
   * `untriaged` variant is the only kind emitted in PR 2, so the adapter
   * is one branch wide.
   */
  private collectDiagnostics(): Diagnostic[] {
    return this.diag.diagnostics().map((d) => ({
      severity: d.severity === "warning" ? Severity.Warning : Severity.Error,
      message: d.message,
      location: d.span,
    }));
  }
}
