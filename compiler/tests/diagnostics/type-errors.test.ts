/**
 * Per-variant snapshot fixtures for the type-errors slice (PR 4a).
 *
 * Each test compiles a minimal kei source designed to fire exactly one
 * variant, walks the typed `Diagnostics` snapshot to find the emitted
 * variant, and asserts on (a) the variant kind + code prefix (so the
 * E1xxx catalog stays pinned) and (b) the formatted text body so any
 * wording drift across PR 4a–N gets caught.
 *
 * `nonOptionalAccess` has no checker site yet — the variant is
 * pre-declared in `types.ts` against the future Optional<T> lowering
 * (see [#19]). We test the formatter directly until the checker grows
 * a site.
 *
 * See `docs/design/diagnostics-module.md` §12.
 */

import { describe, expect, test } from "bun:test";
import { Checker } from "../../src/checker/checker";
import { createDiagnostics, type Diagnostics, formatDiagnostic } from "../../src/diagnostics";
import type { Diagnostic } from "../../src/diagnostics/types";
import { parseSource } from "../helpers/pipeline";

function checkAndGetDiag(content: string): Diagnostics {
  const { source, program } = parseSource(content, "type-errors.test.kei");
  const diag = createDiagnostics({});
  new Checker(program, source, "", { diag }).check();
  return diag;
}

function findByKind(diags: readonly Diagnostic[], kind: Diagnostic["kind"]): Diagnostic {
  const d = diags.find((x) => x.kind === kind);
  if (!d) {
    const seen = diags.map((x) => x.kind).join(", ") || "(none)";
    throw new Error(`expected a '${kind}' diagnostic; saw [${seen}]`);
  }
  return d;
}

describe("PR 4a — type-error variants", () => {
  test("typeMismatch — `static` type-annotation conflict (decl-checker)", () => {
    // Top-level `static` initializers flow through decl-checker, which is
    // the file PR 4a migrates. `let` bindings stay on untriaged until
    // stmt-checker is touched (out of scope per brief).
    const diag = checkAndGetDiag(`static FOO: i32 = "hello"; fn main() -> int { return 0; }`);
    const d = findByKind(diag.diagnostics(), "typeMismatch");
    if (d.kind !== "typeMismatch") throw new Error("unreachable: kind narrowed by findByKind");
    expect(d.code).toBe("E1001");
    expect(d.context).toBe("type mismatch");
    expect(d.expected).toBe("i32");
    expect(d.got).toBe("string");
    expect(formatDiagnostic(d)).toBe(`error[E1001]: type mismatch: expected 'i32', got 'string'`);
  });

  test("expectedType — `if` expression condition is not bool", () => {
    // `if` *expression* (RHS of `let`) is expr-checker's territory; the
    // *statement* form lives in stmt-checker, out of scope for PR 4a.
    const diag = checkAndGetDiag("fn main() -> int { let y = if 1 { 1 } else { 2 }; return 0; }");
    const d = findByKind(diag.diagnostics(), "expectedType");
    if (d.kind !== "expectedType") throw new Error("unreachable: kind narrowed by findByKind");
    expect(d.code).toBe("E1002");
    expect(d.context).toBe("if expression condition");
    expect(d.expected).toBe("bool");
    expect(d.got).toBe("i32");
    expect(formatDiagnostic(d)).toBe(
      `error[E1002]: if expression condition must be bool, got 'i32'`
    );
  });

  test("cannotCast — incompatible explicit `as` cast", () => {
    const diag = checkAndGetDiag(`fn main() -> int { let s = "hi"; let n = s as i32; return 0; }`);
    const d = findByKind(diag.diagnostics(), "cannotCast");
    if (d.kind !== "cannotCast") throw new Error("unreachable: kind narrowed by findByKind");
    expect(d.code).toBe("E1003");
    expect(d.from).toBe("string");
    expect(d.to).toBe("i32");
    expect(formatDiagnostic(d)).toBe(`error[E1003]: cannot cast 'string' to 'i32'`);
  });

  test("incompatibleAssignment — struct field type mismatch", () => {
    const diag = checkAndGetDiag(`
      struct Point { x: i32; y: i32; }
      fn main() -> int {
        let p = Point{ x: "nope", y: 0 };
        return 0;
      }
    `);
    const d = findByKind(diag.diagnostics(), "incompatibleAssignment");
    if (d.kind !== "incompatibleAssignment")
      throw new Error("unreachable: kind narrowed by findByKind");
    expect(d.code).toBe("E1004");
    expect(d.target).toBe(`field 'x'`);
    expect(d.expected).toBe("i32");
    expect(d.got).toBe("string");
    expect(formatDiagnostic(d)).toBe(`error[E1004]: field 'x': expected 'i32', got 'string'`);
  });

  test("nonOptionalAccess — pre-declared variant renders via formatter", () => {
    // No checker site emits this yet; exercise the variant's formatter
    // case directly so the E1xxx catalog stays honest and the wording
    // doesn't drift before a real site lands.
    const synthetic: Diagnostic = {
      kind: "nonOptionalAccess",
      code: "E1005",
      severity: "error",
      span: { file: "synthetic.kei", line: 1, column: 1, offset: 0 },
      operation: "unwrap",
      got: "i32",
    };
    expect(formatDiagnostic(synthetic)).toBe(
      `error[E1005]: unwrap requires Optional<T>, got 'i32'`
    );
  });

  test("unknownType — struct literal head is not a known type", () => {
    const diag = checkAndGetDiag("fn main() -> int { let v = Nope{ x: 1 }; return 0; }");
    const d = findByKind(diag.diagnostics(), "unknownType");
    if (d.kind !== "unknownType") throw new Error("unreachable: kind narrowed by findByKind");
    expect(d.code).toBe("E1006");
    expect(d.name).toBe("Nope");
    expect(formatDiagnostic(d)).toBe(`error[E1006]: undeclared type 'Nope'`);
  });
});
