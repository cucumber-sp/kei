/**
 * Test utilities for the Kei type checker.
 */

import type { Type } from "../../src/checker/types";
import type { LegacyDiagnostic } from "../../src/diagnostics";
import { checkSource, errorsOf, warningsOf } from "../helpers/pipeline";

/** Parse + check source code, return all diagnostics. */
export function check(source: string): readonly LegacyDiagnostic[] {
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
