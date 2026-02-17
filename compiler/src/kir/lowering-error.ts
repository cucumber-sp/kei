/**
 * Error handling (throw/catch) lowering methods for KirLowerer.
 * Extracted from lowering-expr.ts for modularity.
 */

import type { CatchExpr, Expression, ThrowExpr } from "../ast/nodes.ts";
import type { FunctionType } from "../checker/types";
import type { KirType, VarId } from "./kir-types.ts";
import type { KirLowerer } from "./lowering.ts";

export function lowerThrowExpr(this: KirLowerer, expr: ThrowExpr): VarId {
  // throw ErrorType{} → cast __err to typed pointer, store error value, return error tag
  const valueId = this.lowerExpr(expr.value);
  // biome-ignore lint/style/noNonNullAssertion: __err is always present in a throws function context
  const errPtr = this.varMap.get("__err")!;

  // Determine the error type for casting
  const errorKirType = this.getExprKirType(expr.value);

  // Only copy error data if the struct has fields (skip for empty structs)
  const hasFields = errorKirType.kind === "struct" && errorKirType.fields.length > 0;
  if (hasFields) {
    // Cast __err (void*) to the specific error struct pointer type
    const typedErrPtr = this.emitCastToPtr(errPtr, errorKirType);

    // The struct literal returns a pointer; load the actual struct value from it
    const structVal = this.freshVar();
    this.emit({ kind: "load", dest: structVal, ptr: valueId, type: errorKirType });

    // Store the struct value through the typed error pointer
    this.emit({ kind: "store", ptr: typedErrPtr, value: structVal });
  }

  // Determine the tag for this error type
  const checkerType = this.checkResult.typeMap.get(expr.value);
  let tag = 1; // default
  if (checkerType && checkerType.kind === "struct") {
    const idx = this.currentFunctionThrowsTypes.findIndex(
      (t) => t.kind === "struct" && t.name === checkerType.name
    );
    if (idx >= 0) tag = idx + 1;
  }

  this.emitAllScopeDestroys();
  const tagVal = this.emitConstInt(tag);
  this.setTerminator({ kind: "ret", value: tagVal });
  return tagVal;
}

export function lowerCatchExpr(this: KirLowerer, expr: CatchExpr): VarId {
  // The operand must be a function call to a throws function
  // We need to resolve the callee's throws info to generate the right code

  // Resolve the function name and its throws info
  const callExpr = expr.operand;
  const throwsInfo = this.resolveCallThrowsInfo(callExpr);
  if (!throwsInfo) {
    // Fallback: just lower the operand normally
    return this.lowerExpr(expr.operand);
  }

  const { funcName, args: callArgs, throwsTypes, returnType: successType } = throwsInfo;

  // Allocate buffers for out value and error value
  const outType =
    successType.kind === "void"
      ? { kind: "int" as const, bits: 8 as const, signed: false as const }
      : successType;
  const outPtr = this.emitStackAlloc(outType);
  // err buffer: use u8 placeholder (C backend will emit union-sized buffer)
  const errPtr = this.emitStackAlloc({ kind: "int", bits: 8, signed: false });

  // Call the throws function — dest receives the i32 tag
  const tagVar = this.freshVar();
  this.emit({
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
    const isOk = this.emitTagIsSuccess(tagVar);
    const okLabel = this.freshBlockId("catch.ok");
    const panicLabel = this.freshBlockId("catch.panic");
    this.setTerminator({ kind: "br", cond: isOk, thenBlock: okLabel, elseBlock: panicLabel });

    this.sealCurrentBlock();
    this.startBlock(panicLabel);
    // Call kei_panic
    const panicMsg = this.freshVar();
    this.emit({ kind: "const_string", dest: panicMsg, value: "unhandled error" });
    this.emit({ kind: "call_extern_void", func: "kei_panic", args: [panicMsg] });
    this.setTerminator({ kind: "unreachable" });

    this.sealCurrentBlock();
    this.startBlock(okLabel);

    // Load and return the success value
    if (successType.kind === "void") {
      return this.emitConstInt(0);
    }
    const resultVal = this.freshVar();
    this.emit({ kind: "load", dest: resultVal, ptr: outPtr, type: successType });
    return resultVal;
  }

  if (expr.catchType === "throw") {
    // catch throw: pass caller's __err directly so callee writes to it
    // Re-emit the call with the caller's __err pointer
    // Remove the previous call_throws (it was the last emitted instruction)
    this.currentInsts.pop(); // remove the call_throws we just emitted

    // biome-ignore lint/style/noNonNullAssertion: __err is always present when inside a throws function (catch throw requires it)
    const callerErrPtr = this.varMap.get("__err")!;
    this.emit({
      kind: "call_throws",
      dest: tagVar,
      func: funcName,
      args: callArgs,
      outPtr,
      errPtr: callerErrPtr, // pass caller's err buffer directly
      successType,
      errorTypes: throwsTypes,
    });

    const isOk = this.emitTagIsSuccess(tagVar);
    const okLabel = this.freshBlockId("catch.ok");
    const propagateLabel = this.freshBlockId("catch.throw");
    this.setTerminator({ kind: "br", cond: isOk, thenBlock: okLabel, elseBlock: propagateLabel });

    this.sealCurrentBlock();
    this.startBlock(propagateLabel);

    // Remap tags from callee to caller's tag space and propagate
    this.lowerCatchThrowPropagation(throwsTypes, tagVar, callerErrPtr);

    this.sealCurrentBlock();
    this.startBlock(okLabel);

    if (successType.kind === "void") {
      return this.emitConstInt(0);
    }
    const resultVal = this.freshVar();
    this.emit({ kind: "load", dest: resultVal, ptr: outPtr, type: successType });
    return resultVal;
  }

  // catch { clauses } — block catch with per-error-type handling
  const isOk = this.emitTagIsSuccess(tagVar);

  const okLabel = this.freshBlockId("catch.ok");
  const switchLabel = this.freshBlockId("catch.switch");
  const endLabel = this.freshBlockId("catch.end");
  this.setTerminator({ kind: "br", cond: isOk, thenBlock: okLabel, elseBlock: switchLabel });

  // Allocate result storage (the catch expr produces a value)
  const resultType = this.getExprKirType(expr);
  const resultPtr = this.emitStackAlloc(resultType);

  // Switch block: branch on tag value
  this.sealCurrentBlock();
  this.startBlock(switchLabel);

  // Build case blocks for each clause
  const caseInfos: { tagConst: VarId; label: string }[] = [];

  for (const clause of expr.clauses) {
    if (clause.isDefault) continue; // handle default separately

    // Find the tag for this error type
    const errorTag =
      throwsTypes.findIndex((t) => t.kind === "struct" && t.name === clause.errorType) + 1;

    const clauseLabel = this.freshBlockId(`catch.clause.${clause.errorType}`);
    const tagConstVar = this.emitConstInt(errorTag);
    caseInfos.push({ tagConst: tagConstVar, label: clauseLabel });
  }

  // Default block (unreachable or user default clause)
  const defaultClause = expr.clauses.find((c) => c.isDefault);
  const defaultLabel = defaultClause
    ? this.freshBlockId("catch.default")
    : this.freshBlockId("catch.unreachable");

  this.setTerminator({
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
      const inst = this.findConstIntInst(ci.tagConst);
      return inst?.value === errorTag;
    })?.label;
    if (!clauseLabel) continue;

    this.sealCurrentBlock();
    this.startBlock(clauseLabel);

    // If clause has a variable name, bind it to the error value in the err buffer
    if (clause.varName) {
      const errType = throwsTypes[errorTag - 1];
      // Cast errPtr to typed pointer — this becomes the variable's storage
      const typedErrPtr = this.emitCastToPtr(errPtr, errType);
      this.varMap.set(clause.varName, typedErrPtr);
    }

    // Lower clause body statements
    for (const stmt of clause.body) {
      this.lowerStatement(stmt);
    }

    if (!this.isBlockTerminated()) {
      this.setTerminator({ kind: "jump", target: endLabel });
    }
  }

  // Default clause block
  this.sealCurrentBlock();
  this.startBlock(defaultLabel);
  if (defaultClause) {
    if (defaultClause.varName) {
      // Bind the error variable to a typed pointer into the err buffer
      const firstErrType = throwsTypes[0] || {
        kind: "int" as const,
        bits: 8 as const,
        signed: false as const,
      };
      const typedErrPtr = this.emitCastToPtr(errPtr, firstErrType);
      this.varMap.set(defaultClause.varName, typedErrPtr);
    }
    for (const stmt of defaultClause.body) {
      this.lowerStatement(stmt);
    }
  }
  if (!this.isBlockTerminated()) {
    this.setTerminator({ kind: "jump", target: endLabel });
  }

  // OK path: load success value
  this.sealCurrentBlock();
  this.startBlock(okLabel);
  if (successType.kind !== "void") {
    const successVal = this.freshVar();
    this.emit({ kind: "load", dest: successVal, ptr: outPtr, type: successType });
    this.emit({ kind: "store", ptr: resultPtr, value: successVal });
  }
  this.setTerminator({ kind: "jump", target: endLabel });

  // End block
  this.sealCurrentBlock();
  this.startBlock(endLabel);

  if (resultType.kind === "void") {
    return this.emitConstInt(0);
  }
  const finalResult = this.freshVar();
  this.emit({ kind: "load", dest: finalResult, ptr: resultPtr, type: resultType });
  return finalResult;
}

/** Resolve the function name, args, and throws info for a call expression used in catch */
export function resolveCallThrowsInfo(
  this: KirLowerer,
  callExpr: Expression
): {
  funcName: string;
  args: VarId[];
  throwsTypes: KirType[];
  returnType: KirType;
} | null {
  if (callExpr.kind !== "CallExpr") return null;

  const args = callExpr.args.map((a) => this.lowerExpr(a));
  const _resultType = this.getExprKirType(callExpr);

  // Resolve function name (same logic as lowerCallExpr)
  let funcName: string;
  if (callExpr.callee.kind === "Identifier") {
    const baseName = callExpr.callee.name;
    const importedName = this.importedNames.get(baseName);
    const resolvedBase = importedName ?? baseName;

    if (this.overloadedNames.has(baseName)) {
      const calleeType = this.checkResult.typeMap.get(callExpr.callee);
      if (calleeType && calleeType.kind === "function") {
        funcName = this.mangleFunctionNameFromType(resolvedBase, calleeType as FunctionType);
      } else {
        funcName = resolvedBase;
      }
    } else {
      funcName = resolvedBase;
    }
  } else if (callExpr.callee.kind === "MemberExpr") {
    const objType = this.checkResult.typeMap.get(callExpr.callee.object);
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
  const throwsInfo = this.throwsFunctions.get(funcName);
  if (throwsInfo) {
    return {
      funcName,
      args,
      throwsTypes: throwsInfo.throwsTypes,
      returnType: throwsInfo.returnType,
    };
  }

  // Fallback: try to get from checker's type info
  const calleeType = this.checkResult.typeMap.get(callExpr.callee);
  if (
    calleeType &&
    calleeType.kind === "function" &&
    (calleeType as FunctionType).throwsTypes.length > 0
  ) {
    const ft = calleeType as FunctionType;
    return {
      funcName,
      args,
      throwsTypes: ft.throwsTypes.map((t) => this.lowerCheckerType(t)),
      returnType: this.lowerCheckerType(ft.returnType),
    };
  }

  return null;
}

/** For catch throw: propagate errors from callee to caller's error protocol.
 *  The callee already wrote the error value to the caller's __err buffer,
 *  so we only need to remap tags if the error type ordering differs. */
export function lowerCatchThrowPropagation(
  this: KirLowerer,
  calleeThrowsTypes: KirType[],
  tagVar: VarId,
  _errPtr: VarId
): void {
  const callerThrowsTypes = this.currentFunctionThrowsTypes;

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
    this.emitAllScopeDestroys();
    this.setTerminator({ kind: "ret", value: tagVar });
  } else {
    // Remap: switch on callee tag, return caller's tag
    const cases: { value: VarId; target: string }[] = [];
    const endPropLabel = this.freshBlockId("catch.prop.end");

    for (let i = 0; i < calleeThrowsTypes.length; i++) {
      const calleeTag = this.emitConstInt(i + 1);
      const caseLabel = this.freshBlockId(`catch.prop.${i}`);
      cases.push({ value: calleeTag, target: caseLabel });
    }

    this.setTerminator({
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

      this.sealCurrentBlock();
      this.startBlock(cases[i].target);
      this.emitAllScopeDestroys();
      const callerTag = this.emitConstInt(callerIdx + 1);
      this.setTerminator({ kind: "ret", value: callerTag });
    }

    this.sealCurrentBlock();
    this.startBlock(endPropLabel);
    this.setTerminator({ kind: "unreachable" });
  }
}
