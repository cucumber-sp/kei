/**
 * CLI argument parsing — pure: returns a discriminated result, never exits.
 *
 * The entry point in `cli.ts` decides what to do with each variant
 * (`help`/`version` print + exit 0; `error` prints + exits 1; `compile`
 * passes flags to the driver).
 */

export const VERSION = "0.1.0";

/** Build profiles map to a fixed set of C-compiler flags in the driver. */
export type Profile = "debug" | "release";

/** Names of C compilers the driver knows how to invoke. */
export const CC_CHOICES = ["cc", "gcc", "clang"] as const;
export type CcChoice = (typeof CC_CHOICES)[number];

/**
 * Action flags + input file. Multiple action flags are allowed; the driver
 * picks the highest-priority one (codegen > KIR-print > check > AST > lex).
 *
 * `profile` and `backend` are codegen-only (only consulted for `--build` /
 * `--run`). `backend === null` means "auto-detect first available compiler".
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
  profile: Profile;
  backend: CcChoice | null;
}

export type ParseResult =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "error"; message: string }
  | { kind: "compile"; flags: CliFlags };

/** Boolean-flag keys on CliFlags (excludes filePath + value-bearing fields). */
type BooleanFlagKey = Exclude<keyof CliFlags, "filePath" | "profile" | "backend">;

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

/** Profile-selecting bool flags. Last one wins if both are passed. */
const PROFILE_FLAGS: Record<string, Profile> = {
  "--debug": "debug",
  "--release": "release",
};

/** Value-bearing flags (consumed via `--key=value` syntax). */
const VALUE_FLAGS = new Set(["--backend"]);

/** Short flag → long flag (meta-flags handled before action-flag parsing). */
const SHORT_ALIASES: Record<string, string> = {
  "-h": "--help",
  "-V": "--version",
};

const META_FLAGS = new Set(["--help", "--version"]);

const KNOWN_FLAGS = new Set<string>([
  ...Object.keys(FLAG_FIELDS),
  ...Object.keys(PROFILE_FLAGS),
  ...VALUE_FLAGS,
  ...Object.keys(SHORT_ALIASES),
  ...META_FLAGS,
]);

function normalizeFlag(arg: string): string {
  return SHORT_ALIASES[arg] ?? arg;
}

/** Split `--key=value` into `[key, value]`; otherwise `[arg, null]`. */
function splitFlag(arg: string): [string, string | null] {
  const eq = arg.indexOf("=");
  if (eq < 0) return [arg, null];
  return [arg.slice(0, eq), arg.slice(eq + 1)];
}

export function parseArgs(argv: readonly string[]): ParseResult {
  // Short-circuit on meta flags before any validation, matching prior behaviour.
  const rawFlagArgs = argv.filter((a) => a.startsWith("-")).map(normalizeFlag);
  const bareFlagKeys = rawFlagArgs.map((a) => splitFlag(a)[0]);

  if (bareFlagKeys.includes("--help")) return { kind: "help" };
  if (bareFlagKeys.includes("--version")) return { kind: "version" };

  const compiled: CliFlags = {
    filePath: "",
    showAst: false,
    showAstJson: false,
    runCheck: false,
    showKir: false,
    showKirOpt: false,
    emitC: false,
    build: false,
    run: false,
    profile: "debug",
    backend: null,
  };

  for (const arg of rawFlagArgs) {
    const [key, value] = splitFlag(arg);

    if (!KNOWN_FLAGS.has(key)) {
      return { kind: "error", message: `unknown flag '${key}'` };
    }

    if (VALUE_FLAGS.has(key)) {
      if (value === null) {
        return { kind: "error", message: `flag '${key}' requires a value (use ${key}=VALUE)` };
      }
      const err = applyValueFlag(compiled, key, value);
      if (err !== null) return { kind: "error", message: err };
      continue;
    }

    if (value !== null) {
      return { kind: "error", message: `flag '${key}' does not take a value` };
    }

    const profile = PROFILE_FLAGS[key];
    if (profile !== undefined) {
      compiled.profile = profile;
      continue;
    }

    const field = FLAG_FIELDS[key];
    if (field) compiled[field] = true;
  }

  const filePath = argv.find((a) => !a.startsWith("-"));
  if (!filePath) return { kind: "error", message: "no input file provided" };
  compiled.filePath = filePath;

  return { kind: "compile", flags: compiled };
}

/** Apply a `--key=value` flag. Returns an error message string, or null on success. */
function applyValueFlag(flags: CliFlags, key: string, value: string): string | null {
  if (key === "--backend") {
    if (!(CC_CHOICES as readonly string[]).includes(value)) {
      return `unknown backend '${value}' (expected one of: ${CC_CHOICES.join(", ")})`;
    }
    flags.backend = value as CcChoice;
    return null;
  }
  return `unhandled value flag '${key}'`;
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

Build options (apply with --build / --run):
  --debug          Debug profile (-g -O0). Default.
  --release        Release profile (-O2 -DNDEBUG).
  --backend=NAME   Pick the C compiler: ${CC_CHOICES.join(" | ")}.
                   Defaults to the first available on PATH.

Misc:
  --help, -h     Show this help message
  --version, -V  Show the compiler version

If no option is given, the file is lexed and tokens are printed.

Examples:
  kei hello.kei --run                 Compile (debug) and run hello.kei
  kei hello.kei --build --release     Build hello.kei optimised
  kei hello.kei --build --backend=clang
  kei hello.kei --check               Type-check hello.kei
  kei hello.kei --emit-c              Print generated C code`);
}
