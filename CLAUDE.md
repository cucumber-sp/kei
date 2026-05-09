# Repo policy for Claude

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

- #19 — Generic enums (prereq for `Optional<T>` / `Result<T, E>`)
- #21 — C emitter references undeclared `_v1` in scope-end
  `__destroy` after `let x = Struct.make()` (blocks `Shared<T>` e2e)

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

## Tooling note

The compiler subdirectory has its own `compiler/CLAUDE.md` with Bun /
runtime conventions. This file is for *project-wide policy*; that one
is for *how to run things*.
