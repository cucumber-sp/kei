import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "bun";
import { join } from "path";
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from "fs";
import { tmpdir } from "os";

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

/** Write a .kei file, compile+run via CLI, return stdout/stderr/exitCode */
function run(name: string, source: string): { stdout: string; stderr: string; exitCode: number } {
  const filePath = join(tmpDir, `${name}.kei`);
  writeFileSync(filePath, source);

  const result = spawnSync({
    cmd: ["bun", "run", CLI, filePath, "--run"],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });

  // Clean up generated .c and binary
  try { unlinkSync(filePath.replace(/\.kei$/, ".c")); } catch {}
  try { unlinkSync(filePath.replace(/\.kei$/, "")); } catch {}

  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
}

// ─── Basic programs ──────────────────────────────────────────────────────────

describe("e2e: basic programs", () => {
  test("hello world with print", () => {
    const r = run("hello", `
      import { print } from io;
      fn main() -> int {
        print("Hello, World!");
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("Hello, World!\n");
  });

  test("fibonacci recursive", () => {
    const r = run("fib", `
      import { print } from io;
      fn fib(n: int) -> int {
        if n <= 1 { return n; }
        return fib(n - 1) + fib(n - 2);
      }
      fn main() -> int {
        print(fib(10));
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("55\n");
  });

  test("factorial recursive", () => {
    const r = run("fact", `
      import { print } from io;
      fn factorial(n: int) -> int {
        if n <= 1 { return 1; }
        return n * factorial(n - 1);
      }
      fn main() -> int {
        print(factorial(10));
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("3628800\n");
  });

  test("simple arithmetic expressions", () => {
    const r = run("arith", `
      import { print } from io;
      fn main() -> int {
        let a: int = 10;
        let b: int = 3;
        print(a + b);
        print(a - b);
        print(a * b);
        print(a / b);
        print(a % b);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("13\n7\n30\n3\n1\n");
  });

  test("string concatenation with +", () => {
    const r = run("strcat", `
      import { print } from io;
      fn main() -> int {
        let greeting: string = "Hello" + ", " + "World!";
        print(greeting);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("Hello, World!\n");
  });

  test("boolean logic", () => {
    const r = run("booleans", `
      import { print } from io;
      fn main() -> int {
        let a: bool = true;
        let b: bool = false;
        print(a && !b);
        print(a || b);
        print(!a);
        print(b);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("true\ntrue\nfalse\nfalse\n");
  });

  test("multiple print types", () => {
    const r = run("print_types", `
      import { print } from io;
      fn main() -> int {
        print(42);
        print("hello");
        print(true);
        print(false);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("42\nhello\ntrue\nfalse\n");
  });
});

// ─── Structs end-to-end ─────────────────────────────────────────────────────

describe("e2e: structs", () => {
  test("create struct, access fields, print", () => {
    const r = run("struct_basic", `
      import { print } from io;
      struct Point {
        x: int;
        y: int;
      }
      fn main() -> int {
        let p = Point{ x: 10, y: 20 };
        print(p.x);
        print(p.y);
        print(p.x + p.y);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("10\n20\n30\n");
  });

  test("multiple struct instances", () => {
    const r = run("struct_multi", `
      import { print } from io;
      struct Point {
        x: int;
        y: int;
      }
      fn main() -> int {
        let a = Point{ x: 1, y: 2 };
        let b = Point{ x: 3, y: 4 };
        print(a.x + b.x);
        print(a.y + b.y);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("4\n6\n");
  });

  test("struct with bool and int fields", () => {
    const r = run("struct_mixed", `
      import { print } from io;
      struct Config {
        debug: bool;
        level: int;
      }
      fn main() -> int {
        let cfg = Config{ debug: true, level: 5 };
        print(cfg.debug);
        print(cfg.level);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("true\n5\n");
  });

  test("struct with string fields", () => {
    const r = run("struct_string", `
      import { print } from io;
      struct Person {
        name: string;
        age: int;
      }
      fn main() -> int {
        let p = Person{ name: "Alice", age: 30 };
        print(p.name);
        print(p.age);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("Alice\n30\n");
  });
});

// ─── Control flow end-to-end ────────────────────────────────────────────────

describe("e2e: control flow", () => {
  test("while loop counting", () => {
    const r = run("while_count", `
      import { print } from io;
      fn main() -> int {
        let sum: int = 0;
        let i: int = 1;
        while i <= 10 {
          sum = sum + i;
          i = i + 1;
        }
        print(sum);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("55\n");
  });

  test("nested if/else", () => {
    const r = run("nested_if", `
      import { print } from io;
      fn classify(x: int) -> string {
        if x > 100 {
          return "big";
        } else {
          if x > 0 {
            return "small";
          } else {
            return "non-positive";
          }
        }
      }
      fn main() -> int {
        print(classify(200));
        print(classify(50));
        print(classify(-5));
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("big\nsmall\nnon-positive\n");
  });

  test("break in while loop", () => {
    const r = run("break_loop", `
      import { print } from io;
      fn main() -> int {
        let i: int = 0;
        while true {
          if i >= 5 { break; }
          i = i + 1;
        }
        print(i);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("5\n");
  });

  test("continue in while loop", () => {
    const r = run("continue_loop", `
      import { print } from io;
      fn main() -> int {
        let sum: int = 0;
        let i: int = 0;
        while i < 10 {
          i = i + 1;
          if i % 2 == 0 { continue; }
          sum = sum + i;
        }
        print(sum);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    // sum of odd numbers 1..9 = 1+3+5+7+9 = 25
    expect(r.stdout).toBe("25\n");
  });

  test("for range loop", () => {
    const r = run("for_range", `
      import { print } from io;
      fn main() -> int {
        let sum: int = 0;
        for i in 0..5 {
          sum = sum + i;
        }
        print(sum);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    // 0+1+2+3+4 = 10
    expect(r.stdout).toBe("10\n");
  });

  test("early return from function", () => {
    const r = run("early_return", `
      import { print } from io;
      fn check(x: int) -> string {
        if x < 0 { return "negative"; }
        if x == 0 { return "zero"; }
        return "positive";
      }
      fn main() -> int {
        print(check(-5));
        print(check(0));
        print(check(10));
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("negative\nzero\npositive\n");
  });
});

// ─── Arrays end-to-end ──────────────────────────────────────────────────────

describe("e2e: arrays", () => {
  test("array literal and indexing", () => {
    const r = run("array_basic", `
      import { print } from io;
      fn main() -> int {
        let arr = [10, 20, 30];
        print(arr[0]);
        print(arr[1]);
        print(arr[2]);
        let length: int = arr.len as int;
        print(length);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("10\n20\n30\n3\n");
  });

  test("array index assignment", () => {
    const r = run("array_assign", `
      import { print } from io;
      fn main() -> int {
        let arr = [1, 2, 3];
        arr[0] = 99;
        print(arr[0]);
        print(arr[1]);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("99\n2\n");
  });

  test("array sum with for range", () => {
    const r = run("array_sum", `
      import { print } from io;
      fn main() -> int {
        let arr = [1, 2, 3, 4, 5];
        let sum: int = 0;
        for i in 0..5 {
          sum = sum + arr[i];
        }
        print(sum);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("15\n");
  });

  test("array of booleans", () => {
    const r = run("array_bool", `
      import { print } from io;
      fn main() -> int {
        let flags = [true, false, true];
        print(flags[0]);
        print(flags[1]);
        print(flags[2]);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("true\nfalse\ntrue\n");
  });
});

// ─── Error handling end-to-end ──────────────────────────────────────────────

describe("e2e: error handling", () => {
  test("function that throws, caller catches", () => {
    const r = run("throws_catch", `
      import { print } from io;
      struct NotFound {
        code: int;
      }
      fn find(id: int) -> int throws NotFound {
        if id < 0 {
          throw NotFound{ code: 404 };
        }
        return id * 10;
      }
      fn main() -> int {
        let result = find(5) catch {
          NotFound: return 1;
        };
        print(result);

        let result2 = find(-1) catch {
          NotFound e: {
            print(e.code);
            return 0;
          }
        };
        print(result2);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("50\n404\n");
  });

  test("catch panic converts any error to panic", () => {
    const r = run("catch_panic", `
      struct Oops { msg: int; }
      fn bad() -> int throws Oops {
        throw Oops{ msg: 1 };
      }
      fn main() -> int {
        let x = bad() catch panic;
        return 0;
      }
    `);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("panic");
  });

  test("multiple catch branches", () => {
    const r = run("multi_catch", `
      import { print } from io;
      struct ErrA { val: int; }
      struct ErrB { val: int; }
      fn maybe(x: int) -> int throws ErrA, ErrB {
        if x == 1 { throw ErrA{ val: 10 }; }
        if x == 2 { throw ErrB{ val: 20 }; }
        return x;
      }
      fn main() -> int {
        let a = maybe(1) catch {
          ErrA e: {
            print(e.val);
            return 0;
          }
          ErrB e: {
            print(e.val);
            return 0;
          }
        };
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("10\n");
  });

  test("catch throw re-propagates error", () => {
    const r = run("catch_throw", `
      import { print } from io;
      struct Fail { code: int; }
      fn inner() -> int throws Fail {
        throw Fail{ code: 42 };
      }
      fn outer() -> int throws Fail {
        let x = inner() catch throw;
        return x;
      }
      fn main() -> int {
        let result = outer() catch {
          Fail e: {
            print(e.code);
            return 0;
          }
        };
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("42\n");
  });
});

// ─── Generics end-to-end ────────────────────────────────────────────────────

describe("e2e: generics", () => {
  test("generic struct Pair<A,B> with different instantiations", () => {
    const r = run("generic_pair", `
      import { print } from io;
      struct Pair<A, B> {
        first: A;
        second: B;
      }
      fn main() -> int {
        let p1 = Pair<i32, i32>{ first: 10, second: 20 };
        print(p1.first);
        print(p1.second);

        let p2 = Pair<i32, bool>{ first: 99, second: true };
        print(p2.first);
        print(p2.second);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("10\n20\n99\ntrue\n");
  });

  test("generic function identity<T> with i32 and string", () => {
    const r = run("generic_fn", `
      import { print } from io;
      fn identity<T>(x: T) -> T {
        return x;
      }
      fn main() -> int {
        print(identity<i32>(42));
        print(identity<string>("hello"));
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("42\nhello\n");
  });

  test("generic function with multiple type params", () => {
    const r = run("generic_multi", `
      import { print } from io;
      fn first<A, B>(a: A, b: B) -> A {
        return a;
      }
      fn second<A, B>(a: A, b: B) -> B {
        return b;
      }
      fn main() -> int {
        print(first<i32, bool>(42, true));
        print(second<i32, string>(42, "world"));
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("42\nworld\n");
  });
});

// ─── Operator overloading end-to-end ────────────────────────────────────────

describe("e2e: operator overloading", () => {
  test("struct with + operator", () => {
    const r = run("op_add", `
      import { print } from io;
      struct Vec2 {
        x: int;
        y: int;

        fn op_add(self: Vec2, other: Vec2) -> Vec2 {
          return Vec2{ x: self.x + other.x, y: self.y + other.y };
        }
      }
      fn main() -> int {
        let a = Vec2{ x: 1, y: 2 };
        let b = Vec2{ x: 3, y: 4 };
        let c = a + b;
        print(c.x);
        print(c.y);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("4\n6\n");
  });

  test("struct with * operator", () => {
    const r = run("op_mul", `
      import { print } from io;
      struct Vec2 {
        x: int;
        y: int;

        fn op_mul(self: Vec2, other: Vec2) -> int {
          return self.x * other.x + self.y * other.y;
        }
      }
      fn main() -> int {
        let a = Vec2{ x: 2, y: 3 };
        let b = Vec2{ x: 4, y: 5 };
        let dot = a * b;
        print(dot);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    // 2*4 + 3*5 = 8 + 15 = 23
    expect(r.stdout).toBe("23\n");
  });

  test("struct with - operator", () => {
    const r = run("op_sub", `
      import { print } from io;
      struct Vec2 {
        x: int;
        y: int;

        fn op_sub(self: Vec2, other: Vec2) -> Vec2 {
          return Vec2{ x: self.x - other.x, y: self.y - other.y };
        }
      }
      fn main() -> int {
        let a = Vec2{ x: 10, y: 20 };
        let b = Vec2{ x: 3, y: 7 };
        let c = a - b;
        print(c.x);
        print(c.y);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("7\n13\n");
  });
});

// ─── Advanced / combined features ───────────────────────────────────────────

describe("e2e: advanced", () => {
  test("mutual recursion (is_even / is_odd)", () => {
    const r = run("mutual_rec", `
      import { print } from io;
      fn is_even(n: int) -> bool {
        if n == 0 { return true; }
        return is_odd(n - 1);
      }
      fn is_odd(n: int) -> bool {
        if n == 0 { return false; }
        return is_even(n - 1);
      }
      fn main() -> int {
        print(is_even(10));
        print(is_odd(10));
        print(is_even(7));
        print(is_odd(7));
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("true\nfalse\nfalse\ntrue\n");
  });

  test("compound assignment operators", () => {
    const r = run("compound_assign", `
      import { print } from io;
      fn main() -> int {
        let x: int = 10;
        x += 5;
        print(x);
        x -= 3;
        print(x);
        x *= 2;
        print(x);
        x /= 6;
        print(x);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("15\n12\n24\n4\n");
  });

  test("type casting", () => {
    const r = run("cast", `
      import { print } from io;
      fn main() -> int {
        let x: i32 = 42;
        let y: i64 = x as i64;
        print(y);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("42\n");
  });

  test("exit code from main", () => {
    const r = run("exit_code", `
      fn main() -> int {
        return 42;
      }
    `);
    expect(r.exitCode).toBe(42);
  });

  test("float arithmetic", () => {
    const r = run("float_arith", `
      import { print } from io;
      fn main() -> int {
        let x: f64 = 3.14;
        let y: f64 = 2.0;
        let z: f64 = x * y;
        print(z);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("6.28\n");
  });

  test("string comparison", () => {
    const r = run("str_cmp", `
      import { print } from io;
      fn main() -> int {
        let a: string = "hello";
        let b: string = "hello";
        let c: string = "world";
        if a == b {
          print("equal");
        } else {
          print("not equal");
        }
        if a == c {
          print("equal");
        } else {
          print("not equal");
        }
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("equal\nnot equal\n");
  });

  test("nested function calls", () => {
    const r = run("nested_calls", `
      import { print } from io;
      fn add(a: int, b: int) -> int { return a + b; }
      fn mul(a: int, b: int) -> int { return a * b; }
      fn main() -> int {
        print(add(mul(3, 4), mul(5, 6)));
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    // 3*4 + 5*6 = 12 + 30 = 42
    expect(r.stdout).toBe("42\n");
  });

  test("chained comparisons with boolean vars", () => {
    const r = run("comparisons", `
      import { print } from io;
      fn main() -> int {
        let x: int = 5;
        print(x > 3);
        print(x < 10);
        print(x >= 5);
        print(x <= 5);
        print(x == 5);
        print(x != 4);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("true\ntrue\ntrue\ntrue\ntrue\ntrue\n");
  });

  test("deeply nested expressions", () => {
    const r = run("deep_expr", `
      import { print } from io;
      fn main() -> int {
        let result: int = (1 + 2) * (3 + 4) - (5 - 6);
        print(result);
        return 0;
      }
    `);
    expect(r.exitCode).toBe(0);
    // (1+2)*(3+4) - (5-6) = 3*7 - (-1) = 21 + 1 = 22
    expect(r.stdout).toBe("22\n");
  });
});
