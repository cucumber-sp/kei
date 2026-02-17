/**
 * Tests for multi-module KIR lowering.
 */

import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import type { ModuleCheckInfo } from "../../src/checker/checker.ts";
import { Checker } from "../../src/checker/checker.ts";
import { lowerModulesToKir } from "../../src/kir/lowering.ts";
import { ModuleResolver } from "../../src/modules/resolver.ts";

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
