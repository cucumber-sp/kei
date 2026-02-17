/**
 * Operator expression lowering methods for KirLowerer.
 * Extracted from lowering-expr.ts for modularity.
 */

import type {
  StructType,
} from "../checker/types";
import type {
  Expression,
  BinaryExpr,
  UnaryExpr,
  IncrementExpr,
  DecrementExpr,
} from "../ast/nodes.ts";
import type {
  VarId,
} from "./kir-types.ts";
import type { KirLowerer } from "./lowering.ts";

export function lowerBinaryExpr(this: KirLowerer, expr: BinaryExpr): VarId {
  // Check for operator overloading
  const opMethod = this.checkResult.operatorMethods.get(expr);
  if (opMethod) {
    return this.lowerOperatorMethodCall(expr.left, opMethod.methodName, opMethod.structType, [expr.right]);
  }

  // Short-circuit for logical AND/OR
  if (expr.operator === "&&") {
    return this.lowerShortCircuitAnd(expr);
  }
  if (expr.operator === "||") {
    return this.lowerShortCircuitOr(expr);
  }

  const lhs = this.lowerExpr(expr.left);
  const rhs = this.lowerExpr(expr.right);
  const dest = this.freshVar();

  const op = this.mapBinOp(expr.operator);
  if (op) {
    const type = this.getExprKirType(expr);
    // For string equality/inequality, pass operandType so the C emitter knows
    const leftCheckerType = this.checkResult.typeMap.get(expr.left);
    if (leftCheckerType?.kind === "string" && (op === "eq" || op === "neq")) {
      this.emit({ kind: "bin_op", op, dest, lhs, rhs, type, operandType: { kind: "string" } });
    } else {
      this.emit({ kind: "bin_op", op, dest, lhs, rhs, type });
    }
    return dest;
  }

  // Fallback
  return lhs;
}

export function lowerShortCircuitAnd(this: KirLowerer, expr: BinaryExpr): VarId {
  const lhs = this.lowerExpr(expr.left);
  const rhsLabel = this.freshBlockId("and.rhs");
  const endLabel = this.freshBlockId("and.end");

  this.setTerminator({ kind: "br", cond: lhs, thenBlock: rhsLabel, elseBlock: endLabel });

  this.sealCurrentBlock();
  this.startBlock(rhsLabel);
  const rhs = this.lowerExpr(expr.right);
  this.setTerminator({ kind: "jump", target: endLabel });

  this.sealCurrentBlock();
  this.startBlock(endLabel);

  // Without phi nodes, we use a stack_alloc + stores approach
  // For simplicity, just return rhs (correct when both paths converge)
  // In full SSA this would be a phi node
  return rhs;
}

export function lowerShortCircuitOr(this: KirLowerer, expr: BinaryExpr): VarId {
  const lhs = this.lowerExpr(expr.left);
  const rhsLabel = this.freshBlockId("or.rhs");
  const endLabel = this.freshBlockId("or.end");

  this.setTerminator({ kind: "br", cond: lhs, thenBlock: endLabel, elseBlock: rhsLabel });

  this.sealCurrentBlock();
  this.startBlock(rhsLabel);
  const rhs = this.lowerExpr(expr.right);
  this.setTerminator({ kind: "jump", target: endLabel });

  this.sealCurrentBlock();
  this.startBlock(endLabel);

  return lhs;
}

export function lowerUnaryExpr(this: KirLowerer, expr: UnaryExpr): VarId {
  // Check for operator overloading (e.g., -a → a.op_neg())
  const opMethod = this.checkResult.operatorMethods.get(expr);
  if (opMethod) {
    return this.lowerOperatorMethodCall(expr.operand, opMethod.methodName, opMethod.structType, []);
  }

  const operand = this.lowerExpr(expr.operand);
  const dest = this.freshVar();

  switch (expr.operator) {
    case "-": {
      const type = this.getExprKirType(expr);
      this.emit({ kind: "neg", dest, operand, type });
      return dest;
    }
    case "!":
      this.emit({ kind: "not", dest, operand });
      return dest;
    case "~": {
      const type = this.getExprKirType(expr);
      this.emit({ kind: "bit_not", dest, operand, type });
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
  this: KirLowerer,
  selfExpr: Expression,
  methodName: string,
  structType: StructType,
  argExprs: Expression[],
): VarId {
  // Methods take self and args as pointers, so get alloc pointers, not loaded values
  const selfId = this.lowerExprAsPtr(selfExpr);
  const args = argExprs.map(a => {
    const argType = this.checkResult.typeMap.get(a);
    if (argType?.kind === "struct") {
      return this.lowerExprAsPtr(a);
    }
    return this.lowerExpr(a);
  });

  const funcName = `${structType.name}_${methodName}`;

  // Look up the method's return type
  const method = structType.methods.get(methodName);
  if (method && method.returnType.kind !== "void") {
    const resultType = this.lowerCheckerType(method.returnType);
    const dest = this.freshVar();
    this.emit({ kind: "call", dest, func: funcName, args: [selfId, ...args], type: resultType });

    // Struct return values are handled by the caller (variable assignment stores into alloc)

    return dest;
  }

  // Void return
  this.emit({ kind: "call_void", func: funcName, args: [selfId, ...args] });
  return selfId;
}

export function lowerIncrementExpr(this: KirLowerer, expr: IncrementExpr): VarId {
  if (expr.operand.kind === "Identifier") {
    const ptrId = this.varMap.get(expr.operand.name);
    if (ptrId) {
      const type = this.getExprKirType(expr.operand);
      const oneId = this.emitConstInt(1);
      return this.emitLoadModifyStore(ptrId, "add", oneId, type); // post-increment: returns old value
    }
  }
  return this.emitConstInt(0);
}

export function lowerDecrementExpr(this: KirLowerer, expr: DecrementExpr): VarId {
  if (expr.operand.kind === "Identifier") {
    const ptrId = this.varMap.get(expr.operand.name);
    if (ptrId) {
      const type = this.getExprKirType(expr.operand);
      const oneId = this.emitConstInt(1);
      return this.emitLoadModifyStore(ptrId, "sub", oneId, type); // post-decrement: returns old value
    }
  }
  return this.emitConstInt(0);
}
