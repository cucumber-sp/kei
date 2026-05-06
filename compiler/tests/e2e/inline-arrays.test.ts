/**
 * End-to-end tests for the `inline<T, N>` fixed-size value-type array.
 *
 * Covers: literal construction, indexing read/write, `.len`, element-type
 * variations (int / bool / float / string / unsigned), iteration, struct
 * fields, methods, function parameters, return values, nested arrays,
 * copy-by-value semantics, and bounds checking.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "bun";

const CLI = join(import.meta.dir, "../../src/cli.ts");
let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "kei-e2e-inline-"));
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
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
}

// ─── Construction & basic ops ───────────────────────────────────────────────

describe("e2e: inline<T, N> — construction and basic ops", () => {
  test("explicit type annotation with literal", () => {
    const r = run(
      "inline_explicit",
      `
      import { print } from io;
      fn main() -> int {
        let arr: inline<int, 5> = [10, 20, 30, 40, 50];
        print(arr[0]);
        print(arr[4]);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("10\n50\n");
  });

  test(".len returns the compile-time constant N", () => {
    const r = run(
      "inline_len",
      `
      import { print } from io;
      fn main() -> int {
        let arr: inline<int, 7> = [1, 2, 3, 4, 5, 6, 7];
        print(arr.len as int);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("7\n");
  });

  test("index assignment mutates the inline array", () => {
    const r = run(
      "inline_idx_assign",
      `
      import { print } from io;
      fn main() -> int {
        let arr: inline<int, 4> = [1, 2, 3, 4];
        arr[0] = 99;
        arr[3] = 77;
        print(arr[0]);
        print(arr[1]);
        print(arr[2]);
        print(arr[3]);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("99\n2\n3\n77\n");
  });

  test("length-1 inline array", () => {
    const r = run(
      "inline_len1",
      `
      import { print } from io;
      fn main() -> int {
        let one: inline<int, 1> = [42];
        print(one[0]);
        print(one.len as int);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("42\n1\n");
  });

  test("larger N (32 elements) round-trips correctly", () => {
    const r = run(
      "inline_large",
      `
      import { print } from io;
      fn main() -> int {
        let arr: inline<int, 32> = [
          0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
          10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
          20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
          30, 31
        ];
        let sum: int = 0;
        for (let i = 0; i < 32; i = i + 1) {
          sum = sum + arr[i];
        }
        print(sum);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("496\n");
  });
});

// ─── Element-type variations ────────────────────────────────────────────────

describe("e2e: inline<T, N> — element types", () => {
  test("inline<bool, N>", () => {
    const r = run(
      "inline_bool",
      `
      import { print } from io;
      fn main() -> int {
        let flags: inline<bool, 4> = [true, false, true, false];
        print(flags[0]);
        print(flags[1]);
        flags[1] = true;
        print(flags[1]);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("true\nfalse\ntrue\n");
  });

  test("inline<f64, N>", () => {
    const r = run(
      "inline_f64",
      `
      import { print } from io;
      fn main() -> int {
        let xs: inline<f64, 3> = [1.5, 2.5, 3.5];
        let total: f64 = 0.0;
        for (let i = 0; i < 3; i = i + 1) {
          total = total + xs[i];
        }
        print(total);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("7.5");
  });

  test("inline<i64, N>", () => {
    const r = run(
      "inline_i64",
      `
      import { print } from io;
      fn main() -> int {
        let xs: inline<i64, 3> = [1000000000000, 2000000000000, 3000000000000];
        print(xs[0]);
        print(xs[2]);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("1000000000000\n3000000000000\n");
  });

  test("inline<u8, N>", () => {
    const r = run(
      "inline_u8",
      `
      import { print } from io;
      fn main() -> int {
        let bytes: inline<u8, 4> = [255u8, 128u8, 64u8, 1u8];
        print(bytes[0] as int);
        print(bytes[1] as int);
        print(bytes[2] as int);
        print(bytes[3] as int);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("255\n128\n64\n1\n");
  });

  test("inline<string, N>", () => {
    const r = run(
      "inline_string",
      `
      import { print } from io;
      fn main() -> int {
        let names: inline<string, 3> = ["alice", "bob", "carol"];
        print(names[0]);
        print(names[1]);
        print(names[2]);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("alice\nbob\ncarol\n");
  });
});

// ─── Iteration ──────────────────────────────────────────────────────────────

describe("e2e: inline<T, N> — iteration", () => {
  test("for-range over indices computes a sum", () => {
    const r = run(
      "inline_iter_sum",
      `
      import { print } from io;
      fn main() -> int {
        let xs: inline<int, 5> = [2, 4, 6, 8, 10];
        let sum: int = 0;
        for (let i = 0; i < 5; i = i + 1) {
          sum = sum + xs[i];
        }
        print(sum);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("30\n");
  });

  test("loop reads a value through .len bound", () => {
    const r = run(
      "inline_len_bound",
      `
      import { print } from io;
      fn main() -> int {
        let xs: inline<int, 4> = [3, 1, 4, 1];
        let n: int = xs.len as int;
        let max: int = xs[0];
        for (let i = 1; i < n; i = i + 1) {
          if xs[i] > max { max = xs[i]; }
        }
        print(max);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("4\n");
  });

  test("reverse-in-place via index loop", () => {
    const r = run(
      "inline_reverse",
      `
      import { print } from io;
      fn main() -> int {
        let xs: inline<int, 5> = [1, 2, 3, 4, 5];
        let n: int = 5;
        for (let i = 0; i < n / 2; i = i + 1) {
          let j: int = n - 1 - i;
          let tmp: int = xs[i];
          xs[i] = xs[j];
          xs[j] = tmp;
        }
        for (let i = 0; i < n; i = i + 1) {
          print(xs[i]);
        }
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("5\n4\n3\n2\n1\n");
  });
});

// ─── As function parameter ──────────────────────────────────────────────────

describe("e2e: inline<T, N> — function parameters", () => {
  test("pass to function and read elements", () => {
    const r = run(
      "inline_param",
      `
      import { print } from io;

      fn second(a: inline<int, 4>) -> int {
        return a[1];
      }

      fn main() -> int {
        let xs: inline<int, 4> = [10, 20, 30, 40];
        print(second(xs));
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("20\n");
  });

  test("multiple inline params of different sizes", () => {
    const r = run(
      "inline_param_multi",
      `
      import { print } from io;

      fn pair_sum(a: inline<int, 3>, b: inline<int, 2>) -> int {
        return a[0] + a[1] + a[2] + b[0] + b[1];
      }

      fn main() -> int {
        let x: inline<int, 3> = [1, 2, 3];
        let y: inline<int, 2> = [10, 20];
        print(pair_sum(x, y));
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("36\n");
  });

  test("inline<bool, N> as parameter", () => {
    const r = run(
      "inline_bool_param",
      `
      import { print } from io;

      fn count_true(flags: inline<bool, 5>) -> int {
        let count: int = 0;
        for (let i = 0; i < 5; i = i + 1) {
          if flags[i] { count = count + 1; }
        }
        return count;
      }

      fn main() -> int {
        let f: inline<bool, 5> = [true, false, true, true, false];
        print(count_true(f));
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("3\n");
  });

  test("function modifying its inline param does not affect caller (pass-by-value)", () => {
    const r = run(
      "inline_param_byvalue",
      `
      import { print } from io;

      fn clobber(a: inline<int, 3>) -> int {
        a[0] = 999;
        a[1] = 999;
        a[2] = 999;
        return a[0];
      }

      fn main() -> int {
        let xs: inline<int, 3> = [1, 2, 3];
        let _ = clobber(xs);
        // Caller must still see the original values.
        print(xs[0]);
        print(xs[1]);
        print(xs[2]);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("1\n2\n3\n");
  });
});

// ─── In structs ─────────────────────────────────────────────────────────────

describe("e2e: inline<T, N> — in structs", () => {
  test("struct with inline field — read and write through field", () => {
    const r = run(
      "inline_struct_field",
      `
      import { print } from io;

      struct Buf {
        data: inline<int, 4>;
        used: int;
      }

      fn main() -> int {
        let b = Buf{ data: [10, 20, 30, 40], used: 4 };
        print(b.data[0]);
        print(b.data[3]);
        b.data[2] = 99;
        print(b.data[2]);
        print(b.used);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("10\n40\n99\n4\n");
  });

  test("multiple inline fields in one struct", () => {
    const r = run(
      "inline_multi_field",
      `
      import { print } from io;

      struct Pair {
        xs: inline<int, 3>;
        ys: inline<int, 3>;
      }

      fn main() -> int {
        let p = Pair{ xs: [1, 2, 3], ys: [10, 20, 30] };
        print(p.xs[0] + p.ys[0]);
        print(p.xs[1] + p.ys[1]);
        print(p.xs[2] + p.ys[2]);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("11\n22\n33\n");
  });

  test("copying a struct copies its inline array (value semantics)", () => {
    const r = run(
      "inline_struct_copy",
      `
      import { print } from io;

      struct Box { vals: inline<int, 3>; }

      fn main() -> int {
        let a = Box{ vals: [1, 2, 3] };
        let b = a;          // independent copy
        b.vals[0] = 99;
        // a must remain untouched
        print(a.vals[0]);
        print(a.vals[1]);
        print(a.vals[2]);
        // b reflects the mutation
        print(b.vals[0]);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("1\n2\n3\n99\n");
  });

  test("method on struct reads inline field", () => {
    const r = run(
      "inline_method_read",
      `
      import { print } from io;

      struct Vec3 {
        v: inline<f64, 3>;

        fn x(self: Vec3) -> f64 { return self.v[0]; }
        fn y(self: Vec3) -> f64 { return self.v[1]; }
        fn z(self: Vec3) -> f64 { return self.v[2]; }

        fn dot(self: Vec3, other: Vec3) -> f64 {
          return self.v[0] * other.v[0] +
                 self.v[1] * other.v[1] +
                 self.v[2] * other.v[2];
        }
      }

      fn main() -> int {
        let a = Vec3{ v: [1.0, 2.0, 3.0] };
        let b = Vec3{ v: [4.0, 5.0, 6.0] };
        print(a.x());
        print(a.dot(b));
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim().split("\n")).toEqual(["1", "32"]);
  });

  test("method that returns a new struct with mutated inline field", () => {
    const r = run(
      "inline_method_immut_update",
      `
      import { print } from io;

      struct Buf {
        data: inline<int, 4>;
        used: int;

        fn put(self: Buf, val: int) -> Buf {
          let next = Buf{ data: self.data, used: self.used };
          next.data[next.used] = val;
          next.used = next.used + 1;
          return next;
        }
      }

      fn main() -> int {
        let b = Buf{ data: [0, 0, 0, 0], used: 0 };
        b = b.put(7);
        b = b.put(8);
        b = b.put(9);
        print(b.used);
        print(b.data[0]);
        print(b.data[1]);
        print(b.data[2]);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("3\n7\n8\n9\n");
  });
});

// ─── Aggregates / patterns ──────────────────────────────────────────────────

describe("e2e: inline<T, N> — aggregate patterns", () => {
  test("histogram via inline counts", () => {
    const r = run(
      "inline_histogram",
      `
      import { print } from io;

      fn main() -> int {
        let counts: inline<int, 10> = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        let samples: inline<int, 8> = [3, 1, 4, 1, 5, 9, 2, 6];
        for (let i = 0; i < 8; i = i + 1) {
          let v: int = samples[i];
          counts[v] = counts[v] + 1;
        }
        // print non-zero buckets in order
        for (let i = 0; i < 10; i = i + 1) {
          if counts[i] > 0 { print(counts[i]); }
        }
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    // expected counts (in bucket order 1..9): 1->2, 2->1, 3->1, 4->1, 5->1, 6->1, 9->1
    expect(r.stdout).toBe("2\n1\n1\n1\n1\n1\n1\n");
  });

  test("matrix-style 3x3 trace via flat inline<int, 9>", () => {
    const r = run(
      "inline_mat_trace",
      `
      import { print } from io;

      fn at(m: inline<int, 9>, r: int, c: int) -> int {
        return m[r * 3 + c];
      }

      fn trace(m: inline<int, 9>) -> int {
        return at(m, 0, 0) + at(m, 1, 1) + at(m, 2, 2);
      }

      fn main() -> int {
        let m: inline<int, 9> = [1, 2, 3, 4, 5, 6, 7, 8, 9];
        print(trace(m));
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("15\n");
  });

  test("two structs with inline arrays interact via methods", () => {
    const r = run(
      "inline_two_structs",
      `
      import { print } from io;

      struct Row { xs: inline<int, 3>; }

      fn row_sum(r: Row) -> int {
        return r.xs[0] + r.xs[1] + r.xs[2];
      }

      fn main() -> int {
        let a = Row{ xs: [1, 2, 3] };
        let b = Row{ xs: [10, 20, 30] };
        print(row_sum(a) + row_sum(b));
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("66\n");
  });
});

// ─── Bounds checks ──────────────────────────────────────────────────────────

describe("e2e: inline<T, N> — bounds checks", () => {
  test("out-of-bounds index panics at runtime", () => {
    const r = run(
      "inline_oob",
      `
      import { print } from io;
      fn main() -> int {
        let xs: inline<int, 3> = [1, 2, 3];
        let bad: int = 5;
        print(xs[bad]);
        return 0;
      }
    `
    );
    // Bounds check should fail with non-zero exit
    expect(r.exitCode).not.toBe(0);
    // Some panic message should be on stderr
    expect(r.stderr.length).toBeGreaterThan(0);
  });

  test("negative index panics at runtime", () => {
    const r = run(
      "inline_neg_idx",
      `
      import { print } from io;
      fn main() -> int {
        let xs: inline<int, 3> = [1, 2, 3];
        let bad: int = 0 - 1;
        print(xs[bad]);
        return 0;
      }
    `
    );
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.length).toBeGreaterThan(0);
  });

  test("the last valid index does NOT panic", () => {
    const r = run(
      "inline_last_idx",
      `
      import { print } from io;
      fn main() -> int {
        let xs: inline<int, 3> = [10, 20, 30];
        let i: int = 2;
        print(xs[i]);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("30\n");
  });
});
