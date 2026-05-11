/**
 * PR 4c — call-site diagnostic variants (E3xxx).
 *
 * One snapshot per variant. We run the full lexer → parser → checker
 * pipeline against a kei source that's known to trigger the variant,
 * then introspect the *new* diagnostics-union shape (via the
 * `Diagnostics.diagnostics()` snapshot, not the legacy `CheckResult`
 * adapter) so payload fields like `paramIndex` and the secondary-span
 * pointer are visible to assertions.
 *
 * The `argumentTypeMismatch` snapshot specifically verifies the
 * secondary span points at the parameter's declaration site, not just
 * the argument expression — the design doc lists that as the
 * non-trivial payload field for this variant.
 *
 * See `docs/design/diagnostics-module.md` §12, `docs/migrations/diagnostics/pr-4c.md`.
 */

import { describe, expect, test } from "bun:test";
import { Checker } from "../../src/checker/checker";
import { createDiagnostics } from "../../src/diagnostics";
import type { Diagnostic as NewDiagnostic } from "../../src/diagnostics/types";
import { parseSource } from "../helpers/pipeline";

/**
 * Run lex → parse → check and return the new-shape diagnostic union
 * (errors only). Constructs the `Diagnostics` sink directly so we can
 * inspect structured payload fields after the run; the legacy
 * `CheckResult.diagnostics` adapter would discard them.
 */
function checkVariants(source: string): readonly NewDiagnostic[] {
  const parsed = parseSource(source);
  const diag = createDiagnostics({});
  const checker = new Checker(parsed.program, parsed.source, "", { diag });
  checker.check();
  return diag.diagnostics().filter((d) => d.severity === "error");
}

/** Find the single diagnostic of a given kind; fail loudly if missing / duplicated. */
function expectOne<K extends NewDiagnostic["kind"]>(
  diags: readonly NewDiagnostic[],
  kind: K
): Extract<NewDiagnostic, { kind: K }> {
  const matches = diags.filter((d): d is Extract<NewDiagnostic, { kind: K }> => d.kind === kind);
  const [first, ...rest] = matches;
  if (!first || rest.length > 0) {
    const summary = diags
      .map((d) => `${d.kind}: ${"message" in d ? d.message : JSON.stringify(d)}`)
      .join("\n  ");
    throw new Error(
      `Expected exactly one '${kind}' diagnostic, got ${matches.length}. All diagnostics:\n  ${summary}`
    );
  }
  return first;
}

describe("diagnostics — call variants (E3xxx)", () => {
  test("arityMismatch — wrong argument count on a user function call", () => {
    const diags = checkVariants(`
      fn add(a: int, b: int) -> int { return a + b; }
      fn main() -> int { return add(1); }
    `);
    const d = expectOne(diags, "arityMismatch");
    expect(d.code).toBe("E3001");
    expect(d.expected).toBe(2);
    expect(d.got).toBe(1);
    expect(d.message).toBe("expected 2 argument(s), got 1");
    // No declaration secondary span on arity mismatches — the variant
    // points at the call site only.
    expect(d.secondarySpans).toBeUndefined();
  });

  test("argumentTypeMismatch — secondary span points at the parameter declaration", () => {
    const source = `
      fn greet(s: int, b: bool) -> int { return s; }
      fn main() -> int { return greet(1, 42); }
    `;
    const diags = checkVariants(source);
    const d = expectOne(diags, "argumentTypeMismatch");
    expect(d.code).toBe("E3002");
    expect(d.paramIndex).toBe(1);
    expect(d.expected).toBe("bool");
    expect(d.got).toBe("i32");
    expect(d.message).toBe("argument 2: expected 'bool', got 'i32'");

    // Primary span: the argument expression `42` (line 3 in the source above).
    expect(d.span.line).toBe(3);
    // Secondary span: the `b: bool` parameter declaration (line 2). The
    // exact column varies with source layout, but the line and label
    // pin the intent.
    expect(d.secondarySpans).toBeDefined();
    expect(d.secondarySpans).toHaveLength(1);
    const sec = d.secondarySpans?.[0];
    expect(sec?.label).toBe("parameter declared here");
    expect(sec?.span.line).toBe(2);
    // The parameter span isn't the same point as the call site.
    expect(sec?.span.offset).not.toBe(d.span.offset);
  });

  test("notCallable — calling a non-function value", () => {
    const diags = checkVariants(`
      fn main() -> int {
        let x: int = 7;
        return x(1);
      }
    `);
    const d = expectOne(diags, "notCallable");
    expect(d.code).toBe("E3003");
    expect(d.calleeType).toBe("i32");
    expect(d.message).toBe("expression of type 'i32' is not callable");
  });

  test("genericArgMismatch — wrong number of explicit type args on a generic function", () => {
    const diags = checkVariants(`
      fn id<T>(x: T) -> T { return x; }
      fn main() -> int { return id<int, int>(1); }
    `);
    const d = expectOne(diags, "genericArgMismatch");
    expect(d.code).toBe("E3004");
    expect(d.name).toBe("id");
    expect(d.expected).toBe(1);
    expect(d.got).toBe(2);
    // Wording preserved byte-for-byte from the pre-migration string.
    expect(d.message).toContain("function 'id' expects 1 type argument(s)");
    expect(d.message).toContain("got 2");
  });

  test("methodNotFound — static method call on a struct with no such method", () => {
    const diags = checkVariants(`
      struct Point { x: int; y: int; }
      fn main() -> int {
        Point.nope();
        return 0;
      }
    `);
    const d = expectOne(diags, "methodNotFound");
    expect(d.code).toBe("E3005");
    expect(d.typeName).toBe("Point");
    expect(d.methodName).toBe("nope");
    expect(d.message).toBe("type 'Point' has no method 'nope'");
  });
});
