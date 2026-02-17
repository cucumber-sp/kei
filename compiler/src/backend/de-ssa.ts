/**
 * De-SSA pass: eliminate phi nodes by inserting copy instructions
 * at the end of predecessor blocks.
 *
 * For each phi:  %dest = φ [%v1 from bb1, %v2 from bb2]
 * We insert:     in bb1: cast %dest = %v1   (same-type copy)
 *                in bb2: cast %dest = %v2
 *
 * Lost-copy problem:
 *   When a block has multiple phi nodes, naive sequential insertion
 *   can produce incorrect results. For example:
 *     %a = φ [%x from bb1, ...]
 *     %b = φ [%a from bb1, ...]
 *   Naive insertion in bb1 would produce:
 *     %a = %x    ← overwrites %a
 *     %b = %a    ← reads the NEW %a, not the old one!
 *
 *   We solve this by reading all source values first, then writing
 *   all destinations — a "parallel copy" semantics. When a phi source
 *   is also a phi dest from the same predecessor, we insert a temporary
 *   to break the interference.
 */

import type {
  KirModule,
  KirFunction,
  KirBlock,
  KirInst,
  KirType,
  VarId,
  BlockId,
} from "../kir/kir-types.ts";

/**
 * Eliminate phi nodes from a KIR module by inserting copy assignments
 * at predecessor block ends. Returns a new module with no phi nodes.
 */
export function runDeSsa(module: KirModule): KirModule {
  return {
    ...module,
    functions: module.functions.map(deSsaFunction),
  };
}

function deSsaFunction(fn: KirFunction): KirFunction {
  let tempCounter = fn.localCount;

  const blockMap = new Map<BlockId, KirBlock>();
  for (const block of fn.blocks) {
    blockMap.set(block.id, {
      id: block.id,
      phis: [],
      instructions: [...block.instructions],
      terminator: block.terminator,
    });
  }

  // Collect all phi copies grouped by predecessor block.
  // Each predecessor needs a set of parallel copies: (dest, src, type).
  const copiesPerPred = new Map<BlockId, { dest: VarId; src: VarId; type: KirType }[]>();

  for (const block of fn.blocks) {
    for (const phi of block.phis) {
      for (const { value, from } of phi.incoming) {
        if (!copiesPerPred.has(from)) {
          copiesPerPred.set(from, []);
        }
        copiesPerPred.get(from)!.push({
          dest: phi.dest,
          src: value,
          type: phi.type,
        });
      }
    }
  }

  // For each predecessor, resolve the parallel copies into a safe
  // sequential order, inserting temporaries where needed.
  for (const [predId, copies] of copiesPerPred) {
    const predBlock = blockMap.get(predId);
    if (!predBlock) continue;

    // Detect which phi dests are also used as sources by other copies
    // from the same predecessor. These need temporaries to preserve
    // the "read all sources, then write all dests" semantics.
    const dests = new Set(copies.map((c) => c.dest));
    const needsTemp = new Set<VarId>();
    for (const copy of copies) {
      if (dests.has(copy.src) && copy.src !== copy.dest) {
        needsTemp.add(copy.src);
      }
    }

    // Phase 1: save interfering sources to temporaries
    const tempMap = new Map<VarId, VarId>();
    for (const src of needsTemp) {
      const copy = copies.find((c) => c.dest === src)!;
      const tempName = `%${tempCounter++}` as VarId;
      tempMap.set(src, tempName);
      const saveInst: KirInst = {
        kind: "cast",
        dest: tempName,
        value: src,
        targetType: copy.type,
      };
      predBlock.instructions.push(saveInst);
    }

    // Phase 2: emit actual copies, reading from temp if needed
    for (const { dest, src, type } of copies) {
      if (dest === src) continue; // self-copy, skip
      const actualSrc = tempMap.get(src) ?? src;
      const copyInst: KirInst = {
        kind: "cast",
        dest: dest,
        value: actualSrc,
        targetType: type,
      };
      predBlock.instructions.push(copyInst);
    }
  }

  // Clear all phi nodes
  for (const block of fn.blocks) {
    const newBlock = blockMap.get(block.id)!;
    newBlock.phis = [];
  }

  return {
    ...fn,
    localCount: tempCounter,
    blocks: fn.blocks.map((b) => blockMap.get(b.id)!),
  };
}
