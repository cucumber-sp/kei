/**
 * E2E coverage for monomorphized generic enums. PR A wired up the
 * type-checker; PR B emits a per-instantiation KIR type declaration
 * so the C output references a defined struct.
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

describe("generic enums end-to-end", () => {
  test("`Optional<i32>.Some(7)` compiles and runs", () => {
    const r = run(
      "generic_enum_some",
      `
      enum Optional<T> {
        Some(value: T),
        None
      }
      fn main() -> i32 {
        let x = Optional<i32>.Some(7);
        return 0;
      }
      `
    );
    expect(r.exitCode).toBe(0);
  });

  test("`Optional<i32>.None` compiles and runs", () => {
    const r = run(
      "generic_enum_none",
      `
      enum Optional<T> {
        Some(value: T),
        None
      }
      fn main() -> i32 {
        let x = Optional<i32>.None;
        return 0;
      }
      `
    );
    expect(r.exitCode).toBe(0);
  });

  test("two distinct instantiations of the same enum coexist", () => {
    const r = run(
      "generic_enum_distinct",
      `
      enum Optional<T> {
        Some(value: T),
        None
      }
      fn main() -> i32 {
        let a = Optional<i32>.Some(1);
        let b = Optional<bool>.Some(true);
        return 0;
      }
      `
    );
    expect(r.exitCode).toBe(0);
  });
});
