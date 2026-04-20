/**
 * CLI argument parsing — pure: returns a discriminated result, never exits.
 *
 * The entry point in `cli.ts` decides what to do with each variant
 * (`help`/`version` print + exit 0; `error` prints + exits 1; `compile`
 * passes flags to the driver).
 */

export const VERSION = "0.1.0";

/** Action flags + input file. Multiple action flags are allowed; the driver
 * picks the highest-priority one (codegen > KIR-print > check > AST > lex). */
export interface CliFlags {
  filePath: string;
  showAst: boolean;
  showAstJson: boolean;
  runCheck: boolean;
  showKir: boolean;
  showKirOpt: boolean;
  emitC: boolean;
  build: boolean;
  run: boolean;
}

export type ParseResult =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "error"; message: string }
  | { kind: "compile"; flags: CliFlags };

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

const SHORT_FLAGS = new Set(["-h", "-V"]);

export function parseArgs(argv: readonly string[]): ParseResult {
  if (argv.includes("--help") || argv.includes("-h")) return { kind: "help" };
  if (argv.includes("--version") || argv.includes("-V")) return { kind: "version" };

  const filePath = argv.find((a) => !a.startsWith("-"));
  if (!filePath) return { kind: "error", message: "no input file provided" };

  const flagArgs = argv.filter((a) => a.startsWith("-"));
  for (const flag of flagArgs) {
    if (!KNOWN_FLAGS.has(flag) && !SHORT_FLAGS.has(flag)) {
      return { kind: "error", message: `unknown flag '${flag}'` };
    }
  }

  const flagSet = new Set(flagArgs);
  return {
    kind: "compile",
    flags: {
      filePath,
      showAst: flagSet.has("--ast"),
      showAstJson: flagSet.has("--ast-json"),
      runCheck: flagSet.has("--check"),
      showKir: flagSet.has("--kir"),
      showKirOpt: flagSet.has("--kir-opt"),
      emitC: flagSet.has("--emit-c"),
      build: flagSet.has("--build"),
      run: flagSet.has("--run"),
    },
  };
}

export function printHelp(): void {
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
