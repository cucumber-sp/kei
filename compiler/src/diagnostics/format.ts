/**
 * Text formatter — walks the diagnostic union exhaustively.
 *
 * The variants do not know how they are rendered; the formatter
 * dispatches on `diag.kind` so TypeScript exhaustiveness catches a
 * missing branch when a new variant lands. PR 1 ships an empty union
 * (`Diagnostic = never`), so `formatDiagnostic` can only ever be called
 * with an impossible value — it asserts as much. PR 2 adds the first
 * real case.
 *
 * See `docs/design/diagnostics-module.md` §7.
 */

import type { Diagnostic } from "./types";

/** Format a single diagnostic as a one-message text string. */
export function formatDiagnostic(diag: Diagnostic): string {
  // PR 2 replaces this with a `switch (diag.kind)`. Until then `diag` is
  // `never`, and the assignment fails at type-check the moment a variant
  // is added without a corresponding case here.
  const _exhaustive: never = diag;
  return _exhaustive;
}

/**
 * Format a list of diagnostics for terminal output. With no diagnostics,
 * returns the literal `"no diagnostics"` so callers can distinguish
 * "compile produced nothing to say" from "compile produced empty output
 * because something went wrong upstream".
 */
export function formatDiagnostics(diags: readonly Diagnostic[]): string {
  if (diags.length === 0) return "no diagnostics";
  return diags.map(formatDiagnostic).join("\n");
}
