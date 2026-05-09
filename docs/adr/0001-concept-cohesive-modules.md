# ADR-0001: Concept-cohesive modules over pipeline-stage spread

## Status

Accepted — 2026-05-09.

## Context

The kei compiler is organised by pipeline stage: `src/lexer/`,
`src/parser/`, `src/checker/`, `src/kir/`, `src/backend/`. Cross-cutting
concerns — lifecycle hooks (`__destroy` / `__oncopy`), generic
monomorphization, type representation, diagnostic construction — are
each implemented across several stages, with implicit coupling through
shared state (e.g. type tables flagged by the checker and re-read in
KIR lowering, `structLifecycleCache`, generics maps re-walked during
lowering). Issue #21 (closed) was a representative bug: an
insertion-time defect in lifecycle that couldn't have a single fix
location because no one place owned the policy.

## Decision

Cross-cutting concerns live in **concept-cohesive modules** under their
own top-level directory in `compiler/src/`. The module owns the
concept's full interface across all pipeline stages. Pipeline-stage
directories (`src/checker/`, `src/kir/`, `src/backend/`) shrink to flow
control + stage-specific logic; they import the concept module and
call into it at the right moment.

The first concrete instance is `src/lifecycle/` (Decide / Synthesise /
Insert). Subsequent cross-cutting concerns — diagnostics, generic
monomorphization, type construction with invariants — should follow
the same shape.

## Consequences

- **Locality** for the concept: change, bugs, knowledge concentrate at
  the concept module's interface. A future issue-#21-class bug has one
  place to land.
- **Leverage** at the concept's interface: pipeline stages get a small
  surface; the concept module gets to enforce its own invariants
  (e.g. "a managed type always has matching destroy / oncopy
  treatment").
- **The pipeline directory tree no longer advertises every concept it
  touches.** That's intentional: the pipeline is *flow*; concepts are
  separate.
- **Migration is incremental.** Each concept is moved when there's
  active work on it; we don't restructure the whole tree up front.
- **Not every module wants this.** Internally cohesive,
  pipeline-local concerns (e.g. mem2reg, de-SSA) stay in their stage
  directory. The principle applies to *cross-cutting* concerns only.

## Alternatives considered

- **Concept-cohesive *file* inside the pipeline tree** (e.g.
  `src/kir/lifecycle.ts`). Rejected: keeps the directory tree
  pipeline-led, which the user found friction-inducing as a default
  pattern.
- **Status quo (continue spreading across stages).** Rejected: was the
  source of the friction this ADR exists to address.
