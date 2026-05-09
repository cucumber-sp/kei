# Brief: Lifecycle PR 4a — `mark_scope_exit` cutover

## Context (read first)

You are a fresh Claude Code session implementing PR 4a of the
**Lifecycle module** migration. You have no prior context from
the architecture-review session that produced this work. Before
touching any code, read these files in order:

1. `docs/adr/0001-concept-cohesive-modules.md` — the architectural
   direction every concept module follows
2. `docs/design/lifecycle-module.md` — full design; especially §3
   (Marker IR), §5 (Defer interaction), §7 PR 4a (this PR)
3. `CONTEXT.md` — domain glossary; "Lifecycle", "Insert pass",
   "marker IR", "Defer" have specific meanings
4. `compiler/CLAUDE.md` — how to build / test / lint
5. Issue [#38](https://github.com/cucumber-sp/kei/issues/38) — the
   spec gap this PR is gated on

If the design doc disagrees with this brief, the design doc wins
— report the discrepancy and stop.

**PR 3 must be merged first.** PR 3 introduces the `mark_*`
instruction kinds and the no-op Lifecycle pass; this PR turns the
pass on for one marker. PRs 4a–4e are parallelisable in any order
after PR 3 lands; this is the canonical first cutover because the
defer interleave forces the spec question to a head.

## PR scope

**Implements:** `docs/design/lifecycle-module.md#7` (PR 4a).

This is the **first insertion-site cutover**. The Lifecycle pass
(introduced as a no-op in PR 3) starts producing real `destroy`
and `call_extern_void("kei_string_destroy")` instructions for one
marker: `mark_scope_exit`. Lowering stops emitting destroys
directly at scope exit; it emits the marker, and the pass rewrites.

**Files affected:**

- **MODIFIED** `compiler/src/kir/lowering-scope.ts` — replace
  `popScopeWithDestroy`, `emitScopeDestroys`, `emitAllScopeDestroys`,
  `emitLoopScopeDestroys`, `emitAllScopeDestroysExceptNamed` (and
  any helpers they call to walk `scopeStack` for destroy emission)
  with a single `emitScopeExit(ctx, scope_id)` that emits a
  `mark_scope_exit` instruction and nothing else. Lowering becomes
  ignorant of *what* gets destroyed at exit — the Lifecycle pass
  decides at rewrite time.
- **MODIFIED** call sites in `lowering-decl.ts`, `lowering-expr.ts`,
  and `lowering-stmt.ts` that previously called the destroy-emitting
  helpers — now call `emitScopeExit(ctx, scope_id)` instead. The
  defer block is still lowered first, then the marker, per design
  doc §5.
- **MODIFIED** `compiler/src/lifecycle/pass.ts` — the rewrite that
  was a no-op in PR 3 now consumes `mark_scope_exit`. For each
  marker, walk the scope's tracked vars (still populated by the old
  `scopeStack` path until PR 4e migrates `mark_track`), emit
  destroys in reverse declaration order, skip moved vars (still
  read from `LoweringCtx.movedVars` until PR 4d). String vars rewrite
  to `call_extern_void("kei_string_destroy")`; struct vars rewrite
  to `destroy`.
- **NEW** `compiler/tests/lifecycle/pass-scope-exit.test.ts` — pass
  fixture per design doc §9.

**Out of scope (do not touch in this PR):**

- The other markers (`mark_assign`, `mark_param`, `mark_moved`,
  `mark_track`) stay produced via the old code paths — they are
  sibling PRs 4b–4e in this series. Don't migrate them here.
- Don't merge defer logic into the Lifecycle pass. Defer stays in
  `lowering-scope.ts` per design doc §5 / [ADR-0001](../../adr/0001-concept-cohesive-modules.md)
  caveat: the defer block is lowered to KIR *before* the marker is
  emitted, and the pass appends destroys after. Lifecycle never
  imports defer.
- Don't remove `LoweringCtx.scopeStack`, `movedVars`, or
  `structLifecycleCache` yet. They're load-bearing for the
  unmigrated markers and for the rewrite pass's reads.
- Don't migrate `lowering-struct.ts` or anything in the Synthesise
  side — that's PR 2 territory and already merged.

## Behaviour preservation

The full test suite (`bun test`) must pass with no test changes
other than the new pass fixture this PR adds. Pay particular
attention to:

- `tests/e2e/run.test.ts` cases that involve managed structs at
  scope exit, early return, `break`, `continue`, and the
  block-expression form (`{ … }` returning a value)
- `tests/kir/` snapshots that print scope-exit destroy sequences —
  the destroys should appear in the same KIR positions post-pass
  as they did pre-migration; the diff is in *who emits them*, not
  *where they land*
- `tests/e2e/defer.test.ts` — defer-then-destroy ordering must
  match the order resolved in #38

**New tests added by this PR** (per design doc §9):

- `compiler/tests/lifecycle/pass-scope-exit.test.ts` — table-driven
  pass fixture: input KIR with `mark_scope_exit` markers + a
  decision map → output KIR with destroys inserted in reverse
  declaration order, moved vars skipped, strings using the extern
  call form.

## Forbidden shortcuts

- **Don't migrate the other markers in this PR.** `mark_assign`,
  `mark_param`, `mark_moved`, `mark_track` are PRs 4b–4e. Each
  insertion-site cutover removes the old path *for that one site*.
- **Don't merge defer logic into Lifecycle.** Defer is
  pipeline-local per ADR-0001 caveat and stays in
  `lowering-scope.ts`. The interleave is encoded by relative
  position (defer block first, marker second) — one decision at
  one line, per design doc §5.
- **Don't ship without spec resolution of #38.** The defer-vs-destroy
  ordering must be specified in `spec/` and reflected in design doc
  §5 *before* this PR merges. The pass rewrite picks an order; we
  cannot pick before the spec does.
- **Don't keep both paths running in parallel.** The marker path
  replaces the old helpers for scope exit. After this PR, no code
  outside the Lifecycle pass emits a scope-exit `destroy` /
  `kei_string_destroy`.
- **Don't reformat unrelated code.** Biome runs in CI.
- **Don't introduce new dependencies.**

## Implementation steps

1. Resolve issue #38 in `spec/` and reflect the chosen order in
   `docs/design/lifecycle-module.md#5`. **This step is a hard
   blocker — do not proceed until #38 is closed by a spec PR.**
2. Add an `emitScopeExit(ctx, scope_id)` helper in
   `lowering-scope.ts` that emits a `mark_scope_exit` instruction
   and nothing else. The defer-block lowering at scope exit stays
   exactly where it is and runs *before* the marker emission.
3. Replace every call to `popScopeWithDestroy`, `emitAllScopeDestroys`,
   `emitLoopScopeDestroys`, `emitAllScopeDestroysExceptNamed` with
   a sequence that lowers any pending defer block(s), then emits
   `mark_scope_exit` for the scope(s) being exited. For multi-scope
   unwinds (early return, `break`), emit one marker per scope frame
   in inner-to-outer order.
4. Delete the old destroy-emitting helpers from
   `lowering-scope.ts`. Keep `trackScopeVar` /
   `trackScopeVarByType` and the `scopeStack` push/pop — they're
   PR 4e's territory.
5. In `compiler/src/lifecycle/pass.ts`, extend the (currently no-op)
   rewriter to handle `mark_scope_exit`: look up the scope frame's
   tracked vars (via `LoweringCtx.scopeStack` snapshot threaded
   through PR 3's pass interface, or whatever shape PR 3 chose),
   skip vars in the moved-set, emit destroys in reverse declaration
   order. Strings → `call_extern_void("kei_string_destroy")`;
   structs → `destroy`.
6. Add `tests/lifecycle/pass-scope-exit.test.ts` per design doc §9.
   Diff-against-snapshot per fixture.
7. Run full verification recipe.

## Verification recipe

```bash
cd compiler
bun install
bun test                          # must pass with no regressions
bunx biome check src/ tests/      # must report no issues
```

If either fails, **stop and report** — don't push through.

## Output

**Commit messages.** Match existing style:

```
feat(lifecycle): rewrite mark_scope_exit into destroys in the Insert pass
refactor(kir): replace scope-exit destroy helpers with mark_scope_exit emission
test(lifecycle): cover mark_scope_exit pass rewrite
```

**PR description:**

```markdown
## Summary
- Implements [docs/design/lifecycle-module.md#7] (PR 4a of 5) for
  the Lifecycle module migration ([ADR-0001](docs/adr/0001-concept-cohesive-modules.md))
- Lowering emits `mark_scope_exit` markers; the Lifecycle pass
  rewrites them into `destroy` / `kei_string_destroy` in reverse
  declaration order, skipping moved vars
- Defer stays in `lowering-scope.ts` per design doc §5; the
  interleave is encoded by relative emission order
- Closes #38 (defer-vs-destroy ordering — order is now specified
  and reflected in the rewrite)

## Test plan
- [ ] `bun test` passes (no regressions)
- [ ] `bunx biome check` passes
- [ ] New `tests/lifecycle/pass-scope-exit.test.ts` covers reverse
      declaration order, moved-var skip, string vs struct
```

## Escape hatches

Stop and report if:

1. Issue #38 is still open when you start. The PR cannot land
   until the spec resolves the order.
2. A `tests/e2e/` test that exercises defer + managed struct fails
   in a way that suggests the spec'd order disagrees with what the
   tests assumed pre-migration. That's a test-update question for
   the orchestrator, not a brief problem.
3. The pass rewrite cannot reach the tracked-vars information
   because PR 3's pass shape didn't thread `scopeStack` through.
   Don't refactor PR 3 — report.
4. The diff exceeds ~500 lines added or ~300 lines deleted across
   `lowering-*.ts` (suggests scope creep into 4b–4e).

Report format per `_brief-template.md`. Wait for orchestrator
guidance — don't continue past a blocker.
