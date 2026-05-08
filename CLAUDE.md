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

## Tooling note

The compiler subdirectory has its own `compiler/CLAUDE.md` with Bun /
runtime conventions. This file is for *project-wide policy*; that one
is for *how to run things*.
