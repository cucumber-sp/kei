/**
 * De-SSA pass: eliminate phi nodes by inserting copy instructions
 * at the end of predecessor blocks.
 *
 * For each phi:  %dest = φ [%v1 from bb1, %v2 from bb2]
 * We insert:     in bb1: cast %dest = %v1   (same-type copy)
 *                in bb2: cast %dest = %v2
 */

import type {
  KirModule,
  KirFunction,
  KirBlock,
  KirInst,
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
  const blockMap = new Map<BlockId, KirBlock>();
  for (const block of fn.blocks) {
    blockMap.set(block.id, {
      id: block.id,
      phis: [],
      instructions: [...block.instructions],
      terminator: block.terminator,
    });
  }

  for (const block of fn.blocks) {
    for (const phi of block.phis) {
      for (const { value, from } of phi.incoming) {
        const predBlock = blockMap.get(from);
        if (!predBlock) continue;

        const copyInst: KirInst = {
          kind: "cast",
          dest: phi.dest,
          value: value,
          targetType: phi.type,
        };
        predBlock.instructions.push(copyInst);
      }
    }
    const newBlock = blockMap.get(block.id)!;
    newBlock.phis = [];
  }

  return {
    ...fn,
    blocks: fn.blocks.map((b) => blockMap.get(b.id)!),
  };
}
