/**
 * End-to-end tests for `Shared<T>` (the canonical refcount primitive
 * landing as a stdlib `unsafe struct`).
 *
 * Mirrors the lifecycle trace in `docs/design/ref-redesign.md` §3.4 and
 * the `__oncopy(self: ref T)` ABI from §3.1. Currently `.skip`'d — the
 * compiler PR that lands the new lifecycle ABI plus the stdlib
 * implementation will flip the remaining semantic cases back on.
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

describe("Shared<T> end-to-end semantics", () => {
  test("wrap + last-use elision: caller's value moves into the slot, refcount stays 1", () => {
    const r = run(
      "shared_wrap_last_use",
      `
      import { Shared } from shared;

      fn main() -> int {
        let n: i32 = 42;
        let s = Shared<i32>.wrap(n);
        return s.value;
      }
      `
    );
    expect(r.stderr).toBe("");
    expect(r.exitCode).toBe(42);
  });

  test.skip("alias-visible mutation through .value", () => {
    const r = run(
      "shared_value_writethrough",
      `
      unsafe struct Shared<T> {
        refcount: ref i64;
        value: ref T;
        fn wrap(item: ref T) -> Shared<T> { return Shared<T>{}; }
        fn __oncopy(self: ref Shared<T>) { self.refcount += 1; }
        fn __destroy(self: ref Shared<T>) { self.refcount -= 1; }
      }

      fn main() -> int {
        let init: i32 = 10;
        let a = Shared<i32>.wrap(init);
        let b = a;          // refcount becomes 2
        b.value = 32;       // alias-visible: a.value also sees 32
        return a.value;
      }
      `
    );
    expect(r.exitCode).toBe(32);
  });

  test.skip("handle replacement destroys the old shared and constructs the new", () => {
    const r = run(
      "shared_handle_replacement",
      `
      unsafe struct Shared<T> {
        refcount: ref i64;
        value: ref T;
        fn wrap(item: ref T) -> Shared<T> { return Shared<T>{}; }
        fn __oncopy(self: ref Shared<T>) { self.refcount += 1; }
        fn __destroy(self: ref Shared<T>) { self.refcount -= 1; }
      }

      struct Cfg {
        online: Shared<bool>;
      }

      fn flip(c: ref Cfg) {
        let v: bool = false;
        c.online = Shared<bool>.wrap(v);   // replaces the handle
      }

      fn main() -> int {
        let yes: bool = true;
        let cfg = Cfg{ online: Shared<bool>.wrap(yes) };
        flip(cfg);
        return if cfg.online.value { 1 } else { 0 };
      }
      `
    );
    expect(r.exitCode).toBe(0);
  });

  test.skip("readonly Shared<T> field permits write-through but not handle replacement", () => {
    // This test is a NEGATIVE — the compile must FAIL on the readonly
    // assignment. Bringing it up to date with how the harness reports
    // build failures is the unskipping commit's job.
    const r = run(
      "shared_readonly_replacement_rejected",
      `
      unsafe struct Shared<T> {
        refcount: ref i64;
        value: ref T;
        fn wrap(item: ref T) -> Shared<T> { return Shared<T>{}; }
        fn __oncopy(self: ref Shared<T>) {}
        fn __destroy(self: ref Shared<T>) {}
      }
      struct Cfg { readonly online: Shared<bool> }
      fn flip(c: ref Cfg) {
        let v: bool = false;
        c.online = Shared<bool>.wrap(v);   // ERROR: readonly
      }
      fn main() -> int { return 0; }
      `
    );
    expect(r.exitCode).not.toBe(0);
  });
});
