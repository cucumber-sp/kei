import { Lexer } from "./lexer/index.ts";
import { SourceFile } from "./utils/source.ts";

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: bun run src/cli.ts <file.kei>");
  process.exit(1);
}

const content = await Bun.file(filePath).text();
const source = new SourceFile(filePath, content);
const lexer = new Lexer(source);
const tokens = lexer.tokenize();

for (const token of tokens) {
  console.log(`${token.kind}\t${token.lexeme}\t${token.line}:${token.column}`);
}

const diagnostics = lexer.getDiagnostics();
if (diagnostics.length > 0) {
  console.error("\nDiagnostics:");
  for (const diag of diagnostics) {
    console.error(
      `  ${diag.severity}: ${diag.message} at ${diag.location.file}:${diag.location.line}:${diag.location.column}`
    );
  }
}
