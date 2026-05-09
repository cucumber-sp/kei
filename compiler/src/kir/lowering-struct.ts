/**
 * Struct declaration lowering — operates on LoweringCtx.
 * Handles struct declarations, methods, and monomorphized structs.
 *
 * Auto-generated `__destroy` / `__oncopy` bodies live in
 * `src/lifecycle/synthesise.ts` and are emitted from
 * `lowering-decl.ts`'s struct case via `lifecycle.synthesise`.
 */

import type { FunctionDecl, StructDecl, UnsafeStructDecl } from "../ast/nodes";
import type { MonomorphizedStruct } from "../monomorphization";
import type { KirFunction, KirParam, KirType, KirTypeDecl, VarId } from "./kir-types";
import type { LoweringCtx } from "./lowering-ctx";
import { finalizeFunctionBody, resetFunctionState } from "./lowering-decl";
import { pushScope } from "./lowering-scope";
import { lowerBlock } from "./lowering-stmt";
import {
  getFunctionReturnType,
  lowerCheckerType,
  lowerTypeNode,
  resolveParamType,
} from "./lowering-types";

export function lowerStructDecl(
  ctx: LoweringCtx,
  decl: StructDecl | UnsafeStructDecl
): KirTypeDecl {
  const fields = decl.fields.map((f) => ({
    name: f.name,
    type: lowerTypeNode(ctx, f.typeAnnotation),
  }));

  return {
    name: decl.name,
    type: { kind: "struct", name: decl.name, fields },
  };
}

export function lowerMonomorphizedStruct(
  ctx: LoweringCtx,
  mangledName: string,
  monoStruct: MonomorphizedStruct
): KirTypeDecl {
  const concrete = monoStruct.concrete;
  const fields = Array.from(concrete.fields.entries()).map(([name, fieldType]) => ({
    name,
    type: lowerCheckerType(ctx, fieldType),
  }));
  return {
    name: mangledName,
    type: { kind: "struct", name: mangledName, fields },
  };
}

export function lowerMethod(
  ctx: LoweringCtx,
  decl: FunctionDecl,
  mangledName: string,
  _structName: string
): KirFunction {
  resetFunctionState(ctx);

  // Push function-level scope
  pushScope(ctx);

  const params: KirParam[] = decl.params.map((p) => {
    const type = resolveParamType(ctx, decl, p.name);
    // The self parameter is passed as a pointer to the struct — except
    // when the user already declared it as `ref T` or `*T` (which already
    // lowers to ptr at this layer). Same for any param of struct type.
    const alreadyPointer = type.kind === "ptr";
    const paramType: KirType =
      !alreadyPointer && (p.name === "self" || type.kind === "struct")
        ? { kind: "ptr", pointee: type }
        : type;
    const varId: VarId = `%${p.name}`;
    ctx.varMap.set(p.name, varId);
    return { name: p.name, type: paramType };
  });

  const returnType = lowerCheckerType(ctx, getFunctionReturnType(ctx, decl));

  // Set current function return type so lowerReturnStmt can add struct loads
  ctx.currentFunctionOrigReturnType = returnType;

  // Lower body
  lowerBlock(ctx, decl.body);

  finalizeFunctionBody(ctx, false, returnType);

  return {
    name: mangledName,
    params,
    returnType,
    blocks: ctx.blocks,
    localCount: ctx.varCounter,
  };
}

/**
 * Lower a generic struct method for a specific monomorphization.
 *
 * Same shape as {@link lowerMethod} but uses the *substituted* FunctionType
 * (param + return) from the monomorphized struct, plus the per-method body
 * type map populated during `checkMonomorphizedStructMethodBodies`. Without
 * this, signatures and field accesses inside the body would be emitted with
 * the unsubstituted TypeParam (e.g. `struct T*` instead of `int32_t*`).
 */
export function lowerMonomorphizedMethod(
  ctx: LoweringCtx,
  decl: FunctionDecl,
  mangledName: string,
  _structName: string,
  concrete: import("../checker/types").FunctionType,
  bodyTypeMap?: Map<import("../ast/nodes").Expression, import("../checker/types").Type>
): KirFunction {
  resetFunctionState(ctx);
  pushScope(ctx);

  const params: KirParam[] = [];
  for (let i = 0; i < decl.params.length; i++) {
    const p = decl.params[i];
    const concreteParam = concrete.params[i];
    if (!p || !concreteParam) {
      throw new Error("invariant: monomorphized method params must match decl params");
    }
    const type = lowerCheckerType(ctx, concreteParam.type);
    const alreadyPointer = type.kind === "ptr";
    const paramType: KirType =
      !alreadyPointer && (p.name === "self" || type.kind === "struct")
        ? { kind: "ptr", pointee: type }
        : type;
    const varId: VarId = `%${p.name}`;
    ctx.varMap.set(p.name, varId);
    params.push({ name: p.name, type: paramType });
  }

  const returnType = lowerCheckerType(ctx, concrete.returnType);
  ctx.currentFunctionOrigReturnType = returnType;

  // Per-instantiation override so getExprKirType / lowerCheckerType see
  // concrete types for every body expression.
  if (bodyTypeMap) ctx.currentBodyTypeMap = bodyTypeMap;

  lowerBlock(ctx, decl.body);

  ctx.currentBodyTypeMap = null;
  finalizeFunctionBody(ctx, false, returnType);

  return {
    name: mangledName,
    params,
    returnType,
    blocks: ctx.blocks,
    localCount: ctx.varCounter,
  };
}
