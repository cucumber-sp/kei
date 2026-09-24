# ADR-0001: Concept-cohesive modules

## Status

Accepted — 2026-05-09.

## Context

The compiler has pipeline stages for lexing, parsing, checking, KIR, and
code generation. Some concerns cross those stages: lifecycle hooks,
monomorphization, and diagnostics each need their own policy and state.
Keeping that policy in stage-specific files makes its invariants hard to
find and maintain.

## Decision

A cross-stage concern owns its interface and policy in a top-level
module under `compiler/src/`. Pipeline stages call that module at the
appropriate point. Current examples are `lifecycle/`,
`monomorphization/`, and `diagnostics/`.

A concern that belongs to one pipeline stage, such as mem2reg or
de-SSA, stays in that stage.

## Consequences

- The concept module is the place to enforce its invariants and expose
  a small interface to the stages that use it.
- Stage directories retain the stage-specific control flow and
  transformations.
- A change spanning stages may still require integration work at each
  call site, but its policy has one owner.

## Alternatives considered

Keeping cross-stage policy inside stage directories would make each
stage self-contained locally, but would split the concern's invariants
across those directories.
