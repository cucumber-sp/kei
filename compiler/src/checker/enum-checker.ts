/**
 * Type-checks enum declarations.
 */

import type { EnumDecl } from "../ast/nodes";
import type { Checker } from "./checker";
import { typeSymbol } from "./symbols";
import type { EnumType, EnumVariantInfo } from "./types";
import { isAssignableTo, isErrorType, isIntegerType, TypeKind, typeToString } from "./types";

export class EnumChecker {
  private checker: Checker;

  constructor(checker: Checker) {
    this.checker = checker;
  }

  // ─── Registration (Pass 1) ──────────────────────────────────────────────

  registerEnum(decl: EnumDecl): void {
    const baseType = decl.baseType ? this.checker.resolveType(decl.baseType) : null;

    // Check for duplicate variants
    const seenVariants = new Set<string>();
    for (const v of decl.variants) {
      if (seenVariants.has(v.name)) {
        this.checker.error(`duplicate variant '${v.name}' in enum '${decl.name}'`, v.span);
      }
      seenVariants.add(v.name);
    }

    // Push a temporary scope with the generic parameters so that
    // payload field types referencing them (e.g. `Some(value: T)`)
    // resolve to TypeParam rather than failing as undeclared.
    if (decl.genericParams.length > 0) {
      this.checker.pushScope({});
      for (const gp of decl.genericParams) {
        this.checker.currentScope.define(typeSymbol(gp, { kind: TypeKind.TypeParam, name: gp }));
      }
    }

    const variants: EnumVariantInfo[] = decl.variants.map((v) => ({
      name: v.name,
      fields: v.fields.map((f) => ({
        name: f.name,
        type: this.checker.resolveType(f.typeAnnotation),
      })),
      value: v.value && v.value.kind === "IntLiteral" ? v.value.value : null,
    }));

    if (decl.genericParams.length > 0) {
      this.checker.popScope();
    }

    const enumType: EnumType = {
      kind: TypeKind.Enum,
      name: decl.name,
      baseType,
      variants,
      genericParams: decl.genericParams,
      modulePrefix: this.checker.modulePrefix,
    };

    const sym = typeSymbol(decl.name, enumType, decl);
    if (!this.checker.currentScope.define(sym)) {
      this.checker.error(`duplicate declaration '${decl.name}'`, decl.span);
      return;
    }
  }

  // ─── Full Checking (Pass 2) ─────────────────────────────────────────────

  checkEnum(decl: EnumDecl): void {
    if (decl.baseType) {
      const baseType = this.checker.resolveType(decl.baseType);
      // Check variant values match base type
      for (const variant of decl.variants) {
        if (variant.value) {
          const valueType = this.checker.checkExpression(variant.value);
          if (!isErrorType(valueType) && !isErrorType(baseType)) {
            // Allow integer literal values for any integer base type
            // (e.g., literal 0 is i32 but enum base is u8)
            const bothIntegers = isIntegerType(valueType) && isIntegerType(baseType);
            if (!bothIntegers && !isAssignableTo(valueType, baseType)) {
              this.checker.error(
                `enum variant '${variant.name}' value type '${typeToString(valueType)}' does not match base type '${typeToString(baseType)}'`,
                variant.span
              );
            }
          }
        }
      }
    }
  }
}
