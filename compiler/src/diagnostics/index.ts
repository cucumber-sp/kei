/**
 * Public interface of the diagnostics module.
 *
 * `createDiagnostics(config)` returns the typed-methods object call sites
 * use. With zero variants in PR 1 the methods object only exposes
 * `diagnostics()`; PR 2 adds `untriaged()` and PR 4+ add specific
 * methods alongside.
 *
 * See `docs/design/diagnostics-module.md` §4.
 */

import { createCollector, type LintConfig } from "./collector";
import type { Diagnostic } from "./types";

export type { Collector, LintConfig } from "./collector";
export { resolveSeverity } from "./collector";
export { formatDiagnostic, formatDiagnostics } from "./format";
export type { Diagnostic, DiagnosticEnvelope, Severity, Span } from "./types";

/**
 * The typed-methods object handed to checker call sites. PR 2+ extends
 * this with named emit methods (`untriaged`, `typeMismatch`, …); PR 1
 * exposes only the `diagnostics()` snapshot accessor.
 */
export interface Diagnostics {
  /** Frozen snapshot of all diagnostics emitted so far. */
  diagnostics(): readonly Diagnostic[];
}

/** Construct a fresh diagnostics object. */
export function createDiagnostics(config: LintConfig = {}): Diagnostics {
  const collector = createCollector(config);

  return {
    diagnostics: () => collector.snapshot(),
  };
}
