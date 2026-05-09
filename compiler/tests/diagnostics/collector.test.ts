import { describe, expect, test } from "bun:test";
import { createCollector, type LintConfig, resolveSeverity } from "../../src/diagnostics/collector";
import type { Diagnostic, Severity, Span } from "../../src/diagnostics/types";

/**
 * Synthetic test-only variant. The public `Diagnostic` union is empty in
 * PR 1, but the collector's contract (emit + snapshot, lint-config
 * isolation) is testable independently of which variants exist. We
 * fabricate a shape and cast it to `Diagnostic` so the collector code
 * paths exercise. Keeping this in `tests/` keeps the public union
 * pristine — design doc §3 forbids leaking test variants into
 * `src/diagnostics/types.ts`.
 */
interface TestDiagnostic {
  kind: "testKind";
  code: "T0001";
  severity: Severity;
  span: Span;
  message: string;
}

const fakeSpan: Span = { file: "synthetic.kei", line: 1, column: 1, offset: 0 };

function makeDiag(message: string, severity: Severity = "error"): Diagnostic {
  const d: TestDiagnostic = {
    kind: "testKind",
    code: "T0001",
    severity,
    span: fakeSpan,
    message,
  };
  return d as unknown as Diagnostic;
}

describe("Collector", () => {
  test("empty collector returns empty snapshot", () => {
    const c = createCollector();
    expect(c.snapshot()).toEqual([]);
  });

  test("emit + snapshot roundtrip preserves order", () => {
    const c = createCollector();
    const a = makeDiag("first");
    const b = makeDiag("second");
    const z = makeDiag("third");

    c.emit(a);
    c.emit(b);
    c.emit(z);

    const out = c.snapshot();
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(b);
    expect(out[2]).toBe(z);
  });

  test("snapshot is a frozen copy — mutating later emits doesn't change it", () => {
    const c = createCollector();
    c.emit(makeDiag("first"));

    const snap1 = c.snapshot();
    expect(snap1).toHaveLength(1);
    expect(Object.isFrozen(snap1)).toBe(true);

    c.emit(makeDiag("second"));
    expect(snap1).toHaveLength(1); // earlier snapshot stays put
    expect(c.snapshot()).toHaveLength(2);
  });

  test("two collectors are isolated — emit into one, the other stays empty", () => {
    const a = createCollector();
    const b = createCollector();

    a.emit(makeDiag("only in a"));

    expect(a.snapshot()).toHaveLength(1);
    expect(b.snapshot()).toEqual([]);
  });
});

describe("resolveSeverity", () => {
  test("empty LintConfig returns the catalog default unchanged", () => {
    const config: LintConfig = {};
    expect(resolveSeverity("anyKind", config, "error")).toBe("error");
    expect(resolveSeverity("anyKind", config, "warning")).toBe("warning");
    expect(resolveSeverity("anyKind", config, "note")).toBe("note");
  });

  test("LintConfig override (reserved hook) wins over the catalog default", () => {
    // `severities` isn't a v1 surface, but the resolver hook honors it so
    // future PRs adding the CLI flag / `kei.toml` lint section don't have
    // to thread anything new through call sites.
    const config: LintConfig = { severities: { unusedVariable: "error" } };
    expect(resolveSeverity("unusedVariable", config, "warning")).toBe("error");
    expect(resolveSeverity("otherKind", config, "warning")).toBe("warning");
  });
});
