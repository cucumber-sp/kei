/**
 * Test utilities for KIR lowering.
 */

import { Checker } from "../../src/checker/checker.ts";
import { lowerToKir } from "../../src/kir/lowering.ts";
import { printKir } from "../../src/kir/printer.ts";
import type { KirModule, KirFunction, KirBlock, KirInst, KirTerminator } from "../../src/kir/kir-types.ts";
import { Lexer } from "../../src/lexer/index.ts";
import { Parser } from "../../src/parser/index.ts";
import { SourceFile } from "../../src/utils/source.ts";

/** Parse, check, and lower source code to KIR. */
export function lower(source: string): KirModule {
  const file = new SourceFile("test.kei", source);
  const lexer = new Lexer(file);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();

  const parserDiags = parser.getDiagnostics();
  if (parserDiags.length > 0) {
    const msgs = parserDiags.map((d) => d.message).join(", ");
    throw new Error(`Parser errors: ${msgs}`);
  }

  const checker = new Checker(program, file);
  const result = checker.check();

  const errors = result.diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    const msgs = errors.map((d) => `  ${d.message} at ${d.location.line}:${d.location.column}`).join("\n");
    throw new Error(`Type errors:\n${msgs}`);
  }

  return lowerToKir(program, result);
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
