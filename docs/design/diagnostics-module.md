# Diagnostics module — concept-cohesive consolidation

**Status.** Designed, not yet implemented. Second concrete instance of
[ADR-0001](../adr/0001-concept-cohesive-modules.md). Migration is
staged across PRs (§9).

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

`src/errors/diagnostic.ts` goes away in §9's final PR.

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

(See §10 for full alternatives. Quick local notes on §3–6 choices.)

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

## 9. Migration plan

Six PRs. Each behaviour-preserving against the existing test suite.

**PR 1 — Stand up `src/diagnostics/`.** Module skeleton: `Diagnostic`
type with empty kind union (no variants yet), `Collector` interface,
empty text formatter. No call-site changes. Old
`src/errors/diagnostic.ts` untouched. Tests for the new module are
trivially empty.

**PR 2 — Untriaged catch-all + connect existing helpers.** Add a
single variant
`{ kind: 'untriaged'; code: 'TODO'; severity; span; message: string }`
to the union, plus the typed-method
`diag.untriaged({ severity, span, message })` and a formatter case.

The codebase's emit surface today is **not** `new Diagnostic(...)`
constructor calls — it's the `Checker.error(msg, span)` and
`Checker.warning(msg, span)` helpers (~80+ sub-checker call sites
go through them) plus 4 raw `this.diagnostics.push({ severity,
message, location })` literal sites in `checker.ts` and
`ref-position-checker.ts`. There is no constructor to migrate
because `Diagnostic` is an interface (`{ severity, message,
location }`).

So PR 2 is small: re-route the existing helpers and the 4 raw
pushes through `diag.untriaged({...})`. The ~80 sub-checker call
sites that already call `this.checker.error(...) / .warning(...)`
**do not change** — they keep going through the same helper, which
now emits via the new `Diagnostic` union and `Collector`. Old
`src/errors/diagnostic.ts` stays as a transition alias for the
`SourceLocation` type and `Severity` enum (removed in PR N+1).

Diff scope: ~80–150 lines, mostly inside `Checker` and
`ref-position-checker.ts`. Behaviour-preserving: untriaged renders
without a code prefix, so user-visible output is byte-identical.

This is the equivalent of the Lifecycle migration's "PR 3 — pass
slot, no-op rewrite" — introduce infrastructure first, migrate
behaviour second.

**PR 3 — Externalise the `Collector`.** PR 2 makes the helpers
emit via an internally-constructed `Collector` on `Checker`. PR 3
moves the `Collector` to be passed in via the `Checker`
constructor instead of created internally — per design doc §5
("constructed and threaded (b)"). The CLI driver constructs
`createDiagnostics({})` and passes it in. Tests get a fresh
collector per compile.

Plumbing change, no behaviour change.

**PR 4..N — Specificity, parallelizable.** Each PR carves a category
out of `untriaged` into specific variants:

  - 4a: Type errors → `typeMismatch`, `expectedType`, `cannotCast`,
    `incompatibleAssignment`, etc.
  - 4b: Name resolution → `undeclaredName`, `duplicateDecl`,
    `shadowedName`, etc.
  - 4c: Calls → `arityMismatch`, `argumentTypeMismatch`,
    `notCallable`, etc.
  - 4d: Structs → `unknownField`, `missingField`,
    `invalidFieldAccess`, etc.
  - 4e: Lifecycle (interacts with [Lifecycle module migration](./lifecycle-module.md)) →
    `invalidLifecycleSignature`, `unsafeStructMissingDestroy`, etc.
  - 4f: Operators → `noOperatorOverload`, `invalidOperand`, etc.
  - 4g: Modules → `cyclicImport`, `moduleNotFound`, etc.

Codes assigned per category (numbering scheme picked when the catalog
is concrete; see §11). Each sub-PR is independently reviewable;
they're parallelizable across contributors. Tests for each new
variant assert the formatted-output snapshot.

**PR N+1 — Remove untriaged + delete `src/errors/diagnostic.ts`.**
Once no call site uses `untriaged`, remove the variant. Old
`errors/diagnostic.ts` becomes dead code; delete.

## 10. Alternatives considered

### 10.1 Catalog of side-effecting methods, no return value (A from grilling)

`diag.typeMismatch(span, expected, got)` — catalog of named methods,
but each method *emits* into a module-level singleton collector and
returns void. Caller doesn't see the diagnostic.

**Rejected for the singleton; kept for the named-methods part.**
Module-level collector causes test-isolation problems. The named
methods themselves became part of the chosen design (option iii).

### 10.2 Catalog returning `Diagnostic` objects (C from grilling)

`Diag.typeMismatch(span, expected, got) → Diagnostic`. Caller pushes
onto its own diag list.

**Rejected.** Smaller delta but re-enshrines "checker still owns the
diag list" — the very plumbing that the threaded-collector decision
gets rid of.

### 10.3 Builder API (B from grilling)

`error().at(span).msg("...").note(...).build()`.

**Rejected.** Doesn't actually consolidate wording — you can write
162 different fluent chains and end up with the same wording-drift
problem. The catalog is the thing that earns the locality win;
builders fight that.

### 10.4 Single `diag.error(payload)` with tagged union at call site (i)

```ts
diag.error({ kind: 'typeMismatch', span, expected, got });
```

**Rejected.** Mechanically equivalent to (iii) but loses
parameter-type enforcement and autocomplete at 162+ call sites. TS
rename works on union arm names but is less mechanical than method
rename.

### 10.5 Per-variant fields for secondary spans / notes / help (α)

```ts
| { kind: 'typeMismatch'; ...; declaredAt?: Span; note?: string; help?: string }
```

**Rejected.** Type-level enforcement that "typeMismatch carries a
declaredAt" is theatre — secondary spans are advisory and optional
anyway. β gives a simpler shape with the same expressive power.

### 10.6 Stable error codes from day one

Codes (`E0042`) become a SemVer commitment; renumbering is a
breaking change.

**Rejected.** kei is pre-1.0; over-committing on codes constrains
catalog evolution before we know what the variants are. Advisory
codes (codes appear in output for searchability but no stability
promise) are the chosen middle ground. Stability can be promoted
later.

### 10.7 Big-bang migration

One PR replaces all 162 call sites with their final specific variants.

**Rejected.** Massive diff against ~1,900 tests; failures are hard to
localise. The untriaged-codemod approach (§9 PR 2) gives the same
end state with a strictly safer intermediate step.

## 11. Open questions

- **Code numbering scheme.** Sequential `E0001`+ (Rust-style) vs
  categorical ranges (`E1xxx` type, `E2xxx` name, `E3xxx` calls, etc.,
  TS-style). Defer until PR 4a is in flight — easier to pick once we
  see the actual category sizes.
- **Notes vs help vs secondary span boundaries.** When a diagnostic
  has both a "did you mean X?" suggestion and a "the function was
  declared here" pointer, which envelope field carries which? Kept
  loose for now; the formatter establishes convention by example as
  the catalog fills in.
- **LintConfig schema.** `kei.toml` lint section, CLI flags, etc.
  Not in v1; the resolver hook in §6 leaves room.

## 12. Tests that come with the migration

- **Catalog tests** — for each variant, assert the rendered text
  output matches a snapshot fixture. Catches wording drift.
- **Formatter tests** — JSON formatter output schema, text
  formatter span annotation rules.
- **Collector tests** — emit/snapshot, severity resolution under
  various lint configs.
- **End-to-end tests** continue to assert on full compile output;
  they should pass unchanged through the migration. Substring
  matches in existing tests may need updating once specific variants
  introduce code prefixes (`error[E0042]:`); that's a per-PR cost in
  PR 4a..g.
