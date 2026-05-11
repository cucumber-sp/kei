/**
 * Scope and lifecycle tracking — operates on LoweringCtx.
 * Extracted from lowering.ts for modularity.
 */

import type { Expression } from "../ast/nodes";
import type { Type } from "../checker/types";
import type { KirInst, ScopeId, VarId } from "./kir-types";
import type { LoweringCtx, ScopeVar } from "./lowering-ctx";
import { emit } from "./lowering-utils";

/**
 * Build the mangled name used for a struct's __destroy/__oncopy C functions.
 * Definitions live in the module that declared the struct (prefix stamped onto
 * `StructType.modulePrefix` by the checker); call sites in any module must
 * reproduce the same name, so the prefix travels with the type through imports.
 *
 * Main-module structs carry an empty prefix and use the bare struct name
 * (matching how their own function definitions are emitted).
 */
export function mangledLifecycleStructName(t: { name: string; modulePrefix?: string }): string {
  return t.modulePrefix ? `${t.modulePrefix}_${t.name}` : t.name;
}

/** Check if a checker Type is a struct that has __destroy or __oncopy methods */
export function getStructLifecycle(
  ctx: LoweringCtx,
  checkerType: Type | undefined
): { hasDestroy: boolean; hasOncopy: boolean; structName: string } | null {
  if (!checkerType) return null;
  if (checkerType.kind !== "struct") return null;

  // Key the cache by the mangled name so two structs with the same bare name
  // from different modules don't collide.
  const mangled = mangledLifecycleStructName(checkerType);
  const cached = ctx.structLifecycleCache.get(mangled);
  if (cached) return { ...cached, structName: mangled };

  const hasDestroy = checkerType.methods.has("__destroy");
  const hasOncopy = checkerType.methods.has("__oncopy");

  ctx.structLifecycleCache.set(mangled, { hasDestroy, hasOncopy });

  if (!hasDestroy && !hasOncopy) return null;
  return { hasDestroy, hasOncopy, structName: mangled };
}

/** Push a new scope for lifecycle tracking */
export function pushScope(ctx: LoweringCtx): void {
  ctx.scopeStack.push([]);
  ctx.deferStack.push([]);
}

/** Pop the current scope frame, emit its lowered defer block, then the scope-exit marker. */
export function popScopeWithDestroy(ctx: LoweringCtx): void {
  const scope = ctx.scopeStack.pop();
  const defers = ctx.deferStack.pop();
  if (defers) emitScopeDeferInsts(ctx, defers);
  if (scope) emitScopeExit(ctx, scope, null);
}

/** Emit captured defer instruction sequences for one scope frame, in LIFO order. */
function emitScopeDeferInsts(ctx: LoweringCtx, frame: KirInst[][]): void {
  for (let i = frame.length - 1; i >= 0; i--) {
    const insts = frame[i];
    if (insts) ctx.currentInsts.push(...insts);
  }
}

/**
 * Emit a `mark_scope_exit` marker for `scope`, snapshotting the vars and
 * (optionally) the early-return retained name so the Lifecycle pass can
 * rewrite the marker into destroys in reverse declaration order. The
 * moved-set is reconstructed by the pass from the surrounding
 * `mark_moved` markers — it isn't captured here. The pass enforces the
 * reverse-order invariant; this function passes the vars in declaration
 * order.
 */
function emitScopeExit(
  ctx: LoweringCtx,
  scope: readonly ScopeVar[],
  extraSkipName: string | null
): void {
  const scopeId: ScopeId = ctx.scopeIdCounter++;
  const skipNames = new Set<string>();
  if (extraSkipName !== null) skipNames.add(extraSkipName);
  ctx.scopeExitData.set(scopeId, {
    vars: scope.slice(),
    skipNames,
  });
  emit(ctx, { kind: "mark_scope_exit", scopeId });
}

/**
 * Walk scope frames inner→outer from `startDepth` to the top, emit each
 * frame's lowered defer block followed by its `mark_scope_exit` marker.
 * Used by early-return / `break` / `continue` paths that unwind through
 * multiple scopes without popping them (the function or enclosing
 * statement still owns the stack).
 */
function emitScopeExitsFromDepth(
  ctx: LoweringCtx,
  startDepth: number,
  extraSkipName: string | null
): void {
  for (let i = ctx.scopeStack.length - 1; i >= startDepth; i--) {
    const defers = ctx.deferStack[i];
    if (defers) emitScopeDeferInsts(ctx, defers);
    const scope = ctx.scopeStack[i];
    if (scope) emitScopeExit(ctx, scope, extraSkipName);
  }
}

/** Emit defer + scope-exit marker for every live scope (early return). */
export function emitAllScopeDestroys(ctx: LoweringCtx): void {
  emitScopeExitsFromDepth(ctx, 0, null);
}

/** Emit defer + scope-exit marker for scopes inside the current loop (`break` / `continue`). */
export function emitLoopScopeDestroys(ctx: LoweringCtx): void {
  emitScopeExitsFromDepth(ctx, ctx.loopScopeDepth, null);
}

/**
 * Emit defer + scope-exit marker for every live scope (early return),
 * threading `skipName` into each marker's skip-set so the named local
 * survives as the returned value.
 */
export function emitAllScopeDestroysExceptNamed(ctx: LoweringCtx, skipName: string | null): void {
  emitScopeExitsFromDepth(ctx, 0, skipName);
}

/** Track a variable in the current scope if it has lifecycle hooks */
export function trackScopeVar(
  ctx: LoweringCtx,
  name: string,
  varId: VarId,
  expr: Expression
): void {
  if (ctx.scopeStack.length === 0) return;
  const currentScope = ctx.scopeStack.at(-1);
  if (!currentScope) return;
  const checkerType = ctx.checkResult.types.typeMap.get(expr);
  if (checkerType?.kind === "string") {
    currentScope.push({
      name,
      varId,
      structName: "",
      isString: true,
    });
    return;
  }
  const lifecycle = getStructLifecycle(ctx, checkerType);
  if (lifecycle?.hasDestroy) {
    currentScope.push({
      name,
      varId,
      structName: lifecycle.structName,
    });
  }
}

/** Track a variable by its checker type directly (used for function params) */
export function trackScopeVarByType(
  ctx: LoweringCtx,
  name: string,
  varId: VarId,
  checkerType: Type | undefined
): void {
  if (ctx.scopeStack.length === 0) return;
  const currentScope = ctx.scopeStack.at(-1);
  if (!currentScope) return;
  // Note: strings are NOT tracked here because function params are values,
  // not stack pointers. kei_string_destroy requires a pointer.
  // Local string variables are tracked via trackScopeVar instead.
  const lifecycle = getStructLifecycle(ctx, checkerType);
  if (lifecycle?.hasDestroy) {
    currentScope.push({
      name,
      varId,
      structName: lifecycle.structName,
    });
  }
}
