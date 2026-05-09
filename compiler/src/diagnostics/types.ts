/**
 * Diagnostic types — discriminated union shape for the diagnostics module.
 *
 * The variant union is the source of truth. PR 1 lands an empty union
 * (`Diagnostic = never`) so the formatter's exhaustive `switch` is
 * trivially satisfied; PR 2 adds the `untriaged` catch-all and PR 4+
 * carve specific variants out of it. See
 * `docs/design/diagnostics-module.md` §3.
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
 * The discriminated union of all diagnostics the compiler can emit.
 *
 * Empty in PR 1 — `never` so the formatter's exhaustive `switch` compiles
 * with zero cases. PR 2 adds the `untriaged` catch-all variant; PR 4+
 * add specific variants (typeMismatch, undeclaredName, …).
 */
export type Diagnostic = never;
