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

/**
 * Render the human message text for a diagnostic (without severity or
 * code prefix). Exposed separately from `formatDiagnostic` so the
 * checker's legacy-shape adapter
 * (`Checker.collectDiagnostics → { severity, message, location }`) can
 * pull the wording without doubling-up the severity prefix that
 * `cli/diagnostics-format.ts` adds.
 */
export function messageOf(diag: Diagnostic): string {
  switch (diag.kind) {
    case "untriaged":
      return diag.message;
    case "arityMismatch":
    case "argumentTypeMismatch":
    case "notCallable":
    case "genericArgMismatch":
    case "methodNotFound":
      // PR 4c (calls) — semantic message text preserved byte-for-byte
      // from the pre-migration wording.
      return diag.message;
    case "noOperatorOverload":
    case "invalidOperand":
    case "binaryTypeMismatch":
    case "unaryTypeMismatch":
      // PR 4f (operators) — carry op + pre-formatted message body.
      return diag.message;
    case "invalidLifecycleSignature":
      return diag.reason === "wrong-arity"
        ? `lifecycle hook '${diag.hookName}' must take exactly 1 parameter ('self: ref ${diag.structName}')`
        : `lifecycle hook '${diag.hookName}' first parameter must be named 'self'`;
    case "unsafeStructMissingDestroy":
      return `unsafe struct '${diag.structName}' with ptr<T> fields must define '__destroy'`;
    case "unsafeStructMissingOncopy":
      return `unsafe struct '${diag.structName}' with ptr<T> fields must define '__oncopy'`;
    case "lifecycleHookSelfMismatch":
      return `lifecycle hook '${diag.hookName}' must take 'self: ref ${diag.structName}'`;
    case "lifecycleReturnTypeWrong":
      return `lifecycle hook '${diag.hookName}' must return void`;
  }
}

/** Format a single diagnostic as a one-message text string. */
export function formatDiagnostic(diag: Diagnostic): string {
  const body = messageOf(diag);
  if (diag.kind === "untriaged") {
    // No code prefix — the `'TODO'` sentinel is internal. Advisory codes
    // only appear once specific variants are carved out in PRs 4a–4g.
    return `${diag.severity}: ${body}`;
  }
  const head = `${diag.severity}[${diag.code}]: ${body}`;
  return `${head}${renderEnvelopeTail(diag)}`;
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
