/**
 * Snapshot fixtures for PR 4e lifecycle / checker-rule variants
 * (`docs/design/diagnostics-module.md` §9 PR 4e, §12).
 *
 * One assertion per variant. Each test parses a minimal kei source that
 * trips exactly one rule on a hand-authored `__destroy` / `__oncopy`
 * hook, then checks that the new union shape was emitted with the right
 * code prefix and field payload.
 *
 * Scope reminder: these variants cover *user-authored* hooks only. The
 * Lifecycle module's auto-generation logic is a separate concern (see
 * `docs/design/lifecycle-module.md`) and lives in its own migration.
 */

import { describe, expect, test } from "bun:test";
import { Checker } from "../../src/checker/checker";
import { createDiagnostics } from "../../src/diagnostics";
import { formatDiagnostic } from "../../src/diagnostics/format";
import type { Diagnostic } from "../../src/diagnostics/types";
import { parseSource } from "../helpers/pipeline";

function diagnosticsOf(source: string): readonly Diagnostic[] {
  const parsed = parseSource(source);
  const diag = createDiagnostics({});
  const checker = new Checker(parsed.program, parsed.source, "", { diag });
  checker.check();
  return diag.diagnostics();
}

function findByKind<K extends Diagnostic["kind"]>(
  diags: readonly Diagnostic[],
  kind: K
): Extract<Diagnostic, { kind: K }> | undefined {
  return diags.find((d): d is Extract<Diagnostic, { kind: K }> => d.kind === kind);
}

describe("PR 4e lifecycle-rule variants", () => {
  test("invalidLifecycleSignature — `wrong-arity` on __destroy with extra params", () => {
    const diags = diagnosticsOf(`
      extern fn c_free(p: *void);
      unsafe struct Buffer {
        data: *void;
        fn __destroy(self: ref Buffer, extra: int) {
          unsafe { c_free(self.data); }
        }
        fn __oncopy(self: ref Buffer) {}
      }
      fn main() -> int { return 0; }
    `);

    const d = findByKind(diags, "invalidLifecycleSignature");
    expect(d).toBeDefined();
    if (!d) return;
    expect(d.code).toBe("E5001");
    expect(d.severity).toBe("error");
    expect(d.hookName).toBe("__destroy");
    expect(d.structName).toBe("Buffer");
    expect(d.reason).toBe("wrong-arity");
    expect(formatDiagnostic(d)).toBe(
      "error[E5001]: lifecycle hook '__destroy' must take exactly 1 parameter ('self: ref Buffer')"
    );
  });

  test("invalidLifecycleSignature — `first-param-not-self` when the param is renamed", () => {
    const diags = diagnosticsOf(`
      extern fn c_free(p: *void);
      unsafe struct Buffer {
        data: *void;
        fn __destroy(self: ref Buffer) {
          unsafe { c_free(self.data); }
        }
        fn __oncopy(other: ref Buffer) {}
      }
      fn main() -> int { return 0; }
    `);

    const d = findByKind(diags, "invalidLifecycleSignature");
    expect(d).toBeDefined();
    if (!d) return;
    expect(d.code).toBe("E5001");
    expect(d.hookName).toBe("__oncopy");
    expect(d.reason).toBe("first-param-not-self");
    expect(formatDiagnostic(d)).toBe(
      "error[E5001]: lifecycle hook '__oncopy' first parameter must be named 'self'"
    );
  });

  test("unsafeStructMissingDestroy — ptr<T> field with only __oncopy", () => {
    const diags = diagnosticsOf(`
      unsafe struct Buffer {
        data: *void;
        fn __oncopy(self: ref Buffer) {}
      }
      fn main() -> int { return 0; }
    `);

    const d = findByKind(diags, "unsafeStructMissingDestroy");
    expect(d).toBeDefined();
    if (!d) return;
    expect(d.code).toBe("E5002");
    expect(d.structName).toBe("Buffer");
    expect(formatDiagnostic(d)).toBe(
      "error[E5002]: unsafe struct 'Buffer' with ptr<T> fields must define '__destroy'"
    );
  });

  test("unsafeStructMissingOncopy — ptr<T> field with only __destroy", () => {
    const diags = diagnosticsOf(`
      extern fn c_free(p: *void);
      unsafe struct Buffer {
        data: *void;
        fn __destroy(self: ref Buffer) {
          unsafe { c_free(self.data); }
        }
      }
      fn main() -> int { return 0; }
    `);

    const d = findByKind(diags, "unsafeStructMissingOncopy");
    expect(d).toBeDefined();
    if (!d) return;
    expect(d.code).toBe("E5003");
    expect(d.structName).toBe("Buffer");
    expect(formatDiagnostic(d)).toBe(
      "error[E5003]: unsafe struct 'Buffer' with ptr<T> fields must define '__oncopy'"
    );
  });

  test("lifecycleHookSelfMismatch — self by-value instead of `ref T`", () => {
    const diags = diagnosticsOf(`
      extern fn c_free(p: *void);
      unsafe struct Buffer {
        data: *void;
        fn __destroy(self: Buffer) {
          unsafe { c_free(self.data); }
        }
        fn __oncopy(self: ref Buffer) {}
      }
      fn main() -> int { return 0; }
    `);

    const d = findByKind(diags, "lifecycleHookSelfMismatch");
    expect(d).toBeDefined();
    if (!d) return;
    expect(d.code).toBe("E5004");
    expect(d.hookName).toBe("__destroy");
    expect(d.structName).toBe("Buffer");
    expect(formatDiagnostic(d)).toBe(
      "error[E5004]: lifecycle hook '__destroy' must take 'self: ref Buffer'"
    );
  });

  test("lifecycleReturnTypeWrong — non-void return on __destroy", () => {
    const diags = diagnosticsOf(`
      extern fn c_free(p: *void);
      unsafe struct Buffer {
        data: *void;
        fn __destroy(self: ref Buffer) -> int {
          unsafe { c_free(self.data); }
          return 0;
        }
        fn __oncopy(self: ref Buffer) {}
      }
      fn main() -> int { return 0; }
    `);

    const d = findByKind(diags, "lifecycleReturnTypeWrong");
    expect(d).toBeDefined();
    if (!d) return;
    expect(d.code).toBe("E5005");
    expect(d.hookName).toBe("__destroy");
    expect(formatDiagnostic(d)).toBe("error[E5005]: lifecycle hook '__destroy' must return void");
  });
});
