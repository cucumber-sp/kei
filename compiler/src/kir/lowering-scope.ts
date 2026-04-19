/**
 * Scope and lifecycle tracking — operates on LoweringCtx.
 * Extracted from lowering.ts for modularity.
 */

import type { Expression } from "../ast/nodes.ts";
import type { Type } from "../checker/types";
import type { VarId } from "./kir-types.ts";
import type { LoweringCtx } from "./lowering-ctx.ts";
import { emit } from "./lowering-utils.ts";

/** Check if a checker Type is a struct that has __destroy or __oncopy methods */
export function getStructLifecycle(
  ctx: LoweringCtx,
  checkerType: Type | undefined
): { hasDestroy: boolean; hasOncopy: boolean; structName: string } | null {
  if (!checkerType) return null;
  if (checkerType.kind !== "struct") return null;

  const cached = ctx.structLifecycleCache.get(checkerType.name);
  if (cached) return { ...cached, structName: checkerType.name };

  const hasDestroy = checkerType.methods.has("__destroy");
  const hasOncopy = checkerType.methods.has("__oncopy");

  ctx.structLifecycleCache.set(checkerType.name, { hasDestroy, hasOncopy });

  if (!hasDestroy && !hasOncopy) return null;
  return { hasDestroy, hasOncopy, structName: checkerType.name };
}

/** Push a new scope for lifecycle tracking */
export function pushScope(ctx: LoweringCtx): void {
  ctx.scopeStack.push([]);
}

/** Pop scope and emit destroy for all live variables in reverse declaration order */
export function popScopeWithDestroy(ctx: LoweringCtx): void {
  const scope = ctx.scopeStack.pop();
  if (!scope) return;
  emitScopeDestroys(ctx, scope);
}

/** Emit destroys for scope variables in reverse order, skipping moved vars */
export function emitScopeDestroys(
  ctx: LoweringCtx,
  scope: { name: string; varId: VarId; structName: string; isString?: boolean }[]
): void {
  for (let i = scope.length - 1; i >= 0; i--) {
    const sv = scope[i];
    if (ctx.movedVars.has(sv.name)) continue;
    if (sv.isString) {
      emit(ctx, { kind: "call_extern_void", func: "kei_string_destroy", args: [sv.varId] });
    } else {
      emit(ctx, { kind: "destroy", value: sv.varId, structName: sv.structName });
    }
  }
}

/** Emit destroys for all scopes (for early return) without popping */
export function emitAllScopeDestroys(ctx: LoweringCtx): void {
  for (let i = ctx.scopeStack.length - 1; i >= 0; i--) {
    emitScopeDestroys(ctx, ctx.scopeStack[i]);
  }
}

/** Emit destroys only for scopes inside the current loop (from loopScopeDepth onward) */
export function emitLoopScopeDestroys(ctx: LoweringCtx): void {
  for (let i = ctx.scopeStack.length - 1; i >= ctx.loopScopeDepth; i--) {
    emitScopeDestroys(ctx, ctx.scopeStack[i]);
  }
}

/** Emit destroys for all scopes, but skip a named variable (the returned value) */
export function emitAllScopeDestroysExceptNamed(ctx: LoweringCtx, skipName: string | null): void {
  for (let i = ctx.scopeStack.length - 1; i >= 0; i--) {
    const scope = ctx.scopeStack[i];
    for (let j = scope.length - 1; j >= 0; j--) {
      const sv = scope[j];
      if (ctx.movedVars.has(sv.name)) continue;
      if (skipName !== null && sv.name === skipName) continue;
      if (sv.isString) {
        emit(ctx, { kind: "call_extern_void", func: "kei_string_destroy", args: [sv.varId] });
      } else {
        emit(ctx, { kind: "destroy", value: sv.varId, structName: sv.structName });
      }
    }
  }
}

/** Track a variable in the current scope if it has lifecycle hooks */
export function trackScopeVar(
  ctx: LoweringCtx,
  name: string,
  varId: VarId,
  expr: Expression
): void {
  if (ctx.scopeStack.length === 0) return;
  const checkerType = ctx.checkResult.typeMap.get(expr);
  if (checkerType?.kind === "string") {
    ctx.scopeStack[ctx.scopeStack.length - 1].push({
      name,
      varId,
      structName: "",
      isString: true,
    });
    return;
  }
  const lifecycle = getStructLifecycle(ctx, checkerType);
  if (lifecycle?.hasDestroy) {
    ctx.scopeStack[ctx.scopeStack.length - 1].push({
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
  // Note: strings are NOT tracked here because function params are values,
  // not stack pointers. kei_string_destroy requires a pointer.
  // Local string variables are tracked via trackScopeVar instead.
  const lifecycle = getStructLifecycle(ctx, checkerType);
  if (lifecycle?.hasDestroy) {
    ctx.scopeStack[ctx.scopeStack.length - 1].push({
      name,
      varId,
      structName: lifecycle.structName,
    });
  }
}
