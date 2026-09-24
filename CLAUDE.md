# Repository guidance

Kei has one buildable artifact: `compiler/`, a TypeScript compiler running on Bun. Read [compiler/CLAUDE.md](compiler/CLAUDE.md) for commands and edit locations. [Documentation index](docs/README.md) maps the guides, specification, architecture, and design rationale.

## Source of truth

- `spec/` describes language rules without rollout history.
- `SPEC-STATUS.md` tracks specified features that are incomplete in the compiler.
- `docs/design/` and `docs/adr/` record implementation rationale and durable decisions.
- GitHub issues are the actionable backlog. File coherent follow-up work there instead of leaving unexplained TODOs.
- `CONTEXT.md` defines the compiler vocabulary used in architecture discussions.

When changing behavior, update the relevant spec and status entry, documentation examples, and tests. Do not describe an unimplemented feature as available in the guide. Follow the current-state documentation rule in [AGENTS.md](AGENTS.md).
