# Repository guidance

Kei's compiler lives in `compiler/`. See [compiler/CLAUDE.md](compiler/CLAUDE.md) for commands and edit locations, and [docs/README.md](docs/README.md) for the documentation map.

## Documentation rule

Write documentation in the present tense about the current language and code. Explain durable invariants and the reasons behind current design choices. Do not narrate recent commits, PR phases, migrations, deleted files, old paths, or what a helper used to be called; Git already records that history.

Keep implementation plans and unfinished work in `SPEC-STATUS.md`, `docs/roadmap.md`, or GitHub issues. When work is complete, remove its rollout plan from current docs and update links and examples. An ADR may retain a rejected alternative only when it explains an ongoing architectural constraint.

Before changing a claim about implementation, check it against the current source and tests. `spec/` defines language rules; `docs/language-guide.md` teaches implemented features; `SPEC-STATUS.md` marks gaps.
