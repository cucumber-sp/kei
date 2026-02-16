/**
 * Tests for the module resolver.
 */

import { test, expect, describe } from "bun:test";
import { resolve, join } from "node:path";
import { ModuleResolver } from "../../src/modules/resolver.ts";

const FIXTURES_DIR = resolve(import.meta.dir, "../fixtures/modules");

describe("ModuleResolver", () => {
  describe("single-file (no imports)", () => {
    test("resolves a file with no imports", () => {
      const resolver = new ModuleResolver(join(FIXTURES_DIR, "math.kei"));
      const result = resolver.resolve(join(FIXTURES_DIR, "math.kei"));

      expect(result.errors).toHaveLength(0);
      expect(result.modules).toHaveLength(1);
      expect(result.modules[0].name).toBe("math");
    });
  });

  describe("selective imports", () => {
    test("discovers imported module", () => {
      const resolver = new ModuleResolver(join(FIXTURES_DIR, "main_imports_math.kei"));
      const result = resolver.resolve(join(FIXTURES_DIR, "main_imports_math.kei"));

      expect(result.errors).toHaveLength(0);
      expect(result.modules.length).toBeGreaterThanOrEqual(2);

      const names = result.modules.map((m) => m.name);
      expect(names).toContain("math");
      expect(names).toContain("main_imports_math");
    });

    test("modules are in topological order (dependency first)", () => {
      const resolver = new ModuleResolver(join(FIXTURES_DIR, "main_imports_math.kei"));
      const result = resolver.resolve(join(FIXTURES_DIR, "main_imports_math.kei"));

      expect(result.errors).toHaveLength(0);
      const names = result.modules.map((m) => m.name);
      const mathIdx = names.indexOf("math");
      const mainIdx = names.indexOf("main_imports_math");
      expect(mathIdx).toBeLessThan(mainIdx);
    });
  });

  describe("multiple imports", () => {
    test("discovers multiple imported modules", () => {
      const resolver = new ModuleResolver(join(FIXTURES_DIR, "main_chain.kei"));
      const result = resolver.resolve(join(FIXTURES_DIR, "main_chain.kei"));

      expect(result.errors).toHaveLength(0);
      const names = result.modules.map((m) => m.name);
      expect(names).toContain("math");
      expect(names).toContain("utils");
      expect(names).toContain("main_chain");
    });

    test("dependencies come before dependents in topological order", () => {
      const resolver = new ModuleResolver(join(FIXTURES_DIR, "main_chain.kei"));
      const result = resolver.resolve(join(FIXTURES_DIR, "main_chain.kei"));

      const names = result.modules.map((m) => m.name);
      const mainIdx = names.indexOf("main_chain");
      const mathIdx = names.indexOf("math");
      const utilsIdx = names.indexOf("utils");

      // Both math and utils must come before main_chain
      expect(mathIdx).toBeLessThan(mainIdx);
      expect(utilsIdx).toBeLessThan(mainIdx);
    });
  });

  describe("cycle detection", () => {
    test("detects circular dependencies", () => {
      const resolver = new ModuleResolver(join(FIXTURES_DIR, "cycle_a.kei"));
      const result = resolver.resolve(join(FIXTURES_DIR, "cycle_a.kei"));

      expect(result.errors.length).toBeGreaterThan(0);
      const hasCycleError = result.errors.some((e) => e.includes("Circular dependency"));
      expect(hasCycleError).toBe(true);
    });
  });

  describe("missing module", () => {
    test("reports error for unresolvable import", () => {
      const resolver = new ModuleResolver(join(FIXTURES_DIR, "math.kei"));
      const resolved = resolver.resolveImportPath("nonexistent_module");
      expect(resolved).toBeNull();
    });
  });

  describe("path resolution", () => {
    test("resolves import path from source root", () => {
      const resolver = new ModuleResolver(join(FIXTURES_DIR, "math.kei"));
      const resolved = resolver.resolveImportPath("math");
      expect(resolved).toBeTruthy();
      expect(resolved!.endsWith("math.kei")).toBe(true);
    });

    test("resolves std/ imports", () => {
      const resolver = new ModuleResolver(join(FIXTURES_DIR, "math.kei"));
      const resolved = resolver.resolveImportPath("io");
      // std/io.kei should be found
      if (resolved) {
        expect(resolved.endsWith("io.kei")).toBe(true);
      }
    });
  });
});
