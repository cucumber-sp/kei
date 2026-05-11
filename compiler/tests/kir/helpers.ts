/**
 * Test utilities for KIR lowering.
 */

import type {
  KirBlock,
  KirFunction,
  KirInst,
  KirModule,
  KirTerminator,
} from "../../src/kir/kir-types";
import { printKir } from "../../src/kir/printer";
import { runLifecyclePass } from "../../src/lifecycle";
import { lowerSource } from "../helpers/pipeline";

/**
 * Parse, check, lower to KIR, and run the Lifecycle rewrite pass.
 *
 * The pass strips lifecycle markers and rewrites `mark_assign` into
 * concrete `destroy` / `store` / `oncopy` sequences — the same KIR shape
 * mem2reg and the C emitter consume downstream. Running it here keeps
 * KIR-level assertions stable as insertion sites cut over from inline
 * emission to markers (Lifecycle migration PR 4a–4e).
 */
export function lower(source: string): KirModule {
  return runLifecyclePass(lowerSource(source), () => undefined);
}

/** Lower and return the printed KIR text. */
export function lowerAndPrint(source: string): string {
  return printKir(lower(source));
}

/** Lower and return a specific function by name. */
export function lowerFunction(source: string, name: string): KirFunction {
  const mod = lower(source);
  const fn = mod.functions.find((f) => f.name === name);
  if (!fn) {
    const available = mod.functions.map((f) => f.name).join(", ");
    throw new Error(`Function '${name}' not found. Available: ${available}`);
  }
  return fn;
}

/** Get all instructions of a given kind from a function. */
export function getInstructions(fn: KirFunction, kind: string): KirInst[] {
  const result: KirInst[] = [];
  for (const block of fn.blocks) {
    for (const inst of block.instructions) {
      if (inst.kind === kind) {
        result.push(inst);
      }
    }
  }
  return result;
}

/** Get all terminators of a given kind from a function. */
export function getTerminators(fn: KirFunction, kind: string): KirTerminator[] {
  const result: KirTerminator[] = [];
  for (const block of fn.blocks) {
    if (block.terminator.kind === kind) {
      result.push(block.terminator);
    }
  }
  return result;
}

/** Get a block by its id. */
export function getBlock(fn: KirFunction, id: string): KirBlock | undefined {
  return fn.blocks.find((b) => b.id === id);
}

/** Count total instructions across all blocks. */
export function countInstructions(fn: KirFunction, kind?: string): number {
  let count = 0;
  for (const block of fn.blocks) {
    for (const inst of block.instructions) {
      if (!kind || inst.kind === kind) count++;
    }
  }
  return count;
}
