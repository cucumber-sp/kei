/**
 * Declaration lowering — operates on LoweringCtx.
 * Handles the main declaration dispatch, function declarations,
 * extern functions, and static declarations.
 *
 * Struct/method/lifecycle lowering: lowering-struct.ts
 * Enum declaration lowering: lowering-enum-decl.ts
 */

import type { Declaration, ExternFunctionDecl, FunctionDecl, StaticDecl } from "../ast/nodes";
import { synthesise as lifecycleSynthesise } from "../lifecycle";
import type { MonomorphizedFunction } from "../monomorphization";
import type { KirExtern, KirFunction, KirGlobal, KirParam, KirType, VarId } from "./kir-types";
import type { LoweringCtx } from "./lowering-ctx";
import { lowerEnumDecl } from "./lowering-enum-decl";
import { popScopeWithDestroy, pushScope } from "./lowering-scope";
import { lowerBlock } from "./lowering-stmt";
import { lowerMethod, lowerStructDecl } from "./lowering-struct";
import {
  getExprKirType,
  getFunctionReturnType,
  lowerCheckerType,
  lowerTypeNode,
  mangleFunctionName,
  resolveParamCheckerType,
  resolveParamType,
} from "./lowering-types";
import {
  emit,
  emitConstInt,
  ensureTerminator,
  isBlockTerminated,
  sealCurrentBlock,
  setTerminator,
} from "./lowering-utils";

// ─── Declarations ────────────────────────────────────────────────────────

export function lowerDeclaration(ctx: LoweringCtx, decl: Declaration): void {
  switch (decl.kind) {
    case "FunctionDecl":
      // Skip generic function templates — they are instantiated via monomorphization
      if (decl.genericParams.length > 0) break;
      ctx.functions.push(lowerFunction(ctx, decl));
      break;
    case "ExternFunctionDecl":
      ctx.externs.push(lowerExternFunction(ctx, decl));
      break;
    case "StructDecl":
    case "UnsafeStructDecl": {
      // Skip generic struct templates — they are instantiated via monomorphization
      if (decl.genericParams.length > 0) break;
      ctx.typeDecls.push(lowerStructDecl(ctx, decl));
      // Lower methods as top-level functions with mangled names
      for (const method of decl.methods) {
        const structPrefix = ctx.modulePrefix ? `${ctx.modulePrefix}_${decl.name}` : decl.name;
        const mangledName = `${structPrefix}_${method.name}`;
        ctx.functions.push(lowerMethod(ctx, method, mangledName, decl.name));
      }
      // Synthesise auto-generated `__destroy` / `__oncopy` hooks. The
      // Lifecycle module owns both the decision (which fields drive the
      // arm) and the body shape (reverse-declaration iteration order,
      // string vs. nested-struct emit patterns); lowering's only job is
      // to take the resulting KIR functions and append them to the
      // module.
      const autoDestroyType = ctx.checkResult.lifecycle.autoDestroyStructs.get(decl.name);
      const autoOncopyType = ctx.checkResult.lifecycle.autoOncopyStructs.get(decl.name);
      const lifecycleStruct = autoDestroyType ?? autoOncopyType;
      if (lifecycleStruct) {
        const decision = ctx.checkResult.lifecycle.getDecision(lifecycleStruct);
        if (decision) {
          ctx.functions.push(...lifecycleSynthesise(lifecycleStruct, decision));
        }
      }
      break;
    }
    case "EnumDecl":
      // Generic enums are emitted per-instantiation by the monomorphization
      // pass in `runLowering`, not from the original decl (whose payload
      // types still reference TypeParams).
      if (decl.genericParams.length === 0) {
        ctx.typeDecls.push(lowerEnumDecl(ctx, decl));
      }
      break;
    case "StaticDecl":
      ctx.globals.push(lowerStaticDecl(ctx, decl));
      break;
    case "TypeAlias":
    case "ImportDecl":
      // No KIR output needed
      break;
  }
}

/** Reset per-function state to prepare for lowering a new function body. */
export function resetFunctionState(ctx: LoweringCtx): void {
  ctx.blocks = [];
  ctx.currentInsts = [];
  ctx.varCounter = 0;
  ctx.blockCounter = 0;
  ctx.varMap = new Map();
  ctx.currentBlockId = "entry";
  ctx.loopBreakTarget = null;
  ctx.loopContinueTarget = null;
  ctx.scopeStack = [];
  ctx.deferStack = [];
  ctx.movedVars = new Set();
  ctx.scopeIdCounter = 0;
  ctx.scopeExitData = new Map();
}

/** Finalize function body: pop scope, add terminator, seal last block. */
export function finalizeFunctionBody(
  ctx: LoweringCtx,
  isThrows: boolean,
  returnType: KirType
): void {
  // Emit destroy for function-scope variables before implicit return
  if (isBlockTerminated(ctx)) {
    ctx.scopeStack.pop(); // discard without emitting (already returned)
    ctx.deferStack.pop();
  } else {
    popScopeWithDestroy(ctx);
  }

  // Ensure the last block has a terminator
  if (isThrows) {
    if (!isBlockTerminated(ctx)) {
      const zeroTag = emitConstInt(ctx, 0);
      setTerminator(ctx, { kind: "ret", value: zeroTag });
    }
  } else {
    ensureTerminator(ctx, returnType);
  }

  // Seal last block
  sealCurrentBlock(ctx);
}

/** Add __out and __err pointer params for throws functions. */
export function addThrowsParams(
  ctx: LoweringCtx,
  params: KirParam[],
  originalReturnType: KirType
): void {
  const outParamId: VarId = "%__out";
  const errParamId: VarId = "%__err";
  ctx.varMap.set("__out", outParamId);
  ctx.varMap.set("__err", errParamId);
  params.push({
    name: "__out",
    type: {
      kind: "ptr",
      pointee:
        originalReturnType.kind === "void"
          ? { kind: "int", bits: 8, signed: false }
          : originalReturnType,
    },
  });
  params.push({ name: "__err", type: { kind: "ptr", pointee: { kind: "void" } } });
}

export function lowerFunction(ctx: LoweringCtx, decl: FunctionDecl): KirFunction {
  resetFunctionState(ctx);

  // Detect throws function
  const isThrows = decl.throwsTypes.length > 0;
  const throwsKirTypes = isThrows ? decl.throwsTypes.map((t) => lowerTypeNode(ctx, t)) : [];

  const originalReturnType = lowerCheckerType(ctx, getFunctionReturnType(ctx, decl));

  // Set current function throws state
  ctx.currentFunctionThrowsTypes = throwsKirTypes;
  ctx.currentFunctionOrigReturnType = originalReturnType;

  // Push function-level scope
  pushScope(ctx);

  const params: KirParam[] = decl.params.map((p) => {
    const type = resolveParamType(ctx, decl, p.name);
    // Struct params lower to pointers — `field_ptr` always emits `base->field`,
    // so the body needs a pointer base. Caller passes `&value`.
    const paramType: KirType = type.kind === "struct" ? { kind: "ptr", pointee: type } : type;
    const varId: VarId = `%${p.name}`;
    ctx.varMap.set(p.name, varId);
    return { name: p.name, type: paramType };
  });

  // For throws functions: add __out and __err pointer params
  if (isThrows) {
    addThrowsParams(ctx, params, originalReturnType);
  }

  // Emit `mark_param` for each managed-struct param. The Lifecycle pass
  // (`src/lifecycle/pass.ts`) rewrites each marker into a destroy call at
  // every function exit point (every `ret`/`ret_void` terminator).
  //
  // String params are values (not stack pointers), so they are not
  // destroyed at exit — matching the prior `trackScopeVarByType`
  // exclusion. They are filtered here by the `kind === "struct"` guard:
  // `Lifecycle.getDecision` is only populated for structs.
  for (const p of decl.params) {
    const checkerType = resolveParamCheckerType(ctx, decl, p.name);
    if (checkerType?.kind !== "struct") continue;
    if (!ctx.checkResult.lifecycle.getDecision(checkerType)?.destroy) continue;
    emit(ctx, { kind: "mark_param", param: `%${p.name}` });
  }

  // For throws functions, the actual return type is i32 (tag)
  const returnType = isThrows
    ? { kind: "int" as const, bits: 32 as const, signed: true }
    : originalReturnType;

  // Lower body
  lowerBlock(ctx, decl.body);

  finalizeFunctionBody(ctx, isThrows, returnType);

  // Clear throws state
  ctx.currentFunctionThrowsTypes = [];
  ctx.currentFunctionOrigReturnType = { kind: "void" };

  // Use mangled name for overloaded functions, and apply module prefix
  let funcName: string;
  if (ctx.overloadedNames.has(decl.name)) {
    const baseName = ctx.modulePrefix ? `${ctx.modulePrefix}_${decl.name}` : decl.name;
    funcName = mangleFunctionName(ctx, baseName, decl);
  } else if (ctx.modulePrefix && decl.name !== "main") {
    funcName = `${ctx.modulePrefix}_${decl.name}`;
  } else {
    funcName = decl.name;
  }

  return {
    name: funcName,
    params,
    returnType,
    blocks: ctx.blocks,
    localCount: ctx.varCounter,
    throwsTypes: isThrows ? throwsKirTypes : undefined,
    lifecycleScopeExits: ctx.scopeExitData.size > 0 ? ctx.scopeExitData : undefined,
  };
}

export function lowerExternFunction(ctx: LoweringCtx, decl: ExternFunctionDecl): KirExtern {
  const params: KirParam[] = decl.params.map((p) => ({
    name: p.name,
    type: lowerTypeNode(ctx, p.typeAnnotation),
  }));

  const returnType = decl.returnType
    ? lowerTypeNode(ctx, decl.returnType)
    : ({ kind: "void" } as KirType);

  return { name: decl.name, params, returnType };
}

export function lowerMonomorphizedFunction(
  ctx: LoweringCtx,
  monoFunc: MonomorphizedFunction
): KirFunction {
  // biome-ignore lint/style/noNonNullAssertion: monomorphized functions always have a declaration set before lowering
  const decl = monoFunc.declaration!;
  const concreteType = monoFunc.concrete;

  resetFunctionState(ctx);

  // Detect throws function
  const isThrows = concreteType.throwsTypes.length > 0;
  const throwsKirTypes = isThrows
    ? concreteType.throwsTypes.map((t) => lowerCheckerType(ctx, t))
    : [];

  const originalReturnType = lowerCheckerType(ctx, concreteType.returnType);

  // Set current function throws state
  ctx.currentFunctionThrowsTypes = throwsKirTypes;
  ctx.currentFunctionOrigReturnType = originalReturnType;

  // Push function-level scope
  pushScope(ctx);

  const params: KirParam[] = [];
  for (let i = 0; i < decl.params.length; i++) {
    const p = decl.params[i];
    const concreteParam = concreteType.params[i];
    if (!p || !concreteParam) {
      throw new Error("invariant: monomorphized function params must match declaration params");
    }
    const type = lowerCheckerType(ctx, concreteParam.type);
    const paramType: KirType = type.kind === "struct" ? { kind: "ptr", pointee: type } : type;
    const varId: VarId = `%${p.name}`;
    ctx.varMap.set(p.name, varId);
    params.push({ name: p.name, type: paramType });
  }

  // For throws functions: add __out and __err pointer params
  if (isThrows) {
    addThrowsParams(ctx, params, originalReturnType);
  }

  // For throws functions, the actual return type is i32 (tag)
  const returnType = isThrows
    ? { kind: "int" as const, bits: 32 as const, signed: true }
    : originalReturnType;

  // Set per-instantiation type map override for correct type resolution
  if (monoFunc.bodyTypeMap) {
    ctx.currentBodyTypeMap = monoFunc.bodyTypeMap;
  }
  if (monoFunc.bodyGenericResolutions) {
    ctx.currentBodyGenericResolutions = monoFunc.bodyGenericResolutions;
  }

  // Lower body
  lowerBlock(ctx, decl.body);

  // Clear per-instantiation overrides
  ctx.currentBodyTypeMap = null;
  ctx.currentBodyGenericResolutions = null;

  finalizeFunctionBody(ctx, isThrows, returnType);

  // Clear throws state
  ctx.currentFunctionThrowsTypes = [];
  ctx.currentFunctionOrigReturnType = { kind: "void" };

  // Apply module prefix if needed
  let funcName = monoFunc.mangledName;
  if (ctx.modulePrefix) {
    funcName = `${ctx.modulePrefix}_${funcName}`;
  }

  return {
    name: funcName,
    params,
    returnType,
    blocks: ctx.blocks,
    localCount: ctx.varCounter,
    throwsTypes: isThrows ? throwsKirTypes : undefined,
    lifecycleScopeExits: ctx.scopeExitData.size > 0 ? ctx.scopeExitData : undefined,
  };
}

export function lowerStaticDecl(ctx: LoweringCtx, decl: StaticDecl): KirGlobal {
  const type = decl.typeAnnotation
    ? lowerTypeNode(ctx, decl.typeAnnotation)
    : getExprKirType(ctx, decl.initializer);

  return {
    name: decl.name,
    type,
    initializer: null,
  };
}
