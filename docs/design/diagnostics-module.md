# Diagnostics module

`src/diagnostics/` defines diagnostic variants, collects them per compilation, and renders text output. The checker and other stages emit diagnostics through a shared typed interface.

## Data and emission

`types.ts` defines a discriminated union of diagnostic variants. Each variant has a kind, code, severity, source position, and fields specific to that error. Variants may also carry secondary positions, notes, and help text. Codes are advisory before Kei 1.0.

`createDiagnostics` exposes named methods for the variants. A call site provides semantic data; the method supplies the kind, code, default severity, and message fields. `resolveSeverity` applies per-kind overrides when a lint configuration provides them. The current compiler uses default severities.

The collector is created for each compilation. It stores diagnostics in emission order and returns an immutable snapshot. There is no process-wide diagnostic buffer.

## Formatting

`format.ts` renders diagnostics as text. `messageOf` produces the message body used by the checker adapter; `formatDiagnostic` adds severity and code and renders optional notes, help, and secondary positions. The current source position is a single point, represented by `SourceLocation`.

A JSON formatter is not implemented. Add one when a CLI or tooling consumer requires a stable machine-readable schema.

## Remaining generic route

Some checker calls still use `Checker.error` or `Checker.warning` and emit the `untriaged` variant. That variant has a sentinel code which the text formatter does not display. The remaining work is to give those errors specific variants, update their callers without changing user-facing wording, and remove `untriaged`. See [remaining work](../roadmap.md).
