import { Checker } from "./checker/checker.ts";
import { lowerToKir } from "./kir/lowering.ts";
import { printKir } from "./kir/printer.ts";
import { runMem2Reg } from "./kir/mem2reg.ts";
import { runDeSsa } from "./backend/de-ssa.ts";
import { emitC } from "./backend/c-emitter.ts";
import { Lexer } from "./lexer/index.ts";
import { Parser } from "./parser/index.ts";
import { SourceFile } from "./utils/source.ts";

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: bun run src/cli.ts <file.kei> [--ast | --ast-json | --check | --kir | --kir-opt | --emit-c | --build | --run]");
  process.exit(1);
}

const flags = new Set(process.argv.slice(3));
const showAst = flags.has("--ast");
const showAstJson = flags.has("--ast-json");
const runCheck = flags.has("--check");
const showKir = flags.has("--kir");
const showKirOpt = flags.has("--kir-opt");
const emitCFlag = flags.has("--emit-c");
const buildFlag = flags.has("--build");
const runFlag = flags.has("--run");

const content = await Bun.file(filePath).text();
const source = new SourceFile(filePath, content);
const lexer = new Lexer(source);
const tokens = lexer.tokenize();

const lexerDiagnostics = lexer.getDiagnostics();
if (lexerDiagnostics.length > 0) {
  console.error("Lexer diagnostics:");
  for (const diag of lexerDiagnostics) {
    console.error(
      `  ${diag.severity}: ${diag.message} at ${diag.location.file}:${diag.location.line}:${diag.location.column}`
    );
  }
}

if (showAst || showAstJson || runCheck || showKir || showKirOpt || emitCFlag || buildFlag || runFlag) {
  const parser = new Parser(tokens);
  const program = parser.parse();

  const parserDiagnostics = parser.getDiagnostics();
  if (parserDiagnostics.length > 0) {
    console.error("Parser diagnostics:");
    for (const diag of parserDiagnostics) {
      console.error(
        `  ${diag.severity}: ${diag.message} at line ${diag.location.line}:${diag.location.column}`
      );
    }
  }

  if (emitCFlag || buildFlag || runFlag) {
    const checker = new Checker(program, source);
    const result = checker.check();
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    if (errors.length > 0) {
      for (const diag of errors) {
        console.error(
          `${diag.severity}: ${diag.message} at ${diag.location.file}:${diag.location.line}:${diag.location.column}`
        );
      }
      process.exit(1);
    }
    let kirModule = lowerToKir(program, result);
    kirModule = runMem2Reg(kirModule);
    kirModule = runDeSsa(kirModule);
    const cCode = emitC(kirModule);

    if (emitCFlag) {
      console.log(cCode);
    } else {
      // --build or --run: write to .c file and compile
      const outBase = filePath.replace(/\.kei$/, "");
      const cPath = `${outBase}.c`;
      const binPath = outBase;
      await Bun.write(cPath, cCode);

      // Find a C compiler
      const compilers = ["cc", "gcc", "clang"];
      let compiler: string | null = null;
      for (const cc of compilers) {
        try {
          const which = Bun.spawnSync({ cmd: ["which", cc] });
          if (which.exitCode === 0) {
            compiler = cc;
            break;
          }
        } catch {
          // try next
        }
      }

      if (!compiler) {
        console.error("No C compiler found (tried cc, gcc, clang)");
        process.exit(1);
      }

      const compile = Bun.spawnSync({
        cmd: [compiler, "-o", binPath, cPath, "-lm"],
        stderr: "pipe",
      });

      if (compile.exitCode !== 0) {
        console.error(`Compilation failed:\n${compile.stderr.toString()}`);
        process.exit(1);
      }

      if (buildFlag) {
        console.log(`Compiled: ${binPath}`);
      }

      if (runFlag) {
        const run = Bun.spawnSync({
          cmd: [binPath],
          stdout: "inherit",
          stderr: "inherit",
        });
        process.exit(run.exitCode);
      }
    }
  } else if (showKir || showKirOpt) {
    const checker = new Checker(program, source);
    const result = checker.check();
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    if (errors.length > 0) {
      for (const diag of errors) {
        console.error(
          `${diag.severity}: ${diag.message} at ${diag.location.file}:${diag.location.line}:${diag.location.column}`
        );
      }
      process.exit(1);
    }
    let kirModule = lowerToKir(program, result);
    if (showKirOpt) {
      kirModule = runMem2Reg(kirModule);
    }
    console.log(printKir(kirModule));
  } else if (runCheck) {
    const checker = new Checker(program, source);
    const result = checker.check();
    if (result.diagnostics.length > 0) {
      for (const diag of result.diagnostics) {
        console.error(
          `${diag.severity}: ${diag.message} at ${diag.location.file}:${diag.location.line}:${diag.location.column}`
        );
      }
      const errorCount = result.diagnostics.filter((d) => d.severity === "error").length;
      if (errorCount > 0) {
        process.exit(1);
      }
    } else {
      console.log("Check passed: no errors.");
    }
  } else if (showAstJson) {
    console.log(JSON.stringify(program, null, 2));
  } else {
    printAst(program, 0);
  }
} else {
  for (const token of tokens) {
    console.log(`${token.kind}\t${token.lexeme}\t${token.line}:${token.column}`);
  }
}

function printAst(node: Record<string, unknown>, indent: number): void {
  const prefix = "  ".repeat(indent);
  const kind = node.kind as string;

  if (kind === "Program") {
    console.log(`${prefix}Program`);
    const decls = node.declarations as Record<string, unknown>[];
    for (const decl of decls) {
      printAst(decl, indent + 1);
    }
    return;
  }

  // Collect simple fields
  const simpleFields: string[] = [];
  const childNodes: [string, Record<string, unknown> | Record<string, unknown>[]][] = [];

  for (const [key, value] of Object.entries(node)) {
    if (key === "kind" || key === "span") continue;
    if (value === null || value === undefined) continue;

    if (
      Array.isArray(value) &&
      value.length > 0 &&
      typeof value[0] === "object" &&
      value[0]?.kind
    ) {
      childNodes.push([key, value as Record<string, unknown>[]]);
    } else if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).kind
    ) {
      childNodes.push([key, value as Record<string, unknown>]);
    } else if (Array.isArray(value)) {
      simpleFields.push(`${key}=[${value.join(", ")}]`);
    } else {
      simpleFields.push(`${key}=${String(value)}`);
    }
  }

  const fieldStr = simpleFields.length > 0 ? ` ${simpleFields.join(" ")}` : "";
  console.log(`${prefix}${kind}${fieldStr}`);

  for (const [key, value] of childNodes) {
    if (Array.isArray(value)) {
      console.log(`${prefix}  ${key}:`);
      for (const child of value) {
        printAst(child, indent + 2);
      }
    } else {
      console.log(`${prefix}  ${key}:`);
      printAst(value, indent + 2);
    }
  }
}
