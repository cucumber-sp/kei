/**
 * Type-checks statements.
 */

import type {
  AssertStmt,
  BlockStmt,
  BreakStmt,
  ConstStmt,
  ContinueStmt,
  DeferStmt,
  ExprStmt,
  ForStmt,
  IfStmt,
  LetStmt,
  RequireStmt,
  ReturnStmt,
  Statement,
  SwitchStmt,
  UnsafeBlock,
  WhileStmt,
} from "../ast/nodes.ts";
import type { Checker } from "./checker.ts";
import type { Type } from "./types.ts";
import {
  ERROR_TYPE,
  extractLiteralInfo,
  I32_TYPE,
  isAssignableTo,
  isErrorType,
  isLiteralAssignableTo,
  TypeKind,
  typeToString,
} from "./types.ts";

export class StatementChecker {
  private checker: Checker;

  constructor(checker: Checker) {
    this.checker = checker;
  }

  /** Check a statement. Returns true if the statement always returns. */
  checkStatement(stmt: Statement): boolean {
    switch (stmt.kind) {
      case "BlockStmt":
        return this.checkBlockStatement(stmt);
      case "LetStmt":
        return this.checkLetStatement(stmt);
      case "ConstStmt":
        return this.checkConstStatement(stmt);
      case "ReturnStmt":
        return this.checkReturnStatement(stmt);
      case "IfStmt":
        return this.checkIfStatement(stmt);
      case "WhileStmt":
        return this.checkWhileStatement(stmt);
      case "ForStmt":
        return this.checkForStatement(stmt);
      case "SwitchStmt":
        return this.checkSwitchStatement(stmt);
      case "DeferStmt":
        return this.checkDeferStatement(stmt);
      case "BreakStmt":
        return this.checkBreakStatement(stmt);
      case "ContinueStmt":
        return this.checkContinueStatement(stmt);
      case "ExprStmt":
        return this.checkExpressionStatement(stmt);
      case "AssertStmt":
        return this.checkAssertStatement(stmt);
      case "RequireStmt":
        return this.checkRequireStatement(stmt);
      case "UnsafeBlock":
        return this.checkUnsafeBlock(stmt);
    }
  }

  checkBlockStatement(stmt: BlockStmt): boolean {
    this.checker.pushScope({});
    let returns = false;
    for (const s of stmt.statements) {
      if (returns) {
        this.checker.warning("unreachable code after return", s.span);
        break;
      }
      returns = this.checkStatement(s);
    }
    this.checker.popScope();
    return returns;
  }

  private checkLetStatement(stmt: LetStmt): boolean {
    const initType = this.checker.checkExpression(stmt.initializer);

    if (stmt.typeAnnotation) {
      const annotatedType = this.checker.resolveType(stmt.typeAnnotation);
      if (
        !isErrorType(initType) &&
        !isErrorType(annotatedType) &&
        !isAssignableTo(initType, annotatedType)
      ) {
        // Check if this is a literal that can be implicitly converted
        const litInfo = extractLiteralInfo(stmt.initializer);
        const isLiteralOk = litInfo && isLiteralAssignableTo(litInfo.kind, litInfo.value, annotatedType);
        if (!isLiteralOk) {
          this.checker.error(
            `type mismatch: expected '${typeToString(annotatedType)}', got '${typeToString(initType)}'`,
            stmt.span
          );
        }
      }
      this.checker.defineVariable(stmt.name, annotatedType, true, false, stmt.span);
    } else {
      // Infer type from initializer
      this.checker.defineVariable(stmt.name, initType, true, false, stmt.span);
    }

    return false;
  }

  private checkConstStatement(stmt: ConstStmt): boolean {
    const initType = this.checker.checkExpression(stmt.initializer);

    if (stmt.typeAnnotation) {
      const annotatedType = this.checker.resolveType(stmt.typeAnnotation);
      if (
        !isErrorType(initType) &&
        !isErrorType(annotatedType) &&
        !isAssignableTo(initType, annotatedType)
      ) {
        // Check if this is a literal that can be implicitly converted
        const litInfo = extractLiteralInfo(stmt.initializer);
        const isLiteralOk = litInfo && isLiteralAssignableTo(litInfo.kind, litInfo.value, annotatedType);
        if (!isLiteralOk) {
          this.checker.error(
            `type mismatch: expected '${typeToString(annotatedType)}', got '${typeToString(initType)}'`,
            stmt.span
          );
        }
      }
      this.checker.defineVariable(stmt.name, annotatedType, false, true, stmt.span);
    } else {
      this.checker.defineVariable(stmt.name, initType, false, true, stmt.span);
    }

    return false;
  }

  private checkReturnStatement(stmt: ReturnStmt): boolean {
    const enclosingFn = this.checker.currentScope.getEnclosingFunction();

    if (!enclosingFn) {
      this.checker.error("'return' used outside of a function", stmt.span);
      return true;
    }

    if (stmt.value) {
      const valueType = this.checker.checkExpression(stmt.value);
      if (!isErrorType(valueType)) {
        if (enclosingFn.returnType.kind === TypeKind.Void) {
          this.checker.error(
            `function expects return type 'void', got '${typeToString(valueType)}'`,
            stmt.span
          );
        } else if (!isAssignableTo(valueType, enclosingFn.returnType)) {
          // Check if this is a literal that can be implicitly converted
          const litInfo = extractLiteralInfo(stmt.value);
          const isLiteralOk = litInfo && isLiteralAssignableTo(litInfo.kind, litInfo.value, enclosingFn.returnType);
          if (!isLiteralOk) {
            this.checker.error(
              `return type mismatch: expected '${typeToString(enclosingFn.returnType)}', got '${typeToString(valueType)}'`,
              stmt.span
            );
          }
        }
      }
    } else if (enclosingFn.returnType.kind !== TypeKind.Void) {
      this.checker.error(
        `function expects return type '${typeToString(enclosingFn.returnType)}', got void`,
        stmt.span
      );
    }

    return true;
  }

  private checkIfStatement(stmt: IfStmt): boolean {
    const condType = this.checker.checkExpression(stmt.condition);
    if (!isErrorType(condType) && condType.kind !== TypeKind.Bool) {
      this.checker.error(
        `if condition must be bool, got '${typeToString(condType)}'`,
        stmt.condition.span
      );
    }

    this.checker.pushScope({});
    let thenReturns = false;
    for (const s of stmt.thenBlock.statements) {
      if (thenReturns) {
        this.checker.warning("unreachable code after return", s.span);
        break;
      }
      thenReturns = this.checkStatement(s);
    }
    this.checker.popScope();

    let elseReturns = false;
    if (stmt.elseBlock) {
      if (stmt.elseBlock.kind === "IfStmt") {
        elseReturns = this.checkIfStatement(stmt.elseBlock);
      } else {
        this.checker.pushScope({});
        for (const s of stmt.elseBlock.statements) {
          if (elseReturns) {
            this.checker.warning("unreachable code after return", s.span);
            break;
          }
          elseReturns = this.checkStatement(s);
        }
        this.checker.popScope();
      }
    }

    // Both branches must return for the if to be considered as returning
    return thenReturns && elseReturns;
  }

  private checkWhileStatement(stmt: WhileStmt): boolean {
    const condType = this.checker.checkExpression(stmt.condition);
    if (!isErrorType(condType) && condType.kind !== TypeKind.Bool) {
      this.checker.error(
        `while condition must be bool, got '${typeToString(condType)}'`,
        stmt.condition.span
      );
    }

    this.checker.pushScope({ isLoop: true });
    let bodyDiverges = false;
    for (const s of stmt.body.statements) {
      if (bodyDiverges) {
        this.checker.warning("unreachable code after return", s.span);
        break;
      }
      bodyDiverges = this.checkStatement(s);
    }
    this.checker.popScope();

    // While loops may not execute, so they don't guarantee a return
    return false;
  }

  private checkForStatement(stmt: ForStmt): boolean {
    const iterableType = this.checker.checkExpression(stmt.iterable);

    this.checker.pushScope({ isLoop: true });

    if (!isErrorType(iterableType)) {
      let elementType: Type = ERROR_TYPE;

      if (iterableType.kind === TypeKind.Array || iterableType.kind === TypeKind.Slice) {
        elementType = iterableType.element;
      } else if (iterableType.kind === TypeKind.Range) {
        elementType = iterableType.element;
      } else {
        this.checker.error(
          `cannot iterate over type '${typeToString(iterableType)}'`,
          stmt.iterable.span
        );
      }

      // Define loop variable
      this.checker.defineVariable(stmt.variable, elementType, true, false, stmt.span);

      // Define index variable if present
      if (stmt.index) {
        this.checker.defineVariable(stmt.index, I32_TYPE, true, false, stmt.span);
      }
    }

    let bodyDiverges = false;
    for (const s of stmt.body.statements) {
      if (bodyDiverges) {
        this.checker.warning("unreachable code after return", s.span);
        break;
      }
      bodyDiverges = this.checkStatement(s);
    }
    this.checker.popScope();

    return false;
  }

  private checkSwitchStatement(stmt: SwitchStmt): boolean {
    const subjectType = this.checker.checkExpression(stmt.subject);
    let allCasesReturn = true;
    let hasDefault = false;

    for (const switchCase of stmt.cases) {
      if (switchCase.isDefault) {
        hasDefault = true;
      } else {
        // Check case values match subject type
        for (const value of switchCase.values) {
          // For enum subjects, check variant names directly
          if (subjectType.kind === TypeKind.Enum && value.kind === "Identifier") {
            const variant = subjectType.variants.find((v) => v.name === value.name);
            if (!variant) {
              this.checker.error(
                `enum '${subjectType.name}' has no variant '${value.name}'`,
                value.span
              );
            }
          } else {
            const valueType = this.checker.checkExpression(value);
            if (!isErrorType(valueType) && !isErrorType(subjectType)) {
              if (!isAssignableTo(valueType, subjectType)) {
                this.checker.error(
                  `case value type '${typeToString(valueType)}' does not match switch subject type '${typeToString(subjectType)}'`,
                  value.span
                );
              }
            }
          }
        }
      }

      // Check case body
      this.checker.pushScope({});
      let caseReturns = false;
      for (const s of switchCase.body) {
        if (caseReturns) {
          this.checker.warning("unreachable code after return", s.span);
          break;
        }
        caseReturns = this.checkStatement(s);
      }
      this.checker.popScope();

      if (!caseReturns) {
        allCasesReturn = false;
      }
    }

    // Check enum exhaustiveness
    let isExhaustiveEnum = false;
    if (subjectType.kind === TypeKind.Enum && !hasDefault) {
      const coveredVariants = new Set<string>();
      for (const switchCase of stmt.cases) {
        if (!switchCase.isDefault) {
          for (const value of switchCase.values) {
            if (value.kind === "Identifier") {
              coveredVariants.add(value.name);
            }
          }
        }
      }

      const uncovered = subjectType.variants.filter((v) => !coveredVariants.has(v.name));
      if (uncovered.length > 0) {
        const names = uncovered.map((v) => v.name).join(", ");
        this.checker.error(
          `switch on enum '${subjectType.name}' is not exhaustive, missing: ${names}`,
          stmt.span
        );
      } else {
        isExhaustiveEnum = true;
      }
    }

    return allCasesReturn && (hasDefault || isExhaustiveEnum);
  }

  private checkDeferStatement(stmt: DeferStmt): boolean {
    this.checkStatement(stmt.statement);
    return false;
  }

  private checkBreakStatement(stmt: BreakStmt): boolean {
    if (!this.checker.currentScope.isInsideLoop()) {
      this.checker.error("'break' used outside of a loop", stmt.span);
    }
    return true;
  }

  private checkContinueStatement(stmt: ContinueStmt): boolean {
    if (!this.checker.currentScope.isInsideLoop()) {
      this.checker.error("'continue' used outside of a loop", stmt.span);
    }
    return true;
  }

  private checkExpressionStatement(stmt: ExprStmt): boolean {
    this.checker.checkExpression(stmt.expression);
    // A throw expression always diverges (never returns normally)
    if (stmt.expression.kind === "ThrowExpr") {
      return true;
    }
    return false;
  }

  private checkAssertStatement(stmt: AssertStmt): boolean {
    const condType = this.checker.checkExpression(stmt.condition);
    if (!isErrorType(condType) && condType.kind !== TypeKind.Bool) {
      this.checker.error(
        `assert condition must be bool, got '${typeToString(condType)}'`,
        stmt.condition.span
      );
    }

    if (stmt.message) {
      const msgType = this.checker.checkExpression(stmt.message);
      if (!isErrorType(msgType) && msgType.kind !== TypeKind.String) {
        this.checker.error(
          `assert message must be string, got '${typeToString(msgType)}'`,
          stmt.message.span
        );
      }
    }

    return false;
  }

  private checkRequireStatement(stmt: RequireStmt): boolean {
    const condType = this.checker.checkExpression(stmt.condition);
    if (!isErrorType(condType) && condType.kind !== TypeKind.Bool) {
      this.checker.error(
        `require condition must be bool, got '${typeToString(condType)}'`,
        stmt.condition.span
      );
    }

    if (stmt.message) {
      const msgType = this.checker.checkExpression(stmt.message);
      if (!isErrorType(msgType) && msgType.kind !== TypeKind.String) {
        this.checker.error(
          `require message must be string, got '${typeToString(msgType)}'`,
          stmt.message.span
        );
      }
    }

    return false;
  }

  private checkUnsafeBlock(stmt: UnsafeBlock): boolean {
    this.checker.pushScope({ isUnsafe: true });
    let returns = false;
    for (const s of stmt.body.statements) {
      if (returns) {
        this.checker.warning("unreachable code after return", s.span);
        break;
      }
      returns = this.checkStatement(s);
    }
    this.checker.popScope();
    return returns;
  }
}
