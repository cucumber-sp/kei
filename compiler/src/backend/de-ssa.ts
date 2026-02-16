/**
 * De-SSA pass: eliminate phi nodes by inserting copy instructions
 * at the end of predecessor blocks.
 *
 * Phi nodes are SSA constructs that have no direct C equivalent.
 * We lower them to simple variable copies placed before the terminator
 * in each predecessor block.
 *
 * For each phi:  %dest = φ [%v1 from bb1, %v2 from bb2]
 * We insert:     in bb1: store &%dest, %v1   (before terminator)
 *                in bb2: store &%dest, %v2   (before terminator)
 *
 * Since we're post-mem2reg, we reuse the KIR copy semantics by adding
 * a "bin_op" with op="copy" — but since KIR doesn't have a copy instruction,
 * we use const_int/const_bool assignments or direct variable aliasing.
 *
 * Actually, the simplest approach: for each phi, we declare the phi dest
 * as a regular variable and insert assignments (store-like copies) at
 * predecessor ends. We represent copies as a synthetic "bin_op" with
 * op="add" and rhs=0 for ints, but that's hacky. Instead, we'll just
 * keep it as a proper copy using the existing instruction set:
 *   - Add a KirLoad-like copy: %dest = %src (identity)
 *
 * Since KIR doesn't have a "copy" instruction, we'll add the copies as
 * const assignments where possible, or use the KirCast with same type.
 * The simplest correct approach: use KirCast with identical source/target type
 * as a "move" instruction. The C emitter will recognize cast-to-same-type as
 * a simple assignment.
 */

import type {
  KirModule,
  KirFunction,
  KirBlock,
  KirInst,
  KirPhi,
  KirType,
  KirTerminator,
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
  const blockMap = new Map<BlockId, KirBlock>();
  for (const block of fn.blocks) {
    blockMap.set(block.id, {
      id: block.id,
      phis: [],
      instructions: [...block.instructions],
      terminator: block.terminator,
    });
  }

  // For each block that has phis, insert copies in predecessors
  for (const block of fn.blocks) {
    for (const phi of block.phis) {
      for (const { value, from } of phi.incoming) {
        const predBlock = blockMap.get(from);
        if (!predBlock) continue;

        // Insert a cast (same-type copy) before the terminator
        const copyInst: KirInst = {
          kind: "cast",
          dest: phi.dest,
          value: value,
          targetType: phi.type,
        };
        predBlock.instructions.push(copyInst);
      }
    }
    // Clear phis from the target block
    const newBlock = blockMap.get(block.id)!;
    newBlock.phis = [];
  }

  return {
    ...fn,
    blocks: fn.blocks.map((b) => blockMap.get(b.id)!),
  };
}
