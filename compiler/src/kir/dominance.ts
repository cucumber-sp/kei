/**
 * Dominance computation — iterative dominator algorithm, dominance
 * frontiers, and dominator tree construction.
 *
 * Uses the Cooper-Harvey-Kennedy iterative algorithm for immediate
 * dominators, then derives dominance frontiers and dominator tree
 * children from the idom map.
 */

import type { BlockId } from "./kir-types.ts";
import type { CFG } from "./cfg.ts";

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
export function computeDominators(cfg: CFG): Map<BlockId, BlockId> {
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
export function computeDomFrontiers(
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
export function buildDomTree(
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
