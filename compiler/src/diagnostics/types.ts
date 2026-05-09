/**
 * Diagnostic types — discriminated union shape for the diagnostics module.
 *
 * The variant union is the source of truth. PR 2 adds the `untriaged`
 * catch-all so the existing checker emit surface (Checker.error /
 * .warning + a few raw pushes) can route through the new module without
 * disturbing the ~80 sub-checker call sites. PRs 4a–4g carve specific
 * variants out of `untriaged`. See
 * `docs/design/diagnostics-module.md` §3, §9 PR 2.
 */

import type { SourceLocation } from "../errors/diagnostic";

/** Severity level recorded on every emitted diagnostic. */
export type Severity = "error" | "warning" | "note";

/**
 * Source-position span. PR 1 reuses the existing checker `SourceLocation`
 * shape (single point) so the new module integrates without disturbing
 * existing call sites. A future PR may widen this to a half-open range
 * once the formatter needs primary/secondary span ranges; the alias
 * gives us that seam without churn now.
 */
export type Span = SourceLocation;

/** Common envelope fields carried by every diagnostic variant (β shape). */
export interface DiagnosticEnvelope {
  severity: Severity;
  span: Span;
  secondarySpans?: { span: Span; label: string }[];
  notes?: string[];
  help?: string;
}

/**
 * Catch-all variant for diagnostics that haven't been triaged into a
 * specific kind yet. The existing `Checker.error / .warning` helpers
 * route through `diag.untriaged({...})` — PRs 4a–4g carve specific
 * variants out of this and migrate call sites by category. The `code`
 * is a sentinel (`'TODO'`) and intentionally not rendered by the
 * formatter; advisory codes only appear once specific variants exist.
 */
export interface UntriagedDiagnostic extends DiagnosticEnvelope {
  kind: "untriaged";
  code: "TODO";
  message: string;
}

/**
 * The discriminated union of all diagnostics the compiler can emit.
 *
 * PR 2 introduces the `untriaged` catch-all; PR 4+ add specific variants
 * (typeMismatch, undeclaredName, …) alongside.
 */
export type Diagnostic = UntriagedDiagnostic;
