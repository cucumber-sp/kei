import { describe, expect, test } from "bun:test";
import { formatDiagnostics } from "../../src/diagnostics/format";

describe("formatDiagnostics", () => {
  test("empty diagnostics list produces a 'no diagnostics' marker", () => {
    expect(formatDiagnostics([])).toBe("no diagnostics");
  });

  // PR 4+ adds variant-specific formatter cases and snapshot tests for
  // each. The empty-union shape in PR 1 makes per-variant rendering
  // unreachable; covering it here would require a synthetic variant
  // that doesn't exist in the formatter's switch, defeating the
  // exhaustiveness check.
});
