import { describe, expect, test } from "bun:test";
import { parseArgs, VERSION } from "../../src/cli/args";

describe("parseArgs — meta flags", () => {
  test("returns 'help' for --help", () => {
    expect(parseArgs(["--help"])).toEqual({ kind: "help" });
  });

  test("returns 'help' for -h", () => {
    expect(parseArgs(["-h"])).toEqual({ kind: "help" });
  });

  test("returns 'help' even with other args present", () => {
    expect(parseArgs(["foo.kei", "--help", "--check"])).toEqual({ kind: "help" });
  });

  test("returns 'version' for --version", () => {
    expect(parseArgs(["--version"])).toEqual({ kind: "version" });
  });

  test("returns 'version' for -V", () => {
    expect(parseArgs(["-V"])).toEqual({ kind: "version" });
  });

  test("--help wins over --version when both present", () => {
    expect(parseArgs(["--help", "--version"])).toEqual({ kind: "help" });
  });
});

describe("parseArgs — error cases", () => {
  test("missing input file", () => {
    expect(parseArgs([])).toEqual({
      kind: "error",
      message: "no input file provided",
    });
  });

  test("missing input file with only valid flags", () => {
    expect(parseArgs(["--check"])).toEqual({
      kind: "error",
      message: "no input file provided",
    });
  });

  test("unknown flag is reported", () => {
    expect(parseArgs(["foo.kei", "--bogus"])).toEqual({
      kind: "error",
      message: "unknown flag '--bogus'",
    });
  });

  test("unknown short flag is reported", () => {
    expect(parseArgs(["foo.kei", "-x"])).toEqual({
      kind: "error",
      message: "unknown flag '-x'",
    });
  });

  test("unknown flag reported even when file path is missing", () => {
    expect(parseArgs(["--bogus"])).toEqual({
      kind: "error",
      message: "unknown flag '--bogus'",
    });
  });

  test("--backend without a value errors", () => {
    expect(parseArgs(["foo.kei", "--backend"])).toEqual({
      kind: "error",
      message: "flag '--backend' requires a value (use --backend=VALUE)",
    });
  });

  test("--backend with unknown value errors", () => {
    expect(parseArgs(["foo.kei", "--backend=msvc"])).toEqual({
      kind: "error",
      message: "unknown backend 'msvc' (expected one of: cc, gcc, clang)",
    });
  });

  test("bool flag with =value errors", () => {
    expect(parseArgs(["foo.kei", "--check=true"])).toEqual({
      kind: "error",
      message: "flag '--check' does not take a value",
    });
  });
});

describe("parseArgs — compile flag mapping", () => {
  test("bare file path produces defaults (debug profile, auto backend)", () => {
    const result = parseArgs(["foo.kei"]);
    expect(result.kind).toBe("compile");
    if (result.kind !== "compile") return;
    expect(result.flags).toEqual({
      filePath: "foo.kei",
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
    });
  });

  const FLAG_MAP: [string, keyof Omit<ReturnType<typeof getFlags>, "filePath">][] = [
    ["--ast", "showAst"],
    ["--ast-json", "showAstJson"],
    ["--check", "runCheck"],
    ["--kir", "showKir"],
    ["--kir-opt", "showKirOpt"],
    ["--emit-c", "emitC"],
    ["--build", "build"],
    ["--run", "run"],
  ];

  for (const [flag, field] of FLAG_MAP) {
    test(`'${flag}' sets ${field}`, () => {
      const result = parseArgs(["foo.kei", flag]);
      expect(result.kind).toBe("compile");
      if (result.kind !== "compile") return;
      expect(result.flags[field]).toBe(true);
    });
  }

  test("multiple flags can coexist", () => {
    const result = parseArgs(["foo.kei", "--check", "--kir", "--build"]);
    expect(result.kind).toBe("compile");
    if (result.kind !== "compile") return;
    expect(result.flags.runCheck).toBe(true);
    expect(result.flags.showKir).toBe(true);
    expect(result.flags.build).toBe(true);
    expect(result.flags.emitC).toBe(false);
  });

  test("file path can appear after flags", () => {
    const result = parseArgs(["--check", "main.kei"]);
    expect(result.kind).toBe("compile");
    if (result.kind !== "compile") return;
    expect(result.flags.filePath).toBe("main.kei");
  });

  test("file path can appear between flags", () => {
    const result = parseArgs(["--check", "main.kei", "--build"]);
    expect(result.kind).toBe("compile");
    if (result.kind !== "compile") return;
    expect(result.flags.filePath).toBe("main.kei");
    expect(result.flags.build).toBe(true);
  });

  test("first non-flag is taken as the file path", () => {
    const result = parseArgs(["a.kei", "b.kei"]);
    expect(result.kind).toBe("compile");
    if (result.kind !== "compile") return;
    expect(result.flags.filePath).toBe("a.kei");
  });

  test("duplicate flags do not error", () => {
    const result = parseArgs(["foo.kei", "--check", "--check"]);
    expect(result.kind).toBe("compile");
    if (result.kind !== "compile") return;
    expect(result.flags.runCheck).toBe(true);
  });
});

describe("parseArgs — profile flags", () => {
  test("--debug sets profile to 'debug' (also the default)", () => {
    const result = parseArgs(["foo.kei", "--debug"]);
    expect(result.kind).toBe("compile");
    if (result.kind !== "compile") return;
    expect(result.flags.profile).toBe("debug");
  });

  test("--release sets profile to 'release'", () => {
    const result = parseArgs(["foo.kei", "--release"]);
    expect(result.kind).toBe("compile");
    if (result.kind !== "compile") return;
    expect(result.flags.profile).toBe("release");
  });

  test("later profile flag wins (--debug then --release)", () => {
    const result = parseArgs(["foo.kei", "--debug", "--release"]);
    expect(result.kind).toBe("compile");
    if (result.kind !== "compile") return;
    expect(result.flags.profile).toBe("release");
  });

  test("later profile flag wins (--release then --debug)", () => {
    const result = parseArgs(["foo.kei", "--release", "--debug"]);
    expect(result.kind).toBe("compile");
    if (result.kind !== "compile") return;
    expect(result.flags.profile).toBe("debug");
  });
});

describe("parseArgs — backend selection", () => {
  for (const cc of ["cc", "gcc", "clang"]) {
    test(`--backend=${cc} sets backend to '${cc}'`, () => {
      const result = parseArgs(["foo.kei", `--backend=${cc}`]);
      expect(result.kind).toBe("compile");
      if (result.kind !== "compile") return;
      expect(result.flags.backend).toBe(cc as "cc" | "gcc" | "clang");
    });
  }

  test("later --backend= wins", () => {
    const result = parseArgs(["foo.kei", "--backend=gcc", "--backend=clang"]);
    expect(result.kind).toBe("compile");
    if (result.kind !== "compile") return;
    expect(result.flags.backend).toBe("clang");
  });

  test("--backend coexists with --release", () => {
    const result = parseArgs(["foo.kei", "--build", "--release", "--backend=gcc"]);
    expect(result.kind).toBe("compile");
    if (result.kind !== "compile") return;
    expect(result.flags.build).toBe(true);
    expect(result.flags.profile).toBe("release");
    expect(result.flags.backend).toBe("gcc");
  });
});

describe("VERSION", () => {
  test("is a non-empty string", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
  });
});

// Helper for typed FLAG_MAP above
function getFlags() {
  return {
    filePath: "",
    showAst: false,
    showAstJson: false,
    runCheck: false,
    showKir: false,
    showKirOpt: false,
    emitC: false,
    build: false,
    run: false,
    profile: "debug" as "debug" | "release",
    backend: null as "cc" | "gcc" | "clang" | null,
  };
}
