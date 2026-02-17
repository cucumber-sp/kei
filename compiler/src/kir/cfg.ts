/**
 * CFG construction — builds control flow graph from KIR blocks.
 *
 * Computes predecessor/successor maps from terminator edges and derives
 * a reverse post-order (RPO) via DFS from the entry block.
 */

import type { BlockId, KirBlock, KirTerminator } from "./kir-types.ts";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CFG {
  preds: Map<BlockId, BlockId[]>;
  succs: Map<BlockId, BlockId[]>;
  /** Blocks in reverse post-order (reachable from entry only). */
  blockOrder: BlockId[];
  blockMap: Map<BlockId, KirBlock>;
}

// ─── CFG helpers ────────────────────────────────────────────────────────────

/**
 * Build the control-flow graph for a function's blocks.
 *
 * Computes predecessor/successor maps from terminator edges, then
 * derives a reverse post-order (RPO) via DFS from the entry block.
 * Only blocks reachable from the entry appear in blockOrder — unreachable
 * blocks are excluded from dominance/phi computations.
 */
export function buildCFG(blocks: KirBlock[]): CFG {
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
