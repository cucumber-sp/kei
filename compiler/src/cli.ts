import type { Program } from "./ast/nodes.ts";
import { emitC } from "./backend/c-emitter.ts";
import { runDeSsa } from "./backend/de-ssa.ts";
import type { CheckResult, ModuleCheckInfo } from "./checker/checker.ts";
import { Checker } from "./checker/checker.ts";
import type { Diagnostic } from "./errors/index.ts";
import type { KirModule } from "./kir/kir-types.ts";
import { lowerModulesToKir, lowerToKir } from "./kir/lowering.ts";
import { runMem2Reg } from "./kir/mem2reg.ts";
import { printKir } from "./kir/printer.ts";
import { Lexer } from "./lexer/index.ts";
import { ModuleResolver } from "./modules/index.ts";
import { Parser } from "./parser/index.ts";
import { SourceFile } from "./utils/source.ts";

const VERSION = "0.1.0";

const KNOWN_FLAGS = new Set([
  "--ast",
  "--ast-json",
  "--check",
  "--kir",
  "--kir-opt",
  "--emit-c",
  "--build",
  "--run",
  "--help",
  "--version",
]);

// ─── Argument parsing ────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (args.includes("--version") || args.includes("-V")) {
  console.log(`kei ${VERSION}`);
  process.exit(0);
}

const filePath = args.find((a) => !a.startsWith("-"));

if (!filePath) {
  console.error("error: no input file provided\n");
  printHelp();
  process.exit(1);
}

const flags = new Set(args.filter((a) => a.startsWith("-")));

// Warn on unknown flags
for (const flag of flags) {
  if (!KNOWN_FLAGS.has(flag) && flag !== "-h" && flag !== "-V") {
    console.error(`error: unknown flag '${flag}'`);
    console.error("Run with --help to see available options.\n");
    process.exit(1);
  }
}

const showAst = flags.has("--ast");
const showAstJson = flags.has("--ast-json");
const runCheck = flags.has("--check");
const showKir = flags.has("--kir");
const showKirOpt = flags.has("--kir-opt");
const emitCFlag = flags.has("--emit-c");
const buildFlag = flags.has("--build");
const runFlag = flags.has("--run");

// ─── Formatting helpers ──────────────────────────────────────────────────────

/** Format a diagnostic with source context: file:line:col, message, source line, caret. */
function formatDiagnostic(diag: Diagnostic, source?: SourceFile): string {
  const loc = diag.location;
  const file = loc.file || "<unknown>";
  const header = `${file}:${loc.line}:${loc.column}: ${diag.severity}: ${diag.message}`;

  if (!source) return header;

  // Extract the source line for context
  const lines = source.content.split("\n");
  const lineIdx = loc.line - 1;
  if (lineIdx < 0 || lineIdx >= lines.length) return header;

  const srcLine = lines[lineIdx];
  const trimmed = srcLine;
  const caret = " ".repeat(loc.column - 1) + "^";

  return `${header}\n  ${trimmed}\n  ${caret}`;
}

/** Print all diagnostics with source context. Returns the error count. */
function reportDiagnostics(
  diagnostics: readonly Diagnostic[],
  source?: SourceFile,
  sourceMap?: Map<string, SourceFile>
): number {
  let errorCount = 0;
  for (const diag of diagnostics) {
    // Use per-file source map if available, otherwise fall back to single source
    const src = sourceMap?.get(diag.location.file) ?? source;
    console.error(formatDiagnostic(diag, src));
    if (diag.severity === "error") errorCount++;
  }
  return errorCount;
}

function printHelp(): void {
  console.log(`kei ${VERSION} — the Kei compiler

Usage: kei <file.kei> [options]

Options:
  --ast        Print the AST in tree form
  --ast-json   Print the AST as JSON
  --check      Type-check only (no codegen)
  --kir        Print KIR (lowered IR)
  --kir-opt    Print KIR after optimization (mem2reg)
  --emit-c     Emit generated C code to stdout
  --build      Compile to a native binary
  --run        Compile and run the program
  --help, -h   Show this help message
  --version, -V  Show the compiler version

If no option is given, the file is lexed and tokens are printed.

Examples:
  kei hello.kei --run        Compile and run hello.kei
  kei hello.kei --build      Compile hello.kei to a binary
  kei hello.kei --check      Type-check hello.kei
  kei hello.kei --emit-c     Print generated C code`);
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

let content: string;
try {
  content = await Bun.file(filePath).text();
} catch {
  console.error(`error: could not read file '${filePath}'`);
  process.exit(1);
}

const source = new SourceFile(filePath, content);
const lexer = new Lexer(source);
const tokens = lexer.tokenize();

const allDiagnostics: Diagnostic[] = [];

const lexerDiagnostics = lexer.getDiagnostics();
allDiagnostics.push(...lexerDiagnostics);

if (
  showAst ||
  showAstJson ||
  runCheck ||
  showKir ||
  showKirOpt ||
  emitCFlag ||
  buildFlag ||
  runFlag
) {
  const parser = new Parser(tokens);
  const program = parser.parse();

  const parserDiagnostics = parser.getDiagnostics();
  allDiagnostics.push(...parserDiagnostics);

  // If there are lex/parse errors, report them all and exit
  const earlyErrors = allDiagnostics.filter((d) => d.severity === "error");
  if (earlyErrors.length > 0) {
    reportDiagnostics(allDiagnostics, source);
    const n = earlyErrors.length;
    console.error(`\n${n} error${n !== 1 ? "s" : ""} emitted`);
    process.exit(1);
  }

  if (emitCFlag || buildFlag || runFlag) {
    let kirModule: KirModule;

    const hasImports = program.declarations.some((d) => d.kind === "ImportDecl");
    if (hasImports) {
      kirModule = buildMultiModule(filePath, program, source);
    } else {
      const checker = new Checker(program, source);
      const result = checker.check();
      allDiagnostics.push(...result.diagnostics);
      const errorCount = result.diagnostics.filter((d) => d.severity === "error").length;
      if (errorCount > 0) {
        reportDiagnostics(allDiagnostics, source);
        console.error(`\n${errorCount} error${errorCount !== 1 ? "s" : ""} emitted`);
        process.exit(1);
      }
      kirModule = lowerToKir(program, result);
    }

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
        console.error("error: no C compiler found (tried cc, gcc, clang)");
        process.exit(1);
      }

      const compile = Bun.spawnSync({
        cmd: [compiler, "-o", binPath, cPath, "-lm"],
        stderr: "pipe",
      });

      if (compile.exitCode !== 0) {
        console.error(`error: C compilation failed:\n${compile.stderr.toString()}`);
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
    let kirModule: KirModule;

    const hasImports = program.declarations.some((d) => d.kind === "ImportDecl");
    if (hasImports) {
      kirModule = buildMultiModule(filePath, program, source);
    } else {
      const checker = new Checker(program, source);
      const result = checker.check();
      allDiagnostics.push(...result.diagnostics);
      const errorCount = result.diagnostics.filter((d) => d.severity === "error").length;
      if (errorCount > 0) {
        reportDiagnostics(allDiagnostics, source);
        console.error(`\n${errorCount} error${errorCount !== 1 ? "s" : ""} emitted`);
        process.exit(1);
      }
      kirModule = lowerToKir(program, result);
    }

    if (showKirOpt) {
      kirModule = runMem2Reg(kirModule);
    }
    console.log(printKir(kirModule));
  } else if (runCheck) {
    const hasImports = program.declarations.some((d) => d.kind === "ImportDecl");
    if (hasImports) {
      const resolver = new ModuleResolver(filePath);
      const resolverResult = resolver.resolve(filePath);
      if (resolverResult.errors.length > 0) {
        for (const err of resolverResult.errors) {
          console.error(`error: ${err}`);
        }
        process.exit(1);
      }
      const moduleInfos: ModuleCheckInfo[] = resolverResult.modules.map((m) => ({
        name: m.name,
        program: m.program,
        source: m.source,
        importDecls: m.importDecls,
      }));
      const multiResult = Checker.checkModules(moduleInfos);

      // Build a source map for multi-module diagnostics
      const sourceMap = new Map<string, SourceFile>();
      for (const m of resolverResult.modules) {
        sourceMap.set(m.source.filename, m.source);
      }

      if (multiResult.diagnostics.length > 0) {
        const errorCount = reportDiagnostics(multiResult.diagnostics, source, sourceMap);
        if (errorCount > 0) {
          console.error(`\n${errorCount} error${errorCount !== 1 ? "s" : ""} emitted`);
          process.exit(1);
        }
      } else {
        console.log("Check passed: no errors.");
      }
    } else {
      const checker = new Checker(program, source);
      const result = checker.check();
      if (result.diagnostics.length > 0) {
        const errorCount = reportDiagnostics(result.diagnostics, source);
        if (errorCount > 0) {
          console.error(`\n${errorCount} error${errorCount !== 1 ? "s" : ""} emitted`);
          process.exit(1);
        }
      } else {
        console.log("Check passed: no errors.");
      }
    }
  } else if (showAstJson) {
    console.log(JSON.stringify(program, null, 2));
  } else {
    printAst(program, 0);
  }
} else {
  // Lex-only mode: report any diagnostics then print tokens
  if (allDiagnostics.length > 0) {
    reportDiagnostics(allDiagnostics, source);
  }
  for (const token of tokens) {
    console.log(`${token.kind}\t${token.lexeme}\t${token.line}:${token.column}`);
  }
}

// ─── Multi-module build ──────────────────────────────────────────────────────

/** Build a KIR module from a multi-file project with imports. */
function buildMultiModule(
  mainFilePath: string,
  _mainProgram: Program,
  mainSource: SourceFile
): KirModule {
  const resolver = new ModuleResolver(mainFilePath);
  const resolverResult = resolver.resolve(mainFilePath);

  if (resolverResult.errors.length > 0) {
    for (const err of resolverResult.errors) {
      console.error(`error: ${err}`);
    }
    process.exit(1);
  }

  const moduleInfos: ModuleCheckInfo[] = resolverResult.modules.map((m) => ({
    name: m.name,
    program: m.program,
    source: m.source,
    importDecls: m.importDecls,
  }));

  const multiResult = Checker.checkModules(moduleInfos);

  // Build source map for multi-module diagnostics
  const sourceMap = new Map<string, SourceFile>();
  for (const m of resolverResult.modules) {
    sourceMap.set(m.source.filename, m.source);
  }

  const errorCount = multiResult.diagnostics.filter((d) => d.severity === "error").length;
  if (errorCount > 0) {
    reportDiagnostics(multiResult.diagnostics, mainSource, sourceMap);
    console.error(`\n${errorCount} error${errorCount !== 1 ? "s" : ""} emitted`);
    process.exit(1);
  }

  return lowerModulesToKir(moduleInfos, multiResult);
}

// ─── AST printer ─────────────────────────────────────────────────────────────

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
