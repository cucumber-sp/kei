import { describe, expect, test } from "bun:test";
import {
  formatDiagnostic,
  printErrorSummary,
  reportDiagnostics,
} from "../../src/cli/diagnostics-format";
import type { Diagnostic } from "../../src/errors/diagnostic";
import { Severity } from "../../src/errors/diagnostic";
import { SourceFile } from "../../src/utils/source";

function diagnostic(
  line: number,
  column: number,
  message: string,
  severity = Severity.Error,
  file = "test.kei"
): Diagnostic {
  return {
    severity,
    message,
    location: { file, line, column, offset: 0 },
  };
}

/**
 * Capture lines written to console.error/console.log during `fn`.
 * Returns the captured output and restores the originals.
 */
function capture(stream: "error" | "log", fn: () => void): string[] {
  const lines: string[] = [];
  const original = console[stream];
  console[stream] = (msg?: unknown) => {
    lines.push(String(msg ?? ""));
  };
  try {
    fn();
  } finally {
    console[stream] = original;
  }
  return lines;
}

describe("formatDiagnostic", () => {
  test("header only when source is omitted", () => {
    const out = formatDiagnostic(diagnostic(2, 5, "boom"));
    expect(out).toBe("test.kei:2:5: error: boom");
  });

  test("uses '<unknown>' when location.file is empty", () => {
    const diag: Diagnostic = {
      severity: Severity.Warning,
      message: "watch out",
      location: { file: "", line: 1, column: 1, offset: 0 },
    };
    expect(formatDiagnostic(diag)).toBe("<unknown>:1:1: warning: watch out");
  });

  test("renders source line and caret when source provided", () => {
    const source = new SourceFile("test.kei", "let x = 1;\nlet y = 2;\n");
    const out = formatDiagnostic(diagnostic(2, 5, "oops"), source);
    const lines = out.split("\n");
    expect(lines[0]).toBe("test.kei:2:5: error: oops");
    expect(lines[1]).toBe("  let y = 2;");
    expect(lines[2]).toBe("      ^"); // 2 leading spaces + 4 spaces (col-1) + caret
  });

  test("falls back to header-only if line is out of range", () => {
    const source = new SourceFile("test.kei", "only one line\n");
    const out = formatDiagnostic(diagnostic(99, 1, "missing"), source);
    expect(out).toBe("test.kei:99:1: error: missing");
  });

  test("line index 0 (out of range, line is 1-based) returns header only", () => {
    const source = new SourceFile("test.kei", "abc\n");
    const out = formatDiagnostic(diagnostic(0, 1, "bad"), source);
    expect(out).toBe("test.kei:0:1: error: bad");
  });

  test("severity is rendered as the enum string", () => {
    const out = formatDiagnostic(diagnostic(1, 1, "fyi", Severity.Info));
    expect(out.includes("info: fyi")).toBe(true);
  });
});

describe("reportDiagnostics", () => {
  test("returns 0 when there are no diagnostics", () => {
    const lines = capture("error", () => {
      const count = reportDiagnostics([]);
      expect(count).toBe(0);
    });
    expect(lines).toHaveLength(0);
  });

  test("counts only errors, prints all severities", () => {
    let count = 0;
    const lines = capture("error", () => {
      count = reportDiagnostics([
        diagnostic(1, 1, "err1", Severity.Error),
        diagnostic(2, 1, "warn1", Severity.Warning),
        diagnostic(3, 1, "err2", Severity.Error),
        diagnostic(4, 1, "info1", Severity.Info),
      ]);
    });
    expect(count).toBe(2);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("error: err1");
    expect(lines[1]).toContain("warning: warn1");
    expect(lines[3]).toContain("info: info1");
  });

  test("uses sourceMap entry over fallback source", () => {
    const main = new SourceFile("main.kei", "main line\n");
    const other = new SourceFile("other.kei", "other line\n");
    const sourceMap = new Map([["other.kei", other]]);

    const lines = capture("error", () => {
      reportDiagnostics(
        [diagnostic(1, 1, "from other", Severity.Error, "other.kei")],
        main,
        sourceMap
      );
    });

    // Source line for "other.kei" should be rendered, not main's
    expect(lines[0]).toContain("other.kei:1:1");
    expect(lines[0]).toContain("other line");
    expect(lines[0]).not.toContain("main line");
  });

  test("falls back to provided source when filename not in sourceMap", () => {
    const main = new SourceFile("main.kei", "main line\n");
    const sourceMap = new Map<string, SourceFile>();
    const lines = capture("error", () => {
      reportDiagnostics(
        [diagnostic(1, 1, "fallback", Severity.Error, "main.kei")],
        main,
        sourceMap
      );
    });
    expect(lines[0]).toContain("main line");
  });
});

describe("printErrorSummary", () => {
  test("singular form for 1 error", () => {
    const lines = capture("error", () => printErrorSummary(1));
    expect(lines).toEqual(["\n1 error emitted"]);
  });

  test("plural form for 0 errors", () => {
    const lines = capture("error", () => printErrorSummary(0));
    expect(lines).toEqual(["\n0 errors emitted"]);
  });

  test("plural form for >1 errors", () => {
    const lines = capture("error", () => printErrorSummary(7));
    expect(lines).toEqual(["\n7 errors emitted"]);
  });
});
