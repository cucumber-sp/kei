# Remaining work

This file records cleanup left by the compiler module migrations. Language features and spec gaps live in [SPEC-STATUS.md](../SPEC-STATUS.md); GitHub issues are the actionable backlog.

## Diagnostics: retire `untriaged`

`src/diagnostics/` owns diagnostic collection and formatting, and the old `src/errors/` module has already been removed. The checker still routes generic `error(message, span)` and `warning(message, span)` calls through `diag.untriaged`. Around 60 checker call sites use those helpers. This means the old PR 5 brief's prerequisite (no remaining calls) is not met.

To finish: give the remaining errors specific variants and typed emit methods, migrate callers without changing user-facing wording, then remove `untriaged` from the union, formatter, and API. Verify with the diagnostics tests and the full compiler suite. See [Diagnostics design](design/diagnostics-module.md) for the intended catalog and collector shape.

The design also describes a JSON formatter for tooling. The compiler currently has only the text formatter; add JSON output when a CLI or tooling consumer needs it.

## Other follow-ups

- Auto-last-use move elision has a skipped checker test and is not implemented; see [memory model status](../SPEC-STATUS.md#memory-model).
- Lifecycle handling for managed enum payloads still needs a clear ownership rule; see the [Lifecycle design](design/lifecycle-module.md#7-current-implementation).
- Generic-function `throws` propagation has known edge cases in [implementation status](../SPEC-STATUS.md#error-handling).
- The cost of cloned ASTs at high generic-instantiation counts has not been measured. Cross-module adoption deduplicates products, but a benchmark would establish the remaining cost.
- Lint configuration and conventions for combining diagnostic notes, help text, and secondary spans were deferred in the [Diagnostics design](design/diagnostics-module.md).

## Documentation maintenance

The specification is the language reference, while [SPEC-STATUS.md](../SPEC-STATUS.md) tracks implementation gaps. When a feature changes, update both the relevant spec section and status entry, then bring the guide's examples into line with the implementation. Review the status table against compiler tests before treating an item as ready for implementation.
