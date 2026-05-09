/**
 * Text formatter — walks the diagnostic union exhaustively.
 *
 * The variants do not know how they are rendered; the formatter
 * dispatches on `diag.kind` so TypeScript exhaustiveness catches a
 * missing branch when a new variant lands.
 *
 * See `docs/design/diagnostics-module.md` §7.
 */

import type { Diagnostic } from "./types";

/** Format a single diagnostic as a one-message text string. */
export function formatDiagnostic(diag: Diagnostic): string {
  switch (diag.kind) {
    case "untriaged":
      // No code prefix — the `'TODO'` sentinel is internal. Advisory
      // codes (`error[E0042]: …`) only appear once specific variants
      // are carved out in PRs 4a–4g.
      return `${diag.severity}: ${diag.message}`;
  }
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
