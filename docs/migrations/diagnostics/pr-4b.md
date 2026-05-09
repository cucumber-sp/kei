# Brief: Diagnostics PR 4b — Name resolution specificity

## Context (read first)

You are a fresh Claude Code session implementing PR 4b of the
**Diagnostics module** migration. You have no prior context from
the architecture-review session that produced this work. Before
touching any code, read these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/diagnostics-module.md` — especially §3 (union
   shape), §4 (typed methods), §6 (severity in catalog), §9
   PR 4..N (this PR is the name-resolution slice), §11 (codes)
3. `docs/migrations/diagnostics/dispatch.md` — sibling-PR graph
4. `docs/migrations/diagnostics/pr-1.md`, `pr-2.md`, `pr-3.md` —
   prerequisite state on `main`
5. `CONTEXT.md` — domain glossary
6. `compiler/CLAUDE.md` — build / test / lint

If the design doc disagrees with this brief, the design doc wins —
report the discrepancy and stop.

## PR scope

**Implements:** `docs/design/diagnostics-module.md#9` (PR 4b —
name-resolution slice of "PR 4..N — Specificity, parallelizable").

This PR carves the **name-resolution** category out of the
`untriaged` catch-all into specific kind variants with assigned
codes.

**Variants this PR adds** (from design doc §9; confirm against
current call sites before naming):

- `undeclaredName` — value identifier not in scope (e.g. `foo` used
  before `let foo`)
- `duplicateDecl` — two declarations of the same name in the same
  scope (functions, structs, locals)
- `shadowedName` — inner scope re-declares an outer name in a
  context where the spec disallows it (warning-severity by default
  per catalog)
- `unresolvedImport` — `import` references a path that resolves but
  the named symbol isn't in the module's exported set
- `nameNotFound` — qualified-name lookup misses (e.g.
  `Module.symbol` where `symbol` doesn't exist on `Module`)

**Code range for this PR:** `E2xxx` (name resolution). If PR 4a
hasn't landed first and the categorical-range comment in
`src/diagnostics/types.ts` doesn't yet exist, add it per design
doc §11 — first 4x PR to land owns that comment.

**Files affected:**

- `compiler/src/diagnostics/types.ts` — add the five variants to
  the union with `E2xxx` codes and envelope fields per design
  doc §3.
- `compiler/src/diagnostics/index.ts` — typed-method entries.
- `compiler/src/diagnostics/format.ts` — formatter case per
  variant.
- `compiler/src/checker/decl-checker.ts` — migrate
  `duplicate declaration '${decl.name}'` sites and
  `'${item}' is not exported by module '${decl.path}'` sites.
- `compiler/src/checker/expr-checker.ts` — migrate
  `undeclared variable '${expr.name}'` sites; identifier-resolution
  paths.
- `compiler/src/modules/resolver.ts` — migrate import-side
  unresolved-symbol diagnostics that today flow through the
  resolver's diagnostic list and surface via the checker.
- `compiler/tests/diagnostics/name-resolution.test.ts` — NEW. One
  snapshot per variant.

**Out of scope (do not touch in this PR):**

- Type-name resolution failure (`unknownType`) — that's 4a (type
  errors), even though it superficially feels like a name lookup.
  Drawing the line at *value vs type position* keeps the categories
  clean.
- Method-not-found on a value — that's 4c (calls, with
  `methodNotFound`).
- Field-not-found on a struct — that's 4d (structs, with
  `unknownField`).
- Cyclic-import / module-not-found — 4g (modules). The split:
  *symbol-level* import errors are 4b; *module-level* import
  errors are 4g.
- Don't change message wording semantically beyond consolidating
  exact duplicates.

## Behaviour preservation

`bun test` must pass with only substring updates where a new code
prefix appears. Any other test failure is a regression.

**New tests** (per design doc §12):

- `tests/diagnostics/name-resolution.test.ts` — one snapshot per
  variant: `undeclaredName`, `duplicateDecl`, `shadowedName`,
  `unresolvedImport`, `nameNotFound`. Each test fires exactly one
  variant from a minimal kei source.

## Forbidden shortcuts

- **Don't migrate sibling-category variants.** If you find an
  `unknown field` error while you're in `expr-checker.ts`, leave
  it on `untriaged` for PR 4d.
- **Don't widen scope.** Specifically: don't redesign the
  resolver's internal diagnostic plumbing while you're migrating
  its call sites. The resolver still emits via its own list; just
  rewrite the *kind* of diagnostic it produces.
- **Don't rephrase messages.** Identical-text sites collapse to
  one variant; that's the consolidation. New phrasing is not.
- **Don't add per-call severity.** `shadowedName` defaults to
  `'warning'` in the catalog per §6; encode it there, not at
  call sites.
- **Don't reformat unrelated code.**
- **Don't change `package.json`.**

## Implementation steps

1. Read design doc §3, §4, §6, §9, §11.
2. Enumerate name-resolution sites: `grep -nE "checker\.error\("
   src/checker/decl-checker.ts src/checker/expr-checker.ts` and
   filter for "undeclared", "duplicate", "shadow", "not exported",
   qualified-name lookup misses. Add `src/modules/resolver.ts`
   diagnostic strings.
3. Classify each site into one of the five variants. If a site
   doesn't fit, leave it on `untriaged` and note for follow-up.
4. Add variants to `src/diagnostics/types.ts` with `E2xxx` codes.
   `shadowedName` carries `severity: 'warning'` default in the
   catalog.
5. Add typed methods to `src/diagnostics/index.ts`.
6. Add formatter cases to `src/diagnostics/format.ts`. The
   wording per case mirrors the longest-extant phrasing among the
   sites being consolidated.
7. Migrate call sites in the three affected files.
8. Add `tests/diagnostics/name-resolution.test.ts`.
9. Run verification recipe.

## Verification recipe

```bash
cd compiler
bun install
bun test                          # substring updates allowed only for new code prefix
bunx biome check src/ tests/
```

Sanity: `grep -n "diag\.untriaged" src/checker/decl-checker.ts
src/checker/expr-checker.ts src/modules/resolver.ts | wc -l` should
drop by exactly the number of sites migrated.

## Output

**Commit messages.**

```
feat(diagnostics): add name-resolution variants (E2xxx) and methods
refactor(checker): migrate name-resolution call sites off untriaged
test(diagnostics): snapshot one fixture per name-resolution variant
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/diagnostics-module.md#9] (PR 4b) for the
  Diagnostics module migration
  ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- Adds name-resolution variants `undeclaredName`, `duplicateDecl`,
  `shadowedName`, `unresolvedImport`, `nameNotFound` with `E2xxx`
  codes
- Migrates call sites in `decl-checker.ts`, `expr-checker.ts`,
  `modules/resolver.ts`
- Sibling categories (4a, 4c–4g) still on `untriaged`

## Test plan
- [ ] `bun test` passes (substring updates only for new code prefix)
- [ ] `bunx biome check` passes
- [ ] `tests/diagnostics/name-resolution.test.ts` covers all five
      variants
```

## Escape hatches

Stop and report if:

1. The value-vs-type-position split between 4a's `unknownType` and
   this PR's `undeclaredName` produces ambiguous sites (e.g. an
   identifier that could be either depending on parsing context).
   That's a doc problem; report.
2. The resolver's diagnostic plumbing turns out to need a wider
   refactor to surface a `nameNotFound` shape (suggests PR 3's
   collector threading didn't reach the resolver — escalate).
3. `shadowedName` doesn't fire anywhere in current tests
   (suggests the spec doesn't actually disallow what we thought —
   that's a spec/design question, not an implementation call).
4. Diff exceeds ~500 lines added.

Report format per `_brief-template.md`.
