/**
 * Operator expression lowering — operates on LoweringCtx.
 * Extracted from lowering-expr.ts for modularity.
 */

import type { BinaryExpr, Expression, UnaryExpr } from "../ast/nodes.ts";
import type { StructType } from "../checker/types";
import type { KirType, VarId } from "./kir-types.ts";
import type { LoweringCtx } from "./lowering-ctx.ts";
import { lowerExpr, lowerExprAsPtr } from "./lowering-expr.ts";
import { getExprKirType, lowerCheckerType } from "./lowering-types.ts";
import {
  emit,
  emitStackAlloc,
  freshBlockId,
  freshVar,
  mapBinOp,
  sealCurrentBlock,
  setTerminator,
  startBlock,
} from "./lowering-utils.ts";

export function lowerBinaryExpr(ctx: LoweringCtx, expr: BinaryExpr): VarId {
  // Check for operator overloading
  const opMethod = ctx.checkResult.operatorMethods.get(expr);
  if (opMethod) {
    return lowerOperatorMethodCall(ctx, expr.left, opMethod.methodName, opMethod.structType, [
      expr.right,
    ]);
  }

  // Short-circuit for logical AND/OR
  if (expr.operator === "&&") {
    return lowerShortCircuitAnd(ctx, expr);
  }
  if (expr.operator === "||") {
    return lowerShortCircuitOr(ctx, expr);
  }

  const lhs = lowerExpr(ctx, expr.left);
  const rhs = lowerExpr(ctx, expr.right);
  const dest = freshVar(ctx);

  const op = mapBinOp(ctx, expr.operator);
  if (op) {
    const type = getExprKirType(ctx, expr);
    // For string equality/inequality, pass operandType so the C emitter knows
    const leftCheckerType = ctx.checkResult.typeMap.get(expr.left);
    if (leftCheckerType?.kind === "string" && (op === "eq" || op === "neq")) {
      emit(ctx, { kind: "bin_op", op, dest, lhs, rhs, type, operandType: { kind: "string" } });
    } else {
      emit(ctx, { kind: "bin_op", op, dest, lhs, rhs, type });
    }
    return dest;
  }

  // Fallback
  return lhs;
}

export function lowerShortCircuitAnd(ctx: LoweringCtx, expr: BinaryExpr): VarId {
  const resultType: KirType = { kind: "bool" };
  const resultPtr = emitStackAlloc(ctx, resultType);

  const lhs = lowerExpr(ctx, expr.left);
  const rhsLabel = freshBlockId(ctx, "and.rhs");
  const falseLabel = freshBlockId(ctx, "and.false");
  const endLabel = freshBlockId(ctx, "and.end");

  setTerminator(ctx, { kind: "br", cond: lhs, thenBlock: rhsLabel, elseBlock: falseLabel });

  // False path: store false
  sealCurrentBlock(ctx);
  startBlock(ctx, falseLabel);
  const falseVal = freshVar(ctx);
  emit(ctx, { kind: "const_bool", dest: falseVal, value: false });
  emit(ctx, { kind: "store", ptr: resultPtr, value: falseVal });
  setTerminator(ctx, { kind: "jump", target: endLabel });

  // RHS path: evaluate rhs and store it
  sealCurrentBlock(ctx);
  startBlock(ctx, rhsLabel);
  const rhs = lowerExpr(ctx, expr.right);
  emit(ctx, { kind: "store", ptr: resultPtr, value: rhs });
  setTerminator(ctx, { kind: "jump", target: endLabel });

  // End: load result
  sealCurrentBlock(ctx);
  startBlock(ctx, endLabel);
  const dest = freshVar(ctx);
  emit(ctx, { kind: "load", dest, ptr: resultPtr, type: resultType });
  return dest;
}

export function lowerShortCircuitOr(ctx: LoweringCtx, expr: BinaryExpr): VarId {
  const resultType: KirType = { kind: "bool" };
  const resultPtr = emitStackAlloc(ctx, resultType);

  const lhs = lowerExpr(ctx, expr.left);
  const trueLabel = freshBlockId(ctx, "or.true");
  const rhsLabel = freshBlockId(ctx, "or.rhs");
  const endLabel = freshBlockId(ctx, "or.end");

  setTerminator(ctx, { kind: "br", cond: lhs, thenBlock: trueLabel, elseBlock: rhsLabel });

  // True path: store true
  sealCurrentBlock(ctx);
  startBlock(ctx, trueLabel);
  const trueVal = freshVar(ctx);
  emit(ctx, { kind: "const_bool", dest: trueVal, value: true });
  emit(ctx, { kind: "store", ptr: resultPtr, value: trueVal });
  setTerminator(ctx, { kind: "jump", target: endLabel });

  // RHS path: evaluate rhs and store it
  sealCurrentBlock(ctx);
  startBlock(ctx, rhsLabel);
  const rhs = lowerExpr(ctx, expr.right);
  emit(ctx, { kind: "store", ptr: resultPtr, value: rhs });
  setTerminator(ctx, { kind: "jump", target: endLabel });

  // End: load result
  sealCurrentBlock(ctx);
  startBlock(ctx, endLabel);
  const dest = freshVar(ctx);
  emit(ctx, { kind: "load", dest, ptr: resultPtr, type: resultType });
  return dest;
}

export function lowerUnaryExpr(ctx: LoweringCtx, expr: UnaryExpr): VarId {
  // Check for operator overloading (e.g., -a → a.op_neg())
  const opMethod = ctx.checkResult.operatorMethods.get(expr);
  if (opMethod) {
    return lowerOperatorMethodCall(ctx, expr.operand, opMethod.methodName, opMethod.structType, []);
  }

  const operand = lowerExpr(ctx, expr.operand);
  const dest = freshVar(ctx);

  switch (expr.operator) {
    case "-": {
      const type = getExprKirType(ctx, expr);
      emit(ctx, { kind: "neg", dest, operand, type });
      return dest;
    }
    case "!":
      emit(ctx, { kind: "not", dest, operand });
      return dest;
    case "~": {
      const type = getExprKirType(ctx, expr);
      emit(ctx, { kind: "bit_not", dest, operand, type });
      return dest;
    }
    default:
      return operand;
  }
}

/**
 * Emit a method call for an overloaded operator.
 * Lowers `self` and `args`, then emits: call StructName_methodName(self, ...args)
 */
export function lowerOperatorMethodCall(
  ctx: LoweringCtx,
  selfExpr: Expression,
  methodName: string,
  structType: StructType,
  argExprs: Expression[]
): VarId {
  // Methods take self and args as pointers, so get alloc pointers, not loaded values
  const selfId = lowerExprAsPtr(ctx, selfExpr);
  const args = argExprs.map((a) => {
    const argType = ctx.checkResult.typeMap.get(a);
    if (argType?.kind === "struct") {
      return lowerExprAsPtr(ctx, a);
    }
    return lowerExpr(ctx, a);
  });

  const funcName = `${structType.name}_${methodName}`;

  // Look up the method's return type
  const method = structType.methods.get(methodName);
  if (method && method.returnType.kind !== "void") {
    const resultType = lowerCheckerType(ctx, method.returnType);
    const dest = freshVar(ctx);
    emit(ctx, { kind: "call", dest, func: funcName, args: [selfId, ...args], type: resultType });

    // Struct return values are handled by the caller (variable assignment stores into alloc)

    return dest;
  }

  // Void return
  emit(ctx, { kind: "call_void", func: funcName, args: [selfId, ...args] });
  return selfId;
}
