/**
 * Type-checks binary, unary, assignment, increment, and decrement expressions,
 * including operator overloading resolution.
 */

import type {
  AssignExpr,
  BinaryExpr,
  DecrementExpr,
  Expression,
  IncrementExpr,
  UnaryExpr,
} from "../ast/nodes.ts";
import type { Checker } from "./checker.ts";
import { SymbolKind } from "./symbols.ts";
import type { FunctionType, StructType, Type } from "./types";
import {
  BOOL_TYPE,
  ERROR_TYPE,
  extractLiteralInfo,
  isAssignableTo,
  isErrorType,
  isIntegerType,
  isLiteralAssignableTo,
  isNumericType,
  isPtrType,
  ptrType,
  STRING_TYPE,
  TypeKind,
  typesEqual,
  typeToString,
} from "./types";

/** Report an error if left and right types are not equal. Returns false if they differ. */
function requireSameTypes(
  checker: Checker,
  op: string,
  left: Type,
  right: Type,
  span: { start: number; end: number }
): boolean {
  if (!typesEqual(left, right)) {
    checker.error(
      `operator '${op}' requires same types, got '${typeToString(left)}' and '${typeToString(right)}'`,
      span
    );
    return false;
  }
  return true;
}

const ARITHMETIC_OPS = new Set(["+", "-", "*", "/", "%"]);
const COMPARISON_OPS = new Set(["<", ">", "<=", ">="]);
const EQUALITY_OPS = new Set(["==", "!="]);
const LOGICAL_OPS = new Set(["&&", "||"]);
const BITWISE_OPS = new Set(["&", "|", "^", "<<", ">>"]);
const COMPOUND_ASSIGN_OPS = new Set(["+=", "-=", "*=", "/=", "%="]);
const COMPOUND_BITWISE_OPS = new Set(["&=", "|=", "^=", "<<=", ">>="]);

/** Maps binary operators to their corresponding operator method names on structs. */
export const BINARY_OP_METHODS: Record<string, string> = {
  "+": "op_add",
  "-": "op_sub",
  "*": "op_mul",
  "/": "op_div",
  "%": "op_mod",
  "==": "op_eq",
  "!=": "op_neq",
  "<": "op_lt",
  ">": "op_gt",
  "<=": "op_le",
  ">=": "op_ge",
};

export function checkBinaryExpression(checker: Checker, expr: BinaryExpr): Type {
  const left = checker.checkExpression(expr.left);
  const right = checker.checkExpression(expr.right);

  if (isErrorType(left) || isErrorType(right)) return ERROR_TYPE;

  const op = expr.operator;

  // String concatenation
  if (op === "+" && left.kind === TypeKind.String && right.kind === TypeKind.String) {
    return STRING_TYPE;
  }

  // Operator overloading: if left operand is a struct, look for operator method
  const opMethodName = BINARY_OP_METHODS[op];
  if (opMethodName && left.kind === TypeKind.Struct) {
    const method = left.methods.get(opMethodName);
    if (method) {
      return resolveOperatorMethod(checker, expr, left, method, opMethodName, right);
    }
  }

  // Arithmetic operators
  if (ARITHMETIC_OPS.has(op)) {
    if (!isNumericType(left)) {
      checker.error(
        `operator '${op}' requires numeric operands, got '${typeToString(left)}'`,
        expr.span
      );
      return ERROR_TYPE;
    }
    if (!requireSameTypes(checker, op, left, right, expr.span)) return ERROR_TYPE;
    return left;
  }

  // Comparison operators
  if (COMPARISON_OPS.has(op)) {
    if (!isNumericType(left)) {
      checker.error(
        `operator '${op}' requires numeric operands, got '${typeToString(left)}'`,
        expr.span
      );
      return ERROR_TYPE;
    }
    if (!requireSameTypes(checker, op, left, right, expr.span)) return ERROR_TYPE;
    return BOOL_TYPE;
  }

  // Equality operators
  if (EQUALITY_OPS.has(op)) {
    // Allow equality between same types, or ptr and null
    if (
      !typesEqual(left, right) &&
      !(isPtrType(left) && right.kind === TypeKind.Null) &&
      !(left.kind === TypeKind.Null && isPtrType(right))
    ) {
      checker.error(
        `operator '${op}' requires same types, got '${typeToString(left)}' and '${typeToString(right)}'`,
        expr.span
      );
      return ERROR_TYPE;
    }
    return BOOL_TYPE;
  }

  // Logical operators
  if (LOGICAL_OPS.has(op)) {
    if (left.kind !== TypeKind.Bool) {
      checker.error(
        `operator '${op}' requires bool operands, got '${typeToString(left)}'`,
        expr.span
      );
      return ERROR_TYPE;
    }
    if (right.kind !== TypeKind.Bool) {
      checker.error(
        `operator '${op}' requires bool operands, got '${typeToString(right)}'`,
        expr.span
      );
      return ERROR_TYPE;
    }
    return BOOL_TYPE;
  }

  // Bitwise operators
  if (BITWISE_OPS.has(op)) {
    if (!isIntegerType(left)) {
      checker.error(
        `operator '${op}' requires integer operands, got '${typeToString(left)}'`,
        expr.span
      );
      return ERROR_TYPE;
    }
    if (!requireSameTypes(checker, op, left, right, expr.span)) return ERROR_TYPE;
    return left;
  }

  checker.error(`unknown binary operator '${op}'`, expr.span);
  return ERROR_TYPE;
}

export function checkUnaryExpression(checker: Checker, expr: UnaryExpr): Type {
  const operand = checker.checkExpression(expr.operand);
  if (isErrorType(operand)) return ERROR_TYPE;

  switch (expr.operator) {
    case "-":
      // Operator overloading: unary minus on struct → op_neg
      if (operand.kind === TypeKind.Struct) {
        const method = operand.methods.get("op_neg");
        if (method) {
          // op_neg takes only self, no extra args
          if (method.params.length !== 1) {
            checker.error(
              `'op_neg' method must take exactly 1 parameter (self), got ${method.params.length}`,
              expr.span
            );
            return ERROR_TYPE;
          }
          checker.operatorMethods.set(expr, { methodName: "op_neg", structType: operand });
          return method.returnType;
        }
        checker.error(
          `unary '-' requires numeric operand, got '${typeToString(operand)}'`,
          expr.span
        );
        return ERROR_TYPE;
      }
      if (!isNumericType(operand)) {
        checker.error(
          `unary '-' requires numeric operand, got '${typeToString(operand)}'`,
          expr.span
        );
        return ERROR_TYPE;
      }
      return operand;

    case "!":
      if (operand.kind !== TypeKind.Bool) {
        checker.error(`unary '!' requires bool operand, got '${typeToString(operand)}'`, expr.span);
        return ERROR_TYPE;
      }
      return BOOL_TYPE;

    case "~":
      if (!isIntegerType(operand)) {
        checker.error(
          `unary '~' requires integer operand, got '${typeToString(operand)}'`,
          expr.span
        );
        return ERROR_TYPE;
      }
      return operand;

    case "&":
      if (!checker.currentScope.isInsideUnsafe()) {
        checker.error("address-of operator '&' requires unsafe block", expr.span);
        return ERROR_TYPE;
      }
      return ptrType(operand);

    default:
      checker.error(`unknown unary operator '${expr.operator}'`, expr.span);
      return ERROR_TYPE;
  }
}

export function checkAssignExpression(checker: Checker, expr: AssignExpr): Type {
  const targetType = checker.checkExpression(expr.target);
  const valueType = checker.checkExpression(expr.value);

  if (isErrorType(targetType) || isErrorType(valueType)) return ERROR_TYPE;

  // Check mutability
  checkAssignTarget(checker, expr.target);

  const op = expr.operator;

  if (op === "=") {
    // Operator overloading: a[i] = v → op_index_set(self, index, value)
    if (expr.target.kind === "IndexExpr") {
      const indexExpr = expr.target;
      const objectType = checker.typeMap.get(indexExpr.object);
      if (objectType && objectType.kind === TypeKind.Struct) {
        const method = objectType.methods.get("op_index_set");
        if (method) {
          // op_index_set takes self + index + value (3 params)
          if (method.params.length !== 3) {
            checker.error(
              `'op_index_set' method must take exactly 3 parameters (self, index, value), got ${method.params.length}`,
              expr.span
            );
            return ERROR_TYPE;
          }
          const indexType = checker.typeMap.get(indexExpr.index);
          // biome-ignore lint/style/noNonNullAssertion: params.length === 3 is checked above, so index 1 is guaranteed
          const indexParam = method.params[1]!;
          if (indexType && !isAssignableTo(indexType, indexParam.type)) {
            checker.error(
              `index type mismatch: expected '${typeToString(indexParam.type)}', got '${typeToString(indexType)}'`,
              expr.span
            );
            return ERROR_TYPE;
          }
          // biome-ignore lint/style/noNonNullAssertion: params.length === 3 is checked above, so index 2 is guaranteed
          const valueParam = method.params[2]!;
          if (!isAssignableTo(valueType, valueParam.type)) {
            checker.error(
              `value type mismatch: expected '${typeToString(valueParam.type)}', got '${typeToString(valueType)}'`,
              expr.span
            );
            return ERROR_TYPE;
          }
          checker.operatorMethods.set(expr, { methodName: "op_index_set", structType: objectType });
          return method.returnType;
        }
      }
    }

    if (!isAssignableTo(valueType, targetType)) {
      // Check if this is a literal that can be implicitly converted
      const litInfo = extractLiteralInfo(expr.value);
      const isLiteralOk = litInfo && isLiteralAssignableTo(litInfo.kind, litInfo.value, targetType);
      if (!isLiteralOk) {
        checker.error(
          `type mismatch: expected '${typeToString(targetType)}', got '${typeToString(valueType)}'`,
          expr.span
        );
        return ERROR_TYPE;
      }
    }
    return targetType;
  }

  // Compound assignment
  if (COMPOUND_ASSIGN_OPS.has(op)) {
    if (!isNumericType(targetType)) {
      checker.error(
        `operator '${op}' requires numeric type, got '${typeToString(targetType)}'`,
        expr.span
      );
      return ERROR_TYPE;
    }
    if (!requireSameTypes(checker, op, targetType, valueType, expr.span)) return ERROR_TYPE;
    return targetType;
  }

  if (COMPOUND_BITWISE_OPS.has(op)) {
    if (!isIntegerType(targetType)) {
      checker.error(
        `operator '${op}' requires integer type, got '${typeToString(targetType)}'`,
        expr.span
      );
      return ERROR_TYPE;
    }
    if (!requireSameTypes(checker, op, targetType, valueType, expr.span)) return ERROR_TYPE;
    return targetType;
  }

  checker.error(`unknown assignment operator '${op}'`, expr.span);
  return ERROR_TYPE;
}

function checkAssignTarget(checker: Checker, target: Expression): void {
  if (target.kind === "Identifier") {
    const sym = checker.currentScope.lookup(target.name);
    if (sym && sym.kind === SymbolKind.Variable) {
      if (!sym.isMutable) {
        checker.error(`cannot assign to immutable variable '${target.name}'`, target.span);
      }
    }
  }
  // MemberExpr and IndexExpr and DerefExpr — check the root object is mutable
  if (target.kind === "MemberExpr") {
    checkAssignTarget(checker, target.object);
  }
  if (target.kind === "DerefExpr") {
    // Deref assignment is allowed in unsafe
    if (!checker.currentScope.isInsideUnsafe()) {
      checker.error("pointer dereference assignment requires unsafe block", target.span);
    }
  }
}

export function checkIncrementExpression(checker: Checker, expr: IncrementExpr): Type {
  const operandType = checker.checkExpression(expr.operand);
  if (isErrorType(operandType)) return ERROR_TYPE;

  if (!isIntegerType(operandType)) {
    checker.error(
      `increment operator requires integer type, got '${typeToString(operandType)}'`,
      expr.span
    );
    return ERROR_TYPE;
  }

  checkAssignTarget(checker, expr.operand);
  return operandType;
}

export function checkDecrementExpression(checker: Checker, expr: DecrementExpr): Type {
  const operandType = checker.checkExpression(expr.operand);
  if (isErrorType(operandType)) return ERROR_TYPE;

  if (!isIntegerType(operandType)) {
    checker.error(
      `decrement operator requires integer type, got '${typeToString(operandType)}'`,
      expr.span
    );
    return ERROR_TYPE;
  }

  checkAssignTarget(checker, expr.operand);
  return operandType;
}

/**
 * Resolve a binary operator overload method call on a struct.
 * Validates the right operand against the method's second parameter,
 * records the resolution in operatorMethods, and returns the method's return type.
 */
function resolveOperatorMethod(
  checker: Checker,
  expr: Expression,
  structType: StructType,
  method: FunctionType,
  methodName: string,
  rightType: Type
): Type {
  // Operator method should have exactly 2 params: self + rhs
  if (method.params.length !== 2) {
    checker.error(
      `'${methodName}' method must take exactly 2 parameters (self, rhs), got ${method.params.length}`,
      expr.span
    );
    return ERROR_TYPE;
  }

  // biome-ignore lint/style/noNonNullAssertion: params.length === 2 is checked above, so index 1 is guaranteed
  const rhsParam = method.params[1]!;
  if (!isAssignableTo(rightType, rhsParam.type)) {
    checker.error(
      `operator method '${methodName}': expected '${typeToString(rhsParam.type)}' for right operand, got '${typeToString(rightType)}'`,
      expr.span
    );
    return ERROR_TYPE;
  }

  checker.operatorMethods.set(expr, { methodName, structType });
  return method.returnType;
}
