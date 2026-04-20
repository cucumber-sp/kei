import type { Program } from "../../src/ast/nodes";
import { Lexer } from "../../src/lexer";
import { Parser } from "../../src/parser";
import { SourceFile } from "../../src/utils/source";

export function parse(source: string): Program {
  const file = new SourceFile("test.kei", source);
  const lexer = new Lexer(file);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  return parser.parse();
}

export function parseWithDiagnostics(source: string): {
  program: Program;
  diagnostics: ReadonlyArray<{ message: string }>;
} {
  const file = new SourceFile("test.kei", source);
  const lexer = new Lexer(file);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  return { program, diagnostics: parser.getDiagnostics() };
}
