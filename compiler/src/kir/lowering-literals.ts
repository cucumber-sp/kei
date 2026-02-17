/**
 * Literal and composite expression lowering methods for KirLowerer.
 * Extracted from lowering-expr.ts for modularity.
 */

import type {
  ArrayLiteral,
  BoolLiteral,
  FloatLiteral,
  IntLiteral,
  StringLiteral,
  StructLiteral,
} from "../ast/nodes.ts";
import type { KirFloatType, KirIntType, KirType, VarId } from "./kir-types.ts";
import type { KirLowerer } from "./lowering.ts";

export function lowerIntLiteral(this: KirLowerer, expr: IntLiteral): VarId {
  const dest = this.freshVar();
  const checkerType = this.checkResult.typeMap.get(expr);
  let type: KirIntType = { kind: "int", bits: 32, signed: true };
  if (checkerType?.kind === "int") {
    type = { kind: "int", bits: checkerType.bits, signed: checkerType.signed };
  }
  this.emit({ kind: "const_int", dest, type, value: expr.value });
  return dest;
}

export function lowerFloatLiteral(this: KirLowerer, expr: FloatLiteral): VarId {
  const dest = this.freshVar();
  const checkerType = this.checkResult.typeMap.get(expr);
  let type: KirFloatType = { kind: "float", bits: 64 };
  if (checkerType?.kind === "float") {
    type = { kind: "float", bits: checkerType.bits };
  }
  this.emit({ kind: "const_float", dest, type, value: expr.value });
  return dest;
}

export function lowerStringLiteral(this: KirLowerer, expr: StringLiteral): VarId {
  const dest = this.freshVar();
  this.emit({ kind: "const_string", dest, value: expr.value });
  return dest;
}

export function lowerBoolLiteral(this: KirLowerer, expr: BoolLiteral): VarId {
  const dest = this.freshVar();
  this.emit({ kind: "const_bool", dest, value: expr.value });
  return dest;
}

export function lowerNullLiteral(this: KirLowerer): VarId {
  const dest = this.freshVar();
  this.emit({ kind: "const_null", dest, type: { kind: "ptr", pointee: { kind: "void" } } });
  return dest;
}

export function lowerStructLiteral(this: KirLowerer, expr: StructLiteral): VarId {
  const type = this.getExprKirType(expr);
  const ptrId = this.emitStackAlloc(type);

  for (const field of expr.fields) {
    const valueId = this.lowerExpr(field.value);
    const fieldPtrId = this.freshVar();
    const fieldType = this.getExprKirType(field.value);
    this.emit({
      kind: "field_ptr",
      dest: fieldPtrId,
      base: ptrId,
      field: field.name,
      type: fieldType,
    });
    this.emit({ kind: "store", ptr: fieldPtrId, value: valueId });
  }

  return ptrId;
}

export function lowerArrayLiteral(this: KirLowerer, expr: ArrayLiteral): VarId {
  const checkerType = this.checkResult.typeMap.get(expr);
  let elemType: KirType = { kind: "int", bits: 32, signed: true };
  if (checkerType?.kind === "array") {
    elemType = this.lowerCheckerType(checkerType.element);
  }

  const arrType: KirType = { kind: "array", element: elemType, length: expr.elements.length };
  const ptrId = this.emitStackAlloc(arrType);

  // Store each element at its index
  for (let i = 0; i < expr.elements.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: index i is bounded by expr.elements.length
    const valueId = this.lowerExpr(expr.elements[i]!);
    const idxId = this.freshVar();
    this.emit({
      kind: "const_int",
      dest: idxId,
      type: { kind: "int", bits: 64, signed: false },
      value: i,
    });
    const elemPtrId = this.freshVar();
    this.emit({ kind: "index_ptr", dest: elemPtrId, base: ptrId, index: idxId, type: elemType });
    this.emit({ kind: "store", ptr: elemPtrId, value: valueId });
  }

  return ptrId;
}
