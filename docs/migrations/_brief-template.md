# Brief template

Copy this to `docs/migrations/<module>/pr-<N>.md` and fill in.
Headings are mandatory; sub-bullets are guidance, replace with
PR-specific content.

---

# Brief: \<module\> PR \<N\> — \<short title\>

## Context (read first)

You are a fresh Claude Code session implementing PR \<N\> of the
\<module\> module migration. You have **no prior context** from
the architecture-review session that produced this work. Before
touching any code, read these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — architectural
   direction every concept module follows
2. `docs/design/<module>-module.md` — full design for this
   migration; the entire design space and rationale lives here
3. `docs/design/<module>-module.md#<section-id>` — **the
   specific section this PR implements** (link directly)
4. `CONTEXT.md` — domain glossary; uses concrete terms like
   "Lifecycle", "Decision", "Insert pass" with specific meanings
5. `compiler/CLAUDE.md` — how to build, test, and run things

If the design doc disagrees with this brief, the design doc wins —
report the discrepancy and stop, don't try to reconcile.

## PR scope

**Implements:** \<design-doc.md\>#\<section\>

**Files affected:**

- `path/to/file.ts` — \<what changes\>
- `path/to/file.ts` — \<what changes\>

**Out of scope (do not touch in this PR):**

- \<thing 1\>
- \<thing 2\>
- Anything not explicitly listed in §\<N\> of the design doc.
  If you find friction in adjacent code, file a GitHub issue
  per `CLAUDE.md` repo policy and link it from your PR
  description; don't widen scope.

## Behaviour preservation

The full test suite (`bun test`) **must pass after this PR with
no test changes** other than the new tests this PR adds. If an
existing test fails, that is a regression — investigate, don't
update the test to match new behaviour.

**New tests this PR adds** (per design doc §\<N\>):

- `tests/<path>.test.ts` — \<what it covers\>

## Forbidden shortcuts

- **Don't reformat unrelated code.** Biome runs in CI; only
  diffs in your PR scope should appear.
- **Don't introduce new dependencies.** `package.json` should
  not change.
- **Don't add backwards-compatibility shims** unless the design
  doc explicitly calls for one (e.g. the diagnostics PR-2
  codemod keeps `errors/diagnostic.ts` as a temporary alias).
- **Don't widen scope.** If you spot a related issue, file it
  via `gh issue create` per repo policy and link from your PR.
- **Don't skip a step from the design doc.** If a step seems
  unnecessary or wrong, **stop and report** — don't silently
  drop it.
- **Don't disable tests.** A test that doesn't make sense after
  this PR is a design-doc bug, not a test bug.

## Implementation steps

(Numbered, imperative. Sourced from design doc §\<N\>.
Paraphrase if helpful for clarity.)

1. \<step\>
2. \<step\>
3. \<step\>

## Verification recipe

```bash
cd compiler
bun install
bun test                          # must pass with no new failures
bunx biome check src/ tests/      # must report no issues
```

If either fails, **stop and report** — don't push through.

## Output

**Commit messages.** Match existing style in `git log`:

```
<scope>(<module>): <verb> <thing>
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/<module>-module.md#<section>] (PR <N>
  of <total>) for the <module> module migration
  ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- <bullet of what changed>

## Test plan
- [ ] `bun test` passes (no regressions)
- [ ] `bunx biome check` passes
- [ ] New tests added per design doc §<N>: <list>
```

## Escape hatches

If you hit one of these, **stop and report**:

1. The design doc says to do X but X breaks the test suite
   irreproducibly.
2. A file the design doc references doesn't exist or has a
   meaningfully different shape than described.
3. The PR diff would exceed roughly \<N\> lines (suggests scope
   creep — pause for review before continuing).
4. You discover that a design-doc decision is wrong (e.g. the
   chosen approach can't actually deliver the claimed
   simplification). The design doc gets updated, not bypassed.

**Report format.** A single message with:

1. What blocked
2. What you tried
3. Diff size and which tests failed (if applicable)
4. Whether you think this is a brief problem, design-doc problem,
   or implementation-judgment call

Don't ask for permission to continue past a blocker — report and
wait. The orchestrating session decides whether to update the
brief, update the design doc, or revise the implementation
strategy.
