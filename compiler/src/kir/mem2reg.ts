/**
 * mem2reg — Promote stack_alloc/load/store to SSA with phi nodes.
 *
 * Implements the classic Cytron et al. algorithm:
 *   1. Identify promotable allocas (only load/store, no address-taken)
 *   2. Build CFG (predecessor/successor maps)
 *   3. Compute dominance tree (Cooper, Harvey, Kennedy iterative algorithm)
 *   4. Compute dominance frontiers
 *   5. Insert phi nodes at dominance frontiers (iterated dominance frontier)
 *   6. Rename variables (walk dominator tree, replace loads/stores)
 *   7. Remove dead stack_alloc/load/store instructions
 */

import type {
  KirModule,
  KirFunction,
  KirBlock,
  KirInst,
  KirTerminator,
  KirPhi,
  KirType,
  VarId,
  BlockId,
} from "./kir-types.ts";

// ─── CFG helpers ────────────────────────────────────────────────────────────

interface CFG {
  preds: Map<BlockId, BlockId[]>;
  succs: Map<BlockId, BlockId[]>;
  blockOrder: BlockId[]; // RPO order
  blockMap: Map<BlockId, KirBlock>;
}

function buildCFG(blocks: KirBlock[]): CFG {
  const preds = new Map<BlockId, BlockId[]>();
  const succs = new Map<BlockId, BlockId[]>();
  const blockMap = new Map<BlockId, KirBlock>();

  for (const block of blocks) {
    blockMap.set(block.id, block);
    preds.set(block.id, []);
    succs.set(block.id, []);
  }

  for (const block of blocks) {
    const targets = terminatorTargets(block.terminator);
    succs.set(block.id, targets);
    for (const t of targets) {
      const p = preds.get(t);
      if (p) p.push(block.id);
    }
  }

  // Compute reverse post-order via DFS
  const visited = new Set<BlockId>();
  const rpo: BlockId[] = [];

  function dfs(id: BlockId) {
    if (visited.has(id)) return;
    visited.add(id);
    for (const s of succs.get(id) ?? []) {
      dfs(s);
    }
    rpo.push(id);
  }

  if (blocks.length > 0) {
    dfs(blocks[0].id);
  }
  rpo.reverse();

  return { preds, succs, blockOrder: rpo, blockMap };
}

function terminatorTargets(term: KirTerminator): BlockId[] {
  switch (term.kind) {
    case "jump":
      return [term.target];
    case "br":
      return [term.thenBlock, term.elseBlock];
    case "switch": {
      const targets = term.cases.map((c) => c.target);
      targets.push(term.defaultBlock);
      return targets;
    }
    default:
      return [];
  }
}

// ─── Dominance (Cooper, Harvey, Kennedy) ────────────────────────────────────

function computeDominators(cfg: CFG): Map<BlockId, BlockId> {
  const { blockOrder, preds } = cfg;
  if (blockOrder.length === 0) return new Map();

  const entry = blockOrder[0];
  // Map block → index in RPO for efficient comparisons
  const rpoIndex = new Map<BlockId, number>();
  for (let i = 0; i < blockOrder.length; i++) {
    rpoIndex.set(blockOrder[i], i);
  }

  // idom[b] = immediate dominator of b
  const idom = new Map<BlockId, BlockId>();
  idom.set(entry, entry);

  function intersect(b1: BlockId, b2: BlockId): BlockId {
    let finger1 = rpoIndex.get(b1)!;
    let finger2 = rpoIndex.get(b2)!;
    while (finger1 !== finger2) {
      while (finger1 > finger2) {
        finger1 = rpoIndex.get(idom.get(blockOrder[finger1])!)!;
      }
      while (finger2 > finger1) {
        finger2 = rpoIndex.get(idom.get(blockOrder[finger2])!)!;
      }
    }
    return blockOrder[finger1];
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < blockOrder.length; i++) {
      const b = blockOrder[i];
      const predList = preds.get(b) ?? [];

      // Pick first processed predecessor as initial idom
      let newIdom: BlockId | null = null;
      for (const p of predList) {
        if (idom.has(p)) {
          newIdom = p;
          break;
        }
      }
      if (newIdom === null) continue;

      for (const p of predList) {
        if (p === newIdom) continue;
        if (idom.has(p)) {
          newIdom = intersect(p, newIdom);
        }
      }

      if (idom.get(b) !== newIdom) {
        idom.set(b, newIdom);
        changed = true;
      }
    }
  }

  return idom;
}

// ─── Dominance frontiers ────────────────────────────────────────────────────

function computeDominanceFrontiers(
  cfg: CFG,
  idom: Map<BlockId, BlockId>,
): Map<BlockId, Set<BlockId>> {
  const df = new Map<BlockId, Set<BlockId>>();
  for (const id of cfg.blockOrder) {
    df.set(id, new Set());
  }

  for (const b of cfg.blockOrder) {
    const predList = cfg.preds.get(b) ?? [];
    if (predList.length < 2) continue;

    for (const p of predList) {
      let runner = p;
      while (runner !== idom.get(b) && runner !== undefined) {
        df.get(runner)!.add(b);
        if (runner === idom.get(runner)) break; // entry node
        runner = idom.get(runner)!;
      }
    }
  }

  return df;
}

// ─── Dominator tree children ────────────────────────────────────────────────

function buildDomTree(
  cfg: CFG,
  idom: Map<BlockId, BlockId>,
): Map<BlockId, BlockId[]> {
  const children = new Map<BlockId, BlockId[]>();
  for (const id of cfg.blockOrder) {
    children.set(id, []);
  }
  for (const id of cfg.blockOrder) {
    const parent = idom.get(id);
    if (parent !== undefined && parent !== id) {
      children.get(parent)!.push(id);
    }
  }
  return children;
}

// ─── Promotable alloca identification ───────────────────────────────────────

interface AllocaInfo {
  dest: VarId;
  type: KirType;
  defBlocks: Set<BlockId>; // blocks that store to this alloca
  useBlocks: Set<BlockId>; // blocks that load from this alloca
}

function findPromotableAllocas(fn: KirFunction): Map<VarId, AllocaInfo> {
  const allocas = new Map<VarId, AllocaInfo>();

  // First pass: find all stack_alloc instructions
  for (const block of fn.blocks) {
    for (const inst of block.instructions) {
      if (inst.kind === "stack_alloc") {
        allocas.set(inst.dest, {
          dest: inst.dest,
          type: inst.type,
          defBlocks: new Set(),
          useBlocks: new Set(),
        });
      }
    }
  }

  // Second pass: identify address-taken allocas (not promotable)
  // and record def/use blocks for promotable ones
  const addressTaken = new Set<VarId>();

  for (const block of fn.blocks) {
    for (const inst of block.instructions) {
      if (inst.kind === "store") {
        if (allocas.has(inst.ptr)) {
          allocas.get(inst.ptr)!.defBlocks.add(block.id);
        }
      } else if (inst.kind === "load") {
        if (allocas.has(inst.ptr)) {
          allocas.get(inst.ptr)!.useBlocks.add(block.id);
        }
      } else if (inst.kind === "field_ptr") {
        if (allocas.has(inst.base)) addressTaken.add(inst.base);
      } else if (inst.kind === "index_ptr") {
        if (allocas.has(inst.base)) addressTaken.add(inst.base);
      }
    }
  }

  // Remove address-taken allocas
  for (const v of addressTaken) {
    allocas.delete(v);
  }

  return allocas;
}

// ─── Phi insertion (iterated dominance frontier) ────────────────────────────

function insertPhis(
  fn: KirFunction,
  cfg: CFG,
  df: Map<BlockId, Set<BlockId>>,
  allocas: Map<VarId, AllocaInfo>,
): Map<BlockId, Map<VarId, KirPhi>> {
  // Map: blockId → allocaVar → phi node
  const phis = new Map<BlockId, Map<VarId, KirPhi>>();

  for (const [allocaVar, info] of allocas) {
    // Iterated dominance frontier
    const phiBlocks = new Set<BlockId>();
    const worklist = [...info.defBlocks];
    const processed = new Set<BlockId>();

    while (worklist.length > 0) {
      const block = worklist.pop()!;
      if (processed.has(block)) continue;
      processed.add(block);

      for (const dfBlock of df.get(block) ?? []) {
        if (!phiBlocks.has(dfBlock)) {
          phiBlocks.add(dfBlock);

          // Create phi node
          if (!phis.has(dfBlock)) {
            phis.set(dfBlock, new Map());
          }
          const predList = cfg.preds.get(dfBlock) ?? [];
          phis.get(dfBlock)!.set(allocaVar, {
            dest: "", // will be assigned during rename
            type: info.type,
            incoming: predList.map((p) => ({ value: "" as VarId, from: p })),
          });

          // Add to worklist if not already a def block
          if (!info.defBlocks.has(dfBlock)) {
            worklist.push(dfBlock);
          }
        }
      }
    }
  }

  return phis;
}

// ─── Variable renaming ─────────────────────────────────────────────────────

function renameVariables(
  fn: KirFunction,
  cfg: CFG,
  idom: Map<BlockId, BlockId>,
  allocas: Map<VarId, AllocaInfo>,
  phiMap: Map<BlockId, Map<VarId, KirPhi>>,
): KirBlock[] {
  const domChildren = buildDomTree(cfg, idom);

  // Fresh SSA name counter (continues from fn's counter)
  let varCounter = fn.localCount;
  function freshVar(): VarId {
    return `%${varCounter++}`;
  }

  // Stack of current definitions for each alloca
  const stacks = new Map<VarId, VarId[]>();
  for (const allocaVar of allocas.keys()) {
    stacks.set(allocaVar, []);
  }

  // Get current value for an alloca (top of stack)
  function currentDef(allocaVar: VarId): VarId | undefined {
    const stack = stacks.get(allocaVar);
    if (!stack || stack.length === 0) return undefined;
    return stack[stack.length - 1];
  }

  // Push a new definition
  function pushDef(allocaVar: VarId, value: VarId): void {
    stacks.get(allocaVar)!.push(value);
  }

  // Build result blocks
  const newBlocks = new Map<BlockId, KirBlock>();
  for (const block of fn.blocks) {
    newBlocks.set(block.id, {
      id: block.id,
      phis: [],
      instructions: [...block.instructions],
      terminator: block.terminator,
    });
  }

  // Rename in dominator-tree DFS order
  function renameBlock(blockId: BlockId): void {
    const block = cfg.blockMap.get(blockId)!;
    const newBlock = newBlocks.get(blockId)!;

    // Track how many defs we pushed (for rollback)
    const pushCounts = new Map<VarId, number>();
    for (const allocaVar of allocas.keys()) {
      pushCounts.set(allocaVar, 0);
    }

    // 1. Process phi nodes in this block — each phi defines a new SSA name
    const blockPhis = phiMap.get(blockId);
    if (blockPhis) {
      for (const [allocaVar, phi] of blockPhis) {
        const newName = freshVar();
        phi.dest = newName;
        pushDef(allocaVar, newName);
        pushCounts.set(allocaVar, pushCounts.get(allocaVar)! + 1);
        newBlock.phis.push(phi);
      }
    }

    // 2. Process instructions — replace loads, update stores, remove both
    const filteredInsts: KirInst[] = [];
    for (const inst of block.instructions) {
      if (inst.kind === "stack_alloc" && allocas.has(inst.dest)) {
        // Remove promoted stack_alloc
        continue;
      }
      if (inst.kind === "store" && allocas.has(inst.ptr)) {
        // Store to promoted alloca → define new SSA value
        // The value being stored becomes the current def, but we need
        // to resolve it first (it might reference a load from another alloca)
        const resolvedValue = resolveValue(inst.value);
        pushDef(inst.ptr, resolvedValue);
        pushCounts.set(inst.ptr, pushCounts.get(inst.ptr)! + 1);
        continue;
      }
      if (inst.kind === "load" && allocas.has(inst.ptr)) {
        // Load from promoted alloca → replace with current SSA value
        const value = currentDef(inst.ptr);
        if (value !== undefined) {
          // Record mapping: inst.dest → value (for use by other instructions)
          valueMap.set(inst.dest, value);
        }
        continue;
      }

      // For other instructions, rewrite operands that reference removed loads
      const rewritten = rewriteInst(inst);
      filteredInsts.push(rewritten);
    }

    newBlock.instructions = filteredInsts;

    // 3. Rewrite terminator operands
    newBlock.terminator = rewriteTerminator(block.terminator);

    // 4. Fill in phi operands in successor blocks
    for (const succId of cfg.succs.get(blockId) ?? []) {
      const succPhis = phiMap.get(succId);
      if (!succPhis) continue;
      for (const [allocaVar, phi] of succPhis) {
        const value = currentDef(allocaVar);
        for (const incoming of phi.incoming) {
          if (incoming.from === blockId) {
            incoming.value = value ?? ("undef" as VarId);
          }
        }
      }
    }

    // 5. Recurse into dominated blocks
    for (const child of domChildren.get(blockId) ?? []) {
      renameBlock(child);
    }

    // 6. Pop definitions
    for (const [allocaVar, count] of pushCounts) {
      const stack = stacks.get(allocaVar)!;
      for (let i = 0; i < count; i++) {
        stack.pop();
      }
    }
  }

  // Map from old load dest → new SSA value
  const valueMap = new Map<VarId, VarId>();

  function resolveValue(v: VarId): VarId {
    return valueMap.get(v) ?? v;
  }

  function rewriteInst(inst: KirInst): KirInst {
    switch (inst.kind) {
      case "bin_op":
        return {
          ...inst,
          lhs: resolveValue(inst.lhs),
          rhs: resolveValue(inst.rhs),
        };
      case "neg":
        return { ...inst, operand: resolveValue(inst.operand) };
      case "not":
        return { ...inst, operand: resolveValue(inst.operand) };
      case "bit_not":
        return { ...inst, operand: resolveValue(inst.operand) };
      case "call":
        return { ...inst, args: inst.args.map(resolveValue) };
      case "call_void":
        return { ...inst, args: inst.args.map(resolveValue) };
      case "call_extern":
        return { ...inst, args: inst.args.map(resolveValue) };
      case "call_extern_void":
        return { ...inst, args: inst.args.map(resolveValue) };
      case "cast":
        return { ...inst, value: resolveValue(inst.value) };
      case "store":
        return { ...inst, value: resolveValue(inst.value), ptr: resolveValue(inst.ptr) };
      case "load":
        return { ...inst, ptr: resolveValue(inst.ptr) };
      case "field_ptr":
        return { ...inst, base: resolveValue(inst.base) };
      case "index_ptr":
        return {
          ...inst,
          base: resolveValue(inst.base),
          index: resolveValue(inst.index),
        };
      case "bounds_check":
        return {
          ...inst,
          index: resolveValue(inst.index),
          length: resolveValue(inst.length),
        };
      case "overflow_check":
        return {
          ...inst,
          lhs: resolveValue(inst.lhs),
          rhs: resolveValue(inst.rhs),
        };
      case "null_check":
        return { ...inst, ptr: resolveValue(inst.ptr) };
      case "assert_check":
        return { ...inst, cond: resolveValue(inst.cond) };
      case "require_check":
        return { ...inst, cond: resolveValue(inst.cond) };
      default:
        return inst;
    }
  }

  function rewriteTerminator(term: KirTerminator): KirTerminator {
    switch (term.kind) {
      case "ret":
        return { ...term, value: resolveValue(term.value) };
      case "br":
        return { ...term, cond: resolveValue(term.cond) };
      case "switch":
        return {
          ...term,
          value: resolveValue(term.value),
          cases: term.cases.map((c) => ({
            ...c,
            value: resolveValue(c.value),
          })),
        };
      default:
        return term;
    }
  }

  if (cfg.blockOrder.length > 0) {
    renameBlock(cfg.blockOrder[0]);
  }

  // Update localCount
  fn.localCount = varCounter;

  // Return blocks in original order
  return fn.blocks.map((b) => newBlocks.get(b.id)!);
}

// ─── Dead phi elimination ───────────────────────────────────────────────────

function eliminateDeadPhis(blocks: KirBlock[]): void {
  // Remove phi nodes where all incoming values are the same (or self-referential)
  let changed = true;
  while (changed) {
    changed = false;
    for (const block of blocks) {
      const newPhis: KirPhi[] = [];
      for (const phi of block.phis) {
        // Filter out self-references
        const nonSelfValues = phi.incoming
          .filter((e) => e.value !== phi.dest)
          .map((e) => e.value);

        const uniqueValues = [...new Set(nonSelfValues)];

        if (uniqueValues.length === 0) {
          // All self-referential or empty — remove (dead)
          changed = true;
          continue;
        }

        if (uniqueValues.length === 1) {
          // All incoming are the same value — replace phi with that value
          const replacement = uniqueValues[0];
          // Rewrite all uses of phi.dest → replacement across all blocks
          for (const b of blocks) {
            for (const p of b.phis) {
              for (const inc of p.incoming) {
                if (inc.value === phi.dest) inc.value = replacement;
              }
            }
            b.instructions = b.instructions.map((inst) =>
              rewriteAllUses(inst, phi.dest, replacement),
            );
            b.terminator = rewriteTerminatorUses(
              b.terminator,
              phi.dest,
              replacement,
            );
          }
          changed = true;
          continue;
        }

        newPhis.push(phi);
      }
      block.phis = newPhis;
    }
  }
}

function rewriteAllUses(inst: KirInst, from: VarId, to: VarId): KirInst {
  function r(v: VarId): VarId {
    return v === from ? to : v;
  }

  switch (inst.kind) {
    case "bin_op":
      return { ...inst, lhs: r(inst.lhs), rhs: r(inst.rhs) };
    case "neg":
      return { ...inst, operand: r(inst.operand) };
    case "not":
      return { ...inst, operand: r(inst.operand) };
    case "bit_not":
      return { ...inst, operand: r(inst.operand) };
    case "call":
      return { ...inst, args: inst.args.map(r) };
    case "call_void":
      return { ...inst, args: inst.args.map(r) };
    case "call_extern":
      return { ...inst, args: inst.args.map(r) };
    case "call_extern_void":
      return { ...inst, args: inst.args.map(r) };
    case "cast":
      return { ...inst, value: r(inst.value) };
    case "store":
      return { ...inst, value: r(inst.value), ptr: r(inst.ptr) };
    case "load":
      return { ...inst, ptr: r(inst.ptr) };
    case "field_ptr":
      return { ...inst, base: r(inst.base) };
    case "index_ptr":
      return { ...inst, base: r(inst.base), index: r(inst.index) };
    case "bounds_check":
      return { ...inst, index: r(inst.index), length: r(inst.length) };
    case "overflow_check":
      return { ...inst, lhs: r(inst.lhs), rhs: r(inst.rhs) };
    case "null_check":
      return { ...inst, ptr: r(inst.ptr) };
    case "assert_check":
      return { ...inst, cond: r(inst.cond) };
    case "require_check":
      return { ...inst, cond: r(inst.cond) };
    default:
      return inst;
  }
}

function rewriteTerminatorUses(
  term: KirTerminator,
  from: VarId,
  to: VarId,
): KirTerminator {
  function r(v: VarId): VarId {
    return v === from ? to : v;
  }

  switch (term.kind) {
    case "ret":
      return { ...term, value: r(term.value) };
    case "br":
      return { ...term, cond: r(term.cond) };
    case "switch":
      return {
        ...term,
        value: r(term.value),
        cases: term.cases.map((c) => ({ ...c, value: r(c.value) })),
      };
    default:
      return term;
  }
}

// ─── Main pass ──────────────────────────────────────────────────────────────

function runMem2RegOnFunction(fn: KirFunction): void {
  if (fn.blocks.length === 0) return;

  const allocas = findPromotableAllocas(fn);
  if (allocas.size === 0) return;

  const cfg = buildCFG(fn.blocks);
  const idom = computeDominators(cfg);
  const df = computeDominanceFrontiers(cfg, idom);
  const phiMap = insertPhis(fn, cfg, df, allocas);
  const newBlocks = renameVariables(fn, cfg, idom, allocas, phiMap);

  fn.blocks = newBlocks;

  // Clean up trivial / dead phi nodes
  eliminateDeadPhis(fn.blocks);
}

export function runMem2Reg(module: KirModule): KirModule {
  for (const fn of module.functions) {
    runMem2RegOnFunction(fn);
  }
  return module;
}
