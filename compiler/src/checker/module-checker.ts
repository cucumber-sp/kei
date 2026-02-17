/**
 * Multi-module checking orchestration.
 *
 * Coordinates type-checking across multiple modules in topological order
 * (dependencies first), merging per-module results into a combined result.
 */

import type { Expression, ImportDecl, Program } from "../ast/nodes.ts";
import type { SourceFile } from "../utils/index.ts";
import { Checker } from "./checker.ts";
import type { CheckResult } from "./checker.ts";
import type { MonomorphizedFunction, MonomorphizedStruct } from "./generics.ts";
import type { ScopeSymbol } from "./symbols.ts";
import type { StructType, Type } from "./types.ts";

/** Info about a module to check in multi-module mode. */
export interface ModuleCheckInfo {
  name: string;
  program: Program;
  source: SourceFile;
  importDecls: ImportDecl[];
}

/** Result of multi-module checking. */
export interface MultiModuleCheckResult {
  /** Per-module check results, keyed by module name. */
  results: Map<string, CheckResult>;
  /** Combined type map across all modules. */
  typeMap: Map<Expression, Type>;
  /** Combined diagnostics across all modules. */
  diagnostics: import("../errors/diagnostic.ts").Diagnostic[];
  /** Public symbols exported by each module. */
  moduleExports: Map<string, Map<string, ScopeSymbol>>;
  /** Combined operator method resolution info. */
  operatorMethods: Map<Expression, { methodName: string; structType: StructType }>;
  /** Combined monomorphized structs. */
  monomorphizedStructs: Map<string, MonomorphizedStruct>;
  /** Combined monomorphized functions. */
  monomorphizedFunctions: Map<string, MonomorphizedFunction>;
  /** Combined generic resolution info. */
  genericResolutions: Map<Expression, string>;
}

/**
 * Check multiple modules in topological order (dependencies first).
 *
 * Each module is checked in its own Checker instance, with access to
 * the public symbols exported by previously-checked modules. Results
 * are merged into a single {@link MultiModuleCheckResult}.
 */
export function checkModules(modules: ModuleCheckInfo[]): MultiModuleCheckResult {
  const moduleExports = new Map<string, Map<string, ScopeSymbol>>();
  const allResults = new Map<string, CheckResult>();
  const combinedTypeMap = new Map<Expression, Type>();
  const combinedDiags: import("../errors/diagnostic.ts").Diagnostic[] = [];
  const combinedOpMethods = new Map<Expression, { methodName: string; structType: StructType }>();
  const combinedMonoStructs = new Map<string, MonomorphizedStruct>();
  const combinedMonoFuncs = new Map<string, MonomorphizedFunction>();
  const combinedGenericResolutions = new Map<Expression, string>();

  for (const mod of modules) {
    const checker = new Checker(mod.program, mod.source);
    checker.setModuleExports(moduleExports);

    const result = checker.check();
    allResults.set(mod.name, result);

    // Merge per-module results into combined maps
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
