/**
 * Public interface of the diagnostics module.
 *
 * `createDiagnostics(config)` returns the typed-methods object call sites
 * use. PR 2 exposes the `untriaged` catch-all so the existing checker
 * emit surface (Checker.error / .warning) can route through this module
 * unchanged at the call sites; PR 4+ add specific methods alongside.
 *
 * See `docs/design/diagnostics-module.md` §4.
 */

import { createCollector, type LintConfig } from "./collector";
import type { Diagnostic, Severity, Span } from "./types";

export type { Collector, LintConfig } from "./collector";
export { resolveSeverity } from "./collector";
export { formatDiagnostic, formatDiagnostics } from "./format";
export type { Diagnostic, DiagnosticEnvelope, Severity, Span, UntriagedDiagnostic } from "./types";

/**
 * The typed-methods object handed to checker call sites. PR 2 exposes
 * the `untriaged` catch-all; PR 4+ add named methods (`typeMismatch`,
 * `undeclaredName`, …) alongside as variants are carved out of it.
 */
export interface Diagnostics {
  /**
   * Catch-all emit method. Routes through the collector with severity
   * provided by the caller (the existing `Checker.error / .warning`
   * helpers know the severity from the method name; future-specific
   * variants resolve severity from the catalog default at emit time).
   */
  untriaged(payload: { severity: Severity; span: Span; message: string }): void;

  /** Frozen snapshot of all diagnostics emitted so far. */
  diagnostics(): readonly Diagnostic[];
}

/** Construct a fresh diagnostics object. */
export function createDiagnostics(config: LintConfig = {}): Diagnostics {
  const collector = createCollector(config);

  return {
    untriaged({ severity, span, message }) {
      collector.emit({ kind: "untriaged", code: "TODO", severity, span, message });
    },
    diagnostics: () => collector.snapshot(),
  };
}
