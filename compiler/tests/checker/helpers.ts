/**
 * Test utilities for the Kei type checker.
 */

import { Checker } from "../../src/checker/checker.ts";
import type { Type } from "../../src/checker/types";
import type { Diagnostic } from "../../src/errors/diagnostic.ts";
import { Severity } from "../../src/errors/diagnostic.ts";
import { Lexer } from "../../src/lexer/index.ts";
import { Parser } from "../../src/parser/index.ts";
import { SourceFile } from "../../src/utils/source.ts";

/** Parse + check source code, return all diagnostics. */
export function check(source: string): Diagnostic[] {
  const file = new SourceFile("test.kei", source);
  const lexer = new Lexer(file);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();

  // Fail if there are parser errors
  const parserDiags = parser.getDiagnostics();
  if (parserDiags.length > 0) {
    const msgs = parserDiags.map((d) => d.message).join(", ");
    throw new Error(`Parser errors: ${msgs}`);
  }

  const checker = new Checker(program, file);
  const result = checker.check();
  return result.diagnostics;
}

/** Parse + check, expect zero errors (warnings ok). */
export function checkOk(source: string): void {
  const diagnostics = check(source);
  const errors = diagnostics.filter((d) => d.severity === Severity.Error);
  if (errors.length > 0) {
    const msgs = errors
      .map((d) => `  ${d.severity}: ${d.message} at ${d.location.line}:${d.location.column}`)
      .join("\n");
    throw new Error(`Expected no errors but got ${errors.length}:\n${msgs}`);
  }
}

/** Parse + check, expect specific error messages (substring match). */
export function checkErrors(source: string, expectedErrors: string[]): void {
  const diagnostics = check(source);
  const errors = diagnostics.filter((d) => d.severity === Severity.Error);

  for (const expected of expectedErrors) {
    const found = errors.some((d) => d.message.includes(expected));
    if (!found) {
      const actual = errors.map((d) => d.message).join("\n  ");
      throw new Error(
        `Expected error containing '${expected}' but got:\n  ${actual || "(no errors)"}`
      );
    }
  }

  // Check that all errors were expected
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
  const diagnostics = check(source);
  const errors = diagnostics.filter((d) => d.severity === Severity.Error);
  const found = errors.some((d) => d.message.includes(expectedError));
  if (!found) {
    const actual = errors.map((d) => d.message).join("\n  ");
    throw new Error(
      `Expected error containing '${expectedError}' but got:\n  ${actual || "(no errors)"}`
    );
  }
}

/** Parse + check, get the resolved type of the last expression statement in main(). */
export function typeOf(exprSource: string): Type {
  const source = `fn main() -> int { ${exprSource}; return 0; }`;
  const file = new SourceFile("test.kei", source);
  const lexer = new Lexer(file);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();

  const checker = new Checker(program, file);
  const result = checker.check();

  // Find the last expression statement in main's body and get its type
  const mainDecl = program.declarations[0];
  if (mainDecl?.kind !== "FunctionDecl") {
    throw new Error("Expected FunctionDecl");
  }

  // Find the first ExprStmt
  for (const stmt of mainDecl.body.statements) {
    if (stmt.kind === "ExprStmt") {
      const type = result.typeMap.get(stmt.expression);
      if (type) return type;
    }
  }

  throw new Error("No expression statement found");
}

/** Parse + check, expect warnings containing the given substring. */
export function checkWarning(source: string, expectedWarning: string): void {
  const diagnostics = check(source);
  const warnings = diagnostics.filter((d) => d.severity === Severity.Warning);
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
  const diagnostics = check(source);
  return diagnostics.filter((d) => d.severity === Severity.Error).length;
}
