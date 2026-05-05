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
  const source = await readSource(flags.filePath);
  if (source === null) return 1;

  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const lexDiagnostics: Diagnostic[] = [...lexer.getDiagnostics()];

  if (!needsParse(flags)) {
    if (lexDiagnostics.length > 0) reportDiagnostics(lexDiagnostics, source);
    for (const token of tokens) {
      console.log(`${token.kind}\t${token.lexeme}\t${token.line}:${token.column}`);
    }
    return 0;
  }

  const parser = new Parser(tokens);
  const program = parser.parse();
  const parseDiagnostics: Diagnostic[] = [...lexDiagnostics, ...parser.getDiagnostics()];

  // Lex/parse errors are fatal — bail before checking
  const earlyErrors = parseDiagnostics.filter((d) => d.severity === "error");
  if (earlyErrors.length > 0) {
    reportDiagnostics(parseDiagnostics, source);
    printErrorSummary(earlyErrors.length);
    return 1;
  }

  if (flags.emitC || flags.build || flags.run) {
    const kir = compileToKir(flags.filePath, program, source, parseDiagnostics);
    if (kir === null) return 1;

    const cCode = emitC(runDeSsa(runMem2Reg(kir)));
    if (flags.emitC) {
      console.log(cCode);
      return 0;
    }
    return await compileAndMaybeRun(flags.filePath, cCode, flags.build, flags.run);
  }

  if (flags.showKir || flags.showKirOpt) {
    const kir = compileToKir(flags.filePath, program, source, parseDiagnostics);
    if (kir === null) return 1;
    console.log(printKir(flags.showKirOpt ? runMem2Reg(kir) : kir));
    return 0;
  }

  if (flags.runCheck) {
    return runCheckOnly(flags.filePath, program, source);
  }

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

// ─── Input + flag helpers ────────────────────────────────────────────────────

async function readSource(filePath: string): Promise<SourceFile | null> {
  try {
    const content = await Bun.file(filePath).text();
    return new SourceFile(filePath, content);
  } catch {
    console.error(`error: could not read file '${filePath}'`);
    return null;
  }
}

function needsParse(flags: CliFlags): boolean {
  return (
    flags.showAst ||
    flags.showAstJson ||
    flags.runCheck ||
    flags.showKir ||
    flags.showKirOpt ||
    flags.emitC ||
    flags.build ||
    flags.run
  );
}

// ─── Pipeline helpers ────────────────────────────────────────────────────────

/**
 * Combined result of running the type checker (single- or multi-module).
 * Discriminated on `mode` so codegen can pick the right `lowerToKir` overload.
 */
type CheckOutcome =
  | {
      mode: "single";
      diagnostics: Diagnostic[];
      sourceMap: Map<string, SourceFile>;
      result: ReturnType<Checker["check"]>;
    }
  | {
      mode: "multi";
      diagnostics: Diagnostic[];
      sourceMap: Map<string, SourceFile>;
      modules: ModuleCheckInfo[];
      result: ReturnType<typeof Checker.checkModules>;
    };

function hasImports(program: Program): boolean {
  return program.declarations.some((d) => d.kind === "ImportDecl");
}

/**
 * Run the appropriate checker (single- or multi-module). Resolver errors are
 * printed inline and return a sentinel `null` result; otherwise the caller
 * decides what to do with the diagnostics.
 */
function runChecker(filePath: string, program: Program, source: SourceFile): CheckOutcome | null {
  if (!hasImports(program)) {
    const result = new Checker(program, source).check();
    return {
      mode: "single",
      diagnostics: result.diagnostics,
      sourceMap: new Map([[source.filename, source]]),
      result,
    };
  }

  const resolverResult = new ModuleResolver(filePath).resolve(filePath);
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
  const result = Checker.checkModules(moduleInfos);

  const sourceMap = new Map<string, SourceFile>();
  for (const m of resolverResult.modules) sourceMap.set(m.source.filename, m.source);

  return {
    mode: "multi",
    diagnostics: result.diagnostics,
    sourceMap,
    modules: moduleInfos,
    result,
  };
}

/**
 * Type-check (single- or multi-module depending on imports) and lower to KIR.
 * Returns null on errors (already printed).
 */
function compileToKir(
  filePath: string,
  program: Program,
  source: SourceFile,
  parseDiagnostics: Diagnostic[]
): KirModule | null {
  const outcome = runChecker(filePath, program, source);
  if (outcome === null) return null;

  const allDiagnostics = [...parseDiagnostics, ...outcome.diagnostics];
  const errorCount = allDiagnostics.filter((d) => d.severity === "error").length;
  if (errorCount > 0) {
    reportDiagnostics(allDiagnostics, source, outcome.sourceMap);
    printErrorSummary(errorCount);
    return null;
  }

  return outcome.mode === "multi"
    ? lowerModulesToKir(outcome.modules, outcome.result)
    : lowerToKir(program, outcome.result);
}

/** --check: type-check only. Returns exit code. */
function runCheckOnly(filePath: string, program: Program, source: SourceFile): number {
  const outcome = runChecker(filePath, program, source);
  if (outcome === null) return 1;

  if (outcome.diagnostics.length === 0) {
    console.log("Check passed: no errors.");
    return 0;
  }

  const errorCount = reportDiagnostics(outcome.diagnostics, source, outcome.sourceMap);
  if (errorCount > 0) {
    printErrorSummary(errorCount);
    return 1;
  }
  return 0;
}

/**
 * Write C, find a C compiler, build, optionally run. Returns exit code.
 * `--build` prints "Compiled: ..."; `--run` executes the binary;
 * if both set, prints then runs.
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
