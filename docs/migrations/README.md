# Migration briefs

Per-PR briefs for the [ADR-0001](../adr/0001-concept-cohesive-modules.md)
migrations: [Lifecycle](../design/lifecycle-module.md),
[Diagnostics](../design/diagnostics-module.md),
[Monomorphization](../design/monomorphization-module.md).

Each brief is a self-contained dispatch packet for a fresh Claude
Code session running in its own workspace. The receiving session
sees the repo and the brief — nothing else from the architecture
review that produced this work. The brief points it at the design
doc, scopes the PR, lists the forbidden shortcuts, and specifies
how to verify completion.

## Layout

```
docs/migrations/
├── README.md                 ← this file
├── _brief-template.md        ← reusable template, copy + fill per PR
├── lifecycle/
│   ├── pr-1.md … pr-5.md
├── diagnostics/
│   ├── pr-1.md … pr-6.md
└── monomorphization/
    ├── pr-1.md … pr-6.md
```

## Workspace dispatch

One worktree per in-flight PR. Each session owns its own working
copy; no cross-session interference.

```bash
# Spin up a worktree per brief
git worktree add ../kei-lifecycle-pr1 -b lifecycle/pr-1
git worktree add ../kei-diagnostics-pr1 -b diagnostics/pr-1
git worktree add ../kei-monomorph-pr1 -b monomorphization/pr-1

# In each worktree, start a Claude Code session and feed the brief
# as the first prompt. The brief's "Context (read first)" section
# tells the session which files to read before doing anything.
cd ../kei-lifecycle-pr1
claude   # paste contents of docs/migrations/lifecycle/pr-1.md
```

Each session reads the brief, reads the design doc the brief
points at, implements, runs `bun test` + `bunx biome check`, and
opens a PR. The orchestrating session (you) reviews each PR
against the design doc, surfaces deviations, merges or asks for
changes.

## Cadence

Per [the dispatch plan](#) — see also the closing notes of the
2026-05-09 architecture review:

| Wave | What | Parallel? |
|---|---|---|
| 1 | Foundation: lifecycle/pr-1 + diagnostics/pr-1 + monomorphization/pr-1 | 3 parallel sessions, no overlap |
| 2 | Diagnostics codemod (pr-2) + collector threading (pr-3) | Sequential within Diagnostics; doesn't block other migrations |
| 3 | Lifecycle pr-2, Monomorphization pr-2, Diagnostics specificity (pr-4a..g) | Cross-migration parallel; specificity PRs parallelizable across categories |
| 4 | Markers (lifecycle pr-3) + per-site cutovers (lifecycle pr-4) + monomorph pr-3..4 | Sequential within each migration |
| 5 | Payoff PRs: monomorph pr-5 (delete override), lifecycle pr-5 (cleanup), diagnostics pr-N+1 (remove untriaged) | Cross-migration parallel |

## Bottleneck

Implementation throughput is N parallel sessions. **Review
throughput is one orchestrator (you).** Realistic working budget
for the 17 PRs is 3–5 focused sessions of orchestration; sessions
can be days apart since each is a clean review pass.

## Brief authoring

`_brief-template.md` is the canonical shape. Every brief in a PR
subdirectory follows it. When in doubt:

- Lean on the design doc; don't re-explain decisions the doc
  records. Just point at the section.
- Be precise about scope. "Don't touch X" matters more than
  "do touch Y" — the do-list comes from the design doc, the
  don't-list is what you've learned about scope creep.
- The verification recipe is non-negotiable. If `bun test` and
  `bunx biome check` aren't both green, the PR isn't done.
