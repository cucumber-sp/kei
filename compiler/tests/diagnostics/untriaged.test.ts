import { describe, expect, test } from "bun:test";
import { createDiagnostics } from "../../src/diagnostics";
import { formatDiagnostic, formatDiagnostics } from "../../src/diagnostics/format";
import type { Span } from "../../src/diagnostics/types";

const fakeSpan: Span = { file: "synthetic.kei", line: 3, column: 7, offset: 42 };

describe("diag.untriaged", () => {
  test("emit + snapshot stores the catch-all variant with caller-provided severity", () => {
    const diag = createDiagnostics({});
    diag.untriaged({ severity: "error", span: fakeSpan, message: "oops" });
    diag.untriaged({ severity: "warning", span: fakeSpan, message: "heads up" });

    const snap = diag.diagnostics();
    expect(snap).toHaveLength(2);

    const first = snap[0];
    expect(first).toEqual({
      kind: "untriaged",
      code: "TODO",
      severity: "error",
      span: fakeSpan,
      message: "oops",
    });

    const second = snap[1];
    expect(second?.severity).toBe("warning");
    expect(second?.kind).toBe("untriaged");
  });

  test("formatter renders `<severity>: <message>` with no code prefix", () => {
    const diag = createDiagnostics({});
    diag.untriaged({ severity: "error", span: fakeSpan, message: "type mismatch" });

    const [d] = diag.diagnostics();
    if (!d) throw new Error("expected one diagnostic");
    // Advisory codes only appear once specific variants are carved out
    // in PRs 4a–4g; the `'TODO'` sentinel must never reach user output.
    expect(formatDiagnostic(d)).toBe("error: type mismatch");
    expect(formatDiagnostic(d)).not.toContain("TODO");
  });

  test("formatDiagnostics joins lines and skips the empty marker when populated", () => {
    const diag = createDiagnostics({});
    diag.untriaged({ severity: "error", span: fakeSpan, message: "first" });
    diag.untriaged({ severity: "warning", span: fakeSpan, message: "second" });

    expect(formatDiagnostics(diag.diagnostics())).toBe("error: first\nwarning: second");
  });
});
