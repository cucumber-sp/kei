/**
 * Switch expression lowering methods for KirLowerer.
 * Extracted from lowering-expr.ts for modularity.
 */

import type { Statement, SwitchCase, SwitchExpr } from "../ast/nodes.ts";
import type { KirType, VarId } from "./kir-types.ts";
import type { KirLowerer } from "./lowering.ts";

export function lowerSwitchExpr(this: KirLowerer, expr: SwitchExpr): VarId {
  const subjectId = this.lowerExpr(expr.subject);
  const resultType = this.getExprKirType(expr);
  const endLabel = this.freshBlockId("switchexpr.end");

  // Check if this is a switch on a data-variant (tagged union) enum
  const subjectType = this.checkResult.typeMap.get(expr.subject);
  const isTaggedUnionEnum =
    subjectType?.kind === "enum" && subjectType.variants.some((v) => v.fields.length > 0);

  // For tagged union enums, compare on the .tag field
  let switchValue: VarId;
  if (isTaggedUnionEnum) {
    const tagType: KirType = { kind: "int", bits: 32, signed: true };
    switchValue = this.emitFieldLoad(subjectId, "tag", tagType);
  } else {
    switchValue = subjectId;
  }

  // Allocate result on stack
  const resultPtr = this.emitStackAlloc(resultType);

  const caseLabels: { value: VarId; target: string }[] = [];
  let defaultLabel = endLabel;
  const caseBlocks: { label: string; stmts: Statement[]; astCase: SwitchCase }[] = [];

  for (const c of expr.cases) {
    const label = c.isDefault
      ? this.freshBlockId("switchexpr.default")
      : this.freshBlockId("switchexpr.case");

    if (c.isDefault) {
      defaultLabel = label;
    }

    for (const val of c.values) {
      // For tagged union enums, case values are variant names — emit const_int tag
      if (isTaggedUnionEnum && subjectType?.kind === "enum" && val.kind === "Identifier") {
        const variantIndex = subjectType.variants.findIndex((v) => v.name === val.name);
        if (variantIndex >= 0) {
          const variant = subjectType.variants[variantIndex];
          const tagValue = variant.value ?? variantIndex;
          const tagId = this.freshVar();
          this.emit({
            kind: "const_int",
            dest: tagId,
            type: { kind: "int", bits: 32, signed: true },
            value: tagValue,
          });
          caseLabels.push({ value: tagId, target: label });
          continue;
        }
      }
      const valId = this.lowerExpr(val);
      caseLabels.push({ value: valId, target: label });
    }

    caseBlocks.push({ label, stmts: c.body, astCase: c });
  }

  this.setTerminator({
    kind: "switch",
    value: switchValue,
    cases: caseLabels,
    defaultBlock: defaultLabel,
  });

  // Emit case blocks — store last expression value into resultPtr
  for (const cb of caseBlocks) {
    this.sealCurrentBlock();
    this.startBlock(cb.label);

    // Emit destructuring bindings
    const bindingInfo = this.checkResult.switchCaseBindings?.get(cb.astCase);
    if (bindingInfo && cb.astCase.bindings) {
      for (let i = 0; i < cb.astCase.bindings.length; i++) {
        const fieldPath = `data.${bindingInfo.variantName}.${bindingInfo.fieldNames[i]}`;
        const fieldType = this.lowerCheckerType(bindingInfo.fieldTypes[i]);
        const loadedVal = this.emitFieldLoad(subjectId, fieldPath, fieldType);
        this.varMap.set(cb.astCase.bindings[i], loadedVal);
      }
    }

    for (const s of cb.stmts) {
      if (s.kind === "ExprStmt") {
        const val = this.lowerExpr(s.expression);
        this.emit({ kind: "store", ptr: resultPtr, value: val });
      } else {
        this.lowerStatement(s);
      }
    }
    if (!this.isBlockTerminated()) {
      this.setTerminator({ kind: "jump", target: endLabel });
    }
  }

  // End block — load and return result
  this.sealCurrentBlock();
  this.startBlock(endLabel);

  const dest = this.freshVar();
  this.emit({ kind: "load", dest, ptr: resultPtr, type: resultType });
  return dest;
}

/** Find a const_int instruction by its dest VarId (for tag matching) */
export function findConstIntInst(this: KirLowerer, varId: VarId): { value: number } | null {
  for (const block of this.blocks) {
    for (const inst of block.instructions) {
      if (inst.kind === "const_int" && inst.dest === varId) {
        return { value: inst.value };
      }
    }
  }
  for (const inst of this.currentInsts) {
    if (inst.kind === "const_int" && inst.dest === varId) {
      return { value: inst.value };
    }
  }
  return null;
}
