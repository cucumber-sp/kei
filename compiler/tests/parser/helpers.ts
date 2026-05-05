import type { Program } from "../../src/ast/nodes";
import { parseSource } from "../helpers/pipeline";

export function parse(source: string): Program {
  return parseSource(source).program;
}

export function parseWithDiagnostics(source: string): {
  program: Program;
  diagnostics: ReadonlyArray<{ message: string }>;
} {
  const { program, diagnostics } = parseSource(source);
  return { program, diagnostics };
}
