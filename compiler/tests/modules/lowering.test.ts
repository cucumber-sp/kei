/**
 * Tests for multi-module KIR lowering.
 */

import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import type { ModuleCheckInfo } from "../../src/checker/checker";
import { Checker } from "../../src/checker/checker";
import { lowerModulesToKir } from "../../src/kir/lowering";
import { ModuleResolver } from "../../src/modules/resolver";

const FIXTURES_DIR = resolve(import.meta.dir, "../fixtures/modules");

/** Helper: resolve, check, and lower a multi-module project */
function lowerMultiModule(mainFile: string) {
  const mainPath = join(FIXTURES_DIR, mainFile);
  const resolver = new ModuleResolver(mainPath);
  const resolverResult = resolver.resolve(mainPath);

  if (resolverResult.errors.length > 0) {
    throw new Error(`Resolution errors: ${resolverResult.errors.join(", ")}`);
  }

  const moduleInfos: ModuleCheckInfo[] = resolverResult.modules.map((m) => ({
    name: m.name,
    program: m.program,
    source: m.source,
    importDecls: m.importDecls,
  }));

  const multiResult = Checker.checkModules(moduleInfos);
  const errors = multiResult.diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    const msgs = errors.map((d) => d.message).join("\n  ");
    throw new Error(`Type errors:\n  ${msgs}`);
  }

  return lowerModulesToKir(moduleInfos, multiResult);
}

describe("Multi-module KIR lowering", () => {
  describe("name mangling", () => {
    test("dependency module functions get module prefix", () => {
      const kirModule = lowerMultiModule("main_imports_math.kei");
      const funcNames = kirModule.functions.map((f) => f.name);

      // math module functions should be prefixed with "math_"
      expect(funcNames).toContain("math_add");
      expect(funcNames).toContain("math_multiply");
      expect(funcNames).toContain("math_helper");

      // main module keeps its names (no prefix)
      expect(funcNames).toContain("main");
    });

    test("main module 'main' function is NOT prefixed", () => {
      const kirModule = lowerMultiModule("main_imports_math.kei");
      const funcNames = kirModule.functions.map((f) => f.name);
      expect(funcNames).toContain("main");
      expect(funcNames).not.toContain("main_imports_math_main");
    });
  });

  describe("merged output", () => {
    test("all modules' functions are in single KirModule", () => {
      const kirModule = lowerMultiModule("main_chain.kei");
      const funcNames = kirModule.functions.map((f) => f.name);

      // math, utils, and main module functions should all be present
      expect(funcNames).toContain("math_add");
      expect(funcNames).toContain("math_multiply");
      expect(funcNames).toContain("utils_twice");
      expect(funcNames).toContain("utils_negate");
      expect(funcNames).toContain("main");
    });

    test("types from dependency modules are included", () => {
      const kirModule = lowerMultiModule("main_imports_math.kei");
      const typeNames = kirModule.types.map((t) => t.name);
      expect(typeNames).toContain("Point");
    });
  });

  describe("extern deduplication", () => {
    test("duplicate externs across modules are deduplicated", () => {
      // Both modules declare the same extern — should only appear once
      const kirModule = lowerMultiModule("main_imports_math.kei");
      const externNames = kirModule.externs.map((e) => e.name);
      const unique = new Set(externNames);
      expect(externNames.length).toBe(unique.size);
    });
  });
});

describe("Multi-module monomorphized lifecycle (single emission)", () => {
  test("user-defined hooks on an imported generic struct are emitted exactly once", () => {
    // Repro of the third Shared<T> e2e gap: a generic unsafe struct
    // defined in a dependency module whose `__destroy` / `__oncopy`
    // are user-defined methods used to be lowered twice — once in
    // the defining module's lowering pass (with module prefix) and
    // once in the importing module's pass (without prefix). Pick a
    // single canonical form and emit it only in the defining module.
    const kirModule = lowerMultiModule("main_generic_lifecycle.kei");
    const fnNames = kirModule.functions.map((f) => f.name);

    const destroys = fnNames.filter((n) => n.endsWith("Bag_i32___destroy"));
    expect(destroys.length).toBe(1);

    const oncopies = fnNames.filter((n) => n.endsWith("Bag_i32___oncopy"));
    expect(oncopies.length).toBe(1);
  });
});

describe("Multi-module monomorphized method body resolution", () => {
  test("monomorphized method body resolves imported names via the defining module", () => {
    // Repro of Shared<T> e2e gap #2: when `Shared<T>.__destroy` calls
    // `dealloc(...)` (imported from `std_mem`), the lowered call site
    // must use the defining module's import scope and emit
    // `std_mem_dealloc`, not the unqualified `dealloc`. Same story
    // for `wrap` calling `alloc(...)`.
    const kirModule = lowerMultiModule("main_uses_shared.kei");

    const wrapFn = kirModule.functions.find((f) => f.name.endsWith("Shared_i32_wrap"));
    const destroyFn = kirModule.functions.find((f) => f.name.endsWith("Shared_i32___destroy"));
    expect(wrapFn).toBeTruthy();
    expect(destroyFn).toBeTruthy();

    const wrapCalls: string[] = [];
    for (const block of wrapFn?.blocks ?? []) {
      for (const inst of block.instructions) {
        if ((inst.kind === "call" || inst.kind === "call_void") && "func" in inst) {
          wrapCalls.push(inst.func);
        }
      }
    }
    const destroyCalls: string[] = [];
    for (const block of destroyFn?.blocks ?? []) {
      for (const inst of block.instructions) {
        if ((inst.kind === "call" || inst.kind === "call_void") && "func" in inst) {
          destroyCalls.push(inst.func);
        }
      }
    }

    // wrap calls alloc — must resolve to std_mem_alloc.
    expect(wrapCalls.some((c) => c === "std_mem_alloc")).toBe(true);
    expect(wrapCalls.some((c) => c === "alloc")).toBe(false);
    // __destroy calls dealloc — must resolve to std_mem_dealloc.
    expect(destroyCalls.some((c) => c === "std_mem_dealloc")).toBe(true);
    expect(destroyCalls.some((c) => c === "dealloc")).toBe(false);
  });
});
