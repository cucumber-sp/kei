/**
 * Scope and lifecycle tracking — operates on LoweringCtx.
 *
 * Emits `mark_scope_enter` / `mark_scope_exit` / `mark_track` markers; the
 * Lifecycle pass (`src/lifecycle/pass.ts`) reconstructs the
 * `scope → tracked vars` map from the marker stream at rewrite time.
 * Lowering owns only marker emission plus a small `openScopes` stack of
 * scope ids for naming the innermost open scope.
 */

import type { Expression } from "../ast/nodes";
import type { Type } from "../checker/types";
import type { KirInst, ScopeId, VarId } from "./kir-types";
import type { LoweringCtx } from "./lowering-ctx";
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

/**
 * Check if a checker Type is a struct that has a `__destroy` / `__oncopy`
 * hook, whether user-written (registered on `methods`) or auto-generated
 * (signalled by the `autoDestroy` / `autoOncopy` flags the Lifecycle
 * decision sets on the struct type). Returns null for anything else.
 */
export function getStructLifecycle(
  checkerType: Type | undefined
): { hasDestroy: boolean; hasOncopy: boolean; structName: string } | null {
  if (!checkerType) return null;
  if (checkerType.kind !== "struct") return null;
  const hasDestroy = checkerType.methods.has("__destroy") || checkerType.autoDestroy === true;
  const hasOncopy = checkerType.methods.has("__oncopy") || checkerType.autoOncopy === true;
  if (!hasDestroy && !hasOncopy) return null;
  return { hasDestroy, hasOncopy, structName: mangledLifecycleStructName(checkerType) };
}

/** Open a new lexical scope: mint a fresh id, emit `mark_scope_enter`. */
export function pushScope(ctx: LoweringCtx): void {
  const scopeId: ScopeId = ctx.nextScopeId++;
  ctx.openScopes.push(scopeId);
  ctx.deferStack.push([]);
  emit(ctx, { kind: "mark_scope_enter", scopeId });
}

/** Pop the current scope frame, emit its lowered defer block, then the scope-exit marker. */
export function popScopeWithDestroy(ctx: LoweringCtx): void {
  const scopeId = ctx.openScopes.pop();
  const defers = ctx.deferStack.pop();
  if (defers) emitScopeDeferInsts(ctx, defers);
  if (scopeId !== undefined) emitScopeExit(ctx, scopeId, null);
}

/** Emit captured defer instruction sequences for one scope frame, in LIFO order. */
function emitScopeDeferInsts(ctx: LoweringCtx, frame: KirInst[][]): void {
  for (let i = frame.length - 1; i >= 0; i--) {
    const insts = frame[i];
    if (insts) ctx.currentInsts.push(...insts);
  }
}

/**
 * Emit a `mark_scope_exit` marker tagged with `scopeId`, optionally
 * extending the skip-set with `extraSkipName` so the Lifecycle pass can
 * suppress the destroy for an early-returned var. The moved-set is
 * reconstructed by the pass from the surrounding `mark_moved` markers —
 * it isn't captured here.
 */
function emitScopeExit(ctx: LoweringCtx, scopeId: ScopeId, extraSkipName: string | null): void {
  const skipNames = new Set<string>();
  if (extraSkipName !== null) skipNames.add(extraSkipName);
  ctx.scopeExitData.set(scopeId, { skipNames });
  emit(ctx, { kind: "mark_scope_exit", scopeId });
}

/**
 * Walk open scopes inner→outer from `startDepth` to the top, emit each
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
  for (let i = ctx.openScopes.length - 1; i >= startDepth; i--) {
    const defers = ctx.deferStack[i];
    if (defers) emitScopeDeferInsts(ctx, defers);
    const scopeId = ctx.openScopes[i];
    if (scopeId !== undefined) emitScopeExit(ctx, scopeId, extraSkipName);
  }
}

/** Emit defer + scope-exit marker for every live scope (early return). */
export function emitAllScopeDestroys(ctx: LoweringCtx): void {
  emitScopeExitsFromDepth(ctx, 0, null);
}

/** Emit defer + scope-exit marker for scopes inside the current loop (`break` / `continue`). */
export function emitLoopScopeDestroys(ctx: LoweringCtx): void {
  emitScopeExitsFromDepth(ctx, ctx.loopOpenScopeBase, null);
}

/**
 * Emit defer + scope-exit marker for every live scope (early return),
 * threading `skipName` into each marker's skip-set so the named local
 * survives as the returned value.
 */
export function emitAllScopeDestroysExceptNamed(ctx: LoweringCtx, skipName: string | null): void {
  emitScopeExitsFromDepth(ctx, 0, skipName);
}

/** Emit `mark_track` for the innermost open scope if `expr` has a lifecycle-managed type. */
export function trackScopeVar(
  ctx: LoweringCtx,
  name: string,
  varId: VarId,
  expr: Expression
): void {
  const scopeId = ctx.openScopes.at(-1);
  if (scopeId === undefined) return;
  const checkerType = ctx.checkResult.types.typeMap.get(expr);
  if (checkerType?.kind === "string") {
    emit(ctx, { kind: "mark_track", varId, name, scopeId });
    return;
  }
  const lifecycle = getStructLifecycle(checkerType);
  if (lifecycle?.hasDestroy) {
    emit(ctx, { kind: "mark_track", varId, name, scopeId });
  }
}
