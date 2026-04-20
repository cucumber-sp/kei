/**
 * AST → KIR lowering pass.
 *
 * Takes a type-checked AST (Program + CheckResult) and produces a KirModule.
 *
 * The lowering is implemented as plain functions over `LoweringCtx` (see
 * `lowering-ctx.ts`). This file is the orchestrator — it wires together the
 * per-category modules below and exposes the public entry points
 * (`lowerToKir`, `lowerModulesToKir`).
 *
 * Per-category implementations live in:
 *   - lowering-decl.ts       (declaration dispatch, function/extern/static lowering)
 *   - lowering-struct.ts     (struct declaration, method, lifecycle lowering)
 *   - lowering-enum-decl.ts  (enum declaration lowering)
 *   - lowering-stmt.ts       (statement lowering)
 *   - lowering-expr.ts       (expression lowering)
 *   - lowering-literals.ts   (literal expression lowering)
 *   - lowering-operators.ts  (operator expression lowering)
 *   - lowering-error.ts      (error handling lowering)
 *   - lowering-switch.ts     (switch expression lowering)
 *   - lowering-enum.ts       (enum variant construction/access)
 *   - lowering-types.ts      (type conversion helpers)
 *   - lowering-scope.ts      (scope/lifecycle helpers)
 *   - lowering-utils.ts      (basic emit helpers)
 */

import type { Program } from "../ast/nodes";
import type { CheckResult, ModuleCheckInfo, MultiModuleCheckResult } from "../checker/checker";
import type { KirModule } from "./kir-types";
import { createLoweringCtx, type LoweringCtx } from "./lowering-ctx";
import { lowerDeclaration, lowerMonomorphizedFunction } from "./lowering-decl";
import { lowerMethod, lowerMonomorphizedStruct } from "./lowering-struct";
import { lowerTypeNode, mangleFunctionName } from "./lowering-types";

/**
 * Run the full AST → KIR lowering against a prepared context. Mutates `ctx`
 * by populating `ctx.functions`, `ctx.typeDecls`, etc., and returns the
 * assembled KirModule.
 */
export function runLowering(ctx: LoweringCtx): KirModule {
  // Detect which function names are overloaded
  const funcNameCounts = new Map<string, number>();
  for (const decl of ctx.program.declarations) {
    if (decl.kind === "FunctionDecl") {
      funcNameCounts.set(decl.name, (funcNameCounts.get(decl.name) ?? 0) + 1);
    }
  }
  for (const [name, count] of funcNameCounts) {
    if (count > 1) ctx.overloadedNames.add(name);
  }

  // Also mark imported overloaded names (e.g. print from io module)
  for (const name of ctx.importedOverloads) {
    ctx.overloadedNames.add(name);
  }

  // Pre-pass: discover which functions use throws protocol
  for (const decl of ctx.program.declarations) {
    if (decl.kind === "FunctionDecl" && decl.throwsTypes.length > 0) {
      const throwsKirTypes = decl.throwsTypes.map((t) => lowerTypeNode(ctx, t));
      const retType = decl.returnType
        ? lowerTypeNode(ctx, decl.returnType)
        : { kind: "void" as const };
      // Compute the mangled name the same way lowerFunction does
      let funcName: string;
      if (ctx.overloadedNames.has(decl.name)) {
        const baseName = ctx.modulePrefix ? `${ctx.modulePrefix}_${decl.name}` : decl.name;
        funcName = mangleFunctionName(ctx, baseName, decl);
      } else if (ctx.modulePrefix && decl.name !== "main") {
        funcName = `${ctx.modulePrefix}_${decl.name}`;
      } else {
        funcName = decl.name;
      }
      ctx.throwsFunctions.set(funcName, { throwsTypes: throwsKirTypes, returnType: retType });
    }
  }

  for (const decl of ctx.program.declarations) {
    lowerDeclaration(ctx, decl);
  }

  // Emit monomorphized struct definitions from generics
  for (const [mangledName, monoStruct] of ctx.checkResult.generics.monomorphizedStructs) {
    ctx.typeDecls.push(lowerMonomorphizedStruct(ctx, mangledName, monoStruct));
    // Lower methods for monomorphized structs
    if (monoStruct.originalDecl) {
      for (const method of monoStruct.originalDecl.methods) {
        const structPrefix = ctx.modulePrefix ? `${ctx.modulePrefix}_${mangledName}` : mangledName;
        const methodMangledName = `${structPrefix}_${method.name}`;
        ctx.functions.push(lowerMethod(ctx, method, methodMangledName, mangledName));
      }
    }
  }

  // Emit monomorphized function definitions from generics
  for (const [_mangledName, monoFunc] of ctx.checkResult.generics.monomorphizedFunctions) {
    if (monoFunc.declaration) {
      ctx.functions.push(lowerMonomorphizedFunction(ctx, monoFunc));
    }
  }

  return {
    name: "main",
    globals: ctx.globals,
    functions: ctx.functions,
    types: ctx.typeDecls,
    externs: ctx.externs,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function lowerToKir(program: Program, checkResult: CheckResult): KirModule {
  return runLowering(createLoweringCtx(program, checkResult));
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

    const ctx = createLoweringCtx(
      mod.program,
      result,
      modulePrefix,
      importedNames,
      importedOverloads
    );
    const kirModule = runLowering(ctx);

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
