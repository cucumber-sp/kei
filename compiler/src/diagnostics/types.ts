/**
 * Diagnostic types — discriminated union shape for the diagnostics module.
 *
 * The variant union is the source of truth. PR 2 adds the `untriaged`
 * catch-all so the existing checker emit surface (Checker.error /
 * .warning + a few raw pushes) can route through the new module without
 * disturbing the ~80 sub-checker call sites. PRs 4a–4g carve specific
 * variants out of `untriaged`. See
 * `docs/design/diagnostics-module.md` §3, §9 PR 2.
 *
 * PR 4c (calls) — adds five call-site variants in the `E3xxx` range:
 * `arityMismatch`, `argumentTypeMismatch` (carries `paramIndex` plus an
 * optional secondary-span pointer at the parameter declaration),
 * `notCallable`, `genericArgMismatch`, `methodNotFound`. Each variant
 * stores a pre-built `message` field so the legacy
 * `{ severity, message, location }` adapter in `Checker.collectDiagnostics`
 * keeps working unchanged through the migration; the structured payload
 * fields exist for the formatter and future tooling consumers.
 */

import type { SourceLocation } from "../errors/diagnostic";

/** Severity level recorded on every emitted diagnostic. */
export type Severity = "error" | "warning" | "note";

/**
 * Source-position span. PR 1 reuses the existing checker `SourceLocation`
 * shape (single point) so the new module integrates without disturbing
 * existing call sites. A future PR may widen this to a half-open range
 * once the formatter needs primary/secondary span ranges; the alias
 * gives us that seam without churn now.
 */
export type Span = SourceLocation;

/** Common envelope fields carried by every diagnostic variant (β shape). */
export interface DiagnosticEnvelope {
  severity: Severity;
  span: Span;
  secondarySpans?: { span: Span; label: string }[];
  notes?: string[];
  help?: string;
}

/**
 * Catch-all variant for diagnostics that haven't been triaged into a
 * specific kind yet. The existing `Checker.error / .warning` helpers
 * route through `diag.untriaged({...})` — PRs 4a–4g carve specific
 * variants out of this and migrate call sites by category. The `code`
 * is a sentinel (`'TODO'`) and intentionally not rendered by the
 * formatter; advisory codes only appear once specific variants exist.
 */
export interface UntriagedDiagnostic extends DiagnosticEnvelope {
  kind: "untriaged";
  code: "TODO";
  message: string;
}

// ─── PR 4c — Calls (E3xxx) ───────────────────────────────────────────────────

/**
 * A call expression was passed the wrong number of arguments.
 *
 * Covers regular function calls, builtin special-cases (`sizeof`,
 * `alloc`, `free`, `onCopy` / `onDestroy`), enum-variant construction,
 * and the generic-function arity-after-substitution path. The
 * `expected`/`got` fields carry the numeric counts so future tooling
 * (LSP, JSON formatter) can present them structurally; the
 * `message` field is the pre-built user-facing wording the legacy
 * substring tests still match against.
 */
export interface ArityMismatchDiagnostic extends DiagnosticEnvelope {
  kind: "arityMismatch";
  code: "E3001";
  expected: number;
  got: number;
  message: string;
}

/**
 * A call expression's argument at position `paramIndex` (0-based) does
 * not satisfy the parameter type.
 *
 * Distinct from the assignment / return `typeMismatch` (PR 4a) because
 * call-site context — the parameter's index and its declaration span —
 * is part of the diagnostic's identity. The optional `secondarySpans`
 * envelope field carries the parameter-declaration pointer when the
 * caller can recover it (regular function / module-qualified / generic-
 * explicit calls thread the `FunctionDecl`'s params through); for
 * paths that don't currently track the decl (instance / static methods)
 * we emit the diagnostic without a secondary span.
 */
export interface ArgumentTypeMismatchDiagnostic extends DiagnosticEnvelope {
  kind: "argumentTypeMismatch";
  code: "E3002";
  /** 0-based parameter index (user-visible message renders `paramIndex + 1`). */
  paramIndex: number;
  /** Pretty-printed expected parameter type. */
  expected: string;
  /** Pretty-printed actual argument type. */
  got: string;
  message: string;
}

/**
 * A call expression was applied to a value whose type is not callable.
 *
 * The callee was already bound (name resolution succeeded) — this is
 * the post-resolution variant.  Pre-resolution `undeclaredName` errors
 * remain PR 4b's territory.
 */
export interface NotCallableDiagnostic extends DiagnosticEnvelope {
  kind: "notCallable";
  code: "E3003";
  /** Pretty-printed type of the non-callable expression. */
  calleeType: string;
  message: string;
}

/**
 * Explicit type-argument count (or, prospectively, kind) doesn't match
 * the generic's parameters.
 *
 * Covers `foo<i32, str>(x)` where `foo` is `<T>` (function generics),
 * `Type<...>` on non-generic / wrongly-arity'd structs and enums for
 * static method calls and variant construction, and the
 * "function is not generic but was called with N type argument(s)"
 * shape.
 */
export interface GenericArgMismatchDiagnostic extends DiagnosticEnvelope {
  kind: "genericArgMismatch";
  code: "E3004";
  /** Name of the generic entity (function / struct / enum). */
  name: string;
  /** Expected number of type arguments; `null` if the entity isn't generic. */
  expected: number | null;
  /** Number of type arguments the caller actually supplied. */
  got: number;
  message: string;
}

/**
 * A method-call dispatch couldn't find a method of that name on the
 * receiver type.
 *
 * Emitted by static method-call dispatch in `call-checker.ts` and (when
 * the receiver is a struct in instance position) by member-access
 * lookup in `expr-checker.ts`. The receiver type name is in
 * `typeName`; the missing method name is in `methodName`.
 */
export interface MethodNotFoundDiagnostic extends DiagnosticEnvelope {
  kind: "methodNotFound";
  code: "E3005";
  typeName: string;
  methodName: string;
  message: string;
}

/**
 * Operator-category variants (PR 4f). Carved out of `untriaged` by
 * `operator-checker.ts`. Each carries the operator string in its
 * payload (`op`) plus the pre-formatted message text so existing
 * checker wording survives the migration. See
 * `docs/design/diagnostics-module.md` §9 PR 4f and §11 for the
 * `E6xxx` code range.
 */

/**
 * Operator has no overload — built-in or user-defined — that applies
 * here. Covers "unknown binary operator", "unknown unary operator",
 * and "unknown assignment operator" sites: the operator token has no
 * usable overload at all.
 */
export interface NoOperatorOverloadDiagnostic extends DiagnosticEnvelope {
  kind: "noOperatorOverload";
  code: "E6001";
  /** The operator token (e.g. `+`, `<<`, `!`). */
  op: string;
  message: string;
}

/**
 * Single-operand operator (unary minus on a struct without `op_neg`,
 * malformed overload-method signatures, etc.) applied to a value the
 * operator can't accept. `unaryTypeMismatch` is the narrower sibling
 * when the unary operator has a known built-in type rule; this
 * variant covers the broader "operand isn't shaped right for the
 * operator at all" cases.
 */
export interface InvalidOperandDiagnostic extends DiagnosticEnvelope {
  kind: "invalidOperand";
  code: "E6002";
  /** The operator token (e.g. `-`, `[]=`, `op_neg`). */
  op: string;
  message: string;
}

/**
 * Binary operator where the operand types are individually acceptable
 * but don't pair (e.g. `i32 + str`), or the target type of a binary
 * operator rejects the operand category outright (e.g. `&&` on a
 * non-bool, `<<` on a non-integer). Compound-assignment operators
 * (`+=`, `<<=`, …) and indexed-write overload checks also surface as
 * this variant — they have two effective operands.
 */
export interface BinaryTypeMismatchDiagnostic extends DiagnosticEnvelope {
  kind: "binaryTypeMismatch";
  code: "E6003";
  /** The operator token (e.g. `+`, `==`, `+=`). */
  op: string;
  message: string;
}

/**
 * Unary operator with a known built-in type rule applied to an operand
 * that misses the rule (`-` on a non-numeric, `!` on a non-bool, `~`
 * on a non-integer). Distinct from `invalidOperand` because arity is
 * part of the diagnostic's identity — the formatter wording for unary
 * type rules differs from the broader "operand isn't shaped right"
 * variant.
 */
export interface UnaryTypeMismatchDiagnostic extends DiagnosticEnvelope {
  kind: "unaryTypeMismatch";
  code: "E6004";
  /** The operator token (e.g. `-`, `!`, `~`). */
  op: string;
  message: string;
}

/**
 * Lifecycle / checker-rules variants (E5xxx) — see
 * `docs/design/diagnostics-module.md` §9 PR 4e.
 *
 * Scope: *user-authored* `__destroy` / `__oncopy` hooks on an
 * `unsafe struct`. Auto-generated hooks belong to the Lifecycle module
 * (`src/lifecycle/`); the two concerns share keywords only.
 */

/**
 * `__destroy` / `__oncopy` declared with the wrong shape — wrong arity,
 * or first parameter not named `self`. Distinct from
 * `lifecycleHookSelfMismatch` (param type wrong) and
 * `lifecycleReturnTypeWrong` (non-void return).
 */
export interface InvalidLifecycleSignatureDiagnostic extends DiagnosticEnvelope {
  kind: "invalidLifecycleSignature";
  code: "E5001";
  /** `"__destroy"` or `"__oncopy"`. */
  hookName: string;
  /** Owning unsafe-struct name (used in the message). */
  structName: string;
  /** Why the signature is invalid — drives the message wording. */
  reason: "wrong-arity" | "first-param-not-self";
}

/**
 * `unsafe struct` with `ptr<T>` field(s) declares `__oncopy` but not
 * `__destroy` (or no lifecycle hooks at all). The pair rule comes from
 * the spec — fields that may own resources need both halves.
 */
export interface UnsafeStructMissingDestroyDiagnostic extends DiagnosticEnvelope {
  kind: "unsafeStructMissingDestroy";
  code: "E5002";
  structName: string;
}

/** Symmetric pair-rule companion to `unsafeStructMissingDestroy`. */
export interface UnsafeStructMissingOncopyDiagnostic extends DiagnosticEnvelope {
  kind: "unsafeStructMissingOncopy";
  code: "E5003";
  structName: string;
}

/**
 * `self` parameter type doesn't match `ref Self`. By-value `self: T` or
 * raw `*T` doesn't fit the C-emitted prototype; only `ref T` does.
 */
export interface LifecycleHookSelfMismatchDiagnostic extends DiagnosticEnvelope {
  kind: "lifecycleHookSelfMismatch";
  code: "E5004";
  hookName: string;
  structName: string;
}

/** Lifecycle hook return type isn't `void`. */
export interface LifecycleReturnTypeWrongDiagnostic extends DiagnosticEnvelope {
  kind: "lifecycleReturnTypeWrong";
  code: "E5005";
  hookName: string;
}

/**
 * The discriminated union of all diagnostics the compiler can emit.
 *
 * PR 2 introduces the `untriaged` catch-all; PR 4c adds the calls slice
 * (`E3xxx`). Sibling categories remain on `untriaged` until their PRs
 * land.
 */
export type Diagnostic =
  | UntriagedDiagnostic
  | ArityMismatchDiagnostic
  | ArgumentTypeMismatchDiagnostic
  | NotCallableDiagnostic
  | GenericArgMismatchDiagnostic
  | MethodNotFoundDiagnostic
  | NoOperatorOverloadDiagnostic
  | InvalidOperandDiagnostic
  | BinaryTypeMismatchDiagnostic
  | UnaryTypeMismatchDiagnostic;
  | InvalidLifecycleSignatureDiagnostic
  | UnsafeStructMissingDestroyDiagnostic
  | UnsafeStructMissingOncopyDiagnostic
  | LifecycleHookSelfMismatchDiagnostic
  | LifecycleReturnTypeWrongDiagnostic;
