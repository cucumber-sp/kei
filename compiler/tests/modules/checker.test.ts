/**
 * Tests for multi-module type checking.
 */

import { test, expect, describe } from "bun:test";
import { resolve, join } from "node:path";
import { Checker } from "../../src/checker/checker.ts";
import type { ModuleCheckInfo } from "../../src/checker/checker.ts";
import { ModuleResolver } from "../../src/modules/resolver.ts";

const FIXTURES_DIR = resolve(import.meta.dir, "../fixtures/modules");

/** Helper: resolve + check a multi-module project starting from a main file */
function checkMultiModule(mainFile: string) {
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

  return Checker.checkModules(moduleInfos);
}

describe("Multi-module checker", () => {
  describe("selective imports", () => {
    test("import { add, multiply } from math — no errors", () => {
      const result = checkMultiModule("main_imports_math.kei");
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(0);
    });

    test("exports are collected for public symbols", () => {
      const result = checkMultiModule("main_imports_math.kei");
      const mathExports = result.moduleExports.get("math");
      expect(mathExports).toBeDefined();
      expect(mathExports!.has("add")).toBe(true);
      expect(mathExports!.has("multiply")).toBe(true);
      expect(mathExports!.has("Point")).toBe(true);
      // helper is private
      expect(mathExports!.has("helper")).toBe(false);
    });
  });

  describe("whole-module imports", () => {
    test("import math — no errors", () => {
      const result = checkMultiModule("main_whole_import.kei");
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(0);
    });
  });

  describe("multiple imports", () => {
    test("import from math and utils — no errors", () => {
      const result = checkMultiModule("main_chain.kei");
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(0);
    });
  });

  describe("visibility", () => {
    test("private functions are not exported", () => {
      const result = checkMultiModule("main_imports_math.kei");
      const mathExports = result.moduleExports.get("math");
      expect(mathExports).toBeDefined();
      // helper is not pub, should not be exported
      expect(mathExports!.has("helper")).toBe(false);
    });
  });
});
