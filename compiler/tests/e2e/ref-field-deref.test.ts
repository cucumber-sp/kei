/**
 * E2E coverage for `ref T` field auto-deref. The checker has been
 * auto-dereffing ref T fields at use sites for a while; the KIR
 * lowering used to emit only the slot load, leaving the bound
 * pointer's bytes (the slot value) where the user expected the
 * pointed-to value.
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

describe("ref T field auto-deref end-to-end", () => {
  test("reading a `ref i32` field through a struct returns the pointed-to i32", () => {
    const r = run(
      "ref_field_read",
      `
      extern fn malloc(size: usize) -> *u8;

      unsafe struct Bag {
        value: ref i32;
        fn __destroy(self: ref Bag) {}
        fn __oncopy(self: ref Bag) {}
      }

      fn build(item: ref i32) -> Bag {
        unsafe {
          let raw = malloc(sizeof(i32)) as *i32;
          *raw = item;
          return Bag{ value: raw };
        }
      }

      fn main() -> i32 {
        let n: i32 = 42;
        let b = build(n);
        return b.value;
      }
      `
    );
    expect(r.exitCode).toBe(42);
  });

  test("writing through a `ref i32` field stores into the pointed-to i32", () => {
    const r = run(
      "ref_field_write",
      `
      extern fn malloc(size: usize) -> *u8;

      unsafe struct Bag {
        value: ref i32;
        fn __destroy(self: ref Bag) {}
        fn __oncopy(self: ref Bag) {}
      }

      fn build(item: ref i32) -> Bag {
        unsafe {
          let raw = malloc(sizeof(i32)) as *i32;
          *raw = item;
          return Bag{ value: raw };
        }
      }

      fn main() -> i32 {
        let n: i32 = 0;
        let b = build(n);
        b.value = 99;
        return b.value;
      }
      `
    );
    expect(r.exitCode).toBe(99);
  });
});
