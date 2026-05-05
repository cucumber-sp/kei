/**
 * CLI argument parsing — pure: returns a discriminated result, never exits.
 *
 * The entry point in `cli.ts` decides what to do with each variant
 * (`help`/`version` print + exit 0; `error` prints + exits 1; `compile`
 * passes flags to the driver).
 */

export const VERSION = "0.1.0";

/**
 * Action flags + input file. Multiple action flags are allowed; the driver
 * picks the highest-priority one (codegen > KIR-print > check > AST > lex).
 */
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

/** Boolean-flag keys on CliFlags (excludes filePath). */
type BooleanFlagKey = Exclude<keyof CliFlags, "filePath">;

/** Long flag → corresponding boolean field on `CliFlags`. */
const FLAG_FIELDS: Record<string, BooleanFlagKey> = {
  "--ast": "showAst",
  "--ast-json": "showAstJson",
  "--check": "runCheck",
  "--kir": "showKir",
  "--kir-opt": "showKirOpt",
  "--emit-c": "emitC",
  "--build": "build",
  "--run": "run",
};

/** Short flag → long flag (meta-flags handled before action-flag parsing). */
const SHORT_ALIASES: Record<string, string> = {
  "-h": "--help",
  "-V": "--version",
};

const META_FLAGS = new Set(["--help", "--version"]);

const KNOWN_FLAGS = new Set<string>([
  ...Object.keys(FLAG_FIELDS),
  ...Object.keys(SHORT_ALIASES),
  ...META_FLAGS,
]);

function normalizeFlag(arg: string): string {
  return SHORT_ALIASES[arg] ?? arg;
}

export function parseArgs(argv: readonly string[]): ParseResult {
  const flagArgs = argv.filter((a) => a.startsWith("-")).map(normalizeFlag);

  if (flagArgs.includes("--help")) return { kind: "help" };
  if (flagArgs.includes("--version")) return { kind: "version" };

  const unknown = flagArgs.find((f) => !KNOWN_FLAGS.has(f));
  if (unknown) return { kind: "error", message: `unknown flag '${unknown}'` };

  const filePath = argv.find((a) => !a.startsWith("-"));
  if (!filePath) return { kind: "error", message: "no input file provided" };

  const flagSet = new Set(flagArgs);
  const compiled: CliFlags = {
    filePath,
    showAst: false,
    showAstJson: false,
    runCheck: false,
    showKir: false,
    showKirOpt: false,
    emitC: false,
    build: false,
    run: false,
  };
  for (const [flag, field] of Object.entries(FLAG_FIELDS)) {
    if (flagSet.has(flag)) compiled[field] = true;
  }
  return { kind: "compile", flags: compiled };
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
