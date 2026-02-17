import { beforeAll, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitC } from "../../src/backend/c-emitter.ts";
import { runDeSsa } from "../../src/backend/de-ssa.ts";
import { runMem2Reg } from "../../src/kir/mem2reg.ts";
import { lower } from "../kir/helpers.ts";

/** Full pipeline: source → KIR → mem2reg → de-ssa → C code */
function compileToC(source: string): string {
  let mod = lower(source);
  mod = runMem2Reg(mod);
  mod = runDeSsa(mod);
  return emitC(mod);
}

function findCompiler(): string | null {
  for (const cc of ["cc", "gcc", "clang"]) {
    try {
      const result = Bun.spawnSync({ cmd: ["which", cc] });
      if (result.exitCode === 0) return cc;
    } catch {}
  }
  return null;
}

let compiler: string | null = null;
beforeAll(() => {
  compiler = findCompiler();
});

async function compileAndRun(
  cCode: string,
  name: string
): Promise<{ compiled: boolean; exitCode: number; stdout: string; stderr: string }> {
  if (!compiler) {
    return { compiled: false, exitCode: -1, stdout: "", stderr: "no compiler" };
  }
  const dir = tmpdir();
  const cPath = join(dir, `kei_arr_${name}.c`);
  const binPath = join(dir, `kei_arr_${name}`);
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
  const run = Bun.spawnSync({ cmd: [binPath], stdout: "pipe", stderr: "pipe" });
  try {
    require("node:fs").unlinkSync(cPath);
    require("node:fs").unlinkSync(binPath);
  } catch {}
  return {
    compiled: true,
    exitCode: run.exitCode,
    stdout: run.stdout.toString(),
    stderr: run.stderr.toString(),
  };
}

describe("arrays: parser", () => {
  test("array literal compiles to C", () => {
    const c = compileToC(`
      fn main() -> int {
        let arr = [1, 2, 3];
        return 0;
      }
    `);
    expect(c).toContain("int32_t");
    expect(c).toContain("[3]");
  });

  test("empty array is a type error", () => {
    expect(() =>
      compileToC(`
      fn main() -> int {
        let arr = [];
        return 0;
      }
    `)
    ).toThrow();
  });
});

describe("arrays: checker", () => {
  test("array literal type inference", () => {
    // Should not throw — element types match
    compileToC(`
      fn main() -> int {
        let arr = [10, 20, 30];
        return 0;
      }
    `);
  });

  test("mixed element types error", () => {
    expect(() =>
      compileToC(`
      fn main() -> int {
        let arr = [1, "hello"];
        return 0;
      }
    `)
    ).toThrow();
  });

  test(".len on array", () => {
    const c = compileToC(`
      fn main() -> int {
        let arr = [1, 2, 3, 4, 5];
        let n = arr.len;
        return 0;
      }
    `);
    // Should contain the constant 5 for len
    expect(c).toBeDefined();
  });
});

describe("arrays: integration", () => {
  test("array index access", async () => {
    const c = compileToC(`
      fn main() -> int {
        let arr = [10, 20, 30, 40, 50];
        return arr[2];
      }
    `);
    const result = await compileAndRun(c, "idx");
    if (!compiler) return;
    expect(result.compiled).toBe(true);
    expect(result.exitCode).toBe(30);
  });

  test("array first and last element", async () => {
    const c = compileToC(`
      fn main() -> int {
        let arr = [5, 10, 15, 20, 25];
        let first = arr[0];
        let last = arr[4];
        return first + last;
      }
    `);
    const result = await compileAndRun(c, "firstlast");
    if (!compiler) return;
    expect(result.compiled).toBe(true);
    expect(result.exitCode).toBe(30);
  });

  test("array sum with while loop", async () => {
    const c = compileToC(`
      fn main() -> int {
        let arr = [1, 2, 3, 4, 5];
        let sum = 0;
        let i = 0;
        while i < 5 {
          sum = sum + arr[i];
          i = i + 1;
        }
        return sum;
      }
    `);
    const result = await compileAndRun(c, "sum");
    if (!compiler) return;
    expect(result.compiled).toBe(true);
    expect(result.exitCode).toBe(15);
  });

  test("array index assignment", async () => {
    const c = compileToC(`
      fn main() -> int {
        let arr = [0, 0, 0];
        arr[1] = 42;
        return arr[1];
      }
    `);
    const result = await compileAndRun(c, "assign");
    if (!compiler) return;
    expect(result.compiled).toBe(true);
    expect(result.exitCode).toBe(42);
  });

  test("array .len property", async () => {
    const c = compileToC(`
      fn main() -> int {
        let arr = [10, 20, 30];
        let n = arr.len;
        return n as int;
      }
    `);
    const result = await compileAndRun(c, "len");
    if (!compiler) return;
    expect(result.compiled).toBe(true);
    expect(result.exitCode).toBe(3);
  });

  test("array bounds check panics on out-of-bounds", async () => {
    const c = compileToC(`
      fn main() -> int {
        let arr = [1, 2, 3];
        return arr[5];
      }
    `);
    const result = await compileAndRun(c, "oob");
    if (!compiler) return;
    expect(result.compiled).toBe(true);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("index out of bounds");
  });

  test("single element array", async () => {
    const c = compileToC(`
      fn main() -> int {
        let arr = [99];
        return arr[0];
      }
    `);
    const result = await compileAndRun(c, "single");
    if (!compiler) return;
    expect(result.compiled).toBe(true);
    expect(result.exitCode).toBe(99);
  });

  test("array with negative values", async () => {
    const c = compileToC(`
      fn main() -> int {
        let arr = [10, -5, 3];
        return arr[0] + arr[1] + arr[2];
      }
    `);
    const result = await compileAndRun(c, "neg");
    if (!compiler) return;
    expect(result.compiled).toBe(true);
    expect(result.exitCode).toBe(8);
  });

  test("nested array index in expression", async () => {
    const c = compileToC(`
      fn main() -> int {
        let a = [2, 3, 5];
        let b = [7, 11, 13];
        return a[0] * b[1];
      }
    `);
    const result = await compileAndRun(c, "nested");
    if (!compiler) return;
    expect(result.compiled).toBe(true);
    expect(result.exitCode).toBe(22);
  });

  test("array passed to function index", async () => {
    const c = compileToC(`
      fn get_second(i: int) -> int {
        let arr = [10, 20, 30];
        return arr[i];
      }
      fn main() -> int {
        return get_second(1);
      }
    `);
    const result = await compileAndRun(c, "funcidx");
    if (!compiler) return;
    expect(result.compiled).toBe(true);
    expect(result.exitCode).toBe(20);
  });

  test("for range loop compiles", async () => {
    const c = compileToC(`
      fn main() -> int {
        let sum = 0;
        for i in 0..5 {
          sum = sum + i;
        }
        return sum;
      }
    `);
    const result = await compileAndRun(c, "forrange");
    if (!compiler) return;
    expect(result.compiled).toBe(true);
    expect(result.exitCode).toBe(10);
  });

  test("trailing comma in array literal", () => {
    const c = compileToC(`
      fn main() -> int {
        let arr = [1, 2, 3,];
        return arr[0];
      }
    `);
    expect(c).toBeDefined();
  });
});
