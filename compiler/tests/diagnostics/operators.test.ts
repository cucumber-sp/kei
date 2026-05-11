/**
 * Snapshot tests for the operator-category variants (PR 4f). One
 * minimal kei source per variant fires exactly one diagnostic; we
 * assert on the formatted output so wording drift across the four
 * variants is caught here.
 *
 * The fixtures run a full lex → parse → check pipeline against the
 * `Checker`'s own `Diagnostics` sink (rather than a synthetic one
 * built by hand) so the test exercises the real migration path from
 * `operator-checker.ts` through the typed `Diagnostics` methods.
 */

import { describe, expect, test } from "bun:test";
import { Checker } from "../../src/checker/checker";
import { createDiagnostics, formatDiagnostic } from "../../src/diagnostics";
import { Lexer } from "../../src/lexer";
import { Parser } from "../../src/parser";
import { SourceFile } from "../../src/utils/source";

function diagnosticsFor(source: string) {
  const sf = new SourceFile("test.kei", source);
  const tokens = new Lexer(sf).tokenize();
  const program = new Parser(tokens).parse();
  const diag = createDiagnostics({});
  const checker = new Checker(program, sf, "", { diag });
  checker.check();
  return diag.diagnostics();
}

describe("operator variants (PR 4f)", () => {
  test("noOperatorOverload formatter wiring (defensive fallthrough)", () => {
    // The `noOperatorOverload` variant's three sites in
    // `operator-checker.ts` (unknown binary / unary / assignment
    // operator) are defensive — the parser only emits operators from
    // fixed sets, so none of them is reachable from valid syntax
    // today. We exercise the typed method + formatter directly so the
    // wiring is covered even though no source fixture can fire it.
    const diag = createDiagnostics({});
    diag.noOperatorOverload({
      span: { file: "test.kei", line: 1, column: 1, offset: 0 },
      op: "@@",
      message: "unknown binary operator '@@'",
    });
    const [d] = diag.diagnostics();
    if (!d) throw new Error("expected one diagnostic");
    expect(d.kind).toBe("noOperatorOverload");
    expect(d.kind === "noOperatorOverload" && d.op).toBe("@@");
    expect(d.code).toBe("E6001");
    expect(formatDiagnostic(d)).toBe("error[E6001]: unknown binary operator '@@'");
  });

  test("invalidOperand fires on unary `-` applied to a struct without op_neg", () => {
    const source = `
      struct Vec2 {
        x: f64;
        y: f64;
      }
      fn main() -> i32 {
        let a = Vec2{ x: 1.0, y: 2.0 };
        let b = -a;
        return 0;
      }
    `;
    const diags = diagnosticsFor(source);
    const op = diags.find((d) => d.kind === "invalidOperand");
    if (!op || op.kind !== "invalidOperand") {
      throw new Error(`expected invalidOperand, got: ${diags.map((d) => d.kind).join(", ")}`);
    }
    expect(op.op).toBe("-");
    expect(op.code).toBe("E6002");
    expect(formatDiagnostic(op)).toBe(
      "error[E6002]: unary '-' requires numeric operand, got 'Vec2'"
    );
  });

  test("binaryTypeMismatch fires on `i32 + str`", () => {
    const source = `
      fn main() -> i32 {
        let x = 1 + "hi";
        return 0;
      }
    `;
    const diags = diagnosticsFor(source);
    const bm = diags.find((d) => d.kind === "binaryTypeMismatch");
    if (!bm || bm.kind !== "binaryTypeMismatch") {
      throw new Error(`expected binaryTypeMismatch, got: ${diags.map((d) => d.kind).join(", ")}`);
    }
    expect(bm.op).toBe("+");
    expect(bm.code).toBe("E6003");
    expect(formatDiagnostic(bm)).toBe(
      "error[E6003]: operator '+' requires same types, got 'i32' and 'string'"
    );
  });

  test("unaryTypeMismatch fires on unary `-` applied to a bool", () => {
    const source = `
      fn main() -> i32 {
        let x = -true;
        return 0;
      }
    `;
    const diags = diagnosticsFor(source);
    const um = diags.find((d) => d.kind === "unaryTypeMismatch");
    if (!um || um.kind !== "unaryTypeMismatch") {
      throw new Error(`expected unaryTypeMismatch, got: ${diags.map((d) => d.kind).join(", ")}`);
    }
    expect(um.op).toBe("-");
    expect(um.code).toBe("E6004");
    expect(formatDiagnostic(um)).toBe(
      "error[E6004]: unary '-' requires numeric operand, got 'bool'"
    );
  });
});
