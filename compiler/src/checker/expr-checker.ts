/**
 * Type-checks expressions and returns their resolved type.
 */

import type {
  CastExpr,
  DerefExpr,
  Expression,
  GroupExpr,
  Identifier,
  IfExpr,
  IndexExpr,
  MemberExpr,
  MoveExpr,
  RangeExpr,
  UnsafeExpr,
} from "../ast/nodes.ts";
import type { Checker } from "./checker.ts";
import { checkCallExpression } from "./call-checker.ts";
import { checkCatchExpression, checkThrowExpression } from "./catch-checker.ts";
import {
  checkArrayLiteral,
  checkBoolLiteral,
  checkFloatLiteral,
  checkIntLiteral,
  checkNullLiteral,
  checkStringLiteral,
  checkStructLiteral,
} from "./literal-checker.ts";
import {
  checkAssignExpression,
  checkBinaryExpression,
  checkDecrementExpression,
  checkIncrementExpression,
  checkUnaryExpression,
} from "./operator-checker.ts";
import { SymbolKind } from "./symbols.ts";
import type { Type } from "./types";
import {
  ERROR_TYPE,
  isAssignableTo,
  isErrorType,
  isIntegerType,
  isNumericType,
  isPtrType,
  rangeType,
  STRING_TYPE,
  TypeKind,
  typesEqual,
  typeToString,
  USIZE_TYPE,
  VOID_TYPE,
  isBoolType,
} from "./types";

export class ExpressionChecker {
  private checker: Checker;

  constructor(checker: Checker) {
    this.checker = checker;
  }

  /** Type-check an expression and return its resolved type. */
  checkExpression(expr: Expression): Type {
    const type = this.checkExpressionInner(expr);
    this.checker.setExprType(expr, type);
    return type;
  }

  private checkExpressionInner(expr: Expression): Type {
    switch (expr.kind) {
      case "IntLiteral":
        return checkIntLiteral(expr);
      case "FloatLiteral":
        return checkFloatLiteral(expr);
      case "StringLiteral":
        return checkStringLiteral(expr);
      case "BoolLiteral":
        return checkBoolLiteral(expr);
      case "NullLiteral":
        return checkNullLiteral(expr);
      case "Identifier":
        return this.checkIdentifier(expr);
      case "BinaryExpr":
        return checkBinaryExpression(this.checker, expr);
      case "UnaryExpr":
        return checkUnaryExpression(this.checker, expr);
      case "CallExpr":
        return checkCallExpression(this.checker, expr);
      case "MemberExpr":
        return this.checkMemberExpression(expr);
      case "IndexExpr":
        return this.checkIndexExpression(expr);
      case "DerefExpr":
        return this.checkDerefExpression(expr);
      case "AssignExpr":
        return checkAssignExpression(this.checker, expr);
      case "StructLiteral":
        return checkStructLiteral(this.checker, expr);
      case "IfExpr":
        return this.checkIfExpression(expr);
      case "MoveExpr":
        return this.checkMoveExpression(expr);
      case "CatchExpr":
        return checkCatchExpression(this.checker, expr);
      case "ThrowExpr":
        return checkThrowExpression(this.checker, expr);
      case "GroupExpr":
        return this.checkGroupExpression(expr);
      case "IncrementExpr":
        return checkIncrementExpression(this.checker, expr);
      case "DecrementExpr":
        return checkDecrementExpression(this.checker, expr);
      case "RangeExpr":
        return this.checkRangeExpression(expr);
      case "UnsafeExpr":
        return this.checkUnsafeExpression(expr);
      case "CastExpr":
        return this.checkCastExpression(expr);
      case "ArrayLiteral":
        return checkArrayLiteral(this.checker, expr);
    }
  }

  private checkIdentifier(expr: Identifier): Type {
    const sym = this.checker.currentScope.lookup(expr.name);
    if (!sym) {
      this.checker.error(`undeclared variable '${expr.name}'`, expr.span);
      return ERROR_TYPE;
    }

    if (sym.kind === SymbolKind.Variable) {
      if (sym.isMoved) {
        this.checker.error(`use of moved variable '${expr.name}'`, expr.span);
        return ERROR_TYPE;
      }
      return sym.type;
    }

    if (sym.kind === SymbolKind.Function) {
      return sym.type;
    }

    if (sym.kind === SymbolKind.Type) {
      // Type used as value — this is for static method access like Type.method()
      return sym.type;
    }

    if (sym.kind === SymbolKind.Module) {
      return sym.type;
    }

    return ERROR_TYPE;
  }

  private checkMemberExpression(expr: MemberExpr): Type {
    const objectType = this.checkExpression(expr.object);
    if (isErrorType(objectType)) return ERROR_TYPE;

    // Module-qualified access: math.add, net.http.Server
    if (objectType.kind === TypeKind.Module) {
      const exportedType = objectType.exports.get(expr.property);
      if (exportedType) return exportedType;

      this.checker.error(
        `module '${objectType.name}' has no exported member '${expr.property}'`,
        expr.span
      );
      return ERROR_TYPE;
    }

    if (objectType.kind === TypeKind.Struct) {
      // Check fields first
      const fieldType = objectType.fields.get(expr.property);
      if (fieldType) return fieldType;

      // Check methods
      const methodType = objectType.methods.get(expr.property);
      if (methodType) return methodType;

      // Check if it's a type being used for static method access
      this.checker.error(
        `type '${objectType.name}' has no field or method '${expr.property}'`,
        expr.span
      );
      return ERROR_TYPE;
    }

    if (objectType.kind === TypeKind.Enum) {
      // Enum variant access
      const variant = objectType.variants.find((v) => v.name === expr.property);
      if (variant) {
        // For simple enums, the variant value is the enum type itself
        return objectType;
      }
      this.checker.error(`enum '${objectType.name}' has no variant '${expr.property}'`, expr.span);
      return ERROR_TYPE;
    }

    // Check for .len on array/slice/string
    if (expr.property === "len") {
      if (
        objectType.kind === TypeKind.Array ||
        objectType.kind === TypeKind.Slice ||
        objectType.kind === TypeKind.String
      ) {
        return USIZE_TYPE;
      }
    }

    this.checker.error(
      `type '${typeToString(objectType)}' has no property '${expr.property}'`,
      expr.span
    );
    return ERROR_TYPE;
  }

  private checkIndexExpression(expr: IndexExpr): Type {
    const objectType = this.checkExpression(expr.object);
    const indexType = this.checkExpression(expr.index);

    if (isErrorType(objectType) || isErrorType(indexType)) return ERROR_TYPE;

    // Operator overloading: struct with op_index
    if (objectType.kind === TypeKind.Struct) {
      const method = objectType.methods.get("op_index");
      if (method) {
        // op_index takes self + index param
        if (method.params.length !== 2) {
          this.checker.error(
            `'op_index' method must take exactly 2 parameters (self, index), got ${method.params.length}`,
            expr.span
          );
          return ERROR_TYPE;
        }
        const indexParam = method.params[1]!;
        if (!isAssignableTo(indexType, indexParam.type)) {
          this.checker.error(
            `index type mismatch: expected '${typeToString(indexParam.type)}', got '${typeToString(indexType)}'`,
            expr.span
          );
          return ERROR_TYPE;
        }
        this.checker.operatorMethods.set(expr, { methodName: "op_index", structType: objectType });
        return method.returnType;
      }
    }

    if (
      objectType.kind !== TypeKind.Array &&
      objectType.kind !== TypeKind.Slice &&
      objectType.kind !== TypeKind.String
    ) {
      this.checker.error(`cannot index type '${typeToString(objectType)}'`, expr.span);
      return ERROR_TYPE;
    }

    if (!isIntegerType(indexType)) {
      this.checker.error(
        `index must be an integer type, got '${typeToString(indexType)}'`,
        expr.span
      );
      return ERROR_TYPE;
    }

    if (objectType.kind === TypeKind.String) return STRING_TYPE;
    return objectType.element;
  }

  private checkDerefExpression(expr: DerefExpr): Type {
    if (!this.checker.currentScope.isInsideUnsafe()) {
      this.checker.error("pointer dereference requires unsafe block", expr.span);
      return ERROR_TYPE;
    }

    const operandType = this.checkExpression(expr.operand);
    if (isErrorType(operandType)) return ERROR_TYPE;

    if (!isPtrType(operandType)) {
      this.checker.error(
        `cannot dereference non-pointer type '${typeToString(operandType)}'`,
        expr.span
      );
      return ERROR_TYPE;
    }

    return operandType.pointee;
  }

  private checkIfExpression(expr: IfExpr): Type {
    const condType = this.checkExpression(expr.condition);
    if (!isErrorType(condType) && condType.kind !== TypeKind.Bool) {
      this.checker.error(
        `if expression condition must be bool, got '${typeToString(condType)}'`,
        expr.condition.span
      );
    }

    // Check both branches
    const thenType = this.checker.checkBlockExpressionType(expr.thenBlock);
    const elseType = this.checker.checkBlockExpressionType(expr.elseBlock);

    if (isErrorType(thenType) || isErrorType(elseType)) return ERROR_TYPE;

    if (!typesEqual(thenType, elseType)) {
      this.checker.error(
        `if expression branches have different types: '${typeToString(thenType)}' and '${typeToString(elseType)}'`,
        expr.span
      );
      return ERROR_TYPE;
    }

    return thenType;
  }

  private checkMoveExpression(expr: MoveExpr): Type {
    // Move operand must be a variable identifier
    if (expr.operand.kind !== "Identifier") {
      this.checker.error("'move' can only be applied to a variable", expr.span);
      return ERROR_TYPE;
    }

    const operandType = this.checkExpression(expr.operand);
    if (isErrorType(operandType)) return ERROR_TYPE;

    // Mark variable as moved
    this.checker.markVariableMoved(expr.operand.name);

    return operandType;
  }

  private checkGroupExpression(expr: GroupExpr): Type {
    return this.checkExpression(expr.expression);
  }

  private checkRangeExpression(expr: RangeExpr): Type {
    const startType = this.checkExpression(expr.start);
    const endType = this.checkExpression(expr.end);

    if (isErrorType(startType) || isErrorType(endType)) return ERROR_TYPE;

    if (!isIntegerType(startType)) {
      this.checker.error(
        `range start must be integer type, got '${typeToString(startType)}'`,
        expr.span
      );
      return ERROR_TYPE;
    }

    if (!typesEqual(startType, endType)) {
      this.checker.error(
        `range start and end must be same type, got '${typeToString(startType)}' and '${typeToString(endType)}'`,
        expr.span
      );
      return ERROR_TYPE;
    }

    return rangeType(startType);
  }

  private checkUnsafeExpression(expr: UnsafeExpr): Type {
    this.checker.pushScope({ isUnsafe: true });
    let lastType: Type = VOID_TYPE;

    for (const stmt of expr.body.statements) {
      if (stmt.kind === "ExprStmt") {
        lastType = this.checker.checkExpression(stmt.expression);
      } else {
        this.checker.checkStatement(stmt);
        lastType = VOID_TYPE;
      }
    }

    this.checker.popScope();
    return lastType;
  }

  private checkCastExpression(expr: CastExpr): Type {
    const operandType = this.checkExpression(expr.operand);
    if (isErrorType(operandType)) return ERROR_TYPE;

    const targetType = this.checker.resolveType(expr.targetType);
    if (isErrorType(targetType)) return ERROR_TYPE;

    // Same type → no-op, always allowed
    if (typesEqual(operandType, targetType)) return targetType;

    // numeric → numeric (int↔float, int↔int, float↔float)
    if (isNumericType(operandType) && isNumericType(targetType)) return targetType;

    // bool → int
    if (isBoolType(operandType) && isIntegerType(targetType)) return targetType;

    // ptr → ptr (unsafe only)
    if (isPtrType(operandType) && isPtrType(targetType)) {
      if (!this.checker.currentScope.isInsideUnsafe()) {
        this.checker.error("pointer cast requires unsafe block", expr.span);
        return ERROR_TYPE;
      }
      return targetType;
    }

    this.checker.error(
      `cannot cast '${typeToString(operandType)}' to '${typeToString(targetType)}'`,
      expr.span
    );
    return ERROR_TYPE;
  }
}
