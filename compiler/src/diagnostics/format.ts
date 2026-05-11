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

/** Render the secondary-span / notes / help envelope tail, if any. */
function renderEnvelopeTail(diag: Diagnostic): string {
  // `untriaged` doesn't carry envelope fields in practice; bail fast to
  // keep its byte-identical `<severity>: <message>` output.
  if (diag.kind === "untriaged") return "";

  const parts: string[] = [];
  if (diag.secondarySpans) {
    for (const sec of diag.secondarySpans) {
      parts.push(`note: ${sec.label}\n  --> ${sec.span.file}:${sec.span.line}:${sec.span.column}`);
    }
  }
  if (diag.notes) {
    for (const note of diag.notes) parts.push(`note: ${note}`);
  }
  if (diag.help) parts.push(`help: ${diag.help}`);
  return parts.length === 0 ? "" : `\n${parts.join("\n")}`;
}

/** Format a single diagnostic as a one-message text string. */
export function formatDiagnostic(diag: Diagnostic): string {
  switch (diag.kind) {
    case "untriaged":
      // No code prefix — the `'TODO'` sentinel is internal. Advisory
      // codes (`error[E0042]: …`) only appear once specific variants
      // are carved out in PRs 4a–4g.
      return `${diag.severity}: ${diag.message}`;

    case "arityMismatch":
    case "argumentTypeMismatch":
    case "notCallable":
    case "genericArgMismatch":
    case "methodNotFound": {
      // PR 4c (calls) — advisory `E3xxx` codes prefix the message; the
      // semantic message text is preserved byte-for-byte from the
      // pre-migration wording so existing substring tests keep passing.
      const head = `${diag.severity}[${diag.code}]: ${diag.message}`;
      return `${head}${renderEnvelopeTail(diag)}`;
    }
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
