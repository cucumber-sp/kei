/**
 * Shared compile-pipeline helpers for tests.
 *
 * Tests across lexer / parser / checker / KIR all run the same source-file
 * pipeline. This module provides one canonical implementation; per-domain
 * helpers (`tests/<domain>/helpers.ts`) compose these primitives.
 */

import type { Program } from "../../src/ast/nodes";
import type { CheckResult as CheckerCheckResult } from "../../src/checker/checker";
import { Checker } from "../../src/checker/checker";
import { createDiagnostics, type LegacyDiagnostic, Severity } from "../../src/diagnostics";
import type { KirModule } from "../../src/kir/kir-types";
import { lowerToKir } from "../../src/kir/lowering";
import type { Token } from "../../src/lexer";
import { Lexer } from "../../src/lexer";
import { Parser } from "../../src/parser";
import { SourceFile } from "../../src/utils/source";

const DEFAULT_FILENAME = "test.kei";

/** Build a `SourceFile` for an in-memory test snippet. */
function makeSourceFile(content: string, filename = DEFAULT_FILENAME): SourceFile {
  return new SourceFile(filename, content);
}

export interface TokenizeResult {
  source: SourceFile;
  lexer: Lexer;
  tokens: Token[];
  diagnostics: readonly LegacyDiagnostic[];
}

/** Run only the lexer over `content`. */
export function tokenize(content: string, filename = DEFAULT_FILENAME): TokenizeResult {
  const source = makeSourceFile(content, filename);
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  return { source, lexer, tokens, diagnostics: lexer.getDiagnostics() };
}

export interface ParseResult {
  source: SourceFile;
  tokens: Token[];
  parser: Parser;
  program: Program;
  diagnostics: readonly LegacyDiagnostic[];
}

/**
 * Run lexer + parser over `content`.
 *
 * Throws when the lexer reports any error — a malformed token stream cannot be
 * meaningfully parsed, so callers asking only "does this parse?" should never
 * see lexer errors silently swallowed.
 */
export function parseSource(content: string, filename = DEFAULT_FILENAME): ParseResult {
  const { source, tokens, diagnostics: lexDiags } = tokenize(content, filename);
  const lexErrors = lexDiags.filter((d) => d.severity === Severity.Error);
  if (lexErrors.length > 0) {
    throw new Error(`Lexer errors: ${lexErrors.map((d) => d.message).join(", ")}`);
  }
  const parser = new Parser(tokens);
  const program = parser.parse();
  return { source, tokens, parser, program, diagnostics: parser.getDiagnostics() };
}

export interface CheckResult {
  source: SourceFile;
  program: Program;
  checker: Checker;
  result: CheckerCheckResult;
  diagnostics: readonly LegacyDiagnostic[];
}

/**
 * Run the full lex → parse → check pipeline. Throws on lexer / parser errors
 * (a checker run on a broken AST is meaningless), but checker errors are
 * returned in `diagnostics` for the caller to assert on.
 */
export function checkSource(content: string, filename = DEFAULT_FILENAME): CheckResult {
  const parsed = parseSource(content, filename);
  const parseErrors = errorsOf(parsed.diagnostics);
  if (parseErrors.length > 0) {
    throw new Error(`Parser errors: ${parseErrors.map((d) => d.message).join(", ")}`);
  }
  const checker = new Checker(parsed.program, parsed.source, "", {
    diag: createDiagnostics({}),
  });
  const result = checker.check();
  return {
    source: parsed.source,
    program: parsed.program,
    checker,
    result,
    diagnostics: result.diagnostics,
  };
}

/**
 * Run the full pipeline through KIR lowering. Throws if the checker reports
 * any errors — lowering an ill-typed program is undefined behaviour.
 */
export function lowerSource(content: string, filename = DEFAULT_FILENAME): KirModule {
  const { program, result } = checkSource(content, filename);
  const errors = result.diagnostics.filter((d) => d.severity === Severity.Error);
  if (errors.length > 0) {
    const msgs = errors
      .map((d) => `  ${d.message} at ${d.location.line}:${d.location.column}`)
      .join("\n");
    throw new Error(`Type errors:\n${msgs}`);
  }
  return lowerToKir(program, result);
}

/** Filter diagnostics to errors only. */
export function errorsOf(diagnostics: readonly LegacyDiagnostic[]): LegacyDiagnostic[] {
  return diagnostics.filter((d) => d.severity === Severity.Error);
}

/** Filter diagnostics to warnings only. */
export function warningsOf(diagnostics: readonly LegacyDiagnostic[]): LegacyDiagnostic[] {
  return diagnostics.filter((d) => d.severity === Severity.Warning);
}
