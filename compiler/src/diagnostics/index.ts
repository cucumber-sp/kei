/**
 * Public interface of the diagnostics module.
 *
 * `createDiagnostics(config)` returns the typed-methods object call sites
 * use. PR 2 exposes the `untriaged` catch-all so the existing checker
 * emit surface (Checker.error / .warning) can route through this module
 * unchanged at the call sites; PR 4+ add specific methods alongside.
 *
 * See `docs/design/diagnostics-module.md` §4.
 */

import { createCollector, type LintConfig, resolveSeverity } from "./collector";
import type { Diagnostic, Severity, Span } from "./types";

export type { Collector, LintConfig } from "./collector";
export { resolveSeverity } from "./collector";
export { formatDiagnostic, formatDiagnostics } from "./format";

export type {
  ArgumentTypeMismatchDiagnostic,
  ArityMismatchDiagnostic,
  BinaryTypeMismatchDiagnostic,
  Diagnostic,
  DiagnosticEnvelope,
  GenericArgMismatchDiagnostic,
  InvalidOperandDiagnostic,
  MethodNotFoundDiagnostic,
  NoOperatorOverloadDiagnostic,
  NotCallableDiagnostic,
  Severity,
  Span,
  UnaryTypeMismatchDiagnostic,
export
{
  formatDiagnostic, formatDiagnostics, messageOf;
}
from;
("./format");

export type {
  Diagnostic,
  DiagnosticEnvelope,
  InvalidLifecycleSignatureDiagnostic,
  LifecycleHookSelfMismatchDiagnostic,
  LifecycleReturnTypeWrongDiagnostic,
  Severity,
  Span,
  UnsafeStructMissingDestroyDiagnostic,
  UnsafeStructMissingOncopyDiagnostic,
  UntriagedDiagnostic,
} from "./types";

/**
 * The typed-methods object handed to checker call sites. PR 2 exposes
 * the `untriaged` catch-all; PR 4c adds the calls-slice methods
 * (`arityMismatch`, `argumentTypeMismatch`, `notCallable`,
 * `genericArgMismatch`, `methodNotFound`). Each typed method composes
 * the user-visible `message` string itself so call sites pass payload
 * data rather than pre-formatted prose.
 */
export interface Diagnostics {
  /**
   * Catch-all emit method. Routes through the collector with severity
   * provided by the caller (the existing `Checker.error / .warning`
   * helpers know the severity from the method name; future-specific
   * variants resolve severity from the catalog default at emit time).
   */
  untriaged(payload: { severity: Severity; span: Span; message: string }): void;

  /** Wrong argument count at a call site. */
  arityMismatch(payload: {
    span: Span;
    expected: number;
    got: number;
    /**
     * Override for the user-visible message. Builtins (`sizeof`,
     * `alloc`, `free`, `onCopy`/`onDestroy`) and enum-variant /
     * generic-function call sites carry their own wording from before
     * the migration; we preserve those strings byte-for-byte.
     * Omitted → uses the canonical
     * `expected <N> argument(s), got <M>` wording.
     */
    message?: string;
  }): void;

  /** Argument N's type doesn't satisfy the parameter type. */
  argumentTypeMismatch(payload: {
    span: Span;
    paramIndex: number;
    expected: string;
    got: string;
    /** Optional parameter-declaration pointer. */
    paramDeclSpan?: Span;
  }): void;

  /** Call applied to a non-callable value. */
  notCallable(payload: { span: Span; calleeType: string }): void;

  /** Generic argument count (or shape) doesn't match the generic's params. */
  genericArgMismatch(payload: {
    span: Span;
    /** Pre-built message — generic-arity wording varies enough across call
     * sites (function / enum / struct, generic vs. non-generic) that
     * preserving the originals byte-for-byte is the safe path. The
     * structured fields stay payload-only for tooling. */
    message: string;
    name: string;
    expected: number | null;
    got: number;
  }): void;

  /** Method-call dispatch couldn't find a method of that name. */
  methodNotFound(payload: { span: Span; typeName: string; methodName: string }): void;
  /**
   * Operator token has no usable overload (built-in or user-defined).
   * Severity resolves from the catalog default (`error`).
   */
  noOperatorOverload(payload: { span: Span; op: string; message: string }): void;

  /**
   * Single-operand operator applied to a value the operator can't accept.
   * Broader sibling of `unaryTypeMismatch` — covers struct-overload
   * arity errors and "operator doesn't accept this operand category"
   * cases. Severity defaults to `error`.
   */
  invalidOperand(payload: { span: Span; op: string; message: string }): void;

  /**
   * Binary operator where the operands don't pair, or the operator's
   * target-type rule rejects one or both operands. Severity defaults
   * to `error`.
   */
  binaryTypeMismatch(payload: { span: Span; op: string; message: string }): void;

  /**
   * Unary operator with a built-in type rule applied to an operand that
   * misses the rule. Severity defaults to `error`.
   */
  unaryTypeMismatch(payload: { span: Span; op: string; message: string }): void;
  // ─── Lifecycle / checker-rules (E5xxx, PR 4e) ─────────────────────────
  //
  // Scope: validation of user-authored `__destroy` / `__oncopy` hooks on
  // an `unsafe struct`. Auto-generated hooks belong to the Lifecycle
  // module and emit through a separate surface.

  /** User wrote `__destroy` / `__oncopy` with wrong arity or non-`self` first param. */
  invalidLifecycleSignature(payload: {
    span: Span;
    hookName: string;
    structName: string;
    reason: "wrong-arity" | "first-param-not-self";
  }): void;

  /** `unsafe struct` with `ptr<T>` field(s) is missing `__destroy`. */
  unsafeStructMissingDestroy(payload: { span: Span; structName: string }): void;

  /** `unsafe struct` with `ptr<T>` field(s) is missing `__oncopy`. */
  unsafeStructMissingOncopy(payload: { span: Span; structName: string }): void;

  /** Lifecycle hook `self` parameter type isn't `ref Self`. */
  lifecycleHookSelfMismatch(payload: { span: Span; hookName: string; structName: string }): void;

  /** Lifecycle hook return type isn't `void`. */
  lifecycleReturnTypeWrong(payload: { span: Span; hookName: string }): void;

  /** Frozen snapshot of all diagnostics emitted so far. */
  diagnostics(): readonly Diagnostic[];
}

/** Construct a fresh diagnostics object. */
export function createDiagnostics(config: LintConfig = {}): Diagnostics {
  const collector = createCollector(config);

  function maybeSecondary(
    span: Span | undefined,
    label: string
  ): { span: Span; label: string }[] | undefined {
    return span === undefined ? undefined : [{ span, label }];
  }

  return {
    untriaged({ severity, span, message }) {
      collector.emit({ kind: "untriaged", code: "TODO", severity, span, message });
    },

    arityMismatch({ span, expected, got, message }) {
      const text = message ?? `expected ${expected} argument(s), got ${got}`;
      collector.emit({
        kind: "arityMismatch",
        code: "E3001",
        severity: resolveSeverity("arityMismatch", config, "error"),
        span,
        expected,
        got,
        message: text,
      });
    },

    argumentTypeMismatch({ span, paramIndex, expected, got, paramDeclSpan }) {
      const text = `argument ${paramIndex + 1}: expected '${expected}', got '${got}'`;
      collector.emit({
        kind: "argumentTypeMismatch",
        code: "E3002",
        severity: resolveSeverity("argumentTypeMismatch", config, "error"),
        span,
        paramIndex,
        expected,
        got,
        message: text,
        secondarySpans: maybeSecondary(paramDeclSpan, "parameter declared here"),
      });
    },

    notCallable({ span, calleeType }) {
      const text = `expression of type '${calleeType}' is not callable`;
      collector.emit({
        kind: "notCallable",
        code: "E3003",
        severity: resolveSeverity("notCallable", config, "error"),
        span,
        calleeType,
        message: text,
      });
    },

    genericArgMismatch({ span, message, name, expected, got }) {
      collector.emit({
        kind: "genericArgMismatch",
        code: "E3004",
        severity: resolveSeverity("genericArgMismatch", config, "error"),
        span,
        name,
        expected,
        got,
        message,
      });
    },

    methodNotFound({ span, typeName, methodName }) {
      const text = `type '${typeName}' has no method '${methodName}'`;
      collector.emit({
        kind: "methodNotFound",
        code: "E3005",
        severity: resolveSeverity("methodNotFound", config, "error"),
        span,
        typeName,
        methodName,
        message: text,
      });
    },

    noOperatorOverload({ span, op, message }) {
      collector.emit({
        kind: "noOperatorOverload",
        code: "E6001",
        severity: resolveSeverity("noOperatorOverload", config, "error"),
        span,
        op,
        message,
      });
    },
    invalidOperand({ span, op, message }) {
      collector.emit({
        kind: "invalidOperand",
        code: "E6002",
        severity: resolveSeverity("invalidOperand", config, "error"),
        span,
        op,
        message,
      });
    },
    binaryTypeMismatch({ span, op, message }) {
      collector.emit({
        kind: "binaryTypeMismatch",
        code: "E6003",
        severity: resolveSeverity("binaryTypeMismatch", config, "error"),
        span,
        op,
        message,
      });
    },
    unaryTypeMismatch({ span, op, message }) {
      collector.emit({
        kind: "unaryTypeMismatch",
        code: "E6004",
        severity: resolveSeverity("unaryTypeMismatch", config, "error"),
        span,
        op,
        message,
    invalidLifecycleSignature({ span, hookName, structName, reason }) {
      collector.emit({
        kind: "invalidLifecycleSignature",
        code: "E5001",
        severity: resolveSeverity("invalidLifecycleSignature", config, "error"),
        span,
        hookName,
        structName,
        reason,
      });
    },
    unsafeStructMissingDestroy({ span, structName }) {
      collector.emit({
        kind: "unsafeStructMissingDestroy",
        code: "E5002",
        severity: resolveSeverity("unsafeStructMissingDestroy", config, "error"),
        span,
        structName,
      });
    },
    unsafeStructMissingOncopy({ span, structName }) {
      collector.emit({
        kind: "unsafeStructMissingOncopy",
        code: "E5003",
        severity: resolveSeverity("unsafeStructMissingOncopy", config, "error"),
        span,
        structName,
      });
    },
    lifecycleHookSelfMismatch({ span, hookName, structName }) {
      collector.emit({
        kind: "lifecycleHookSelfMismatch",
        code: "E5004",
        severity: resolveSeverity("lifecycleHookSelfMismatch", config, "error"),
        span,
        hookName,
        structName,
      });
    },
    lifecycleReturnTypeWrong({ span, hookName }) {
      collector.emit({
        kind: "lifecycleReturnTypeWrong",
        code: "E5005",
        severity: resolveSeverity("lifecycleReturnTypeWrong", config, "error"),
        span,
        hookName,
      });
    },
    diagnostics: () => collector.snapshot(),
  };
}
