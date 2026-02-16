import type { Program } from "../../src/ast/nodes.ts";
import { Lexer } from "../../src/lexer/index.ts";
import { Parser } from "../../src/parser/index.ts";
import { SourceFile } from "../../src/utils/source.ts";

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
