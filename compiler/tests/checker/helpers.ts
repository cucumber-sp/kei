/**
 * Test utilities for the Kei type checker.
 */

import type { Type } from "../../src/checker/types";
import type { Diagnostic } from "../../src/errors/diagnostic";
import { checkSource, errorsOf, warningsOf } from "../helpers/pipeline";

/** Parse + check source code, return all diagnostics. */
export function check(source: string): readonly Diagnostic[] {
  return checkSource(source).diagnostics;
}

/** Parse + check, expect zero errors (warnings ok). */
export function checkOk(source: string): void {
  const errors = errorsOf(check(source));
  if (errors.length > 0) {
    const msgs = errors
      .map((d) => `  ${d.severity}: ${d.message} at ${d.location.line}:${d.location.column}`)
      .join("\n");
    throw new Error(`Expected no errors but got ${errors.length}:\n${msgs}`);
  }
}

/** Parse + check, expect specific error messages (substring match). */
export function checkErrors(source: string, expectedErrors: string[]): void {
  const errors = errorsOf(check(source));

  for (const expected of expectedErrors) {
    const found = errors.some((d) => d.message.includes(expected));
    if (!found) {
      const actual = errors.map((d) => d.message).join("\n  ");
      throw new Error(
        `Expected error containing '${expected}' but got:\n  ${actual || "(no errors)"}`
      );
    }
  }

  if (errors.length > expectedErrors.length) {
    const unexpected = errors.filter((e) => !expectedErrors.some((exp) => e.message.includes(exp)));
    if (unexpected.length > 0) {
      const msgs = unexpected.map((d) => d.message).join("\n  ");
      throw new Error(`Unexpected errors:\n  ${msgs}`);
    }
  }
}

/** Parse + check, expect at least one error containing the given substring. */
export function checkError(source: string, expectedError: string): void {
  const errors = errorsOf(check(source));
  const found = errors.some((d) => d.message.includes(expectedError));
  if (!found) {
    const actual = errors.map((d) => d.message).join("\n  ");
    throw new Error(
      `Expected error containing '${expectedError}' but got:\n  ${actual || "(no errors)"}`
    );
  }
}

/** Parse + check, get the resolved type of the first expression statement in main(). */
export function typeOf(exprSource: string): Type {
  const source = `fn main() -> int { ${exprSource}; return 0; }`;
  const { program, result } = checkSource(source);

  const mainDecl = program.declarations[0];
  if (mainDecl?.kind !== "FunctionDecl") {
    throw new Error("Expected FunctionDecl");
  }

  for (const stmt of mainDecl.body.statements) {
    if (stmt.kind === "ExprStmt") {
      const type = result.types.typeMap.get(stmt.expression);
      if (type) return type;
    }
  }

  throw new Error("No expression statement found");
}

/** Parse + check, expect warnings containing the given substring. */
export function checkWarning(source: string, expectedWarning: string): void {
  const warnings = warningsOf(check(source));
  const found = warnings.some((d) => d.message.includes(expectedWarning));
  if (!found) {
    const actual = warnings.map((d) => d.message).join("\n  ");
    throw new Error(
      `Expected warning containing '${expectedWarning}' but got:\n  ${actual || "(no warnings)"}`
    );
  }
}

/** Get error count from check. */
export function errorCount(source: string): number {
  return errorsOf(check(source)).length;
}
