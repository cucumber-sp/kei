# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

```
kei/
├── compiler/        TypeScript-on-Bun compiler + stdlib (.kei). Has its own CLAUDE.md.
├── spec/            Language specification (01-design.md … 13-grammar.md). Reference manual, not changelog.
├── docs/            getting-started.md, language guide, design docs in docs/design/.
└── SPEC-STATUS.md   What's spec'd vs. implemented (WIP / PLANNED / BLOCKED tags).
```

The compiler is the only buildable artifact. Run things from `compiler/`; see
[`compiler/CLAUDE.md`](./compiler/CLAUDE.md) for build / test / lint commands and
the lexer → parser → checker → KIR → backend pipeline.

## Agent skills

### Issue tracker

Issues live as GitHub issues (`cucumber-sp/kei`); skills use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical role names — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Backlog lives on GitHub

When work gets descoped from the current PR — because it ballooned, or
because it depends on something that doesn't exist yet — **file a
GitHub issue** instead of leaving a TODO comment, a marker test with no
follow-up, or a paragraph in a design doc.

Rules of thumb:

- **One issue per coherent piece of work.** If you'd write a separate
  PR for it, it deserves its own issue.
- **Link from the descoping PR back to the issue.** The PR description
  should say "see #N" so the trail is obvious.
- **Capture enough context that a future reader can act on it cold:**
  what needs to happen (parser/checker/KIR/backend bullets), why it's
  separate from the current PR, related links (PRs, marker tests,
  spec sections).
- **Don't relitigate decisions in the issue.** If the design has been
  resolved in a spec or design doc, link to it and move on.

The mental model: design docs and spec describe *what we're building*;
GitHub issues are the *queue of work to get there*. Both should
out-survive any single conversation.

## Existing tracker entries

(Add as we file them.)

- #39 — Architecture review: extract `src/throws/` as a
  concept-cohesive module (next ADR-0001 candidate after the three
  designed modules ship)
- #40 — `LoweringCtx`: internal seams hygiene cleanup (after
  Lifecycle and Monomorphization migrations land)

(Closed: #19 generic enums, #21 `_v1` scope-end destroy bug, #38
defer-vs-destroy ordering specified.)

## Spec describes the current language, not its history

`spec/` is a reference manual for the language as it stands. It is
**not** a changelog. When a feature is dropped or an alternative is
rejected, the spec should describe the language **without** that
feature — full stop. No "`X` is rejected because we decided", no
"`X` was removed under the ref-redesign", no "`X` used to be
allowed." A reader who has never seen earlier drafts must not be able
to tell that an earlier draft existed.

Where the journey *does* belong:

- **Design docs** (`docs/design/*.md`) — the place to capture
  rationale, alternatives considered, decisions, trade-offs.
- **PR descriptions and commit messages** — what changed and why.
- **GitHub issues** — open work, descoped items, follow-ups.

Rules of thumb when editing spec:

- **Describe what IS.** "`Optional<T>` expresses absence." Not
  "`Optional<T>` replaces the old `T?` syntax."
- **Don't justify by negation.** "Bare `*T` is non-null" stands on
  its own. No need to add "the old nullable suffix was removed."
- **No "today the parser/checker still accepts X" notes.** Rollout
  status belongs in `SPEC-STATUS.md`, not in the prose of the spec
  itself.
- **No "future" references.** If a feature is part of the language,
  describe it. If it's a planned addition, file an issue and link to
  it from `SPEC-STATUS.md`. Don't leave half-thoughts in the spec.

The mental model: design docs are the *journey*; the spec is the
*destination*. Each survives independently.

## Split between this file and `compiler/CLAUDE.md`

This file is *project-wide policy* (backlog discipline, what belongs in
spec vs. design docs vs. issues). `compiler/CLAUDE.md` is *how to run
things* (Bun commands, pipeline overview, where to add a new
keyword/type/instruction). When a rule applies to all of `kei/` it
goes here; when it applies only to the compiler subdir it goes there.
