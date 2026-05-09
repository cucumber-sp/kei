/**
 * Collector — holds emitted diagnostics for one compile.
 *
 * Constructed and threaded; no module-level singleton. See
 * `docs/design/diagnostics-module.md` §5.
 *
 * `LintConfig` is `{}` in v1; the resolver hook stays so a future CLI
 * flag / `kei.toml` lint section can override severities without touching
 * any call site (§6).
 */

import type { Diagnostic, Severity } from "./types";

/**
 * Lint configuration. Empty in v1 — the resolver leaves catalog defaults
 * unchanged. Future per-rule overrides slot in here.
 */
export interface LintConfig {
  /** Per-kind severity overrides. Reserved for v2. */
  readonly severities?: Readonly<Record<string, Severity>>;
}

/**
 * Resolve the severity for a diagnostic kind given the lint config and the
 * catalog default. With an empty config, returns the catalog default
 * unchanged. Exposed so `createDiagnostics`'s typed methods (PR 4+) can
 * resolve severity at emit time without each method re-implementing the
 * lookup.
 */
export function resolveSeverity(
  kind: string,
  config: LintConfig,
  defaultSeverity: Severity
): Severity {
  return config.severities?.[kind] ?? defaultSeverity;
}

/** The minimal interface exposed to typed-method factories. */
export interface Collector {
  /** Append a diagnostic to the buffer. */
  emit(diag: Diagnostic): void;

  /** Frozen, ordered snapshot of all diagnostics emitted so far. */
  snapshot(): readonly Diagnostic[];
}

/**
 * Default collector: a `Diagnostic[]` plus emit/snapshot. Each call to
 * `createCollector` gives an isolated buffer, so two collectors built
 * from the same config don't share state.
 */
export function createCollector(_config: LintConfig = {}): Collector {
  const buffer: Diagnostic[] = [];

  return {
    emit(diag) {
      buffer.push(diag);
    },
    snapshot() {
      return Object.freeze(buffer.slice());
    },
  };
}
