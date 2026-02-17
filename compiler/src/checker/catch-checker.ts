/**
 * Type-checks catch and throw expressions, including catch panic,
 * catch throw (propagation), and catch block with error type clauses.
 */

import type { CatchExpr, ThrowExpr } from "../ast/nodes.ts";
import type { Checker } from "./checker.ts";
import type { Type } from "./types.ts";
import {
  ERROR_TYPE,
  isErrorType,
  TypeKind,
  typesEqual,
  typeToString,
  VOID_TYPE,
} from "./types.ts";

export function checkCatchExpression(checker: Checker, expr: CatchExpr): Type {
  // The operand should be a function call that throws
  const operandType = checker.checkExpression(expr.operand);

  // Clear the throws flag since we're handling it with catch
  if (expr.operand.kind === "CallExpr") {
    checker.clearThrowsCall(expr.operand);
  }

  if (isErrorType(operandType)) return ERROR_TYPE;

  // Get the throws types from the function call
  const throwsInfo = checker.getThrowsInfo(expr.operand);

  if (expr.catchType === "panic") {
    // catch panic — always valid
    return operandType;
  }

  if (expr.catchType === "throw") {
    // catch throw — propagate errors to enclosing function
    const enclosingFn = checker.currentScope.getEnclosingFunction();
    if (!enclosingFn) {
      checker.error("cannot use 'catch throw' outside a function", expr.span);
      return ERROR_TYPE;
    }
    if (enclosingFn.throwsTypes.length === 0) {
      checker.error(
        "cannot use 'catch throw' — function does not declare 'throws'",
        expr.span
      );
      return ERROR_TYPE;
    }
    // Check that all thrown types are in the enclosing function's throws
    if (throwsInfo) {
      for (const thrownType of throwsInfo) {
        const canPropagate = enclosingFn.throwsTypes.some((t) => typesEqual(t, thrownType));
        if (!canPropagate) {
          checker.error(
            `cannot propagate error type '${typeToString(thrownType)}' — not in function's throws clause`,
            expr.span
          );
        }
      }
    }
    return operandType;
  }

  // catch { clauses } — block catch
  if (throwsInfo && throwsInfo.length > 0) {
    const handledTypes = new Set<string>();
    let hasDefault = false;

    for (const clause of expr.clauses) {
      if (clause.isDefault) {
        hasDefault = true;
        // Check clause body
        checker.pushScope({});
        if (clause.varName) {
          // Default clause var — type is the union of unhandled error types (use first for now)
          const unhandledTypes = throwsInfo.filter((t) => !handledTypes.has(typeToString(t)));
          const firstUnhandled = unhandledTypes[0];
          if (firstUnhandled) {
            checker.defineVariable(
              clause.varName,
              firstUnhandled,
              false,
              false,
              clause.span
            );
          }
        }
        for (const stmt of clause.body) {
          checker.checkStatement(stmt);
        }
        checker.popScope();
        continue;
      }

      // Named error type clause
      const errorTypeName = clause.errorType;
      const errorType = throwsInfo.find(
        (t) =>
          (t.kind === TypeKind.Struct && t.name === errorTypeName) ||
          typeToString(t) === errorTypeName
      );

      if (!errorType) {
        checker.error(
          `error type '${errorTypeName}' is not thrown by the callee`,
          clause.span
        );
        continue;
      }

      handledTypes.add(typeToString(errorType));

      // Check clause body with error variable in scope
      checker.pushScope({});
      if (clause.varName) {
        checker.defineVariable(clause.varName, errorType, false, false, clause.span);
      }
      for (const stmt of clause.body) {
        checker.checkStatement(stmt);
      }
      checker.popScope();
    }

    // Check exhaustiveness
    if (!hasDefault) {
      const unhandled = throwsInfo.filter((t) => !handledTypes.has(typeToString(t)));
      if (unhandled.length > 0) {
        const names = unhandled.map((t) => typeToString(t)).join(", ");
        checker.error(`unhandled error types: ${names}`, expr.span);
      }
    }
  }

  return operandType;
}

export function checkThrowExpression(checker: Checker, expr: ThrowExpr): Type {
  const valueType = checker.checkExpression(expr.value);
  if (isErrorType(valueType)) return ERROR_TYPE;

  const enclosingFn = checker.currentScope.getEnclosingFunction();
  if (!enclosingFn) {
    checker.error("'throw' used outside of a function", expr.span);
    return ERROR_TYPE;
  }

  if (enclosingFn.throwsTypes.length === 0) {
    checker.error("'throw' used in function that does not declare 'throws'", expr.span);
    return ERROR_TYPE;
  }

  // Check that the thrown type is one of the declared throws types
  const isValidThrowType = enclosingFn.throwsTypes.some((t) => typesEqual(t, valueType));
  if (!isValidThrowType) {
    checker.error(
      `error type '${typeToString(valueType)}' is not declared in function's throws clause`,
      expr.span
    );
    return ERROR_TYPE;
  }

  return VOID_TYPE;
}
