/**
 * Snapshot tests for the module-level (`E7xxx`) diagnostic variants
 * added in PR 4g. One test per variant. `cyclicImport` uses a real
 * multi-file fixture so the rendered cycle is non-trivial.
 *
 * The variants that already have resolver-pass call sites today
 * (`cyclicImport`, `moduleNotFound`) are covered through the resolver
 * end-to-end; the variants the resolver doesn't yet surface
 * (`importedSymbolNotExported`, `mixedModuleStyles`) are covered via
 * the typed methods so the catalog entry is exercised. PR 4b will
 * migrate the checker-pass "is not exported by" site onto the typed
 * method; this PR keeps the variant available so that migration has
 * a kind to land on.
 */

import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { createDiagnostics, formatDiagnostic } from "../../src/diagnostics";
import type { Span } from "../../src/diagnostics/types";
import { ModuleResolver } from "../../src/modules/resolver";

const FIXTURES_DIR = resolve(import.meta.dir, "../fixtures/modules");

const fakeSpan: Span = { file: "synthetic.kei", line: 1, column: 1, offset: 0 };

describe("modules diagnostics — cyclicImport (E7001)", () => {
  test("multi-file import cycle surfaces a typed cyclicImport with the full path", () => {
    // cycle_a imports cycle_b; cycle_b imports cycle_a. The fixtures live
    // in `tests/fixtures/modules/`.
    const entry = join(FIXTURES_DIR, "cycle_a.kei");
    const result = new ModuleResolver(entry).resolve(entry);

    const cyclic = result.diagnostics.filter((d) => d.kind === "cyclicImport");
    expect(cyclic.length).toBeGreaterThan(0);

    const first = cyclic[0];
    if (!first || first.kind !== "cyclicImport") throw new Error("expected cyclicImport");
    expect(first.code).toBe("E7001");
    expect(first.severity).toBe("error");
    expect(first.path.length).toBeGreaterThanOrEqual(3); // A → B → A
    expect(first.path[0]).toBe(first.path[first.path.length - 1]);
    expect(first.path).toContain("cycle_a");
    expect(first.path).toContain("cycle_b");

    expect(formatDiagnostic(first)).toBe(`error[E7001]: cyclic import: ${first.path.join(" → ")}`);
  });
});

describe("modules diagnostics — moduleNotFound (E7002)", () => {
  test("import of a nonexistent module surfaces a typed moduleNotFound with searched paths", () => {
    const entry = join(FIXTURES_DIR, "main_import_missing_module.kei");
    const result = new ModuleResolver(entry).resolve(entry);

    const notFound = result.diagnostics.filter((d) => d.kind === "moduleNotFound");
    expect(notFound.length).toBeGreaterThan(0);

    const first = notFound[0];
    if (!first || first.kind !== "moduleNotFound") throw new Error("expected moduleNotFound");
    expect(first.code).toBe("E7002");
    expect(first.severity).toBe("error");
    expect(first.importPath).toBe("no_such_module");
    expect(first.importerModule).toBe("main_import_missing_module");
    expect(first.searched?.length ?? 0).toBeGreaterThan(0);

    const rendered = formatDiagnostic(first);
    expect(rendered).toContain("error[E7002]:");
    expect(rendered).toContain("module 'main_import_missing_module'");
    expect(rendered).toContain("module 'no_such_module' not found");
    expect(rendered).toContain("searched:");
  });
});

describe("modules diagnostics — importedSymbolNotExported (E7003)", () => {
  test("typed method emits the variant with the right envelope and renders", () => {
    // Resolver doesn't surface this today; PR 4b will migrate the
    // checker-pass site. The variant exists so that migration has a
    // kind to land on; cover the catalog entry directly here.
    const diag = createDiagnostics({});
    diag.importedSymbolNotExported({
      span: fakeSpan,
      modulePath: "math",
      symbolName: "nonexistent_func",
    });

    const [d] = diag.diagnostics();
    if (!d || d.kind !== "importedSymbolNotExported") {
      throw new Error("expected importedSymbolNotExported");
    }
    expect(d.code).toBe("E7003");
    expect(d.severity).toBe("error");
    expect(d.modulePath).toBe("math");
    expect(d.symbolName).toBe("nonexistent_func");
    expect(formatDiagnostic(d)).toBe(
      "error[E7003]: 'nonexistent_func' is not exported by module 'math'"
    );
  });
});

describe("modules diagnostics — mixedModuleStyles (E7004)", () => {
  test("typed method emits the variant with the right envelope and renders", () => {
    // No migration site fires today — the rule the resolver enforces
    // doesn't have an active trigger in current fixtures. Cover the
    // catalog entry so the formatter case is exercised and the kind is
    // available the moment a call site needs it.
    const diag = createDiagnostics({});
    diag.mixedModuleStyles({
      span: fakeSpan,
      message: "cannot mix selective and whole-module imports of 'math'",
    });

    const [d] = diag.diagnostics();
    if (!d || d.kind !== "mixedModuleStyles") throw new Error("expected mixedModuleStyles");
    expect(d.code).toBe("E7004");
    expect(d.severity).toBe("error");
    expect(formatDiagnostic(d)).toBe(
      "error[E7004]: cannot mix selective and whole-module imports of 'math'"
    );
  });
});
