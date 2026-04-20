/**
 * CLI driver — runs the compiler pipeline based on parsed flags.
 *
 * Public entry: `runDriver(flags)` returns a process exit code.
 *
 * Mode priority (highest first):
 *   --emit-c | --build | --run    → codegen path
 *   --kir | --kir-opt             → KIR-print path
 *   --check                       → type-check only
 *   --ast-json | --ast            → AST dump
 *   (none)                        → lex-only token dump
 */

import type { Program } from "../ast/nodes";
import { emitC } from "../backend/c-emitter";
import { runDeSsa } from "../backend/de-ssa";
import type { ModuleCheckInfo } from "../checker/checker";
import { Checker } from "../checker/checker";
import type { Diagnostic } from "../errors";
import type { KirModule } from "../kir/kir-types";
import { lowerModulesToKir, lowerToKir } from "../kir/lowering";
import { runMem2Reg } from "../kir/mem2reg";
import { printKir } from "../kir/printer";
import { Lexer } from "../lexer";
import { ModuleResolver } from "../modules";
import { Parser } from "../parser";
import { SourceFile } from "../utils/source";
import type { CliFlags } from "./args";
import { printAst } from "./ast-printer";
import { printErrorSummary, reportDiagnostics } from "./diagnostics-format";

export async function runDriver(flags: CliFlags): Promise<number> {
  // Read input file
  let content: string;
  try {
    content = await Bun.file(flags.filePath).text();
  } catch {
    console.error(`error: could not read file '${flags.filePath}'`);
    return 1;
  }

  const source = new SourceFile(flags.filePath, content);
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();

  const allDiagnostics: Diagnostic[] = [...lexer.getDiagnostics()];

  const wantsParse =
    flags.showAst ||
    flags.showAstJson ||
    flags.runCheck ||
    flags.showKir ||
    flags.showKirOpt ||
    flags.emitC ||
    flags.build ||
    flags.run;

  if (!wantsParse) {
    // Lex-only mode
    if (allDiagnostics.length > 0) reportDiagnostics(allDiagnostics, source);
    for (const token of tokens) {
      console.log(`${token.kind}\t${token.lexeme}\t${token.line}:${token.column}`);
    }
    return 0;
  }

  const parser = new Parser(tokens);
  const program = parser.parse();
  allDiagnostics.push(...parser.getDiagnostics());

  // Lex/parse errors are fatal — bail before checking
  const earlyErrors = allDiagnostics.filter((d) => d.severity === "error");
  if (earlyErrors.length > 0) {
    reportDiagnostics(allDiagnostics, source);
    printErrorSummary(earlyErrors.length);
    return 1;
  }

  // Codegen path: --emit-c, --build, or --run
  if (flags.emitC || flags.build || flags.run) {
    const kir = await compileToKir(flags.filePath, program, source, allDiagnostics);
    if (kir === null) return 1;

    const optimized = runDeSsa(runMem2Reg(kir));
    const cCode = emitC(optimized);

    if (flags.emitC) {
      console.log(cCode);
      return 0;
    }
    return await compileAndMaybeRun(flags.filePath, cCode, flags.build, flags.run);
  }

  // KIR-print path
  if (flags.showKir || flags.showKirOpt) {
    const kir = await compileToKir(flags.filePath, program, source, allDiagnostics);
    if (kir === null) return 1;
    const out = flags.showKirOpt ? runMem2Reg(kir) : kir;
    console.log(printKir(out));
    return 0;
  }

  // Check-only path
  if (flags.runCheck) {
    return runCheckOnly(flags.filePath, program, source);
  }

  // AST dump
  if (flags.showAstJson) {
    console.log(JSON.stringify(program, null, 2));
    return 0;
  }
  if (flags.showAst) {
    printAst(program as unknown as Record<string, unknown>, 0);
    return 0;
  }

  return 0;
}

// ─── Pipeline helpers ────────────────────────────────────────────────────────

/**
 * Type-check (single or multi-module depending on imports) and lower to KIR.
 * Returns null on errors (already printed).
 */
async function compileToKir(
  filePath: string,
  program: Program,
  source: SourceFile,
  allDiagnostics: Diagnostic[]
): Promise<KirModule | null> {
  const hasImports = program.declarations.some((d) => d.kind === "ImportDecl");

  if (hasImports) {
    return buildMultiModule(filePath, source);
  }

  const checker = new Checker(program, source);
  const result = checker.check();
  allDiagnostics.push(...result.diagnostics);
  const errorCount = result.diagnostics.filter((d) => d.severity === "error").length;
  if (errorCount > 0) {
    reportDiagnostics(allDiagnostics, source);
    printErrorSummary(errorCount);
    return null;
  }
  return lowerToKir(program, result);
}

/** Resolve all imports, multi-module check, lower combined module. */
function buildMultiModule(mainFilePath: string, mainSource: SourceFile): KirModule | null {
  const resolver = new ModuleResolver(mainFilePath);
  const resolverResult = resolver.resolve(mainFilePath);

  if (resolverResult.errors.length > 0) {
    for (const err of resolverResult.errors) console.error(`error: ${err}`);
    return null;
  }

  const moduleInfos: ModuleCheckInfo[] = resolverResult.modules.map((m) => ({
    name: m.name,
    program: m.program,
    source: m.source,
    importDecls: m.importDecls,
  }));

  const multiResult = Checker.checkModules(moduleInfos);

  const sourceMap = new Map<string, SourceFile>();
  for (const m of resolverResult.modules) sourceMap.set(m.source.filename, m.source);

  const errorCount = multiResult.diagnostics.filter((d) => d.severity === "error").length;
  if (errorCount > 0) {
    reportDiagnostics(multiResult.diagnostics, mainSource, sourceMap);
    printErrorSummary(errorCount);
    return null;
  }

  return lowerModulesToKir(moduleInfos, multiResult);
}

/** --check: type-check only. Returns exit code. */
function runCheckOnly(filePath: string, program: Program, source: SourceFile): number {
  const hasImports = program.declarations.some((d) => d.kind === "ImportDecl");

  if (hasImports) {
    const resolver = new ModuleResolver(filePath);
    const resolverResult = resolver.resolve(filePath);
    if (resolverResult.errors.length > 0) {
      for (const err of resolverResult.errors) console.error(`error: ${err}`);
      return 1;
    }
    const moduleInfos: ModuleCheckInfo[] = resolverResult.modules.map((m) => ({
      name: m.name,
      program: m.program,
      source: m.source,
      importDecls: m.importDecls,
    }));
    const multiResult = Checker.checkModules(moduleInfos);

    const sourceMap = new Map<string, SourceFile>();
    for (const m of resolverResult.modules) sourceMap.set(m.source.filename, m.source);

    if (multiResult.diagnostics.length > 0) {
      const errorCount = reportDiagnostics(multiResult.diagnostics, source, sourceMap);
      if (errorCount > 0) {
        printErrorSummary(errorCount);
        return 1;
      }
    } else {
      console.log("Check passed: no errors.");
    }
    return 0;
  }

  const checker = new Checker(program, source);
  const result = checker.check();
  if (result.diagnostics.length > 0) {
    const errorCount = reportDiagnostics(result.diagnostics, source);
    if (errorCount > 0) {
      printErrorSummary(errorCount);
      return 1;
    }
  } else {
    console.log("Check passed: no errors.");
  }
  return 0;
}

/**
 * Write C, find a C compiler, build, optionally run. Returns exit code.
 * Mirrors original behavior: `--build` prints "Compiled: ..."; `--run`
 * executes the binary; if both set, prints then runs.
 */
async function compileAndMaybeRun(
  filePath: string,
  cCode: string,
  announceBuild: boolean,
  shouldRun: boolean
): Promise<number> {
  const outBase = filePath.replace(/\.kei$/, "");
  const cPath = `${outBase}.c`;
  const binPath = outBase;
  await Bun.write(cPath, cCode);

  const compiler = findCCompiler();
  if (!compiler) {
    console.error("error: no C compiler found (tried cc, gcc, clang)");
    return 1;
  }

  const compile = Bun.spawnSync({
    cmd: [compiler, "-o", binPath, cPath, "-lm"],
    stderr: "pipe",
  });

  if (compile.exitCode !== 0) {
    console.error(`error: C compilation failed:\n${compile.stderr.toString()}`);
    return 1;
  }

  if (announceBuild) console.log(`Compiled: ${binPath}`);

  if (shouldRun) {
    const run = Bun.spawnSync({
      cmd: [binPath],
      stdout: "inherit",
      stderr: "inherit",
    });
    return run.exitCode ?? 0;
  }
  return 0;
}

function findCCompiler(): string | null {
  for (const cc of ["cc", "gcc", "clang"]) {
    try {
      const which = Bun.spawnSync({ cmd: ["which", cc] });
      if (which.exitCode === 0) return cc;
    } catch {
      // try next
    }
  }
  return null;
}
