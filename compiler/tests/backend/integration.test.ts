import { test, expect, describe, beforeAll } from "bun:test";
import { emitC } from "../../src/backend/c-emitter.ts";
import { runDeSsa } from "../../src/backend/de-ssa.ts";
import { runMem2Reg } from "../../src/kir/mem2reg.ts";
import { lower } from "../kir/helpers.ts";
import { tmpdir } from "os";
import { join } from "path";

/** Full pipeline: source → KIR → mem2reg → de-ssa → C code */
function compileToC(source: string): string {
  let mod = lower(source);
  mod = runMem2Reg(mod);
  mod = runDeSsa(mod);
  return emitC(mod);
}

/** Check if a C compiler is available */
function findCompiler(): string | null {
  for (const cc of ["cc", "gcc", "clang"]) {
    try {
      const result = Bun.spawnSync({ cmd: ["which", cc] });
      if (result.exitCode === 0) return cc;
    } catch {
      // try next
    }
  }
  return null;
}

let compiler: string | null = null;

beforeAll(() => {
  compiler = findCompiler();
});

/** Compile C code to a binary and optionally run it */
async function compileAndRun(
  cCode: string,
  name: string,
): Promise<{ compiled: boolean; exitCode: number; stdout: string; stderr: string }> {
  if (!compiler) {
    return { compiled: false, exitCode: -1, stdout: "", stderr: "no compiler" };
  }

  const dir = tmpdir();
  const cPath = join(dir, `kei_test_${name}.c`);
  const binPath = join(dir, `kei_test_${name}`);

  await Bun.write(cPath, cCode);

  const compile = Bun.spawnSync({
    cmd: [compiler, "-o", binPath, cPath, "-lm", "-std=c11"],
    stderr: "pipe",
  });

  if (compile.exitCode !== 0) {
    return {
      compiled: false,
      exitCode: compile.exitCode,
      stdout: "",
      stderr: compile.stderr.toString(),
    };
  }

  const run = Bun.spawnSync({
    cmd: [binPath],
    stdout: "pipe",
    stderr: "pipe",
  });

  // Clean up
  try {
    const { unlinkSync } = require("fs");
    unlinkSync(cPath);
    unlinkSync(binPath);
  } catch {
    // ignore cleanup errors
  }

  return {
    compiled: true,
    exitCode: run.exitCode,
    stdout: run.stdout.toString(),
    stderr: run.stderr.toString(),
  };
}

describe("integration: .kei → C → binary", () => {
  test("simple return 0", async () => {
    const c = compileToC(`fn main() -> int { return 0; }`);
    const result = await compileAndRun(c, "return0");

    if (!compiler) {
      console.log("Skipping: no C compiler available");
      return;
    }

    expect(result.compiled).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  test("return non-zero exit code", async () => {
    const c = compileToC(`fn main() -> int { return 42; }`);
    const result = await compileAndRun(c, "return42");

    if (!compiler) {
      console.log("Skipping: no C compiler available");
      return;
    }

    expect(result.compiled).toBe(true);
    expect(result.exitCode).toBe(42);
  });

  test("arithmetic expression", async () => {
    const c = compileToC(`
      fn main() -> int {
        let x: int = 10;
        let y: int = 32;
        return x + y;
      }
    `);
    const result = await compileAndRun(c, "arithmetic");

    if (!compiler) {
      console.log("Skipping: no C compiler available");
      return;
    }

    expect(result.compiled).toBe(true);
    expect(result.exitCode).toBe(42);
  });

  test("function call", async () => {
    const c = compileToC(`
      fn twice(x: int) -> int { return x * 2; }
      fn main() -> int { return twice(21); }
    `);
    const result = await compileAndRun(c, "funcall");

    if (!compiler) {
      console.log("Skipping: no C compiler available");
      return;
    }

    expect(result.compiled).toBe(true);
    expect(result.exitCode).toBe(42);
  });

  test("if/else branching", async () => {
    const c = compileToC(`
      fn abs(x: int) -> int {
        if x < 0 { return -x; } else { return x; }
      }
      fn main() -> int { return abs(-5); }
    `);
    const result = await compileAndRun(c, "ifelse");

    if (!compiler) {
      console.log("Skipping: no C compiler available");
      return;
    }

    expect(result.compiled).toBe(true);
    expect(result.exitCode).toBe(5);
  });

  test("recursive function (factorial)", async () => {
    const c = compileToC(`
      fn factorial(n: int) -> int {
        if n <= 1 { return 1; }
        return n * factorial(n - 1);
      }
      fn main() -> int { return factorial(5); }
    `);
    const result = await compileAndRun(c, "factorial");

    if (!compiler) {
      console.log("Skipping: no C compiler available");
      return;
    }

    expect(result.compiled).toBe(true);
    // 5! = 120, exit codes are mod 256 → 120
    expect(result.exitCode).toBe(120);
  });

  test("while loop", async () => {
    const c = compileToC(`
      fn main() -> int {
        let sum: int = 0;
        let i: int = 1;
        while i <= 10 {
          sum = sum + i;
          i = i + 1;
        }
        return sum - 13;
      }
    `);
    const result = await compileAndRun(c, "while_loop");

    if (!compiler) {
      console.log("Skipping: no C compiler available");
      return;
    }

    expect(result.compiled).toBe(true);
    // sum of 1..10 = 55, 55 - 13 = 42
    expect(result.exitCode).toBe(42);
  });

  test("boolean logic", async () => {
    const c = compileToC(`
      fn main() -> int {
        let a: bool = true;
        let b: bool = false;
        if a && !b { return 1; }
        return 0;
      }
    `);
    const result = await compileAndRun(c, "boolean");

    if (!compiler) {
      console.log("Skipping: no C compiler available");
      return;
    }

    expect(result.compiled).toBe(true);
    expect(result.exitCode).toBe(1);
  });

  test("multiple functions calling each other", async () => {
    const c = compileToC(`
      fn add(a: int, b: int) -> int { return a + b; }
      fn mul(a: int, b: int) -> int { return a * b; }
      fn main() -> int { return add(mul(6, 7), 0); }
    `);
    const result = await compileAndRun(c, "multi_fn");

    if (!compiler) {
      console.log("Skipping: no C compiler available");
      return;
    }

    expect(result.compiled).toBe(true);
    expect(result.exitCode).toBe(42);
  });

  test("nested if/else", async () => {
    const c = compileToC(`
      fn classify(x: int) -> int {
        if x > 0 {
          if x > 100 {
            return 3;
          } else {
            return 2;
          }
        } else {
          return 1;
        }
      }
      fn main() -> int { return classify(50); }
    `);
    const result = await compileAndRun(c, "nested_if");

    if (!compiler) {
      console.log("Skipping: no C compiler available");
      return;
    }

    expect(result.compiled).toBe(true);
    expect(result.exitCode).toBe(2);
  });

  test("C code compiles without warnings (basic)", async () => {
    if (!compiler) {
      console.log("Skipping: no C compiler available");
      return;
    }

    const c = compileToC(`fn main() -> int { return 0; }`);
    const dir = tmpdir();
    const cPath = join(dir, "kei_test_warnings.c");

    await Bun.write(cPath, c);

    const compile = Bun.spawnSync({
      cmd: [compiler, "-fsyntax-only", "-std=c11", cPath],
      stderr: "pipe",
    });

    try {
      const { unlinkSync } = require("fs");
      unlinkSync(cPath);
    } catch {
      // ignore
    }

    expect(compile.exitCode).toBe(0);
  });
});
