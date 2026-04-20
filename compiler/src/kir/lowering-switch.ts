/**
 * Switch expression lowering — operates on LoweringCtx.
 * Extracted from lowering-expr.ts for modularity.
 */

import type { Statement, SwitchCase, SwitchExpr } from "../ast/nodes.ts";
import type { KirType, VarId } from "./kir-types.ts";
import type { LoweringCtx } from "./lowering-ctx.ts";
import { lowerExpr } from "./lowering-expr.ts";
import { lowerStatement } from "./lowering-stmt.ts";
import { getExprKirType, lowerCheckerType } from "./lowering-types.ts";
import {
  emit,
  emitFieldLoad,
  emitStackAlloc,
  freshBlockId,
  freshVar,
  isBlockTerminated,
  sealCurrentBlock,
  setTerminator,
  startBlock,
} from "./lowering-utils.ts";

export function lowerSwitchExpr(ctx: LoweringCtx, expr: SwitchExpr): VarId {
  const subjectId = lowerExpr(ctx, expr.subject);
  const resultType = getExprKirType(ctx, expr);
  const endLabel = freshBlockId(ctx, "switchexpr.end");

  // Check if this is a switch on a data-variant (tagged union) enum
  const subjectType = ctx.checkResult.types.typeMap.get(expr.subject);
  const isTaggedUnionEnum =
    subjectType?.kind === "enum" && subjectType.variants.some((v) => v.fields.length > 0);

  // For tagged union enums, compare on the .tag field
  let switchValue: VarId;
  if (isTaggedUnionEnum) {
    const tagType: KirType = { kind: "int", bits: 32, signed: true };
    switchValue = emitFieldLoad(ctx, subjectId, "tag", tagType);
  } else {
    switchValue = subjectId;
  }

  // Allocate result on stack
  const resultPtr = emitStackAlloc(ctx, resultType);

  const caseLabels: { value: VarId; target: string }[] = [];
  let defaultLabel = endLabel;
  const caseBlocks: { label: string; stmts: Statement[]; astCase: SwitchCase }[] = [];

  for (const c of expr.cases) {
    const label = c.isDefault
      ? freshBlockId(ctx, "switchexpr.default")
      : freshBlockId(ctx, "switchexpr.case");

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
          const tagId = freshVar(ctx);
          emit(ctx, {
            kind: "const_int",
            dest: tagId,
            type: { kind: "int", bits: 32, signed: true },
            value: tagValue,
          });
          caseLabels.push({ value: tagId, target: label });
          continue;
        }
      }
      const valId = lowerExpr(ctx, val);
      caseLabels.push({ value: valId, target: label });
    }

    caseBlocks.push({ label, stmts: c.body, astCase: c });
  }

  setTerminator(ctx, {
    kind: "switch",
    value: switchValue,
    cases: caseLabels,
    defaultBlock: defaultLabel,
  });

  // Emit case blocks — store last expression value into resultPtr
  for (const cb of caseBlocks) {
    sealCurrentBlock(ctx);
    startBlock(ctx, cb.label);

    // Emit destructuring bindings
    const bindingInfo = ctx.checkResult.types.switchCaseBindings.get(cb.astCase);
    if (bindingInfo && cb.astCase.bindings) {
      for (let i = 0; i < cb.astCase.bindings.length; i++) {
        const fieldPath = `data.${bindingInfo.variantName}.${bindingInfo.fieldNames[i]}`;
        const fieldType = lowerCheckerType(ctx, bindingInfo.fieldTypes[i]);
        const loadedVal = emitFieldLoad(ctx, subjectId, fieldPath, fieldType);
        ctx.varMap.set(cb.astCase.bindings[i], loadedVal);
      }
    }

    for (const s of cb.stmts) {
      if (s.kind === "ExprStmt") {
        const val = lowerExpr(ctx, s.expression);
        emit(ctx, { kind: "store", ptr: resultPtr, value: val });
      } else {
        lowerStatement(ctx, s);
      }
    }
    if (!isBlockTerminated(ctx)) {
      setTerminator(ctx, { kind: "jump", target: endLabel });
    }
  }

  // End block — load and return result
  sealCurrentBlock(ctx);
  startBlock(ctx, endLabel);

  const dest = freshVar(ctx);
  emit(ctx, { kind: "load", dest, ptr: resultPtr, type: resultType });
  return dest;
}

/** Find a const_int instruction by its dest VarId (for tag matching) */
export function findConstIntInst(ctx: LoweringCtx, varId: VarId): { value: number } | null {
  for (const block of ctx.blocks) {
    for (const inst of block.instructions) {
      if (inst.kind === "const_int" && inst.dest === varId) {
        return { value: inst.value };
      }
    }
  }
  for (const inst of ctx.currentInsts) {
    if (inst.kind === "const_int" && inst.dest === varId) {
      return { value: inst.value };
    }
  }
  return null;
}
