/**
 * Snapshot one fixture per struct-category variant carved out of
 * `untriaged` in PR 4d (`docs/migrations/diagnostics/pr-4d.md`).
 *
 * Each test feeds a minimal `.kei` source through the full check
 * pipeline, locks the new-union snapshot for the migrated kind, and
 * locks the formatted output (with its `E4xxx` code prefix) so wording
 * regressions surface immediately. Legacy adapter coverage —
 * substring matches against `d.message` — is exercised by the
 * existing checker tests; this file is the typed surface.
 */

import { describe, expect, test } from "bun:test";
import { Checker } from "../../src/checker/checker";
import { createDiagnostics, formatDiagnostic } from "../../src/diagnostics";
import type { Diagnostic as VariantDiagnostic } from "../../src/diagnostics/types";
import { Lexer } from "../../src/lexer";
import { Parser } from "../../src/parser";
import { SourceFile } from "../../src/utils/source";

function run(source: string): readonly VariantDiagnostic[] {
  const sf = new SourceFile("structs-fixture.kei", source);
  const tokens = new Lexer(sf).tokenize();
  const program = new Parser(tokens).parse();
  const diag = createDiagnostics({});
  const checker = new Checker(program, sf, "", { diag });
  checker.check();
  return diag.diagnostics();
}

function pick(
  diags: readonly VariantDiagnostic[],
  kind: VariantDiagnostic["kind"]
): VariantDiagnostic {
  const found = diags.find((d) => d.kind === kind);
  if (!found) {
    const seen = diags.map((d) => d.kind).join(", ");
    throw new Error(`expected a '${kind}' diagnostic, got: [${seen}]`);
  }
  return found;
}

describe("PR 4d struct diagnostics", () => {
  test("unknownField fires on a struct-literal field that doesn't exist", () => {
    const diags = run(`
      struct Point { x: i32; y: i32; }
      fn main() {
        let p = Point{ x: 1, y: 2, z: 3 };
      }
    `);
    const d = pick(diags, "unknownField");
    expect(d).toMatchObject({
      kind: "unknownField",
      code: "E4001",
      severity: "error",
      structName: "Point",
      fieldName: "z",
      access: "literal",
    });
    expect(formatDiagnostic(d)).toBe("error[E4001]: struct 'Point' has no field 'z'");
  });

  test("unknownField (member access) preserves the 'or method' wording", () => {
    const diags = run(`
      struct Point { x: i32; y: i32; }
      fn main() {
        let p = Point{ x: 1, y: 2 };
        let q = p.z;
      }
    `);
    const d = pick(diags, "unknownField");
    expect(d).toMatchObject({
      kind: "unknownField",
      code: "E4001",
      access: "member",
      structName: "Point",
      fieldName: "z",
    });
    expect(formatDiagnostic(d)).toBe("error[E4001]: type 'Point' has no field or method 'z'");
  });

  test("missingField fires once per omitted field at the literal span", () => {
    const diags = run(`
      struct Point { x: i32; y: i32; }
      fn main() {
        let p = Point{ x: 1 };
      }
    `);
    const d = pick(diags, "missingField");
    expect(d).toMatchObject({
      kind: "missingField",
      code: "E4002",
      severity: "error",
      structName: "Point",
      fieldName: "y",
    });
    expect(formatDiagnostic(d)).toBe("error[E4002]: missing field 'y' in struct literal 'Point'");
  });

  test("invalidFieldAccess fires for `.field` on a non-struct type", () => {
    const diags = run(`
      fn main() {
        let n: i32 = 1;
        let bad = n.foo;
      }
    `);
    const d = pick(diags, "invalidFieldAccess");
    expect(d).toMatchObject({
      kind: "invalidFieldAccess",
      code: "E4003",
      severity: "error",
      typeName: "i32",
      property: "foo",
    });
    expect(formatDiagnostic(d)).toBe("error[E4003]: type 'i32' has no property 'foo'");
  });

  test("cannotConstructStruct fires when struct-literal name isn't a struct", () => {
    // `enum` resolves as a type but not a struct — exactly the
    // 'is not a struct type' path. Using a non-existent name routes
    // through `undeclared type` (4b's territory) instead.
    const diags = run(`
      enum Color : u8 { Red = 0, Green = 1 }
      fn main() {
        let c = Color{ x: 1 };
      }
    `);
    const d = pick(diags, "cannotConstructStruct");
    expect(d).toMatchObject({
      kind: "cannotConstructStruct",
      code: "E4004",
      severity: "error",
      name: "Color",
    });
    expect(formatDiagnostic(d)).toBe("error[E4004]: 'Color' is not a struct type");
  });

  test("unsafeStructFieldRule fires on a plain struct carrying a ptr<T> field", () => {
    const diags = run(`
      struct Bad { p: *i32; }
      fn main() {}
    `);
    const d = pick(diags, "unsafeStructFieldRule");
    expect(d).toMatchObject({
      kind: "unsafeStructFieldRule",
      code: "E4005",
      severity: "error",
      structName: "Bad",
      fieldName: "p",
    });
    expect(formatDiagnostic(d)).toBe(
      "error[E4005]: struct 'Bad' cannot have pointer field 'p'; use 'unsafe struct' for pointer fields"
    );
  });
});
