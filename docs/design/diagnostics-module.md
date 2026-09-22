# Diagnostics module — concept-cohesive consolidation

**Status.** Partially implemented. Sections 1–8 record the original design and describe the pre-migration code in historical present tense. The current `untriaged` path is tracked in [remaining work](../roadmap.md) and summarized in §9.

## 1. Why

The checker constructs ~162 diagnostics across 14+ files (`expr-checker`,
`decl-checker`, `call-checker`, `struct-checker`, `operator-checker`,
…). Today each call site builds the diagnostic by hand — string
template, location plumbing, severity. The `Diagnostic` type itself
(`src/errors/diagnostic.ts`) is little more than
`{ severity, span, message }`: an empty record propped up by 162
duplicated-by-pattern construction sites.

Two friction signals:

**Wording drift.** The same logical error fires from multiple checker
files with subtly different wording. There is no single owner for
"how do we say type-mismatch errors?" and no test that surfaces the
inconsistency.

**No identity for diagnostics.** Tests assert against substrings of
English. Tooling (CLI flags, future LSP, future lint config) has no
way to identify a diagnostic class — there is no `kind`, no code, no
stable handle. Adding any of these requires consolidating the call
sites first.

This ADR-0001 instance addresses the same architectural pattern as
the Lifecycle module ([docs/design/lifecycle-module.md](./lifecycle-module.md)):
a cross-cutting concern (constructing user-facing diagnostics) that
today spreads across pipeline-stage modules with no concept-cohesive
home.

## 2. What — the deepened module

A new top-level directory `compiler/src/diagnostics/`. Owns:

- The catalog of diagnostics — kind names, default severities, any
  static metadata.
- The discriminated-union `Diagnostic` type that the rest of the
  compiler reads.
- Construction sugar — typed methods that the checker calls.
- The `Collector`, which holds emitted diagnostics through a compile.
- Severity resolution — applies any future lint config at emit time.
- Formatting — pluggable: text (default) and JSON (for tooling).

The old `src/errors/diagnostic.ts` was removed after the module took over.

## 3. The discriminated-union shape

The variant union is the source of truth. Construction sugar is
generated from it.

```ts
// src/diagnostics/types.ts

export type Severity = 'error' | 'warning' | 'note';

export type Diagnostic = {
  kind: 'typeMismatch';
  code: 'E0042';
  severity: Severity;          // resolved at emit time
  span: Span;
  expected: Type;
  got: Type;
  // common envelope fields (β):
  secondarySpans?: { span: Span; label: string }[];
  notes?: string[];
  help?: string;
} | {
  kind: 'undeclaredName';
  code: 'E0103';
  severity: Severity;
  span: Span;
  name: string;
  secondarySpans?: { span: Span; label: string }[];
  notes?: string[];
  help?: string;
} | {
  kind: 'ice';                  // internal compiler error; §8
  code: 'BUG';
  severity: 'error';
  span?: Span;
  message: string;
} | { /* … */ };
```

Common envelope fields (`secondarySpans`, `notes`, `help`) live on
every variant rather than per-variant — see §6.5 for why α was
rejected.

## 4. Construction sugar — typed methods

Call sites use named methods, not raw payload construction.

```ts
// src/diagnostics/index.ts (sketch)

export function createDiagnostics(config: LintConfig = {}): Diagnostics {
  const collector = new Collector(config);

  return {
    typeMismatch: (a: { span: Span; expected: Type; got: Type }) =>
      collector.emit({
        kind: 'typeMismatch',
        code: 'E0042',
        severity: resolveSeverity('typeMismatch', config, 'error'),
        ...a,
      }),

    undeclaredName: (a: { span: Span; name: string }) =>
      collector.emit({
        kind: 'undeclaredName',
        code: 'E0103',
        severity: resolveSeverity('undeclaredName', config, 'error'),
        ...a,
      }),

    // …

    diagnostics: () => collector.snapshot(),
  };
}
```

Why both the union and the methods (option iii from the design
session): the union gives first-class data — pattern-matchable in
the formatter, programmatically iterable, exhaustiveness-checked by
TS. The methods give discoverable autocomplete, mechanical
TS-rename across the 162+ call sites, and parameter-type enforcement
at the call site. They are not redundant; each buys something the
other doesn't.

## 5. Collector — constructed and threaded (b)

The `Collector` is a *value*, not a module-level singleton.

```ts
const diag = createDiagnostics(lintConfig);
const checker = new Checker(ast, diag);
checker.run();
const results = diag.diagnostics();
```

Tests construct a fresh `Collector` per compile; no global state to
reset. The existing `Checker` (and any future cross-cutting
constructed-and-threaded modules — `Lifecycle`, planned
`Monomorphization`) all follow this pattern. Consistency across
ADR-0001 instances matters more than the ergonomics of a singleton.

## 6. Severity — catalog default + processor-time resolution

Call sites do not know about severity. The catalog declares a default
per kind. The collector resolves severity at emit time, taking lint
config into account.

```
diag.unusedVariable({ span, name })             ← caller blind
    ↓
Collector.emit({                                 ← collector resolves
  kind: 'unusedVariable',
  code: 'W0001',
  severity: resolveSeverity('unusedVariable', config, 'warning'),
  ...
})
    ↓
Diagnostic { …, severity: 'warning' }            ← stored, severity fixed
    ↓
format(diag) → user output
```

For v1, `LintConfig` is empty and `resolveSeverity` returns the
catalog default unchanged. When a future feature (CLI flag, `kei.toml`
lint section) introduces per-rule overrides, the resolver picks them
up; nothing else changes. Tests assert on the stored severity directly.

The alternative — per-call severity parameter — was rejected for
reasons in §6.5.

## 6.5 (Alternatives considered for this section)

(Quick notes on the choices in §3–6.)

- **β envelope vs α per-variant fields.** β chosen. Per-variant
  fields would buy "type system enforces typeMismatch always carries
  a `declaredAt`" — but that enforcement is theatre because secondary
  spans are advisory and optional in practice. β matches what
  `rustc_errors` and TS's diagnostic model do.
- **Singleton vs threaded collector.** Threaded chosen. Singleton is
  tempting for ergonomics but causes test-isolation problems and
  drifts from the constructed-and-threaded pattern of other ADR-0001
  modules.
- **Per-call severity vs catalog default + resolver.** Resolver
  chosen. Caller has no business knowing the active lint config.
- **Single `diag.error(payload)` vs typed methods (i vs iii).** Typed
  methods chosen. (i) is mechanically equivalent to the
  union-emit pattern but loses autocomplete and TS-rename across the
  162+ call sites.

## 7. Formatting — pluggable

Rendering lives inside the diagnostics module but is pluggable.

```
src/diagnostics/format.ts          ← text formatter (default)
src/diagnostics/format-json.ts     ← JSON formatter (for tooling)
```

`cli/driver.ts` picks a formatter based on a flag (default text). The
text formatter follows the Rust convention — annotated source,
secondary spans inline, notes and help underneath.

The variants do not know how they are rendered. Formatters walk the
union and `switch (diag.kind)`. Adding a new variant requires adding
a case to the formatter; TS exhaustiveness catches missing branches —
a real win of the union-as-source-of-truth shape.

JSON output schema:

```json
{
  "kind": "typeMismatch",
  "code": "E0042",
  "severity": "error",
  "span": { "file": "foo.kei", "start": [5, 14], "end": [5, 21] },
  "expected": "int",
  "got": "string",
  "secondarySpans": [...],
  "notes": [],
  "help": null
}
```

LSP integration is not in scope for this design but the JSON formatter
shape is chosen to be straightforward to map to LSP `Diagnostic` later.

## 8. ICE — internal compiler errors

Compiler bugs report through the same channel as user errors but are
their own variant:

```ts
| { kind: 'ice'; code: 'BUG'; severity: 'error';
    span?: Span; message: string;
    /* envelope fields */ }
```

Distinguished from user errors at format time: ICE renders with
`internal compiler error: please report this at <repo url>`. They
also short-circuit subsequent passes — emitting an ICE marks the
compile as fatally broken, even if other passes might continue.

## 9. Current implementation and remaining work

`src/diagnostics/` now contains the typed catalog, a collector created per compilation, and a text formatter. The JSON formatter described in §7 has not been implemented. The old `src/errors/` module has been removed. Several diagnostic categories use specific variants, but the checker still routes generic `error` and `warning` calls through `untriaged`. See [remaining work](../roadmap.md) before removing that variant. Diagnostic codes are advisory before 1.0.

## 10. Design trade-offs

The collector is per compilation to keep diagnostics isolated. Typed methods centralize catalog entries and severity resolution. A catch-all variant allowed incremental migration but should disappear when all call sites are specific.
