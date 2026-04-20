/**
 * Scope and lifecycle tracking — operates on LoweringCtx.
 * Extracted from lowering.ts for modularity.
 */

import type { Expression } from "../ast/nodes";
import type { Type } from "../checker/types";
import type { KirInst, VarId } from "./kir-types";
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

/** Pop scope and emit destroy for all live variables in reverse declaration order */
export function popScopeWithDestroy(ctx: LoweringCtx): void {
  const scope = ctx.scopeStack.pop();
  const defers = ctx.deferStack.pop();
  if (defers) emitScopeDeferInsts(ctx, defers);
  if (scope) emitScopeDestroys(ctx, scope);
}

/** Emit captured defer instruction sequences for one scope frame, in LIFO order. */
function emitScopeDeferInsts(ctx: LoweringCtx, frame: KirInst[][]): void {
  for (let i = frame.length - 1; i >= 0; i--) {
    const insts = frame[i];
    if (insts) ctx.currentInsts.push(...insts);
  }
}

/** Emit destroys for scope variables in reverse order, skipping moved vars */
export function emitScopeDestroys(
  ctx: LoweringCtx,
  scope: { name: string; varId: VarId; structName: string; isString?: boolean }[]
): void {
  for (let i = scope.length - 1; i >= 0; i--) {
    const sv = scope[i];
    if (!sv) continue;
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
    const defers = ctx.deferStack[i];
    if (defers) emitScopeDeferInsts(ctx, defers);
    const scope = ctx.scopeStack[i];
    if (scope) emitScopeDestroys(ctx, scope);
  }
}

/** Emit destroys only for scopes inside the current loop (from loopScopeDepth onward) */
export function emitLoopScopeDestroys(ctx: LoweringCtx): void {
  for (let i = ctx.scopeStack.length - 1; i >= ctx.loopScopeDepth; i--) {
    const defers = ctx.deferStack[i];
    if (defers) emitScopeDeferInsts(ctx, defers);
    const scope = ctx.scopeStack[i];
    if (scope) emitScopeDestroys(ctx, scope);
  }
}

/** Emit destroys for all scopes, but skip a named variable (the returned value) */
export function emitAllScopeDestroysExceptNamed(ctx: LoweringCtx, skipName: string | null): void {
  for (let i = ctx.scopeStack.length - 1; i >= 0; i--) {
    const defers = ctx.deferStack[i];
    if (defers) emitScopeDeferInsts(ctx, defers);
    const scope = ctx.scopeStack[i];
    if (!scope) continue;
    for (let j = scope.length - 1; j >= 0; j--) {
      const sv = scope[j];
      if (!sv) continue;
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
