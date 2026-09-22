# Contributing to Kei

The compiler is written in TypeScript for Bun. Run commands from `compiler/`:

```sh
bun install
bun test
bun test tests/checker/arrays.test.ts
bunx biome check src/ tests/
bun src/cli.ts path/to/program.kei --run
```

A C compiler (`cc`, `gcc`, or `clang`) is required for end-to-end compilation. `bun run build` creates `dist/kei` and copies the standard library beside it.

## Finding your way

[Compiler architecture](docs/architecture.md) describes the pipeline. The source tree mirrors it: `src/lexer/`, `parser/`, `ast/`, `checker/`, `kir/`, and `backend/`. Cross-cutting rules live in `src/lifecycle/`, `monomorphization/`, and `diagnostics/`. `src/modules/` resolves imports; `src/cli/` drives compilation. See [compiler/CLAUDE.md](compiler/CLAUDE.md) for feature-specific edit locations.

Tests under `compiler/tests/` follow the source tree. Parser, checker, and KIR tests use local `helpers.ts` files; end-to-end tests compile and run Kei programs. Add coverage at the layer where behavior changes and run the full suite before opening a PR.

## Documentation and backlog

- `spec/` states language rules; `SPEC-STATUS.md` records implementation gaps.
- `docs/language-guide.md` teaches implemented behavior.
- `docs/design/` and `docs/adr/` preserve architectural decisions.
- GitHub issues track actionable work. [Remaining work](docs/roadmap.md) records cleanup left by the module migrations.

Keep these in sync when behavior changes. Avoid putting rollout history into the specification or leaving completed PR plans in the current docs. Branch from `main`, describe what changed and why, and include `bun test` and Biome results in the PR.
