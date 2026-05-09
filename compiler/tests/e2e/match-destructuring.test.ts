/**
 * E2E coverage for switch-case destructuring of enum variants. The
 * parser + checker have had support for this for a while; PRs A and B
 * brought generic enums into the picture, so this PR pins the
 * happy-path cases through C.
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

describe("switch-case destructuring on enums", () => {
  test("destructures `Some(v)` payload from a generic enum and returns it", () => {
    const r = run(
      "match_some",
      `
      enum Optional<T> {
        Some(value: T),
        None
      }
      fn main() -> i32 {
        let s = Optional<i32>.Some(42);
        switch s {
          case Some(v):
            return v;
          case None:
            return 0;
        }
        return 0;
      }
      `
    );
    expect(r.exitCode).toBe(42);
  });

  test("hits the `None` arm when constructed with `Optional<i32>.None`", () => {
    const r = run(
      "match_none",
      `
      enum Optional<T> {
        Some(value: T),
        None
      }
      fn main() -> i32 {
        let s = Optional<i32>.None;
        switch s {
          case Some(v):
            return v;
          case None:
            return 7;
        }
        return 0;
      }
      `
    );
    expect(r.exitCode).toBe(7);
  });

  test("multi-field variant destructures all fields", () => {
    const r = run(
      "match_pair",
      `
      enum Pair<A, B> {
        Both(left: A, right: B),
        Empty
      }
      fn main() -> i32 {
        let p = Pair<i32, i32>.Both(20, 22);
        switch p {
          case Both(l, r):
            return l + r;
          case Empty:
            return 0;
        }
        return 0;
      }
      `
    );
    expect(r.exitCode).toBe(42);
  });

  test("non-generic enum destructure still works (regression)", () => {
    const r = run(
      "match_shape",
      `
      enum Shape {
        Circle(r: i32),
        Square(s: i32)
      }
      fn main() -> i32 {
        let c = Shape.Circle(7);
        switch c {
          case Circle(r):
            return r;
          case Square(s):
            return s;
        }
        return 0;
      }
      `
    );
    expect(r.exitCode).toBe(7);
  });
});
