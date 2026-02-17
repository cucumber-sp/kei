/**
 * Enum lowering methods for KirLowerer.
 * Extracted from lowering-expr.ts for modularity.
 *
 * Handles:
 *   - Enum data variant construction: Shape.Circle(3.14) → stack_alloc + tag + data fields
 *   - Enum variant member access: Color.Red → integer discriminant or tagged union struct
 */

import type { CallExpr, MemberExpr } from "../ast/nodes.ts";
import type { KirType, VarId } from "./kir-types.ts";
import type { KirLowerer } from "./lowering.ts";

/**
 * Lower an enum data variant construction call: Shape.Circle(3.14)
 * Returns the VarId of the constructed tagged union, or null if expr is not an enum construction.
 */
export function lowerEnumVariantConstruction(this: KirLowerer, expr: CallExpr): VarId | null {
  if (expr.callee.kind !== "MemberExpr") return null;

  const calleeType = this.checkResult.typeMap.get(expr.callee.object);
  if (calleeType?.kind !== "enum") return null;

  const enumType = calleeType;
  const variantName = expr.callee.property;
  const variantIndex = enumType.variants.findIndex((v) => v.name === variantName);
  if (variantIndex < 0) return null;

  const variant = enumType.variants[variantIndex];
  const tagValue = variant.value ?? variantIndex;
  const kirEnumType = this.lowerCheckerType(enumType);

  // stack_alloc the tagged union struct
  const ptrId = this.emitStackAlloc(kirEnumType);

  // Set tag field
  const tagPtrId = this.freshVar();
  this.emit({
    kind: "field_ptr",
    dest: tagPtrId,
    base: ptrId,
    field: "tag",
    type: { kind: "int", bits: 32, signed: true },
  });
  const tagVal = this.freshVar();
  this.emit({
    kind: "const_int",
    dest: tagVal,
    type: { kind: "int", bits: 32, signed: true },
    value: tagValue,
  });
  this.emit({ kind: "store", ptr: tagPtrId, value: tagVal });

  // Set data fields: data.VariantName.fieldName
  for (let i = 0; i < expr.args.length; i++) {
    const arg = expr.args[i];
    if (!arg) continue;
    const valueId = this.lowerExpr(arg);
    const field = variant.fields[i];
    if (!field) continue;
    const fieldType = this.lowerCheckerType(field.type);
    const fieldPtrId = this.freshVar();
    this.emit({
      kind: "field_ptr",
      dest: fieldPtrId,
      base: ptrId,
      field: `data.${variantName}.${field.name}`,
      type: fieldType,
    });
    this.emit({ kind: "store", ptr: fieldPtrId, value: valueId });
  }

  return ptrId;
}

/**
 * Lower an enum variant member access: Color.Red or Shape.None (fieldless variant of tagged union).
 * Returns the VarId, or null if expr is not an enum variant access.
 */
export function lowerEnumVariantAccess(this: KirLowerer, expr: MemberExpr): VarId | null {
  const objectType = this.checkResult.typeMap.get(expr.object);
  if (objectType?.kind !== "enum") return null;

  const variantIndex = objectType.variants.findIndex((v) => v.name === expr.property);
  if (variantIndex < 0) return null;

  const variant = objectType.variants[variantIndex];
  const value = variant.value ?? variantIndex;
  const hasDataVariants = objectType.variants.some((v) => v.fields.length > 0);

  if (hasDataVariants) {
    // Tagged union enum: construct full struct with tag set (no data fields for fieldless variant)
    const kirEnumType = this.lowerCheckerType(objectType);
    const ptrId = this.emitStackAlloc(kirEnumType);

    const tagPtrId = this.freshVar();
    this.emit({
      kind: "field_ptr",
      dest: tagPtrId,
      base: ptrId,
      field: "tag",
      type: { kind: "int", bits: 32, signed: true },
    });
    const tagVal = this.freshVar();
    this.emit({
      kind: "const_int",
      dest: tagVal,
      type: { kind: "int", bits: 32, signed: true },
      value,
    });
    this.emit({ kind: "store", ptr: tagPtrId, value: tagVal });

    return ptrId;
  }

  // Simple enum: just emit the integer discriminant
  const dest = this.freshVar();
  this.emit({ kind: "const_int", dest, type: { kind: "int", bits: 32, signed: true }, value });
  return dest;
}
