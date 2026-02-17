/**
 * mem2reg — Promote stack_alloc/load/store to SSA with phi nodes.
 *
 * Implements the classic Cytron et al. algorithm:
 *   1. Identify promotable allocas (only load/store, no address-taken)
 *   2. Build CFG (predecessor/successor maps) and compute RPO
 *   3. Compute dominance tree (Cooper, Harvey, Kennedy iterative algorithm)
 *   4. Compute dominance frontiers
 *   5. Insert phi nodes at iterated dominance frontiers of def blocks
 *   6. Rename variables (walk dominator tree, replace loads with SSA values)
 *   7. Remove dead stack_alloc/load/store instructions
 *   8. Eliminate trivial phi nodes (all-same or self-referential)
 *
 * An alloca is "promotable" if it is only accessed via load/store — never
 * via field_ptr, index_ptr, or passed as an address (call_throws out/err
 * pointers). Address-taken allocas remain in memory.
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
  /** Blocks in reverse post-order (reachable from entry only). */
  blockOrder: BlockId[];
  blockMap: Map<BlockId, KirBlock>;
}

/**
 * Build the control-flow graph for a function's blocks.
 *
 * Computes predecessor/successor maps from terminator edges, then
 * derives a reverse post-order (RPO) via DFS from the entry block.
 * Only blocks reachable from the entry appear in blockOrder — unreachable
 * blocks are excluded from dominance/phi computations.
 */
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
    for (const target of targets) {
      const predList = preds.get(target);
      if (predList) predList.push(block.id);
    }
  }

  // Compute reverse post-order via iterative DFS.
  // RPO is needed by the dominator algorithm (blocks processed before
  // their dominatees) and determines the order of phi insertion.
  const visited = new Set<BlockId>();
  const rpo: BlockId[] = [];

  function dfs(id: BlockId) {
    if (visited.has(id)) return;
    visited.add(id);
    for (const succ of succs.get(id) ?? []) {
      dfs(succ);
    }
    rpo.push(id);
  }

  if (blocks.length > 0) {
    dfs(blocks[0].id);
  }
  rpo.reverse();

  return { preds, succs, blockOrder: rpo, blockMap };
}

/** Extract branch targets from a terminator instruction. */
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

/**
 * Compute immediate dominators using the Cooper-Harvey-Kennedy algorithm.
 *
 * This is an iterative fixed-point algorithm that works on RPO-numbered
 * blocks. The entry block dominates itself (idom[entry] = entry). For
 * every other block, we intersect the idom paths of all processed
 * predecessors to find the nearest common dominator.
 *
 * Returns a map from each block to its immediate dominator.
 */
function computeDominators(cfg: CFG): Map<BlockId, BlockId> {
  const { blockOrder, preds } = cfg;
  if (blockOrder.length === 0) return new Map();

  const entryBlock = blockOrder[0];

  // Map block → index in RPO for efficient comparisons.
  // Lower index = earlier in RPO = dominates more blocks.
  const rpoIndex = new Map<BlockId, number>();
  for (let i = 0; i < blockOrder.length; i++) {
    rpoIndex.set(blockOrder[i], i);
  }

  const idom = new Map<BlockId, BlockId>();
  idom.set(entryBlock, entryBlock);

  /**
   * Walk up the dominator tree from two blocks to find their nearest
   * common dominator (NCD). Uses RPO indices — the block with the
   * higher index is farther from the entry, so we step it upward.
   */
  function intersect(b1: BlockId, b2: BlockId): BlockId {
    let idx1 = rpoIndex.get(b1)!;
    let idx2 = rpoIndex.get(b2)!;
    while (idx1 !== idx2) {
      while (idx1 > idx2) {
        idx1 = rpoIndex.get(idom.get(blockOrder[idx1])!)!;
      }
      while (idx2 > idx1) {
        idx2 = rpoIndex.get(idom.get(blockOrder[idx2])!)!;
      }
    }
    return blockOrder[idx1];
  }

  // Iterate until fixed point. Skip the entry (index 0) since its
  // idom is itself.
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < blockOrder.length; i++) {
      const blockId = blockOrder[i];
      const predList = preds.get(blockId) ?? [];

      // Pick the first already-processed predecessor as the initial idom
      let newIdom: BlockId | null = null;
      for (const pred of predList) {
        if (idom.has(pred)) {
          newIdom = pred;
          break;
        }
      }
      if (newIdom === null) continue;

      // Intersect with all other processed predecessors
      for (const pred of predList) {
        if (pred === newIdom) continue;
        if (idom.has(pred)) {
          newIdom = intersect(pred, newIdom);
        }
      }

      if (idom.get(blockId) !== newIdom) {
        idom.set(blockId, newIdom);
        changed = true;
      }
    }
  }

  return idom;
}

// ─── Dominance frontiers ────────────────────────────────────────────────────

/**
 * Compute dominance frontiers for all blocks.
 *
 * DF(X) = set of blocks Y where X dominates a predecessor of Y but
 * does not strictly dominate Y itself. These are the join points where
 * phi nodes may be needed.
 *
 * Algorithm: For each join point (block with >= 2 predecessors), walk
 * up the dominator tree from each predecessor until we reach the
 * block's immediate dominator, adding the join point to each runner's
 * dominance frontier along the way.
 */
function computeDomFrontiers(
  cfg: CFG,
  idom: Map<BlockId, BlockId>,
): Map<BlockId, Set<BlockId>> {
  const domFrontiers = new Map<BlockId, Set<BlockId>>();
  for (const id of cfg.blockOrder) {
    domFrontiers.set(id, new Set());
  }

  for (const blockId of cfg.blockOrder) {
    const predList = cfg.preds.get(blockId) ?? [];
    if (predList.length < 2) continue;

    for (const pred of predList) {
      // Skip predecessors not in the RPO (unreachable blocks).
      // These have no idom entry and would cause a null dereference.
      if (!idom.has(pred)) continue;

      let runner = pred;
      while (runner !== idom.get(blockId) && runner !== undefined) {
        domFrontiers.get(runner)!.add(blockId);
        if (runner === idom.get(runner)) break; // entry node
        runner = idom.get(runner)!;
      }
    }
  }

  return domFrontiers;
}

// ─── Dominator tree children ────────────────────────────────────────────────

/** Build a map from each block to its children in the dominator tree. */
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
  /** Blocks containing a store to this alloca. */
  defBlocks: Set<BlockId>;
  /** Blocks containing a load from this alloca. */
  useBlocks: Set<BlockId>;
}

/**
 * Find stack_alloc instructions that can be promoted to SSA registers.
 *
 * An alloca is promotable if it is only accessed by load and store
 * instructions. If its address escapes (via field_ptr, index_ptr, or
 * as an out/err pointer to call_throws), it must stay in memory.
 */
function findPromotableAllocas(fn: KirFunction): Map<VarId, AllocaInfo> {
  const allocas = new Map<VarId, AllocaInfo>();

  // First pass: collect all stack_alloc instructions
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

  // Second pass: classify each use of an alloca.
  // - load → record use block
  // - store → record def block
  // - anything else using the alloca pointer → mark address-taken
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
      } else if (inst.kind === "call_throws") {
        // outPtr and errPtr are passed by address — not promotable
        if (allocas.has(inst.outPtr)) addressTaken.add(inst.outPtr);
        if (allocas.has(inst.errPtr)) addressTaken.add(inst.errPtr);
      }
    }
  }

  // Remove address-taken allocas — they can't be promoted
  for (const varId of addressTaken) {
    allocas.delete(varId);
  }

  return allocas;
}

// ─── Phi insertion (iterated dominance frontier) ────────────────────────────

/**
 * Insert phi nodes at iterated dominance frontiers of each alloca's
 * def blocks.
 *
 * For each promotable alloca, we find every block in the iterated
 * dominance frontier of its store locations. A phi node is placed at
 * each such block, with one incoming slot per predecessor. The phi's
 * dest and incoming values are left empty — they'll be filled during
 * the rename pass.
 */
function insertPhis(
  fn: KirFunction,
  cfg: CFG,
  domFrontiers: Map<BlockId, Set<BlockId>>,
  allocas: Map<VarId, AllocaInfo>,
): Map<BlockId, Map<VarId, KirPhi>> {
  // Map: blockId → allocaVar → phi node
  const phis = new Map<BlockId, Map<VarId, KirPhi>>();

  for (const [allocaVar, info] of allocas) {
    // Worklist algorithm for iterated dominance frontier (IDF).
    // Start with blocks that store to this alloca, then expand:
    // any block in the DF of a def block is also a def (via the phi),
    // so we add it to the worklist too.
    const phiBlocks = new Set<BlockId>();
    const worklist = [...info.defBlocks];
    const visited = new Set<BlockId>();

    while (worklist.length > 0) {
      const defBlock = worklist.pop()!;
      if (visited.has(defBlock)) continue;
      visited.add(defBlock);

      for (const frontierBlock of domFrontiers.get(defBlock) ?? []) {
        if (phiBlocks.has(frontierBlock)) continue;
        phiBlocks.add(frontierBlock);

        // Create phi node for this alloca at this frontier block
        if (!phis.has(frontierBlock)) {
          phis.set(frontierBlock, new Map());
        }
        const predList = cfg.preds.get(frontierBlock) ?? [];
        phis.get(frontierBlock)!.set(allocaVar, {
          dest: "", // assigned during rename
          type: info.type,
          incoming: predList.map((pred) => ({
            value: "" as VarId,
            from: pred,
          })),
        });

        // The phi itself is a def — add frontier block to worklist
        // so we compute the IDF transitively
        if (!info.defBlocks.has(frontierBlock)) {
          worklist.push(frontierBlock);
        }
      }
    }
  }

  return phis;
}

// ─── Operand rewriting helpers ──────────────────────────────────────────────

/**
 * Rewrite all VarId operands in an instruction using the given mapping
 * function. This is the single source of truth for which fields are
 * operands for each instruction kind.
 */
function mapInstOperands(
  inst: KirInst,
  mapVar: (v: VarId) => VarId,
): KirInst {
  switch (inst.kind) {
    case "bin_op":
      return { ...inst, lhs: mapVar(inst.lhs), rhs: mapVar(inst.rhs) };
    case "neg":
      return { ...inst, operand: mapVar(inst.operand) };
    case "not":
      return { ...inst, operand: mapVar(inst.operand) };
    case "bit_not":
      return { ...inst, operand: mapVar(inst.operand) };
    case "call":
      return { ...inst, args: inst.args.map(mapVar) };
    case "call_void":
      return { ...inst, args: inst.args.map(mapVar) };
    case "call_extern":
      return { ...inst, args: inst.args.map(mapVar) };
    case "call_extern_void":
      return { ...inst, args: inst.args.map(mapVar) };
    case "cast":
      return { ...inst, value: mapVar(inst.value) };
    case "store":
      return { ...inst, value: mapVar(inst.value), ptr: mapVar(inst.ptr) };
    case "load":
      return { ...inst, ptr: mapVar(inst.ptr) };
    case "field_ptr":
      return { ...inst, base: mapVar(inst.base) };
    case "index_ptr":
      return {
        ...inst,
        base: mapVar(inst.base),
        index: mapVar(inst.index),
      };
    case "bounds_check":
      return {
        ...inst,
        index: mapVar(inst.index),
        length: mapVar(inst.length),
      };
    case "overflow_check":
      return { ...inst, lhs: mapVar(inst.lhs), rhs: mapVar(inst.rhs) };
    case "null_check":
      return { ...inst, ptr: mapVar(inst.ptr) };
    case "assert_check":
      return { ...inst, cond: mapVar(inst.cond) };
    case "require_check":
      return { ...inst, cond: mapVar(inst.cond) };
    case "destroy":
      return { ...inst, value: mapVar(inst.value) };
    case "oncopy":
      return { ...inst, value: mapVar(inst.value) };
    case "move":
      return { ...inst, source: mapVar(inst.source) };
    case "call_throws":
      return {
        ...inst,
        args: inst.args.map(mapVar),
        outPtr: mapVar(inst.outPtr),
        errPtr: mapVar(inst.errPtr),
      };
    default:
      return inst;
  }
}

/** Rewrite all VarId operands in a terminator using the given mapping. */
function mapTerminatorOperands(
  term: KirTerminator,
  mapVar: (v: VarId) => VarId,
): KirTerminator {
  switch (term.kind) {
    case "ret":
      return { ...term, value: mapVar(term.value) };
    case "br":
      return { ...term, cond: mapVar(term.cond) };
    case "switch":
      return {
        ...term,
        value: mapVar(term.value),
        cases: term.cases.map((c) => ({
          ...c,
          value: mapVar(c.value),
        })),
      };
    default:
      return term;
  }
}

// ─── Variable renaming ─────────────────────────────────────────────────────

/**
 * Rename variables: walk the dominator tree in pre-order, replacing
 * loads with SSA values, stores with def pushes, and filling in phi
 * incoming operands.
 *
 * Each alloca gets a "definition stack" that tracks the current SSA
 * value at each point in the dominator tree walk. Phi nodes and stores
 * push new definitions; when we backtrack out of a dominated subtree
 * we pop them to restore the parent's view.
 */
function renameVariables(
  fn: KirFunction,
  cfg: CFG,
  idom: Map<BlockId, BlockId>,
  allocas: Map<VarId, AllocaInfo>,
  phiMap: Map<BlockId, Map<VarId, KirPhi>>,
): KirBlock[] {
  const domChildren = buildDomTree(cfg, idom);

  // Fresh SSA name counter (continues from fn's counter so names don't collide)
  let varCounter = fn.localCount;
  function freshVar(): VarId {
    return `%${varCounter++}`;
  }

  // Per-alloca stack of current SSA definitions.
  // Top of stack = current reaching definition.
  const defStacks = new Map<VarId, VarId[]>();
  for (const allocaVar of allocas.keys()) {
    defStacks.set(allocaVar, []);
  }

  function currentDef(allocaVar: VarId): VarId | undefined {
    const stack = defStacks.get(allocaVar);
    if (!stack || stack.length === 0) return undefined;
    return stack[stack.length - 1];
  }

  function pushDef(allocaVar: VarId, value: VarId): void {
    defStacks.get(allocaVar)!.push(value);
  }

  // Map from removed load destinations to their SSA replacement values.
  // This allows subsequent instructions to find the right value when
  // they reference a load that was eliminated.
  const loadReplacements = new Map<VarId, VarId>();

  function resolveValue(v: VarId): VarId {
    return loadReplacements.get(v) ?? v;
  }

  // Build output blocks (cloned from originals)
  const newBlocks = new Map<BlockId, KirBlock>();
  for (const block of fn.blocks) {
    newBlocks.set(block.id, {
      id: block.id,
      phis: [],
      instructions: [...block.instructions],
      terminator: block.terminator,
    });
  }

  /**
   * Process a single block during the dominator-tree walk:
   *   1. Assign SSA names to phi dests and push onto def stacks
   *   2. Filter instructions: remove promoted alloc/load/store,
   *      rewrite operands in surviving instructions
   *   3. Rewrite terminator operands
   *   4. Fill in phi incoming values in successor blocks
   *   5. Recurse into dominated children
   *   6. Pop def stacks to restore parent state
   */
  function renameBlock(blockId: BlockId): void {
    const block = cfg.blockMap.get(blockId)!;
    const newBlock = newBlocks.get(blockId)!;

    // Track how many defs we push per alloca, so we can pop exactly
    // that many when backtracking.
    const pushCounts = new Map<VarId, number>();
    for (const allocaVar of allocas.keys()) {
      pushCounts.set(allocaVar, 0);
    }

    // Step 1: Process phi nodes — each phi defines a fresh SSA name
    const blockPhis = phiMap.get(blockId);
    if (blockPhis) {
      for (const [allocaVar, phi] of blockPhis) {
        const ssaName = freshVar();
        phi.dest = ssaName;
        pushDef(allocaVar, ssaName);
        pushCounts.set(allocaVar, pushCounts.get(allocaVar)! + 1);
        newBlock.phis.push(phi);
      }
    }

    // Step 2: Process instructions
    const keptInsts: KirInst[] = [];
    for (const inst of block.instructions) {
      if (inst.kind === "stack_alloc" && allocas.has(inst.dest)) {
        // Promoted alloca — remove entirely
        continue;
      }
      if (inst.kind === "store" && allocas.has(inst.ptr)) {
        // Store to promoted alloca → push the stored value as current def.
        // Resolve first: the value might reference an eliminated load.
        const resolvedValue = resolveValue(inst.value);
        pushDef(inst.ptr, resolvedValue);
        pushCounts.set(inst.ptr, pushCounts.get(inst.ptr)! + 1);
        continue;
      }
      if (inst.kind === "load" && allocas.has(inst.ptr)) {
        // Load from promoted alloca → record dest → current SSA value
        const value = currentDef(inst.ptr);
        if (value !== undefined) {
          loadReplacements.set(inst.dest, value);
        }
        continue;
      }

      // Surviving instruction — rewrite any operands that reference
      // eliminated loads
      keptInsts.push(mapInstOperands(inst, resolveValue));
    }
    newBlock.instructions = keptInsts;

    // Step 3: Rewrite terminator operands
    newBlock.terminator = mapTerminatorOperands(
      block.terminator,
      resolveValue,
    );

    // Step 4: Fill in phi incoming values in each successor block.
    // The current def for each alloca at this point is what flows
    // into the successor's phi from this predecessor.
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

    // Step 5: Recurse into dominated children
    for (const child of domChildren.get(blockId) ?? []) {
      renameBlock(child);
    }

    // Step 6: Pop definitions to restore parent's state
    for (const [allocaVar, count] of pushCounts) {
      const stack = defStacks.get(allocaVar)!;
      for (let i = 0; i < count; i++) {
        stack.pop();
      }
    }
  }

  if (cfg.blockOrder.length > 0) {
    renameBlock(cfg.blockOrder[0]);
  }

  // Update localCount so subsequent passes don't reuse SSA names
  fn.localCount = varCounter;

  // Return blocks in original order (preserving layout)
  return fn.blocks.map((b) => newBlocks.get(b.id)!);
}

// ─── Trivial phi elimination ────────────────────────────────────────────────

/**
 * Remove trivial phi nodes in a fixed-point loop.
 *
 * A phi is trivial if, after ignoring self-references, all incoming
 * values are the same. Such a phi can be replaced by that single value.
 * Removing one trivial phi can make others trivial (e.g., a phi
 * referencing only another trivial phi and itself), so we iterate.
 *
 * A phi with only self-references (or no incoming) is dead and removed.
 */
function eliminateDeadPhis(blocks: KirBlock[]): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const block of blocks) {
      const survivingPhis: KirPhi[] = [];
      for (const phi of block.phis) {
        // Filter out self-references (phi.dest appearing in its own incoming)
        const nonSelfValues = phi.incoming
          .filter((e) => e.value !== phi.dest)
          .map((e) => e.value);

        const uniqueValues = [...new Set(nonSelfValues)];

        if (uniqueValues.length === 0) {
          // All self-referential or empty — dead phi, remove
          changed = true;
          continue;
        }

        if (uniqueValues.length === 1) {
          // Trivial phi: all incoming paths carry the same value.
          // Replace all uses of phi.dest with that value.
          const replacement = uniqueValues[0];
          const from = phi.dest;
          const mapVar = (v: VarId) => (v === from ? replacement : v);

          for (const b of blocks) {
            for (const p of b.phis) {
              for (const inc of p.incoming) {
                if (inc.value === from) inc.value = replacement;
              }
            }
            b.instructions = b.instructions.map((inst) =>
              mapInstOperands(inst, mapVar),
            );
            b.terminator = mapTerminatorOperands(b.terminator, mapVar);
          }
          changed = true;
          continue;
        }

        survivingPhis.push(phi);
      }
      block.phis = survivingPhis;
    }
  }
}

// ─── Main pass ──────────────────────────────────────────────────────────────

function runMem2RegOnFunction(fn: KirFunction): void {
  if (fn.blocks.length === 0) return;

  // Step 1: Find promotable allocas
  const allocas = findPromotableAllocas(fn);
  if (allocas.size === 0) return;

  // Step 2: Build CFG and compute dominance
  const cfg = buildCFG(fn.blocks);
  const idom = computeDominators(cfg);
  const domFrontiers = computeDomFrontiers(cfg, idom);

  // Steps 3-4: Insert phi nodes and rename variables
  const phiMap = insertPhis(fn, cfg, domFrontiers, allocas);
  const newBlocks = renameVariables(fn, cfg, idom, allocas, phiMap);

  fn.blocks = newBlocks;

  // Step 5: Clean up trivial / dead phi nodes
  eliminateDeadPhis(fn.blocks);
}

export function runMem2Reg(module: KirModule): KirModule {
  for (const fn of module.functions) {
    runMem2RegOnFunction(fn);
  }
  return module;
}
