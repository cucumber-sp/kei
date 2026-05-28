/**
 * E2E coverage for static method calls on generic structs.
 *
 * The parser/checker path stores the type arguments on the outer call, then
 * KIR lowering dispatches to the monomorphized static method without adding a
 * receiver argument.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "bun";

const CLI = join(import.meta.dir, "../../src/cli.ts");
let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "kei-e2e-"));
});

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true });
  } catch {
    // ignore
  }
});

function run(name: string, source: string): { stdout: string; stderr: string; exitCode: number } {
  const filePath = join(tmpDir, `${name}.kei`);
  writeFileSync(filePath, source);
  const result = spawnSync({
    cmd: ["bun", "run", CLI, filePath, "--run"],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  try {
    unlinkSync(filePath.replace(/\.kei$/, ".c"));
  } catch {}
  try {
    unlinkSync(filePath.replace(/\.kei$/, ""));
  } catch {}
  return {
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
    exitCode: result.exitCode ?? -1,
  };
}

describe("generic static methods end-to-end", () => {
  test("`Box<i32>.wrap(42)` compiles and runs", () => {
    const r = run(
      "generic_static_method_i32",
      `
      import { print } from io;
      struct Box<T> {
        value: T;
        fn wrap(item: T) -> Box<T> { return Box<T>{ value: item }; }
      }
      fn main() -> i32 {
        let box = Box<i32>.wrap(42);
        print(box.value);
        return 0;
      }
      `
    );
    expect(r.stderr).toBe("");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("42\n");
  });

  test("two static-method instantiations of the same struct coexist", () => {
    const r = run(
      "generic_static_method_distinct",
      `
      import { print } from io;
      struct Box<T> {
        value: T;
        fn wrap(item: T) -> Box<T> { return Box<T>{ value: item }; }
      }
      fn main() -> i32 {
        let a = Box<i32>.wrap(40);
        let b = Box<bool>.wrap(true);
        if b.value { print(a.value + 2); } else { print(0); }
        return 0;
      }
      `
    );
    expect(r.stderr).toBe("");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("42\n");
  });
});
