/**
 * Statement lowering methods for KirLowerer.
 * Extracted from lowering.ts for modularity.
 */

import type {
  AssertStmt,
  BlockStmt,
  ConstStmt,
  ExprStmt,
  ForStmt,
  IfStmt,
  LetStmt,
  RequireStmt,
  ReturnStmt,
  Statement,
  SwitchStmt,
  WhileStmt,
} from "../ast/nodes.ts";
import type { KirType, VarId } from "./kir-types.ts";
import type { KirLowerer } from "./lowering.ts";

// ─── Statements ──────────────────────────────────────────────────────────

export function lowerBlock(this: KirLowerer, block: BlockStmt): void {
  for (const stmt of block.statements) {
    this.lowerStatement(stmt);
  }
}

/** Lower a block statement that introduces its own scope (e.g., nested { } blocks) */
export function lowerScopedBlock(this: KirLowerer, block: BlockStmt): void {
  this.pushScope();
  for (const stmt of block.statements) {
    this.lowerStatement(stmt);
  }
  if (!this.isBlockTerminated()) {
    this.popScopeWithDestroy();
  } else {
    this.scopeStack.pop();
  }
}

export function lowerStatement(this: KirLowerer, stmt: Statement): void {
  // If current block is already terminated, skip
  if (this.isBlockTerminated()) return;

  switch (stmt.kind) {
    case "LetStmt":
      this.lowerLetStmt(stmt);
      break;
    case "ConstStmt":
      this.lowerConstStmt(stmt);
      break;
    case "ReturnStmt":
      this.lowerReturnStmt(stmt);
      break;
    case "IfStmt":
      this.lowerIfStmt(stmt);
      break;
    case "WhileStmt":
      this.lowerWhileStmt(stmt);
      break;
    case "ForStmt":
      this.lowerForStmt(stmt);
      break;
    case "SwitchStmt":
      this.lowerSwitchStmt(stmt);
      break;
    case "ExprStmt":
      this.lowerExprStmt(stmt);
      break;
    case "BlockStmt":
      this.lowerScopedBlock(stmt);
      break;
    case "BreakStmt":
      if (this.loopBreakTarget) {
        this.emitLoopScopeDestroys();
        this.setTerminator({ kind: "jump", target: this.loopBreakTarget });
      }
      break;
    case "ContinueStmt":
      if (this.loopContinueTarget) {
        this.emitLoopScopeDestroys();
        this.setTerminator({ kind: "jump", target: this.loopContinueTarget });
      }
      break;
    case "AssertStmt":
      this.lowerAssertStmt(stmt);
      break;
    case "RequireStmt":
      this.lowerRequireStmt(stmt);
      break;
    case "DeferStmt":
      // Defer is not yet implemented in KIR
      break;
    case "UnsafeBlock":
      this.lowerScopedBlock(stmt.body);
      break;
  }
}

export function lowerLetStmt(this: KirLowerer, stmt: LetStmt): void {
  const type = this.getExprKirType(stmt.initializer);

  // Evaluate initializer first
  const valueId = this.lowerExpr(stmt.initializer);

  // For struct literals and expressions that return alloc pointers,
  // we can directly alias the variable to the alloc pointer (no extra copy needed).
  // This avoids the pointer-store-into-alloc problem.
  const isStructAlloc = type.kind === "struct" && this.isStackAllocVar(valueId);

  let ptrId: VarId;
  if (isStructAlloc) {
    // Directly alias — the struct literal's alloc becomes this variable's alloc
    ptrId = valueId;
  } else {
    // Regular path: alloc + store
    ptrId = this.emitStackAlloc(type);

    // Emit oncopy if this is a copy of a struct with __oncopy (not a move)
    if (stmt.initializer.kind !== "MoveExpr") {
      const checkerType = this.checkResult.typeMap.get(stmt.initializer);
      const lifecycle = this.getStructLifecycle(checkerType);
      if (lifecycle?.hasOncopy) {
        this.emit({ kind: "oncopy", value: valueId, structName: lifecycle.structName });
      }
    }

    this.emit({ kind: "store", ptr: ptrId, value: valueId });
  }

  // Map variable name to its stack pointer
  this.varMap.set(stmt.name, ptrId);

  // Track for scope-exit destroy
  this.trackScopeVar(stmt.name, ptrId, stmt.initializer);
}

export function lowerConstStmt(this: KirLowerer, stmt: ConstStmt): void {
  // Const is just like let but immutable — same lowering
  const valueId = this.lowerExpr(stmt.initializer);
  this.varMap.set(stmt.name, valueId);
}

export function lowerReturnStmt(this: KirLowerer, stmt: ReturnStmt): void {
  if (this.currentFunctionThrowsTypes.length > 0) {
    // In a throws function: store value to __out pointer, return tag 0 (success)
    if (stmt.value) {
      const valueId = this.lowerExpr(stmt.value);
      const returnedVarName = stmt.value.kind === "Identifier" ? stmt.value.name : null;
      this.emitAllScopeDestroysExceptNamed(returnedVarName);
      // Store success value through __out pointer
      if (this.currentFunctionOrigReturnType.kind !== "void") {
        // biome-ignore lint/style/noNonNullAssertion: __out is always present in a throws function when the return type is non-void
        const outPtr = this.varMap.get("__out")!;
        this.emit({ kind: "store", ptr: outPtr, value: valueId });
      }
    } else {
      this.emitAllScopeDestroys();
    }
    const zeroTag = this.emitConstInt(0);
    this.setTerminator({ kind: "ret", value: zeroTag });
  } else {
    if (stmt.value) {
      let valueId = this.lowerExpr(stmt.value);
      // Emit destroys for all scope variables, but skip the returned variable
      const returnedVarName = stmt.value.kind === "Identifier" ? stmt.value.name : null;
      this.emitAllScopeDestroysExceptNamed(returnedVarName);
      // If returning a struct value and the function returns by value,
      // we need to load from the pointer (structs are always stack_alloc'd as pointers in KIR)
      const retType = this.currentFunctionOrigReturnType;
      if (retType.kind === "struct") {
        const loaded = this.freshVar();
        this.emit({ kind: "load", dest: loaded, ptr: valueId, type: retType });
        valueId = loaded;
      }
      this.setTerminator({ kind: "ret", value: valueId });
    } else {
      this.emitAllScopeDestroys();
      this.setTerminator({ kind: "ret_void" });
    }
  }
}

export function lowerIfStmt(this: KirLowerer, stmt: IfStmt): void {
  const condId = this.lowerExpr(stmt.condition);
  const thenLabel = this.freshBlockId("if.then");
  const elseLabel = stmt.elseBlock ? this.freshBlockId("if.else") : this.freshBlockId("if.end");
  const endLabel = stmt.elseBlock ? this.freshBlockId("if.end") : elseLabel;

  this.setTerminator({
    kind: "br",
    cond: condId,
    thenBlock: thenLabel,
    elseBlock: stmt.elseBlock ? elseLabel : endLabel,
  });

  // Then block
  this.sealCurrentBlock();
  this.startBlock(thenLabel);
  this.lowerBlock(stmt.thenBlock);
  if (!this.isBlockTerminated()) {
    this.setTerminator({ kind: "jump", target: endLabel });
  }

  // Else block
  if (stmt.elseBlock) {
    this.sealCurrentBlock();
    this.startBlock(elseLabel);
    if (stmt.elseBlock.kind === "IfStmt") {
      this.lowerIfStmt(stmt.elseBlock);
    } else {
      this.lowerBlock(stmt.elseBlock);
    }
    if (!this.isBlockTerminated()) {
      this.setTerminator({ kind: "jump", target: endLabel });
    }
  }

  // End block
  this.sealCurrentBlock();
  this.startBlock(endLabel);
}

export function lowerWhileStmt(this: KirLowerer, stmt: WhileStmt): void {
  const headerLabel = this.freshBlockId("while.header");
  const bodyLabel = this.freshBlockId("while.body");
  const endLabel = this.freshBlockId("while.end");

  this.setTerminator({ kind: "jump", target: headerLabel });

  // Header: evaluate condition
  this.sealCurrentBlock();
  this.startBlock(headerLabel);
  const condId = this.lowerExpr(stmt.condition);
  this.setTerminator({
    kind: "br",
    cond: condId,
    thenBlock: bodyLabel,
    elseBlock: endLabel,
  });

  // Body
  this.sealCurrentBlock();
  this.startBlock(bodyLabel);

  const prevBreak = this.loopBreakTarget;
  const prevContinue = this.loopContinueTarget;
  const prevScopeDepth = this.loopScopeDepth;
  this.loopBreakTarget = endLabel;
  this.loopContinueTarget = headerLabel;
  this.loopScopeDepth = this.scopeStack.length;

  this.lowerBlock(stmt.body);

  this.loopBreakTarget = prevBreak;
  this.loopContinueTarget = prevContinue;
  this.loopScopeDepth = prevScopeDepth;

  if (!this.isBlockTerminated()) {
    this.setTerminator({ kind: "jump", target: headerLabel });
  }

  // End
  this.sealCurrentBlock();
  this.startBlock(endLabel);
}

export function lowerForStmt(this: KirLowerer, stmt: ForStmt): void {
  // For loops over ranges: for x in start..end { body }
  // Lower as: init → header (condition) → body → latch (increment) → header
  const initLabel = this.freshBlockId("for.init");
  const headerLabel = this.freshBlockId("for.header");
  const bodyLabel = this.freshBlockId("for.body");
  const latchLabel = this.freshBlockId("for.latch");
  const endLabel = this.freshBlockId("for.end");

  this.setTerminator({ kind: "jump", target: initLabel });

  // Init: evaluate iterable (range), set up loop var
  this.sealCurrentBlock();
  this.startBlock(initLabel);

  const _iterableType = this.getExprKirType(stmt.iterable);

  // For range-based: iterable is a RangeExpr, we extract start/end
  if (stmt.iterable.kind === "RangeExpr") {
    const startId = this.lowerExpr(stmt.iterable.start);
    const endId = this.lowerExpr(stmt.iterable.end);

    // Allocate loop variable
    const loopVarType: KirType = { kind: "int", bits: 32, signed: true };
    const loopVarPtr = this.emitStackAlloc(loopVarType);
    this.emit({ kind: "store", ptr: loopVarPtr, value: startId });
    this.varMap.set(stmt.variable, loopVarPtr);

    // Index variable if present
    if (stmt.index) {
      const indexPtr = this.emitStackAlloc(loopVarType);
      const zeroId = this.emitConstInt(0);
      this.emit({ kind: "store", ptr: indexPtr, value: zeroId });
      this.varMap.set(stmt.index, indexPtr);
    }

    this.setTerminator({ kind: "jump", target: headerLabel });

    // Header: check condition
    this.sealCurrentBlock();
    this.startBlock(headerLabel);
    const curVal = this.freshVar();
    this.emit({ kind: "load", dest: curVal, ptr: loopVarPtr, type: loopVarType });
    const condId = this.freshVar();
    this.emit({
      kind: "bin_op",
      op: "lt",
      dest: condId,
      lhs: curVal,
      rhs: endId,
      type: { kind: "bool" },
    });
    this.setTerminator({
      kind: "br",
      cond: condId,
      thenBlock: bodyLabel,
      elseBlock: endLabel,
    });

    // Body
    this.sealCurrentBlock();
    this.startBlock(bodyLabel);

    const prevBreak = this.loopBreakTarget;
    const prevContinue = this.loopContinueTarget;
    const prevScopeDepth = this.loopScopeDepth;
    this.loopBreakTarget = endLabel;
    this.loopContinueTarget = latchLabel;
    this.loopScopeDepth = this.scopeStack.length;

    this.lowerBlock(stmt.body);

    this.loopBreakTarget = prevBreak;
    this.loopContinueTarget = prevContinue;
    this.loopScopeDepth = prevScopeDepth;

    if (!this.isBlockTerminated()) {
      this.setTerminator({ kind: "jump", target: latchLabel });
    }

    // Latch: increment loop var
    this.sealCurrentBlock();
    this.startBlock(latchLabel);
    const oneId = this.emitConstInt(1);
    this.emitLoadModifyStore(loopVarPtr, "add", oneId, loopVarType);

    // Increment index if present
    if (stmt.index) {
      // biome-ignore lint/style/noNonNullAssertion: stmt.index is a declared loop variable guaranteed to be in varMap
      const indexPtr = this.varMap.get(stmt.index)!;
      const oneId2 = this.emitConstInt(1);
      this.emitLoadModifyStore(indexPtr, "add", oneId2, loopVarType);
    }

    this.setTerminator({ kind: "jump", target: headerLabel });
  } else {
    // Fallback: just treat as a while-like loop with the iterable
    // This handles array/slice iteration in the future
    this.setTerminator({ kind: "jump", target: headerLabel });
    this.sealCurrentBlock();
    this.startBlock(headerLabel);
    this.setTerminator({ kind: "jump", target: endLabel });
  }

  // End
  this.sealCurrentBlock();
  this.startBlock(endLabel);
}

export function lowerSwitchStmt(this: KirLowerer, stmt: SwitchStmt): void {
  const subjectId = this.lowerExpr(stmt.subject);
  const endLabel = this.freshBlockId("switch.end");

  // Check if this is a switch on a data-variant (tagged union) enum
  const subjectType = this.checkResult.typeMap.get(stmt.subject);
  const isTaggedUnionEnum =
    subjectType?.kind === "enum" &&
    subjectType.variants.some((v) => v.fields.length > 0);

  // For tagged union enums, compare on the .tag field instead of the whole value
  let switchValue: VarId;
  if (isTaggedUnionEnum) {
    const tagType: KirType = { kind: "int", bits: 32, signed: true };
    switchValue = this.emitFieldLoad(subjectId, "tag", tagType);
  } else {
    switchValue = subjectId;
  }

  const caseLabels: { value: VarId; target: string }[] = [];
  let defaultLabel = endLabel;
  const caseBlocks: { label: string; stmts: Statement[]; isDefault: boolean }[] = [];

  for (const c of stmt.cases) {
    const label = c.isDefault
      ? this.freshBlockId("switch.default")
      : this.freshBlockId("switch.case");

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

    caseBlocks.push({ label, stmts: c.body, isDefault: c.isDefault });
  }

  this.setTerminator({
    kind: "switch",
    value: switchValue,
    cases: caseLabels,
    defaultBlock: defaultLabel,
  });

  // Emit case blocks
  for (const cb of caseBlocks) {
    this.sealCurrentBlock();
    this.startBlock(cb.label);
    for (const s of cb.stmts) {
      this.lowerStatement(s);
    }
    if (!this.isBlockTerminated()) {
      this.setTerminator({ kind: "jump", target: endLabel });
    }
  }

  this.sealCurrentBlock();
  this.startBlock(endLabel);
}

export function lowerExprStmt(this: KirLowerer, stmt: ExprStmt): void {
  this.lowerExpr(stmt.expression);
}

export function lowerAssertStmt(this: KirLowerer, stmt: AssertStmt): void {
  const condId = this.lowerExpr(stmt.condition);
  const msg = stmt.message?.kind === "StringLiteral" ? stmt.message.value : "assertion failed";
  this.emit({ kind: "assert_check", cond: condId, message: msg });
}

export function lowerRequireStmt(this: KirLowerer, stmt: RequireStmt): void {
  const condId = this.lowerExpr(stmt.condition);
  const msg = stmt.message?.kind === "StringLiteral" ? stmt.message.value : "requirement failed";
  this.emit({ kind: "require_check", cond: condId, message: msg });
}
