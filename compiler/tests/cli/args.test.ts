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
});

describe("parseArgs — compile flag mapping", () => {
  test("bare file path produces all-false flags", () => {
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
  };
}
