# Brief: Diagnostics PR 2 — `untriaged` catch-all + connect existing helpers

## Context (read first)

You are a fresh Claude Code session implementing PR 2 of the
**Diagnostics module** migration. You have no prior context from
the architecture-review session that produced this work. Before
touching any code, read these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/diagnostics-module.md` — full design; especially
   §3 (discriminated-union shape), §4 (typed methods), §5
   (collector — constructed-and-threaded; PR 2 sets up an
   internal Collector on Checker, PR 3 externalises it), §9 PR 2
   (this PR; recently corrected)
3. `docs/migrations/diagnostics/pr-1.md` — PR 1 brief; the
   `src/diagnostics/` skeleton lives there
4. `CONTEXT.md` — domain glossary; "Diagnostic", "Collector",
   "untriaged" have specific meanings
5. `compiler/CLAUDE.md` — how to build / test / lint
6. **Read the actual existing code before designing your diff:**
   - `compiler/src/errors/diagnostic.ts` — `Diagnostic` is an
     **interface** (not a class) of shape
     `{ severity, message, location: SourceLocation }`.
   - `compiler/src/checker/checker.ts` — the `Checker` class has
     `error(msg, span)` and `warning(msg, span)` helpers plus a
     `diagnostics: Diagnostic[]` field with raw `.push({...})`
     sites. Read them before editing.
   - `compiler/src/checker/ref-position-checker.ts` — has its
     own `pushError(diags, msg, span)` helper that pushes a
     literal `{ severity, message, location }`.
   - `compiler/src/diagnostics/{types,index,format,collector}.ts`
     — PR 1's skeleton.

PR 1 (skeleton) must be merged first. PR 3 follows immediately;
they're a tightly-coupled pair. Do not start this PR before PR 1
lands.

If the design doc disagrees with this brief, the design doc wins
— report the discrepancy and stop.

## PR scope

**Implements:** `docs/design/diagnostics-module.md#9` PR 2.

The codebase's diagnostic-emit surface today is **not** a
constructor. There are zero `new Diagnostic(...)` call sites — an
earlier framing of this PR misread that. The actual emit pattern
is two helpers on `Checker` (`error`, `warning`, both
`(msg, span) → void`) plus a few raw `this.diagnostics.push({
severity, message, location })` literal sites. Sub-checkers all
funnel through `this.checker.error(...) / .warning(...)`.

So this PR is small. **Connect the existing helpers and raw
pushes to the new module by routing them through
`diag.untriaged({...})` and an internal `Collector` on the
`Checker`.** The ~80 sub-checker call sites that already say
`this.checker.error(...)` **do not change** — they keep using
the same helper, which now emits via the new `Diagnostic` union
internally. PR 3 will then externalise the Collector.

This is the equivalent of the Lifecycle migration's "PR 3 — pass
slot, no-op rewrite" — introduce infrastructure first, migrate
behaviour later (in PRs 4a–4g, which carve specific variants out
of `untriaged`).

**Files affected:**

- **MODIFIED** `compiler/src/diagnostics/types.ts` — extend the
  (currently empty) union with one variant:
  `{ kind: 'untriaged'; code: 'TODO'; severity: Severity; span: Span; message: string }`.
  Envelope fields per design doc §3 (β decision) — present but
  optional.
- **MODIFIED** `compiler/src/diagnostics/index.ts` — add the
  typed-method export
  `untriaged: (a: { severity: Severity; span: Span; message: string }) => void`
  per design doc §4. Routes through the Collector's `emit`.
- **MODIFIED** `compiler/src/diagnostics/format.ts` — add the
  `case 'untriaged':` arm. Renders `<severity>: <message>` at
  `<span>` with NO code prefix (advisory codes don't appear
  until PRs 4a–4g; `'TODO'` is internal).
- **MODIFIED** `compiler/src/checker/checker.ts` — the `Checker`
  class:
  - Add a `private diag: Diagnostics` field. Initialise via
    `createDiagnostics({})` in the constructor (Collector
    internal for now; PR 3 makes it externally injected).
  - Re-route `error(msg, span)` to call
    `this.diag.untriaged({ severity: Severity.Error, span, message: msg })`.
  - Re-route `warning(msg, span)` to call
    `this.diag.untriaged({ severity: Severity.Warning, span, message: msg })`.
  - Replace any raw `this.diagnostics.push({ severity, message, location })`
    site (around lines 689, 871, 879 — verify) with the
    `this.diag.untriaged({...})` call.
  - The `diagnostics: Diagnostic[]` field is replaced by a
    `diagnostics(): Diagnostic[]` accessor that reads from
    `this.diag.diagnostics()` (or whatever PR 1 named the
    snapshot accessor).
  - Note the field-name mismatch: today's `Diagnostic` uses
    `location: SourceLocation` while the new `Span` shape may
    differ. Adapt at the boundary — convert `span → location`
    as needed when constructing the untriaged payload, or use
    the same `SourceLocation` type for both (re-export from
    `errors/diagnostic.ts` per PR 1's import shape; verify).
- **MODIFIED** `compiler/src/checker/ref-position-checker.ts` —
  `pushError` (or the equivalent helper) gets re-routed through
  `diag.untriaged({...})`. The function signature may need to
  change to take a `diag` parameter; trace its callers and
  adjust. The single raw literal push at line ~222 also
  migrates.
- **MODIFIED** `compiler/src/checker/type-resolver.ts` — has a
  `TypeResolverDiagnostic` shape with `{ message, span }`
  (different from `Diagnostic`'s `{ severity, message, location }`).
  Verify whether this PR needs to touch it; if it's an internal
  type that surfaces through Checker.error, leave it. If it's
  emitted directly elsewhere, convert to `diag.untriaged`.
- **NEW** `compiler/tests/diagnostics/untriaged.test.ts` — emit
  one `untriaged` diagnostic and assert on the snapshot shape
  + formatter output (no code prefix; message preserved).
- **MODIFIED** `compiler/src/errors/diagnostic.ts` — kept as-is
  for now. The `SourceLocation` type and `Severity` enum stay;
  the `Diagnostic` interface can be deleted or aliased once
  nothing in `compiler/src/` consumes it directly. Confirm via
  `rg 'Diagnostic[^a-z]' compiler/src/` what depends on the
  interface; if anything outside `Checker` does, defer the
  removal to PR 3 or PR N+1.

**Out of scope (do not touch in this PR):**

- **The ~80 sub-checker call sites that say
  `this.checker.error(...)` / `.warning(...)`.** They stay as-is
  in this PR. The whole point of routing through the helpers
  is that those sites don't need to change.
- Don't add any other variants. The catalog stays at exactly one
  variant (`untriaged`) until PR 4a–4g land.
- Don't change message wording at any call site.
- Don't merge with PR 3 (externalise Collector). PR 3 is the
  plumbing change; this PR keeps the Collector internal.
- Don't delete `src/errors/diagnostic.ts`. PR N+1 handles that
  once the union has fully replaced it.

## Behaviour preservation

`bun test --parallel` must pass with no test changes other than
the new tests this PR adds. Every existing assertion against
checker output must still hold — that's the whole
behaviour-preservation contract.

If existing tests fail, the routing has changed something
unintended (e.g. `SourceLocation` vs `Span` shape mismatch
breaking error messages). Diagnose, don't update the tests.

**New tests added by this PR:**

- `compiler/tests/diagnostics/untriaged.test.ts` — emit one
  `untriaged` via `diag.untriaged({...})`, assert the snapshot
  contains it, assert the formatter renders `<severity>:
  <message>` with no code prefix.

## Forbidden shortcuts

- **Don't change call sites in sub-checker files.** They use
  `this.checker.error(...)` and stay that way. PRs 4a–4g
  migrate them later, by category.
- **Don't introduce a module-level singleton Collector.** Design
  doc §5 forbids it. The Collector lives on the `Checker`
  instance for now (PR 3 externalises it).
- **Don't add per-call severity enforcement** beyond the
  existing helpers' implicit severity-from-method-name. The
  catalog-default-with-resolver path lands as the typed methods
  for specific variants in PRs 4a–4g.
- **Don't widen scope.** If you find friction unrelated to the
  helper-routing (e.g. a stale TODO in `Checker`), file a
  GitHub issue per repo policy and link it from this PR.
- **Don't reformat unrelated code.** Biome runs in CI; only
  diffs in this PR's scope should appear.
- **Don't introduce new dependencies.** `package.json` must not
  change.

## Implementation steps

1. Read design doc §3, §4, §5, §9 PR 2. Understand the
   `Diagnostic` union shape and the `Collector` interface.
2. Read `Checker.error / .warning / .diagnostics` and the raw
   push sites in `checker.ts`. Read `ref-position-checker.ts`'s
   `pushError`. Note the `SourceLocation` (today) vs `Span`
   (new module) field-name asymmetry.
3. Add the `untriaged` variant to
   `src/diagnostics/types.ts`. Mirror the `SourceLocation`
   shape if `Span` is just a re-export, otherwise pick one
   shape and convert at the boundary (record your choice in
   the PR description).
4. Add the typed method `untriaged` to
   `src/diagnostics/index.ts`. Add the formatter case to
   `src/diagnostics/format.ts`.
5. In `Checker`, add the `diag` field initialised to
   `createDiagnostics({})`. Re-route `error` and `warning` to
   call `this.diag.untriaged({...})`. Migrate the 4 raw push
   sites. Update the snapshot accessor.
6. In `ref-position-checker.ts`, re-route `pushError` through
   `diag.untriaged`. Pass `diag` in if needed.
7. Add `tests/diagnostics/untriaged.test.ts`.
8. Run full verification recipe.

## Verification recipe

```bash
cd compiler
bun install
bun test --parallel               # must pass with no regressions
bunx biome check src/ tests/      # must report no issues (one pre-existing
                                  # warning in lowering-expr.ts:225 is OK)
```

If either fails, **stop and report** — don't push through.

Sanity checks:

```bash
rg "this\.diagnostics\.push" compiler/src/checker/    # should be 0
rg "new Diagnostic" compiler/src/                     # should be 0
```

## Output

**Commit messages.** Match existing style:

```
feat(diagnostics): add `untriaged` catch-all variant + typed method
refactor(checker): route error/warning helpers through diag.untriaged
test(diagnostics): cover untriaged emit/format
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/diagnostics-module.md#9] (PR 2 of 6) for
  the Diagnostics module migration
  ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- Adds `untriaged` catch-all variant + `diag.untriaged({...})`
  typed method
- `Checker.error / .warning` and the 4 raw `.push` sites in the
  checker now route through `diag.untriaged({...})` against an
  internal `Collector`
- Sub-checker call sites unchanged — `this.checker.error(...) /
  .warning(...)` still works the same way; under the hood it
  emits via the new `Diagnostic` union
- PR 3 externalises the Collector; PRs 4a–4g carve specific
  variants out of `untriaged`

## Test plan
- [ ] `bun test --parallel` passes (no regressions)
- [ ] `bunx biome check` passes (one pre-existing warning OK)
- [ ] New `tests/diagnostics/untriaged.test.ts` covers emit + format
- [ ] `rg "this\.diagnostics\.push" compiler/src/checker/` returns empty
```

Diff size: ~80–150 lines.

## Escape hatches

Stop and report if:

1. The `Span` / `SourceLocation` shape mismatch between the new
   module and the existing helpers requires changes that go
   beyond a boundary conversion — e.g. the new `Span` carries
   different fields than `SourceLocation`. Don't invent a new
   span type; report.
2. `ref-position-checker.ts`'s `pushError` callers are tangled
   with non-Checker paths (e.g. called from KIR lowering or
   the parser). Don't follow it out of scope; report.
3. An existing test fails after the routing change in a way that
   suggests user-visible output drifted. Don't update tests.
4. The diff exceeds ~250 lines (suggests scope creep; pause and
   report).

Report format per `_brief-template.md`.
