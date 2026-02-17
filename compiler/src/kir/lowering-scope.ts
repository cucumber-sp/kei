/**
 * Scope and lifecycle tracking methods for KirLowerer.
 * Extracted from lowering.ts for modularity.
 */

import type { Expression } from "../ast/nodes.ts";
import type { Type } from "../checker/types";
import type { VarId } from "./kir-types.ts";
import type { KirLowerer } from "./lowering.ts";

/** Check if a checker Type is a struct that has __destroy or __oncopy methods */
export function getStructLifecycle(
  this: KirLowerer,
  checkerType: Type | undefined
): { hasDestroy: boolean; hasOncopy: boolean; structName: string } | null {
  if (!checkerType) return null;
  if (checkerType.kind !== "struct") return null;

  const cached = this.structLifecycleCache.get(checkerType.name);
  if (cached) return { ...cached, structName: checkerType.name };

  const hasDestroy = checkerType.methods.has("__destroy");
  const hasOncopy = checkerType.methods.has("__oncopy");

  this.structLifecycleCache.set(checkerType.name, { hasDestroy, hasOncopy });

  if (!hasDestroy && !hasOncopy) return null;
  return { hasDestroy, hasOncopy, structName: checkerType.name };
}

/** Push a new scope for lifecycle tracking */
export function pushScope(this: KirLowerer): void {
  this.scopeStack.push([]);
}

/** Pop scope and emit destroy for all live variables in reverse declaration order */
export function popScopeWithDestroy(this: KirLowerer): void {
  const scope = this.scopeStack.pop();
  if (!scope) return;
  this.emitScopeDestroys(scope);
}

/** Emit destroys for scope variables in reverse order, skipping moved vars */
export function emitScopeDestroys(
  this: KirLowerer,
  scope: { name: string; varId: VarId; structName: string; isString?: boolean }[]
): void {
  for (let i = scope.length - 1; i >= 0; i--) {
    const sv = scope[i];
    if (this.movedVars.has(sv.name)) continue;
    if (sv.isString) {
      this.emit({ kind: "call_extern_void", func: "kei_string_destroy", args: [sv.varId] });
    } else {
      this.emit({ kind: "destroy", value: sv.varId, structName: sv.structName });
    }
  }
}

/** Emit destroys for all scopes (for early return) without popping */
export function emitAllScopeDestroys(this: KirLowerer): void {
  for (let i = this.scopeStack.length - 1; i >= 0; i--) {
    this.emitScopeDestroys(this.scopeStack[i]);
  }
}

/** Emit destroys only for scopes inside the current loop (from loopScopeDepth onward) */
export function emitLoopScopeDestroys(this: KirLowerer): void {
  for (let i = this.scopeStack.length - 1; i >= this.loopScopeDepth; i--) {
    this.emitScopeDestroys(this.scopeStack[i]);
  }
}

/** Emit destroys for all scopes, but skip a named variable (the returned value) */
export function emitAllScopeDestroysExceptNamed(this: KirLowerer, skipName: string | null): void {
  for (let i = this.scopeStack.length - 1; i >= 0; i--) {
    const scope = this.scopeStack[i];
    for (let j = scope.length - 1; j >= 0; j--) {
      const sv = scope[j];
      if (this.movedVars.has(sv.name)) continue;
      if (skipName !== null && sv.name === skipName) continue;
      if (sv.isString) {
        this.emit({ kind: "call_extern_void", func: "kei_string_destroy", args: [sv.varId] });
      } else {
        this.emit({ kind: "destroy", value: sv.varId, structName: sv.structName });
      }
    }
  }
}

/** Track a variable in the current scope if it has lifecycle hooks */
export function trackScopeVar(
  this: KirLowerer,
  name: string,
  varId: VarId,
  expr: Expression
): void {
  if (this.scopeStack.length === 0) return;
  const checkerType = this.checkResult.typeMap.get(expr);
  if (checkerType?.kind === "string") {
    this.scopeStack[this.scopeStack.length - 1].push({
      name,
      varId,
      structName: "",
      isString: true,
    });
    return;
  }
  const lifecycle = this.getStructLifecycle(checkerType);
  if (lifecycle?.hasDestroy) {
    this.scopeStack[this.scopeStack.length - 1].push({
      name,
      varId,
      structName: lifecycle.structName,
    });
  }
}

/** Track a variable by its checker type directly (used for function params) */
export function trackScopeVarByType(
  this: KirLowerer,
  name: string,
  varId: VarId,
  checkerType: Type | undefined
): void {
  if (this.scopeStack.length === 0) return;
  // Note: strings are NOT tracked here because function params are values,
  // not stack pointers. kei_string_destroy requires a pointer.
  // Local string variables are tracked via trackScopeVar instead.
  const lifecycle = this.getStructLifecycle(checkerType);
  if (lifecycle?.hasDestroy) {
    this.scopeStack[this.scopeStack.length - 1].push({
      name,
      varId,
      structName: lifecycle.structName,
    });
  }
}
