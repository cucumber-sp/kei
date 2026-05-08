/**
 * End-to-end tests for `Shared<T>` (the canonical refcount primitive
 * landing as a stdlib `unsafe struct`).
 *
 * Mirrors the lifecycle trace in `docs/design/ref-redesign.md` §3.4 and
 * the `__oncopy(self: ref T)` ABI from §3.1. Currently `.skip`'d — the
 * compiler PR that lands the new lifecycle ABI plus the stdlib
 * implementation will flip this back on.
 */

import { describe, expect, test } from "bun:test";

// When unskipping, replace this stub with the real `run` helper from
// `run.test.ts` — either by extracting it into a shared module or by
// duplicating its body here. Keeping a local stub for now lets the file
// load cleanly under `describe.skip` without touching the existing e2e
// file's structure.
function run(_name: string, _source: string): { stdout: string; stderr: string; exitCode: number } {
  return { stdout: "", stderr: "", exitCode: 0 };
}

describe.skip("Shared<T> end-to-end semantics", () => {
  test("wrap + last-use elision: caller's value moves into the slot, refcount stays 1", () => {
    // Pattern from §3.5: caller does not use `s` after `wrap(s)`; compiler
    // elides oncopy and destroys, leaving exactly one refcount on the heap
    // slot.
    const r = run(
      "shared_wrap_last_use",
      `
      // Inline mini-Shared<T> for the test (real impl lives in stdlib once
      // it lands).
      unsafe struct Shared<T> {
        refcount: ref i64;
        value: ref T;

        fn wrap(item: ref T) -> Shared<T> {
          let s = Shared<T>{};
          unsafe {
            let block = alloc<u8>(sizeof(i64) + sizeof(T));
            addr(s.refcount) = block as *i64;
            addr(s.value)    = (block + sizeof(i64)) as *T;
            s.refcount = 1;
            init s.value = item;
          }
          return s;
        }

        fn __oncopy(self: ref Shared<T>) { self.refcount += 1; }
        fn __destroy(self: ref Shared<T>) {
          self.refcount -= 1;
          if self.refcount == 0 {
            unsafe { free(addr(self.refcount)); }
          }
        }
      }

      fn main() -> int {
        let n: i32 = 42;
        let s = Shared<i32>::wrap(n);
        return s.value;
      }
      `
    );
    expect(r.exitCode).toBe(42);
  });

  test("alias-visible mutation through .value", () => {
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
        let a = Shared<i32>::wrap(init);
        let b = a;          // refcount becomes 2
        b.value = 32;       // alias-visible: a.value also sees 32
        return a.value;
      }
      `
    );
    expect(r.exitCode).toBe(32);
  });

  test("handle replacement destroys the old shared and constructs the new", () => {
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
        c.online = Shared<bool>::wrap(v);   // replaces the handle
      }

      fn main() -> int {
        let yes: bool = true;
        let cfg = Cfg{ online: Shared<bool>::wrap(yes) };
        flip(cfg);
        return if cfg.online.value { 1 } else { 0 };
      }
      `
    );
    expect(r.exitCode).toBe(0);
  });

  test("readonly Shared<T> field permits write-through but not handle replacement", () => {
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
        c.online = Shared<bool>::wrap(v);   // ERROR: readonly
      }
      fn main() -> int { return 0; }
      `
    );
    expect(r.exitCode).not.toBe(0);
  });
});
