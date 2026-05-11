import { describe, expect, test } from "bun:test";
import { createDiagnostics } from "../../src/diagnostics";
import { formatDiagnostic } from "../../src/diagnostics/format";
import type { Span } from "../../src/diagnostics/types";

/**
 * PR 4b — one snapshot per name-resolution variant. Tests fire the
 * typed methods directly so the catalog (kind / code / severity / text)
 * stays pinned independent of which checker site emits them. End-to-end
 * coverage of the migrated call sites is already exercised by the
 * pre-existing checker tests; their substring assertions now include the
 * advisory `[Exxxx]` code prefix carried through the legacy adapter.
 */

const span: Span = { file: "synthetic.kei", line: 4, column: 9, offset: 17 };

describe("name-resolution diagnostics (PR 4b)", () => {
  test("undeclaredName — E2001, severity error", () => {
    const diag = createDiagnostics({});
    diag.undeclaredName({ span, name: "foo" });

    const [d] = diag.diagnostics();
    if (!d) throw new Error("expected one diagnostic");
    expect(d).toEqual({
      kind: "undeclaredName",
      code: "E2001",
      severity: "error",
      span,
      name: "foo",
    });
    expect(formatDiagnostic(d)).toBe("error[E2001]: undeclared variable 'foo'");
  });

  test("duplicateDecl — E2002, severity error, optional detail suffix", () => {
    const diag = createDiagnostics({});
    diag.duplicateDecl({ span, name: "add", detail: "(same parameter signature)" });
    diag.duplicateDecl({ span, name: "Point" });

    const [withDetail, plain] = diag.diagnostics();
    if (!withDetail || !plain) throw new Error("expected two diagnostics");
    expect(withDetail).toEqual({
      kind: "duplicateDecl",
      code: "E2002",
      severity: "error",
      span,
      name: "add",
      detail: "(same parameter signature)",
    });
    expect(formatDiagnostic(withDetail)).toBe(
      "error[E2002]: duplicate declaration 'add' (same parameter signature)"
    );
    expect(formatDiagnostic(plain)).toBe("error[E2002]: duplicate declaration 'Point'");
  });

  test("unresolvedImport — E2003, severity error", () => {
    const diag = createDiagnostics({});
    diag.unresolvedImport({ span, name: "multiply", module: "math" });

    const [d] = diag.diagnostics();
    if (!d) throw new Error("expected one diagnostic");
    expect(d).toEqual({
      kind: "unresolvedImport",
      code: "E2003",
      severity: "error",
      span,
      name: "multiply",
      module: "math",
    });
    expect(formatDiagnostic(d)).toBe("error[E2003]: 'multiply' is not exported by module 'math'");
  });

  test("nameNotFound — E2004, severity error", () => {
    const diag = createDiagnostics({});
    diag.nameNotFound({ span, name: "missing", container: "io" });

    const [d] = diag.diagnostics();
    if (!d) throw new Error("expected one diagnostic");
    expect(d).toEqual({
      kind: "nameNotFound",
      code: "E2004",
      severity: "error",
      span,
      name: "missing",
      container: "io",
    });
    expect(formatDiagnostic(d)).toBe("error[E2004]: module 'io' has no exported member 'missing'");
  });

  test("lint config can override severity (resolver hook)", () => {
    const diag = createDiagnostics({ severities: { undeclaredName: "warning" } });
    diag.undeclaredName({ span, name: "x" });
    const [d] = diag.diagnostics();
    expect(d?.severity).toBe("warning");
  });
});
