/**
 * Statement lowering — operates on LoweringCtx.
 * Extracted from lowering.ts for modularity.
 */

import type {
  AssertStmt,
  BlockStmt,
  CForStmt,
  ConstStmt,
  ExprStmt,
  ForStmt,
  IfStmt,
  LetStmt,
  RequireStmt,
  ReturnStmt,
  Statement,
  SwitchCase,
  SwitchStmt,
  WhileStmt,
} from "../ast/nodes";
import type { KirType, VarId } from "./kir-types";
import type { LoweringCtx } from "./lowering-ctx";
import { lowerExpr } from "./lowering-expr";
import {
  emitAllScopeDestroys,
  emitAllScopeDestroysExceptNamed,
  emitLoopScopeDestroys,
  getStructLifecycle,
  popScopeWithDestroy,
  pushScope,
  trackScopeVar,
} from "./lowering-scope";
import { getExprKirType, lowerCheckerType } from "./lowering-types";
import {
  emit,
  emitConstInt,
  emitFieldLoad,
  emitLoadModifyStore,
  emitStackAlloc,
  freshBlockId,
  freshVar,
  isBlockTerminated,
  isStackAllocVar,
  sealCurrentBlock,
  setTerminator,
  startBlock,
} from "./lowering-utils";

// ─── Statements ──────────────────────────────────────────────────────────

export function lowerBlock(ctx: LoweringCtx, block: BlockStmt): void {
  for (const stmt of block.statements) {
    lowerStatement(ctx, stmt);
  }
}

/** Lower a block statement that introduces its own scope (e.g., nested { } blocks) */
export function lowerScopedBlock(ctx: LoweringCtx, block: BlockStmt): void {
  pushScope(ctx);
  for (const stmt of block.statements) {
    lowerStatement(ctx, stmt);
  }
  if (!isBlockTerminated(ctx)) {
    popScopeWithDestroy(ctx);
  } else {
    ctx.scopeStack.pop();
  }
}

export function lowerStatement(ctx: LoweringCtx, stmt: Statement): void {
  // If current block is already terminated, skip
  if (isBlockTerminated(ctx)) return;

  switch (stmt.kind) {
    case "LetStmt":
      lowerLetStmt(ctx, stmt);
      break;
    case "ConstStmt":
      lowerConstStmt(ctx, stmt);
      break;
    case "ReturnStmt":
      lowerReturnStmt(ctx, stmt);
      break;
    case "IfStmt":
      lowerIfStmt(ctx, stmt);
      break;
    case "WhileStmt":
      lowerWhileStmt(ctx, stmt);
      break;
    case "ForStmt":
      lowerForStmt(ctx, stmt);
      break;
    case "CForStmt":
      lowerCForStmt(ctx, stmt);
      break;
    case "SwitchStmt":
      lowerSwitchStmt(ctx, stmt);
      break;
    case "ExprStmt":
      lowerExprStmt(ctx, stmt);
      break;
    case "BlockStmt":
      lowerScopedBlock(ctx, stmt);
      break;
    case "BreakStmt":
      if (ctx.loopBreakTarget) {
        emitLoopScopeDestroys(ctx);
        setTerminator(ctx, { kind: "jump", target: ctx.loopBreakTarget });
      }
      break;
    case "ContinueStmt":
      if (ctx.loopContinueTarget) {
        emitLoopScopeDestroys(ctx);
        setTerminator(ctx, { kind: "jump", target: ctx.loopContinueTarget });
      }
      break;
    case "AssertStmt":
      lowerAssertStmt(ctx, stmt);
      break;
    case "RequireStmt":
      lowerRequireStmt(ctx, stmt);
      break;
    case "DeferStmt":
      // Defer is not yet implemented in KIR
      break;
    case "UnsafeBlock":
      lowerScopedBlock(ctx, stmt.body);
      break;
  }
}

export function lowerLetStmt(ctx: LoweringCtx, stmt: LetStmt): void {
  const type = getExprKirType(ctx, stmt.initializer);

  // Evaluate initializer first
  const valueId = lowerExpr(ctx, stmt.initializer);

  // For struct literals and expressions that return alloc pointers,
  // we can directly alias the variable to the alloc pointer (no extra copy needed).
  // This avoids the pointer-store-into-alloc problem.
  const isStructAlloc = type.kind === "struct" && isStackAllocVar(ctx, valueId);

  let ptrId: VarId;
  if (isStructAlloc) {
    // Directly alias — the struct literal's alloc becomes this variable's alloc
    ptrId = valueId;
  } else {
    // Regular path: alloc + store
    ptrId = emitStackAlloc(ctx, type);

    // Emit oncopy if this is a copy of a struct with __oncopy (not a move)
    if (stmt.initializer.kind !== "MoveExpr") {
      const checkerType = ctx.checkResult.types.typeMap.get(stmt.initializer);
      const lifecycle = getStructLifecycle(ctx, checkerType);
      if (lifecycle?.hasOncopy) {
        emit(ctx, { kind: "oncopy", value: valueId, structName: lifecycle.structName });
      }
    }

    emit(ctx, { kind: "store", ptr: ptrId, value: valueId });
  }

  // Map variable name to its stack pointer
  ctx.varMap.set(stmt.name, ptrId);

  // Track for scope-exit destroy
  trackScopeVar(ctx, stmt.name, ptrId, stmt.initializer);
}

export function lowerConstStmt(ctx: LoweringCtx, stmt: ConstStmt): void {
  // Const is just like let but immutable — same lowering
  const valueId = lowerExpr(ctx, stmt.initializer);
  ctx.varMap.set(stmt.name, valueId);
}

export function lowerReturnStmt(ctx: LoweringCtx, stmt: ReturnStmt): void {
  if (ctx.currentFunctionThrowsTypes.length > 0) {
    // In a throws function: store value to __out pointer, return tag 0 (success)
    if (stmt.value) {
      const valueId = lowerExpr(ctx, stmt.value);
      const returnedVarName = stmt.value.kind === "Identifier" ? stmt.value.name : null;
      emitAllScopeDestroysExceptNamed(ctx, returnedVarName);
      // Store success value through __out pointer
      if (ctx.currentFunctionOrigReturnType.kind !== "void") {
        // biome-ignore lint/style/noNonNullAssertion: __out is always present in a throws function when the return type is non-void
        const outPtr = ctx.varMap.get("__out")!;
        emit(ctx, { kind: "store", ptr: outPtr, value: valueId });
      }
    } else {
      emitAllScopeDestroys(ctx);
    }
    const zeroTag = emitConstInt(ctx, 0);
    setTerminator(ctx, { kind: "ret", value: zeroTag });
  } else {
    if (stmt.value) {
      let valueId = lowerExpr(ctx, stmt.value);
      // Emit destroys for all scope variables, but skip the returned variable
      const returnedVarName = stmt.value.kind === "Identifier" ? stmt.value.name : null;
      emitAllScopeDestroysExceptNamed(ctx, returnedVarName);
      // If returning a struct value and the function returns by value,
      // we need to load from the pointer (structs are always stack_alloc'd as pointers in KIR)
      const retType = ctx.currentFunctionOrigReturnType;
      if (retType.kind === "struct") {
        const loaded = freshVar(ctx);
        emit(ctx, { kind: "load", dest: loaded, ptr: valueId, type: retType });
        valueId = loaded;
      }
      setTerminator(ctx, { kind: "ret", value: valueId });
    } else {
      emitAllScopeDestroys(ctx);
      setTerminator(ctx, { kind: "ret_void" });
    }
  }
}

export function lowerIfStmt(ctx: LoweringCtx, stmt: IfStmt): void {
  const condId = lowerExpr(ctx, stmt.condition);
  const thenLabel = freshBlockId(ctx, "if.then");
  const elseLabel = stmt.elseBlock ? freshBlockId(ctx, "if.else") : freshBlockId(ctx, "if.end");
  const endLabel = stmt.elseBlock ? freshBlockId(ctx, "if.end") : elseLabel;

  setTerminator(ctx, {
    kind: "br",
    cond: condId,
    thenBlock: thenLabel,
    elseBlock: stmt.elseBlock ? elseLabel : endLabel,
  });

  // Then block
  sealCurrentBlock(ctx);
  startBlock(ctx, thenLabel);
  lowerBlock(ctx, stmt.thenBlock);
  if (!isBlockTerminated(ctx)) {
    setTerminator(ctx, { kind: "jump", target: endLabel });
  }

  // Else block
  if (stmt.elseBlock) {
    sealCurrentBlock(ctx);
    startBlock(ctx, elseLabel);
    if (stmt.elseBlock.kind === "IfStmt") {
      lowerIfStmt(ctx, stmt.elseBlock);
    } else {
      lowerBlock(ctx, stmt.elseBlock);
    }
    if (!isBlockTerminated(ctx)) {
      setTerminator(ctx, { kind: "jump", target: endLabel });
    }
  }

  // End block
  sealCurrentBlock(ctx);
  startBlock(ctx, endLabel);
}

export function lowerWhileStmt(ctx: LoweringCtx, stmt: WhileStmt): void {
  const headerLabel = freshBlockId(ctx, "while.header");
  const bodyLabel = freshBlockId(ctx, "while.body");
  const endLabel = freshBlockId(ctx, "while.end");

  setTerminator(ctx, { kind: "jump", target: headerLabel });

  // Header: evaluate condition
  sealCurrentBlock(ctx);
  startBlock(ctx, headerLabel);
  const condId = lowerExpr(ctx, stmt.condition);
  setTerminator(ctx, {
    kind: "br",
    cond: condId,
    thenBlock: bodyLabel,
    elseBlock: endLabel,
  });

  // Body
  sealCurrentBlock(ctx);
  startBlock(ctx, bodyLabel);

  const prevBreak = ctx.loopBreakTarget;
  const prevContinue = ctx.loopContinueTarget;
  const prevScopeDepth = ctx.loopScopeDepth;
  ctx.loopBreakTarget = endLabel;
  ctx.loopContinueTarget = headerLabel;
  ctx.loopScopeDepth = ctx.scopeStack.length;

  lowerBlock(ctx, stmt.body);

  ctx.loopBreakTarget = prevBreak;
  ctx.loopContinueTarget = prevContinue;
  ctx.loopScopeDepth = prevScopeDepth;

  if (!isBlockTerminated(ctx)) {
    setTerminator(ctx, { kind: "jump", target: headerLabel });
  }

  // End
  sealCurrentBlock(ctx);
  startBlock(ctx, endLabel);
}

export function lowerForStmt(ctx: LoweringCtx, stmt: ForStmt): void {
  // For loops over ranges: for x in start..end { body }
  // Lower as: init → header (condition) → body → latch (increment) → header
  const initLabel = freshBlockId(ctx, "for.init");
  const headerLabel = freshBlockId(ctx, "for.header");
  const bodyLabel = freshBlockId(ctx, "for.body");
  const latchLabel = freshBlockId(ctx, "for.latch");
  const endLabel = freshBlockId(ctx, "for.end");

  setTerminator(ctx, { kind: "jump", target: initLabel });

  // Init: evaluate iterable (range), set up loop var
  sealCurrentBlock(ctx);
  startBlock(ctx, initLabel);

  const _iterableType = getExprKirType(ctx, stmt.iterable);

  // For range-based: iterable is a RangeExpr, we extract start/end
  if (stmt.iterable.kind === "RangeExpr") {
    const startId = lowerExpr(ctx, stmt.iterable.start);
    const endId = lowerExpr(ctx, stmt.iterable.end);

    // Allocate loop variable
    const loopVarType: KirType = { kind: "int", bits: 32, signed: true };
    const loopVarPtr = emitStackAlloc(ctx, loopVarType);
    emit(ctx, { kind: "store", ptr: loopVarPtr, value: startId });
    ctx.varMap.set(stmt.variable, loopVarPtr);

    // Index variable if present
    if (stmt.index) {
      const indexPtr = emitStackAlloc(ctx, loopVarType);
      const zeroId = emitConstInt(ctx, 0);
      emit(ctx, { kind: "store", ptr: indexPtr, value: zeroId });
      ctx.varMap.set(stmt.index, indexPtr);
    }

    setTerminator(ctx, { kind: "jump", target: headerLabel });

    // Header: check condition
    sealCurrentBlock(ctx);
    startBlock(ctx, headerLabel);
    const curVal = freshVar(ctx);
    emit(ctx, { kind: "load", dest: curVal, ptr: loopVarPtr, type: loopVarType });
    const condId = freshVar(ctx);
    emit(ctx, {
      kind: "bin_op",
      op: "lt",
      dest: condId,
      lhs: curVal,
      rhs: endId,
      type: { kind: "bool" },
    });
    setTerminator(ctx, {
      kind: "br",
      cond: condId,
      thenBlock: bodyLabel,
      elseBlock: endLabel,
    });

    // Body
    sealCurrentBlock(ctx);
    startBlock(ctx, bodyLabel);

    const prevBreak = ctx.loopBreakTarget;
    const prevContinue = ctx.loopContinueTarget;
    const prevScopeDepth = ctx.loopScopeDepth;
    ctx.loopBreakTarget = endLabel;
    ctx.loopContinueTarget = latchLabel;
    ctx.loopScopeDepth = ctx.scopeStack.length;

    lowerBlock(ctx, stmt.body);

    ctx.loopBreakTarget = prevBreak;
    ctx.loopContinueTarget = prevContinue;
    ctx.loopScopeDepth = prevScopeDepth;

    if (!isBlockTerminated(ctx)) {
      setTerminator(ctx, { kind: "jump", target: latchLabel });
    }

    // Latch: increment loop var
    sealCurrentBlock(ctx);
    startBlock(ctx, latchLabel);
    const oneId = emitConstInt(ctx, 1);
    emitLoadModifyStore(ctx, loopVarPtr, "add", oneId, loopVarType);

    // Increment index if present
    if (stmt.index) {
      // biome-ignore lint/style/noNonNullAssertion: stmt.index is a declared loop variable guaranteed to be in varMap
      const indexPtr = ctx.varMap.get(stmt.index)!;
      const oneId2 = emitConstInt(ctx, 1);
      emitLoadModifyStore(ctx, indexPtr, "add", oneId2, loopVarType);
    }

    setTerminator(ctx, { kind: "jump", target: headerLabel });
  } else {
    // Fallback: just treat as a while-like loop with the iterable
    // This handles array/slice iteration in the future
    setTerminator(ctx, { kind: "jump", target: headerLabel });
    sealCurrentBlock(ctx);
    startBlock(ctx, headerLabel);
    setTerminator(ctx, { kind: "jump", target: endLabel });
  }

  // End
  sealCurrentBlock(ctx);
  startBlock(ctx, endLabel);
}

export function lowerCForStmt(ctx: LoweringCtx, stmt: CForStmt): void {
  // C-style for: for (let i = 0; i < 10; i = i + 1) { body }
  // Lower as: init → header (condition) → body → latch (update) → header → end
  const headerLabel = freshBlockId(ctx, "cfor.header");
  const bodyLabel = freshBlockId(ctx, "cfor.body");
  const latchLabel = freshBlockId(ctx, "cfor.latch");
  const endLabel = freshBlockId(ctx, "cfor.end");

  // Init: lower the let statement in the current block
  lowerLetStmt(ctx, stmt.init);

  setTerminator(ctx, { kind: "jump", target: headerLabel });

  // Header: evaluate condition
  sealCurrentBlock(ctx);
  startBlock(ctx, headerLabel);
  const condId = lowerExpr(ctx, stmt.condition);
  setTerminator(ctx, {
    kind: "br",
    cond: condId,
    thenBlock: bodyLabel,
    elseBlock: endLabel,
  });

  // Body
  sealCurrentBlock(ctx);
  startBlock(ctx, bodyLabel);

  const prevBreak = ctx.loopBreakTarget;
  const prevContinue = ctx.loopContinueTarget;
  const prevScopeDepth = ctx.loopScopeDepth;
  ctx.loopBreakTarget = endLabel;
  ctx.loopContinueTarget = latchLabel;
  ctx.loopScopeDepth = ctx.scopeStack.length;

  lowerBlock(ctx, stmt.body);

  ctx.loopBreakTarget = prevBreak;
  ctx.loopContinueTarget = prevContinue;
  ctx.loopScopeDepth = prevScopeDepth;

  if (!isBlockTerminated(ctx)) {
    setTerminator(ctx, { kind: "jump", target: latchLabel });
  }

  // Latch: evaluate update expression, jump back to header
  sealCurrentBlock(ctx);
  startBlock(ctx, latchLabel);
  lowerExpr(ctx, stmt.update);
  setTerminator(ctx, { kind: "jump", target: headerLabel });

  // End
  sealCurrentBlock(ctx);
  startBlock(ctx, endLabel);
}

export function lowerSwitchStmt(ctx: LoweringCtx, stmt: SwitchStmt): void {
  const subjectId = lowerExpr(ctx, stmt.subject);
  const endLabel = freshBlockId(ctx, "switch.end");

  // Check if this is a switch on a data-variant (tagged union) enum
  const subjectType = ctx.checkResult.types.typeMap.get(stmt.subject);
  const isTaggedUnionEnum =
    subjectType?.kind === "enum" && subjectType.variants.some((v) => v.fields.length > 0);

  // For tagged union enums, compare on the .tag field instead of the whole value
  let switchValue: VarId;
  if (isTaggedUnionEnum) {
    const tagType: KirType = { kind: "int", bits: 32, signed: true };
    switchValue = emitFieldLoad(ctx, subjectId, "tag", tagType);
  } else {
    switchValue = subjectId;
  }

  const caseLabels: { value: VarId; target: string }[] = [];
  let defaultLabel = endLabel;
  const caseBlocks: {
    label: string;
    stmts: Statement[];
    isDefault: boolean;
    astCase: SwitchCase;
  }[] = [];

  for (const c of stmt.cases) {
    const label = c.isDefault
      ? freshBlockId(ctx, "switch.default")
      : freshBlockId(ctx, "switch.case");

    if (c.isDefault) {
      defaultLabel = label;
    }

    for (const val of c.values) {
      // For tagged union enums, case values are variant names — emit const_int tag
      if (isTaggedUnionEnum && subjectType?.kind === "enum" && val.kind === "Identifier") {
        const variantIndex = subjectType.variants.findIndex((v) => v.name === val.name);
        if (variantIndex >= 0) {
          const variant = subjectType.variants[variantIndex];
          if (!variant) continue;
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

    caseBlocks.push({ label, stmts: c.body, isDefault: c.isDefault, astCase: c });
  }

  setTerminator(ctx, {
    kind: "switch",
    value: switchValue,
    cases: caseLabels,
    defaultBlock: defaultLabel,
  });

  // Emit case blocks
  for (const cb of caseBlocks) {
    sealCurrentBlock(ctx);
    startBlock(ctx, cb.label);

    // Emit destructuring bindings: load variant fields from the enum subject
    const bindingInfo = ctx.checkResult.types.switchCaseBindings.get(cb.astCase);
    if (bindingInfo && cb.astCase.bindings) {
      for (let i = 0; i < cb.astCase.bindings.length; i++) {
        const bindingName = cb.astCase.bindings[i];
        const fieldName = bindingInfo.fieldNames[i];
        const fieldTypeInfo = bindingInfo.fieldTypes[i];
        if (!bindingName || !fieldName || !fieldTypeInfo) continue;
        const fieldPath = `data.${bindingInfo.variantName}.${fieldName}`;
        const fieldType = lowerCheckerType(ctx, fieldTypeInfo);
        const loadedVal = emitFieldLoad(ctx, subjectId, fieldPath, fieldType);
        ctx.varMap.set(bindingName, loadedVal);
      }
    }

    for (const s of cb.stmts) {
      lowerStatement(ctx, s);
    }
    if (!isBlockTerminated(ctx)) {
      setTerminator(ctx, { kind: "jump", target: endLabel });
    }
  }

  sealCurrentBlock(ctx);
  startBlock(ctx, endLabel);
}

export function lowerExprStmt(ctx: LoweringCtx, stmt: ExprStmt): void {
  lowerExpr(ctx, stmt.expression);
}

export function lowerAssertStmt(ctx: LoweringCtx, stmt: AssertStmt): void {
  const condId = lowerExpr(ctx, stmt.condition);
  const msg = stmt.message?.kind === "StringLiteral" ? stmt.message.value : "assertion failed";
  emit(ctx, { kind: "assert_check", cond: condId, message: msg });
}

export function lowerRequireStmt(ctx: LoweringCtx, stmt: RequireStmt): void {
  const condId = lowerExpr(ctx, stmt.condition);
  const msg = stmt.message?.kind === "StringLiteral" ? stmt.message.value : "requirement failed";
  emit(ctx, { kind: "require_check", cond: condId, message: msg });
}
