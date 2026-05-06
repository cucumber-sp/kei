/**
 * Diagnostic formatting for the CLI: source-line context with caret markers.
 */

import type { Diagnostic } from "../errors";
import type { SourceFile } from "../utils/source";

/** Format a diagnostic with source context: file:line:col, message, source line, caret. */
export function formatDiagnostic(diag: Diagnostic, source?: SourceFile): string {
  const loc = diag.location;
  const file = loc.file || "<unknown>";
  const header = `${file}:${loc.line}:${loc.column}: ${diag.severity}: ${diag.message}`;

  if (!source) return header;

  const lines = source.content.split("\n");
  const lineIdx = loc.line - 1;
  if (lineIdx < 0 || lineIdx >= lines.length) return header;

  const srcLine = lines[lineIdx];
  const caret = `${" ".repeat(loc.column - 1)}^`;
  return `${header}\n  ${srcLine}\n  ${caret}`;
}

/** Print all diagnostics with source context. Returns the error count. */
export function reportDiagnostics(
  diagnostics: readonly Diagnostic[],
  source?: SourceFile,
  sourceMap?: Map<string, SourceFile>
): number {
  let errorCount = 0;
  for (const diag of diagnostics) {
    const src = sourceMap?.get(diag.location.file) ?? source;
    console.error(formatDiagnostic(diag, src));
    if (diag.severity === "error") errorCount++;
  }
  return errorCount;
}

/** Print a "N error(s) emitted" footer to stderr. */
export function printErrorSummary(errorCount: number): void {
  console.error(`\n${errorCount} error${errorCount === 1 ? "" : "s"} emitted`);
}
