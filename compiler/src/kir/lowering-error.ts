/**
 * Error handling (throw/catch) lowering methods for KirLowerer.
 * Extracted from lowering-expr.ts for modularity.
 */

import type { CatchExpr, Expression, ThrowExpr } from "../ast/nodes.ts";
import type { FunctionType } from "../checker/types";
import type { KirType, VarId } from "./kir-types.ts";
import type { LoweringCtx } from "./lowering-ctx.ts";
import { lowerExpr } from "./lowering-expr.ts";
import { emitAllScopeDestroys } from "./lowering-scope.ts";
import { lowerStatement } from "./lowering-stmt.ts";
import { findConstIntInst } from "./lowering-switch.ts";
import { getExprKirType, lowerCheckerType, mangleFunctionNameFromType } from "./lowering-types.ts";
import {
  emit,
  emitCastToPtr,
  emitConstInt,
  emitStackAlloc,
  emitTagIsSuccess,
  freshBlockId,
  freshVar,
  isBlockTerminated,
  sealCurrentBlock,
  setTerminator,
  startBlock,
} from "./lowering-utils.ts";

export function lowerThrowExpr(ctx: LoweringCtx, expr: ThrowExpr): VarId {
  // throw ErrorType{} → cast __err to typed pointer, store error value, return error tag
  const valueId = lowerExpr(ctx, expr.value);
  // biome-ignore lint/style/noNonNullAssertion: __err is always present in a throws function context
  const errPtr = ctx.varMap.get("__err")!;

  // Determine the error type for casting
  const errorKirType = getExprKirType(ctx, expr.value);

  // Only copy error data if the struct has fields (skip for empty structs)
  const hasFields = errorKirType.kind === "struct" && errorKirType.fields.length > 0;
  if (hasFields) {
    // Cast __err (void*) to the specific error struct pointer type
    const typedErrPtr = emitCastToPtr(ctx, errPtr, errorKirType);

    // The struct literal returns a pointer; load the actual struct value from it
    const structVal = freshVar(ctx);
    emit(ctx, { kind: "load", dest: structVal, ptr: valueId, type: errorKirType });

    // Store the struct value through the typed error pointer
    emit(ctx, { kind: "store", ptr: typedErrPtr, value: structVal });
  }

  // Determine the tag for this error type
  const checkerType = ctx.checkResult.typeMap.get(expr.value);
  let tag = 1; // default
  if (checkerType && checkerType.kind === "struct") {
    const idx = ctx.currentFunctionThrowsTypes.findIndex(
      (t) => t.kind === "struct" && t.name === checkerType.name
    );
    if (idx >= 0) tag = idx + 1;
  }

  emitAllScopeDestroys(ctx);
  const tagVal = emitConstInt(ctx, tag);
  setTerminator(ctx, { kind: "ret", value: tagVal });
  return tagVal;
}

export function lowerCatchExpr(ctx: LoweringCtx, expr: CatchExpr): VarId {
  // The operand must be a function call to a throws function
  // We need to resolve the callee's throws info to generate the right code

  // Resolve the function name and its throws info
  const callExpr = expr.operand;
  const throwsInfo = resolveCallThrowsInfo(ctx, callExpr);
  if (!throwsInfo) {
    // Fallback: just lower the operand normally
    return lowerExpr(ctx, expr.operand);
  }

  const { funcName, args: callArgs, throwsTypes, returnType: successType } = throwsInfo;

  // Allocate buffers for out value and error value
  const outType =
    successType.kind === "void"
      ? { kind: "int" as const, bits: 8 as const, signed: false as const }
      : successType;
  const outPtr = emitStackAlloc(ctx, outType);
  // err buffer: use u8 placeholder (C backend will emit union-sized buffer)
  const errPtr = emitStackAlloc(ctx, { kind: "int", bits: 8, signed: false });

  // Call the throws function — dest receives the i32 tag
  const tagVar = freshVar(ctx);
  emit(ctx, {
    kind: "call_throws",
    dest: tagVar,
    func: funcName,
    args: callArgs,
    outPtr,
    errPtr,
    successType,
    errorTypes: throwsTypes,
  });

  if (expr.catchType === "panic") {
    // catch panic: if tag != 0 → kei_panic
    const isOk = emitTagIsSuccess(ctx, tagVar);
    const okLabel = freshBlockId(ctx, "catch.ok");
    const panicLabel = freshBlockId(ctx, "catch.panic");
    setTerminator(ctx, { kind: "br", cond: isOk, thenBlock: okLabel, elseBlock: panicLabel });

    sealCurrentBlock(ctx);
    startBlock(ctx, panicLabel);
    // Call kei_panic
    const panicMsg = freshVar(ctx);
    emit(ctx, { kind: "const_string", dest: panicMsg, value: "unhandled error" });
    emit(ctx, { kind: "call_extern_void", func: "kei_panic", args: [panicMsg] });
    setTerminator(ctx, { kind: "unreachable" });

    sealCurrentBlock(ctx);
    startBlock(ctx, okLabel);

    // Load and return the success value
    if (successType.kind === "void") {
      return emitConstInt(ctx, 0);
    }
    const resultVal = freshVar(ctx);
    emit(ctx, { kind: "load", dest: resultVal, ptr: outPtr, type: successType });
    return resultVal;
  }

  if (expr.catchType === "throw") {
    // catch throw: pass caller's __err directly so callee writes to it
    // Re-emit the call with the caller's __err pointer
    // Remove the previous call_throws (it was the last emitted instruction)
    ctx.currentInsts.pop(); // remove the call_throws we just emitted

    // biome-ignore lint/style/noNonNullAssertion: __err is always present when inside a throws function (catch throw requires it)
    const callerErrPtr = ctx.varMap.get("__err")!;
    emit(ctx, {
      kind: "call_throws",
      dest: tagVar,
      func: funcName,
      args: callArgs,
      outPtr,
      errPtr: callerErrPtr, // pass caller's err buffer directly
      successType,
      errorTypes: throwsTypes,
    });

    const isOk = emitTagIsSuccess(ctx, tagVar);
    const okLabel = freshBlockId(ctx, "catch.ok");
    const propagateLabel = freshBlockId(ctx, "catch.throw");
    setTerminator(ctx, { kind: "br", cond: isOk, thenBlock: okLabel, elseBlock: propagateLabel });

    sealCurrentBlock(ctx);
    startBlock(ctx, propagateLabel);

    // Remap tags from callee to caller's tag space and propagate
    lowerCatchThrowPropagation(ctx, throwsTypes, tagVar, callerErrPtr);

    sealCurrentBlock(ctx);
    startBlock(ctx, okLabel);

    if (successType.kind === "void") {
      return emitConstInt(ctx, 0);
    }
    const resultVal = freshVar(ctx);
    emit(ctx, { kind: "load", dest: resultVal, ptr: outPtr, type: successType });
    return resultVal;
  }

  // catch { clauses } — block catch with per-error-type handling
  const isOk = emitTagIsSuccess(ctx, tagVar);

  const okLabel = freshBlockId(ctx, "catch.ok");
  const switchLabel = freshBlockId(ctx, "catch.switch");
  const endLabel = freshBlockId(ctx, "catch.end");
  setTerminator(ctx, { kind: "br", cond: isOk, thenBlock: okLabel, elseBlock: switchLabel });

  // Allocate result storage (the catch expr produces a value)
  const resultType = getExprKirType(ctx, expr);
  const resultPtr = emitStackAlloc(ctx, resultType);

  // Switch block: branch on tag value
  sealCurrentBlock(ctx);
  startBlock(ctx, switchLabel);

  // Build case blocks for each clause
  const caseInfos: { tagConst: VarId; label: string }[] = [];

  for (const clause of expr.clauses) {
    if (clause.isDefault) continue; // handle default separately

    // Find the tag for this error type
    const errorTag =
      throwsTypes.findIndex((t) => t.kind === "struct" && t.name === clause.errorType) + 1;

    const clauseLabel = freshBlockId(ctx, `catch.clause.${clause.errorType}`);
    const tagConstVar = emitConstInt(ctx, errorTag);
    caseInfos.push({ tagConst: tagConstVar, label: clauseLabel });
  }

  // Default block (unreachable or user default clause)
  const defaultClause = expr.clauses.find((c) => c.isDefault);
  const defaultLabel = defaultClause
    ? freshBlockId(ctx, "catch.default")
    : freshBlockId(ctx, "catch.unreachable");

  setTerminator(ctx, {
    kind: "switch",
    value: tagVar,
    cases: caseInfos.map((ci) => ({ value: ci.tagConst, target: ci.label })),
    defaultBlock: defaultLabel,
  });

  // Emit each clause block
  for (const clause of expr.clauses) {
    if (clause.isDefault) continue;

    const errorTag =
      throwsTypes.findIndex((t) => t.kind === "struct" && t.name === clause.errorType) + 1;
    const clauseLabel = caseInfos.find((ci) => {
      // Match by tag value
      const inst = findConstIntInst(ctx, ci.tagConst);
      return inst?.value === errorTag;
    })?.label;
    if (!clauseLabel) continue;

    sealCurrentBlock(ctx);
    startBlock(ctx, clauseLabel);

    // If clause has a variable name, bind it to the error value in the err buffer
    if (clause.varName) {
      const errType = throwsTypes[errorTag - 1];
      // Cast errPtr to typed pointer — this becomes the variable's storage
      const typedErrPtr = emitCastToPtr(ctx, errPtr, errType);
      ctx.varMap.set(clause.varName, typedErrPtr);
    }

    // Lower clause body statements
    for (const stmt of clause.body) {
      lowerStatement(ctx, stmt);
    }

    if (!isBlockTerminated(ctx)) {
      setTerminator(ctx, { kind: "jump", target: endLabel });
    }
  }

  // Default clause block
  sealCurrentBlock(ctx);
  startBlock(ctx, defaultLabel);
  if (defaultClause) {
    if (defaultClause.varName) {
      // Bind the error variable to a typed pointer into the err buffer
      const firstErrType = throwsTypes[0] || {
        kind: "int" as const,
        bits: 8 as const,
        signed: false as const,
      };
      const typedErrPtr = emitCastToPtr(ctx, errPtr, firstErrType);
      ctx.varMap.set(defaultClause.varName, typedErrPtr);
    }
    for (const stmt of defaultClause.body) {
      lowerStatement(ctx, stmt);
    }
  }
  if (!isBlockTerminated(ctx)) {
    setTerminator(ctx, { kind: "jump", target: endLabel });
  }

  // OK path: load success value
  sealCurrentBlock(ctx);
  startBlock(ctx, okLabel);
  if (successType.kind !== "void") {
    const successVal = freshVar(ctx);
    emit(ctx, { kind: "load", dest: successVal, ptr: outPtr, type: successType });
    emit(ctx, { kind: "store", ptr: resultPtr, value: successVal });
  }
  setTerminator(ctx, { kind: "jump", target: endLabel });

  // End block
  sealCurrentBlock(ctx);
  startBlock(ctx, endLabel);

  if (resultType.kind === "void") {
    return emitConstInt(ctx, 0);
  }
  const finalResult = freshVar(ctx);
  emit(ctx, { kind: "load", dest: finalResult, ptr: resultPtr, type: resultType });
  return finalResult;
}

/** Resolve the function name, args, and throws info for a call expression used in catch */
export function resolveCallThrowsInfo(
  ctx: LoweringCtx,
  callExpr: Expression
): {
  funcName: string;
  args: VarId[];
  throwsTypes: KirType[];
  returnType: KirType;
} | null {
  if (callExpr.kind !== "CallExpr") return null;

  const args = callExpr.args.map((a) => lowerExpr(ctx, a));
  const _resultType = getExprKirType(ctx, callExpr);

  // Resolve function name (same logic as lowerCallExpr)
  let funcName: string;
  if (callExpr.callee.kind === "Identifier") {
    const baseName = callExpr.callee.name;
    const importedName = ctx.importedNames.get(baseName);
    const resolvedBase = importedName ?? baseName;

    if (ctx.overloadedNames.has(baseName)) {
      const calleeType = ctx.checkResult.typeMap.get(callExpr.callee);
      if (calleeType && calleeType.kind === "function") {
        funcName = mangleFunctionNameFromType(ctx, resolvedBase, calleeType as FunctionType);
      } else {
        funcName = resolvedBase;
      }
    } else {
      funcName = resolvedBase;
    }
  } else if (callExpr.callee.kind === "MemberExpr") {
    const objType = ctx.checkResult.typeMap.get(callExpr.callee.object);
    if (objType?.kind === "module") {
      const modulePrefix = objType.name.replace(/\./g, "_");
      funcName = `${modulePrefix}_${callExpr.callee.property}`;
    } else {
      funcName = callExpr.callee.property;
    }
  } else {
    return null;
  }

  // Look up throws info from pre-registered throws functions
  const throwsInfo = ctx.throwsFunctions.get(funcName);
  if (throwsInfo) {
    return {
      funcName,
      args,
      throwsTypes: throwsInfo.throwsTypes,
      returnType: throwsInfo.returnType,
    };
  }

  // Fallback: try to get from checker's type info
  const calleeType = ctx.checkResult.typeMap.get(callExpr.callee);
  if (
    calleeType &&
    calleeType.kind === "function" &&
    (calleeType as FunctionType).throwsTypes.length > 0
  ) {
    const ft = calleeType as FunctionType;
    return {
      funcName,
      args,
      throwsTypes: ft.throwsTypes.map((t) => lowerCheckerType(ctx, t)),
      returnType: lowerCheckerType(ctx, ft.returnType),
    };
  }

  return null;
}

/** For catch throw: propagate errors from callee to caller's error protocol.
 *  The callee already wrote the error value to the caller's __err buffer,
 *  so we only need to remap tags if the error type ordering differs. */
export function lowerCatchThrowPropagation(
  ctx: LoweringCtx,
  calleeThrowsTypes: KirType[],
  tagVar: VarId,
  _errPtr: VarId
): void {
  const callerThrowsTypes = ctx.currentFunctionThrowsTypes;

  // Check if all callee types exist in caller types at same indices
  let needsRemap = false;
  for (let i = 0; i < calleeThrowsTypes.length; i++) {
    const calleeType = calleeThrowsTypes[i];
    const callerIdx = callerThrowsTypes.findIndex(
      (ct) => ct.kind === "struct" && calleeType.kind === "struct" && ct.name === calleeType.name
    );
    if (callerIdx !== i) {
      needsRemap = true;
      break;
    }
  }

  if (!needsRemap) {
    // Direct propagation: same tag numbering, error already in caller's buffer
    emitAllScopeDestroys(ctx);
    setTerminator(ctx, { kind: "ret", value: tagVar });
  } else {
    // Remap: switch on callee tag, return caller's tag
    const cases: { value: VarId; target: string }[] = [];
    const endPropLabel = freshBlockId(ctx, "catch.prop.end");

    for (let i = 0; i < calleeThrowsTypes.length; i++) {
      const calleeTag = emitConstInt(ctx, i + 1);
      const caseLabel = freshBlockId(ctx, `catch.prop.${i}`);
      cases.push({ value: calleeTag, target: caseLabel });
    }

    setTerminator(ctx, {
      kind: "switch",
      value: tagVar,
      cases,
      defaultBlock: endPropLabel,
    });

    for (let i = 0; i < calleeThrowsTypes.length; i++) {
      const calleeType = calleeThrowsTypes[i];
      const callerIdx = callerThrowsTypes.findIndex(
        (ct) => ct.kind === "struct" && calleeType.kind === "struct" && ct.name === calleeType.name
      );
      if (callerIdx < 0) continue;

      sealCurrentBlock(ctx);
      startBlock(ctx, cases[i].target);
      emitAllScopeDestroys(ctx);
      const callerTag = emitConstInt(ctx, callerIdx + 1);
      setTerminator(ctx, { kind: "ret", value: callerTag });
    }

    sealCurrentBlock(ctx);
    startBlock(ctx, endPropLabel);
    setTerminator(ctx, { kind: "unreachable" });
  }
}
