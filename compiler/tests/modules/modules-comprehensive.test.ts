/**
 * Comprehensive tests for the module system:
 * resolver, multi-module checker, and module KIR lowering.
 */

import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import type { ModuleCheckInfo } from "../../src/checker/checker.ts";
import { Checker } from "../../src/checker/checker.ts";
import { lowerModulesToKir } from "../../src/kir/lowering.ts";
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

describe("Module system (comprehensive)", () => {
  // ── Import single symbol ─────────────────────────────────────────────

  describe("import single symbol from module", () => {
    test("import { add } from math — resolves correctly", () => {
      const resolver = new ModuleResolver(join(FIXTURES_DIR, "main_import_single.kei"));
      const result = resolver.resolve(join(FIXTURES_DIR, "main_import_single.kei"));

      expect(result.errors).toHaveLength(0);
      const names = result.modules.map((m) => m.name);
      expect(names).toContain("math");
      expect(names).toContain("main_import_single");
    });

    test("import { add } from math — type checks ok", () => {
      const result = checkMultiModule("main_import_single.kei");
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(0);
    });

    test("import { add } from math — KIR has math_add", () => {
      const kirModule = lowerMultiModule("main_import_single.kei");
      const funcNames = kirModule.functions.map((f) => f.name);
      expect(funcNames).toContain("math_add");
      expect(funcNames).toContain("main");
    });
  });

  // ── Import multiple symbols ──────────────────────────────────────────

  describe("import multiple symbols", () => {
    test("import { add, multiply } from math — no errors", () => {
      const result = checkMultiModule("main_imports_math.kei");
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(0);
    });

    test("imports from two different modules — no errors", () => {
      const result = checkMultiModule("main_chain.kei");
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(0);
    });

    test("imports from two modules — all functions in KIR", () => {
      const kirModule = lowerMultiModule("main_chain.kei");
      const funcNames = kirModule.functions.map((f) => f.name);
      expect(funcNames).toContain("math_add");
      expect(funcNames).toContain("utils_negate");
      expect(funcNames).toContain("main");
    });
  });

  // ── Import non-existent symbol ───────────────────────────────────────

  describe("import non-existent symbol (error)", () => {
    test("importing symbol not exported by module → checker error", () => {
      const result = checkMultiModule("main_import_nonexistent_symbol.kei");
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors.length).toBeGreaterThan(0);
      const hasExpectedError = errors.some((d) => d.message.includes("is not exported by module"));
      expect(hasExpectedError).toBe(true);
    });
  });

  // ── Import from non-existent module ──────────────────────────────────

  describe("import from non-existent module (error)", () => {
    test("resolveImportPath returns null for missing module", () => {
      const resolver = new ModuleResolver(join(FIXTURES_DIR, "math.kei"));
      const resolved = resolver.resolveImportPath("does_not_exist");
      expect(resolved).toBeNull();
    });
  });

  // ── Circular import detection ────────────────────────────────────────

  describe("circular import detection", () => {
    test("cycle_a ↔ cycle_b — detected as circular", () => {
      const resolver = new ModuleResolver(join(FIXTURES_DIR, "cycle_a.kei"));
      const result = resolver.resolve(join(FIXTURES_DIR, "cycle_a.kei"));

      expect(result.errors.length).toBeGreaterThan(0);
      const hasCycleError = result.errors.some((e) => e.includes("Circular dependency"));
      expect(hasCycleError).toBe(true);
    });
  });

  // ── Using imported struct type ───────────────────────────────────────

  describe("using imported struct type", () => {
    test("import { Point } from math — can create struct literal", () => {
      const result = checkMultiModule("main_import_struct.kei");
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(0);
    });

    test("struct type from dependency is included in KIR types", () => {
      const kirModule = lowerMultiModule("main_import_struct.kei");
      const typeNames = kirModule.types.map((t) => t.name);
      expect(typeNames).toContain("Point");
    });
  });

  // ── Using imported function ──────────────────────────────────────────

  describe("using imported function", () => {
    test("calling imported function type-checks → ok", () => {
      const result = checkMultiModule("main_imports_math.kei");
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(0);
    });

    test("imported function is callable in KIR with mangled name", () => {
      const kirModule = lowerMultiModule("main_imports_math.kei");
      const funcNames = kirModule.functions.map((f) => f.name);
      expect(funcNames).toContain("math_add");
      expect(funcNames).toContain("math_multiply");
    });
  });

  // ── Whole-module import ──────────────────────────────────────────────

  describe("whole-module import", () => {
    test("import math — qualified call math.add() checks ok", () => {
      const result = checkMultiModule("main_whole_import.kei");
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(0);
    });

    test("import math — KIR has mangled math_add", () => {
      const kirModule = lowerMultiModule("main_whole_import.kei");
      const funcNames = kirModule.functions.map((f) => f.name);
      expect(funcNames).toContain("math_add");
    });
  });

  // ── Visibility ───────────────────────────────────────────────────────

  describe("visibility", () => {
    test("pub functions are exported", () => {
      const result = checkMultiModule("main_imports_math.kei");
      const mathExports = result.moduleExports.get("math");
      expect(mathExports).toBeDefined();
      expect(mathExports?.has("add")).toBe(true);
      expect(mathExports?.has("multiply")).toBe(true);
    });

    test("pub structs are exported", () => {
      const result = checkMultiModule("main_imports_math.kei");
      const mathExports = result.moduleExports.get("math");
      expect(mathExports).toBeDefined();
      expect(mathExports?.has("Point")).toBe(true);
    });

    test("private functions are not exported", () => {
      const result = checkMultiModule("main_imports_math.kei");
      const mathExports = result.moduleExports.get("math");
      expect(mathExports).toBeDefined();
      expect(mathExports?.has("helper")).toBe(false);
    });

    test("importing private symbol → checker error", () => {
      const result = checkMultiModule("main_import_private.kei");
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors.length).toBeGreaterThan(0);
      const hasNotExportedError = errors.some((d) =>
        d.message.includes("is not exported by module")
      );
      expect(hasNotExportedError).toBe(true);
    });
  });

  // ── Topological ordering ─────────────────────────────────────────────

  describe("topological ordering", () => {
    test("single dependency comes before main", () => {
      const resolver = new ModuleResolver(join(FIXTURES_DIR, "main_imports_math.kei"));
      const result = resolver.resolve(join(FIXTURES_DIR, "main_imports_math.kei"));

      const names = result.modules.map((m) => m.name);
      const mathIdx = names.indexOf("math");
      const mainIdx = names.indexOf("main_imports_math");
      expect(mathIdx).toBeLessThan(mainIdx);
    });

    test("multiple dependencies all come before main", () => {
      const resolver = new ModuleResolver(join(FIXTURES_DIR, "main_chain.kei"));
      const result = resolver.resolve(join(FIXTURES_DIR, "main_chain.kei"));

      const names = result.modules.map((m) => m.name);
      const mainIdx = names.indexOf("main_chain");
      const mathIdx = names.indexOf("math");
      const utilsIdx = names.indexOf("utils");
      expect(mathIdx).toBeLessThan(mainIdx);
      expect(utilsIdx).toBeLessThan(mainIdx);
    });
  });

  // ── Name mangling ────────────────────────────────────────────────────

  describe("name mangling", () => {
    test("main module 'main' function not prefixed", () => {
      const kirModule = lowerMultiModule("main_imports_math.kei");
      const funcNames = kirModule.functions.map((f) => f.name);
      expect(funcNames).toContain("main");
      expect(funcNames).not.toContain("main_imports_math_main");
    });

    test("dependency private functions also get mangled", () => {
      const kirModule = lowerMultiModule("main_imports_math.kei");
      const funcNames = kirModule.functions.map((f) => f.name);
      expect(funcNames).toContain("math_helper");
    });
  });

  // ── Extern deduplication ─────────────────────────────────────────────

  describe("extern deduplication", () => {
    test("duplicate externs across modules are deduplicated", () => {
      const kirModule = lowerMultiModule("main_imports_math.kei");
      const externNames = kirModule.externs.map((e) => e.name);
      const unique = new Set(externNames);
      expect(externNames.length).toBe(unique.size);
    });
  });
});
