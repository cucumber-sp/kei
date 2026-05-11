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
 * Code numbering — categorical ranges (per design doc §11). Each
 * category of diagnostic gets a `Exxxx` block so codes from related
 * variants cluster together. Reserved ranges (mirror the PR 4a–4g
 * categories from design doc §9):
 *
 *   E1xxx — type errors             (PR 4a)
 *   E2xxx — name resolution         (PR 4b)
 *   E3xxx — calls / arity           (PR 4c)
 *   E4xxx — structs / fields        (PR 4d)
 *   E5xxx — lifecycle               (PR 4e)
 *   E6xxx — operators               (PR 4f)
 *   E7xxx — modules / imports       (PR 4g)
 *   W0xxx — warnings (cross-cutting)
 *
 * Per design doc §10.6 codes are *advisory* until kei stabilises —
 * they appear in output for searchability but carry no SemVer
 * stability promise; renumbering is allowed pre-1.0.
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

// ─── E1xxx — type errors (PR 4a) ─────────────────────────────────────────

/**
 * Two types do not unify where one is required to assign / equal another.
 *
 * `context` carries the call-site framing ("type mismatch", "index type
 * mismatch", "array element 3", "'main' return type") so the formatter
 * can prefix the canonical `expected '...', got '...'` body without
 * losing the caller's locality cue. Type names are pre-rendered to
 * keep the diagnostics module decoupled from the checker's `Type`.
 */
export interface TypeMismatchDiagnostic extends DiagnosticEnvelope {
  kind: "typeMismatch";
  code: "E1001";
  context: string;
  expected: string;
  got: string;
}

/**
 * The context required a specific type and got a value that cannot
 * satisfy it. Distinct from `typeMismatch` in that the requirement is
 * structural ("must be bool", "must be integer type") rather than an
 * equality / assignability check against a concrete declared type.
 */
export interface ExpectedTypeDiagnostic extends DiagnosticEnvelope {
  kind: "expectedType";
  code: "E1002";
  context: string;
  expected: string;
  got: string;
}

/**
 * Explicit `as` cast between two types the cast rules do not allow.
 */
export interface CannotCastDiagnostic extends DiagnosticEnvelope {
  kind: "cannotCast";
  code: "E1003";
  from: string;
  to: string;
}

/**
 * Assignment-target / RHS shape mismatch — typically a named slot
 * (struct field, future: local variable, parameter) where the value
 * does not fit the slot. The `target` carries the slot identifier
 * already-quoted to match existing wording (`field 'x'`).
 */
export interface IncompatibleAssignmentDiagnostic extends DiagnosticEnvelope {
  kind: "incompatibleAssignment";
  code: "E1004";
  target: string;
  expected: string;
  got: string;
}

/**
 * `.unwrap` or similar projection used on a value whose type is not
 * `Optional<T>`. No checker site emits this yet — the variant is
 * pre-declared so once the checker grows `Optional<T>`-aware lowering
 * (see [#19] and the `Optional` stdlib type), the call site has a
 * landing pad in the catalog without another PR-4-shaped migration.
 */
export interface NonOptionalAccessDiagnostic extends DiagnosticEnvelope {
  kind: "nonOptionalAccess";
  code: "E1005";
  operation: string;
  got: string;
}

/**
 * Type-name resolution failure inside a type position (`let x: Foo`,
 * `fn f(x: Bar)`, struct-literal head `Baz { ... }`). Distinct from
 * the value-namespace `undeclaredName` (PR 4b) — type and value
 * namespaces are separate in kei, and the wording / hint surface
 * differs ("did you mean a type, not a value?").
 */
export interface UnknownTypeDiagnostic extends DiagnosticEnvelope {
  kind: "unknownType";
  code: "E1006";
  name: string;
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
 * Struct field-access references a field name the struct doesn't have.
 * Fires from struct-literal field assignments (`access: "literal"`,
 * fields only) and from `MemberExpr` when the object is a struct type
 * but the property name isn't in `fields`/`methods` (`access:
 * "member"`, fields and methods). PR 4d. See
 * `docs/migrations/diagnostics/pr-4d.md`.
 */
export interface UnknownFieldDiagnostic extends DiagnosticEnvelope {
  kind: "unknownField";
  code: "E4001";
  structName: string;
  fieldName: string;
  /**
   * Which access form raised the diagnostic. `"literal"` for
   * struct-literal field initialisers (field-only lookup); `"member"`
   * for `.field` access on a struct value (lookup spans both fields
   * and methods, so the user-facing wording reflects that). The
   * formatter dispatches on this so the two sites preserve their
   * existing wording — no rephrasing on migration.
   */
  access: "literal" | "member";
}

/**
 * Struct literal omits a required field. Fires once per missing field
 * at the literal's span. PR 4d.
 */
export interface MissingFieldDiagnostic extends DiagnosticEnvelope {
  kind: "missingField";
  code: "E4002";
  structName: string;
  fieldName: string;
}

/**
 * `.field` access on a value whose type has no field/method concept
 * (non-struct, non-module, non-enum). PR 4d. The companion "struct has
 * no field X" case is `unknownField`; this variant covers "this type
 * cannot have fields at all".
 */
export interface InvalidFieldAccessDiagnostic extends DiagnosticEnvelope {
  kind: "invalidFieldAccess";
  code: "E4003";
  typeName: string;
  property: string;
}

/**
 * Struct-literal expression for a name that doesn't resolve to a struct
 * type (e.g. trying to construct a primitive or an enum). PR 4d.
 */
export interface CannotConstructStructDiagnostic extends DiagnosticEnvelope {
  kind: "cannotConstructStruct";
  code: "E4004";
  name: string;
}

/**
 * Struct field declaration violates the safe/unsafe field-shape rule
 * (today: a plain `struct` carrying a `ptr<T>` field, which is only
 * allowed on `unsafe struct`). PR 4d. Lifecycle-hook signature rules
 * are out of scope for this variant — those route through 4e.
 */
export interface UnsafeStructFieldRuleDiagnostic extends DiagnosticEnvelope {
  kind: "unsafeStructFieldRule";
  code: "E4005";
  structName: string;
  fieldName: string;
  message: string;
}

// ─── Modules (PR 4g) ─────────────────────────────────────────────────────────
//
// Module-level resolver-pass errors. The boundary with 4b's
// `unresolvedImport` is *which-pass-emits-it*: errors that fire while
// the resolver is still discovering / topologically-sorting modules
// live here; symbol-level errors that fire later during the checker
// pass live in 4b. See `docs/design/diagnostics-module.md` §9, PR 4g.

/**
 * The import graph contains a cycle. `path` carries the cycle ordered
 * from entry to closing edge (e.g. `["a", "b", "a"]` for `A → B → A`).
 * The formatter renders the chain joined by `→`.
 */
export interface CyclicImportDiagnostic extends DiagnosticEnvelope {
  kind: "cyclicImport";
  code: "E7001";
  path: readonly string[];
}

/**
 * An `import` references a module path that does not resolve to any
 * `.kei` file in the search roots.
 */
export interface ModuleNotFoundDiagnostic extends DiagnosticEnvelope {
  kind: "moduleNotFound";
  code: "E7002";
  /** The dotted import path that failed to resolve. */
  importPath: string;
  /** Optional context — the importer module's dotted name, when known. */
  importerModule?: string;
  /** Optional human-readable list of paths the resolver tried. */
  searched?: readonly string[];
}

/**
 * A selective import names a symbol the target module does not export.
 *
 * Intentionally overlaps with 4b's `unresolvedImport`; the split is
 * *which-pass-emits-it*. 4g owns the resolver-pass surfacing (e.g. if
 * the resolver ever inspects exports during discovery); 4b owns the
 * checker-pass surfacing where today's `decl-checker.ts` "X is not
 * exported by Y" lives. PR 4b will migrate the checker site; this
 * variant exists so resolver-pass instances have a typed kind to land
 * on without re-using `untriaged`.
 */
export interface ImportedSymbolNotExportedDiagnostic extends DiagnosticEnvelope {
  kind: "importedSymbolNotExported";
  code: "E7003";
  /** Dotted module path the symbol was imported from. */
  modulePath: string;
  /** Name of the symbol that wasn't exported. */
  symbolName: string;
}

/**
 * The import graph mixes module styles (e.g. selective vs whole-module)
 * in a way the resolver disallows. Reserved for the rule the resolver
 * enforces; no migration site fires today, but the catalog carries the
 * variant so the rule's eventual surfacing has a kind to land on.
 */
export interface MixedModuleStylesDiagnostic extends DiagnosticEnvelope {
  kind: "mixedModuleStyles";
  code: "E7004";
  message: string;
}

// ─── E2xxx — name resolution (PR 4b) ─────────────────────────────────────

/** Value identifier referenced before declaration / not in scope. */
export interface UndeclaredNameDiagnostic extends DiagnosticEnvelope {
  kind: "undeclaredName";
  code: "E2001";
  name: string;
}

/** Two declarations of the same name in the same scope. */
export interface DuplicateDeclDiagnostic extends DiagnosticEnvelope {
  kind: "duplicateDecl";
  code: "E2002";
  name: string;
  /** Optional suffix detail (e.g. "(same parameter signature)"). */
  detail?: string;
}

/**
 * Selective `import { x } from m;` where `x` exists nowhere in module `m`'s
 * export set. Module-level resolution failures (missing module, cyclic
 * import) are 4g's territory; this is the symbol-level slice.
 */
export interface UnresolvedImportDiagnostic extends DiagnosticEnvelope {
  kind: "unresolvedImport";
  code: "E2003";
  name: string;
  module: string;
}

/**
 * Qualified-name lookup misses on a module value — `m.foo` where
 * `foo` isn't in `m`'s export set. Field-not-found on a struct and
 * variant-not-found on an enum live in 4d / 4c respectively.
 */
export interface NameNotFoundDiagnostic extends DiagnosticEnvelope {
  kind: "nameNotFound";
  code: "E2004";
  name: string;
  /** The container being searched (module name). */
  container: string;
}

/**
 * The discriminated union of all diagnostics the compiler can emit.
 *
 * PR 2 introduced the `untriaged` catch-all; PRs 4a–4g carve specific
 * categories out by category (E1xxx type errors, E2xxx name resolution,
 * E3xxx calls, E4xxx structs, E5xxx lifecycle, E6xxx operators, E7xxx
 * modules). The catch-all is removed once every category is carved.
 */
export type Diagnostic =
  | UntriagedDiagnostic
  | TypeMismatchDiagnostic
  | ExpectedTypeDiagnostic
  | CannotCastDiagnostic
  | IncompatibleAssignmentDiagnostic
  | NonOptionalAccessDiagnostic
  | UnknownTypeDiagnostic
  | ArityMismatchDiagnostic
  | ArgumentTypeMismatchDiagnostic
  | NotCallableDiagnostic
  | GenericArgMismatchDiagnostic
  | MethodNotFoundDiagnostic
  | UnknownFieldDiagnostic
  | MissingFieldDiagnostic
  | InvalidFieldAccessDiagnostic
  | CannotConstructStructDiagnostic
  | UnsafeStructFieldRuleDiagnostic
  | NoOperatorOverloadDiagnostic
  | InvalidOperandDiagnostic
  | BinaryTypeMismatchDiagnostic
  | UnaryTypeMismatchDiagnostic
  | InvalidLifecycleSignatureDiagnostic
  | UnsafeStructMissingDestroyDiagnostic
  | UnsafeStructMissingOncopyDiagnostic
  | LifecycleHookSelfMismatchDiagnostic
  | LifecycleReturnTypeWrongDiagnostic
  | CyclicImportDiagnostic
  | ModuleNotFoundDiagnostic
  | ImportedSymbolNotExportedDiagnostic
  | MixedModuleStylesDiagnostic
  | UndeclaredNameDiagnostic
  | DuplicateDeclDiagnostic
  | UnresolvedImportDiagnostic
  | NameNotFoundDiagnostic;
