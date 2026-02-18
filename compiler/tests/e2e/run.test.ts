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

// ─── Basic programs ──────────────────────────────────────────────────────────

describe("e2e: basic programs", () => {
  test("hello world with print", () => {
    const r = run(
      "hello",
      `
      import { print } from io;
      fn main() -> int {
        print("Hello, World!");
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("Hello, World!\n");
  });

  test("fibonacci recursive", () => {
    const r = run(
      "fib",
      `
      import { print } from io;
      fn fib(n: int) -> int {
        if n <= 1 { return n; }
        return fib(n - 1) + fib(n - 2);
      }
      fn main() -> int {
        print(fib(10));
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("55\n");
  });

  test("factorial recursive", () => {
    const r = run(
      "fact",
      `
      import { print } from io;
      fn factorial(n: int) -> int {
        if n <= 1 { return 1; }
        return n * factorial(n - 1);
      }
      fn main() -> int {
        print(factorial(10));
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("3628800\n");
  });

  test("simple arithmetic expressions", () => {
    const r = run(
      "arith",
      `
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
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("13\n7\n30\n3\n1\n");
  });

  test("string concatenation with +", () => {
    const r = run(
      "strcat",
      `
      import { print } from io;
      fn main() -> int {
        let greeting: string = "Hello" + ", " + "World!";
        print(greeting);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("Hello, World!\n");
  });

  test("boolean logic", () => {
    const r = run(
      "booleans",
      `
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
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("true\ntrue\nfalse\nfalse\n");
  });

  test("multiple print types", () => {
    const r = run(
      "print_types",
      `
      import { print } from io;
      fn main() -> int {
        print(42);
        print("hello");
        print(true);
        print(false);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("42\nhello\ntrue\nfalse\n");
  });
});

// ─── Structs end-to-end ─────────────────────────────────────────────────────

describe("e2e: structs", () => {
  test("create struct, access fields, print", () => {
    const r = run(
      "struct_basic",
      `
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
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("10\n20\n30\n");
  });

  test("multiple struct instances", () => {
    const r = run(
      "struct_multi",
      `
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
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("4\n6\n");
  });

  test("struct with bool and int fields", () => {
    const r = run(
      "struct_mixed",
      `
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
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("true\n5\n");
  });

  test("struct with string fields", () => {
    const r = run(
      "struct_string",
      `
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
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("Alice\n30\n");
  });
});

// ─── Control flow end-to-end ────────────────────────────────────────────────

describe("e2e: control flow", () => {
  test("while loop counting", () => {
    const r = run(
      "while_count",
      `
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
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("55\n");
  });

  test("nested if/else", () => {
    const r = run(
      "nested_if",
      `
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
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("big\nsmall\nnon-positive\n");
  });

  test("break in while loop", () => {
    const r = run(
      "break_loop",
      `
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
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("5\n");
  });

  test("continue in while loop", () => {
    const r = run(
      "continue_loop",
      `
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
    `
    );
    expect(r.exitCode).toBe(0);
    // sum of odd numbers 1..9 = 1+3+5+7+9 = 25
    expect(r.stdout).toBe("25\n");
  });

  test("for range loop", () => {
    const r = run(
      "for_range",
      `
      import { print } from io;
      fn main() -> int {
        let sum: int = 0;
        for (let i = 0; i < 5; i = i + 1) {
          sum = sum + i;
        }
        print(sum);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    // 0+1+2+3+4 = 10
    expect(r.stdout).toBe("10\n");
  });

  test("early return from function", () => {
    const r = run(
      "early_return",
      `
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
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("negative\nzero\npositive\n");
  });
});

// ─── Arrays end-to-end ──────────────────────────────────────────────────────

describe("e2e: arrays", () => {
  test("array literal and indexing", () => {
    const r = run(
      "array_basic",
      `
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
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("10\n20\n30\n3\n");
  });

  test("array index assignment", () => {
    const r = run(
      "array_assign",
      `
      import { print } from io;
      fn main() -> int {
        let arr = [1, 2, 3];
        arr[0] = 99;
        print(arr[0]);
        print(arr[1]);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("99\n2\n");
  });

  test("array sum with for range", () => {
    const r = run(
      "array_sum",
      `
      import { print } from io;
      fn main() -> int {
        let arr = [1, 2, 3, 4, 5];
        let sum: int = 0;
        for (let i = 0; i < 5; i = i + 1) {
          sum = sum + arr[i];
        }
        print(sum);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("15\n");
  });

  test("array of booleans", () => {
    const r = run(
      "array_bool",
      `
      import { print } from io;
      fn main() -> int {
        let flags = [true, false, true];
        print(flags[0]);
        print(flags[1]);
        print(flags[2]);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("true\nfalse\ntrue\n");
  });
});

// ─── Error handling end-to-end ──────────────────────────────────────────────

describe("e2e: error handling", () => {
  test("function that throws, caller catches", () => {
    const r = run(
      "throws_catch",
      `
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
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("50\n404\n");
  });

  test("catch panic converts any error to panic", () => {
    const r = run(
      "catch_panic",
      `
      struct Oops { msg: int; }
      fn bad() -> int throws Oops {
        throw Oops{ msg: 1 };
      }
      fn main() -> int {
        let x = bad() catch panic;
        return 0;
      }
    `
    );
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("panic");
  });

  test("multiple catch branches", () => {
    const r = run(
      "multi_catch",
      `
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
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("10\n");
  });

  test("catch throw re-propagates error", () => {
    const r = run(
      "catch_throw",
      `
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
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("42\n");
  });
});

// ─── Generics end-to-end ────────────────────────────────────────────────────

describe("e2e: generics", () => {
  test("generic struct Pair<A,B> with different instantiations", () => {
    const r = run(
      "generic_pair",
      `
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
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("10\n20\n99\ntrue\n");
  });

  test("generic function identity<T> with i32 and string", () => {
    const r = run(
      "generic_fn",
      `
      import { print } from io;
      fn identity<T>(x: T) -> T {
        return x;
      }
      fn main() -> int {
        print(identity<i32>(42));
        print(identity<string>("hello"));
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("42\nhello\n");
  });

  test("generic function with multiple type params", () => {
    const r = run(
      "generic_multi",
      `
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
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("42\nworld\n");
  });
});

// ─── Operator overloading end-to-end ────────────────────────────────────────

describe("e2e: operator overloading", () => {
  test("struct with + operator", () => {
    const r = run(
      "op_add",
      `
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
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("4\n6\n");
  });

  test("struct with * operator", () => {
    const r = run(
      "op_mul",
      `
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
    `
    );
    expect(r.exitCode).toBe(0);
    // 2*4 + 3*5 = 8 + 15 = 23
    expect(r.stdout).toBe("23\n");
  });

  test("struct with - operator", () => {
    const r = run(
      "op_sub",
      `
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
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("7\n13\n");
  });
});

// ─── Advanced / combined features ───────────────────────────────────────────

describe("e2e: advanced", () => {
  test("mutual recursion (is_even / is_odd)", () => {
    const r = run(
      "mutual_rec",
      `
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
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("true\nfalse\nfalse\ntrue\n");
  });

  test("compound assignment operators", () => {
    const r = run(
      "compound_assign",
      `
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
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("15\n12\n24\n4\n");
  });

  test("type casting", () => {
    const r = run(
      "cast",
      `
      import { print } from io;
      fn main() -> int {
        let x: i32 = 42;
        let y: i64 = x as i64;
        print(y);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("42\n");
  });

  test("exit code from main", () => {
    const r = run(
      "exit_code",
      `
      fn main() -> int {
        return 42;
      }
    `
    );
    expect(r.exitCode).toBe(42);
  });

  test("float arithmetic", () => {
    const r = run(
      "float_arith",
      `
      import { print } from io;
      fn main() -> int {
        let x: f64 = 3.14;
        let y: f64 = 2.0;
        let z: f64 = x * y;
        print(z);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("6.28\n");
  });

  test("string comparison", () => {
    const r = run(
      "str_cmp",
      `
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
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("equal\nnot equal\n");
  });

  test("nested function calls", () => {
    const r = run(
      "nested_calls",
      `
      import { print } from io;
      fn add(a: int, b: int) -> int { return a + b; }
      fn mul(a: int, b: int) -> int { return a * b; }
      fn main() -> int {
        print(add(mul(3, 4), mul(5, 6)));
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    // 3*4 + 5*6 = 12 + 30 = 42
    expect(r.stdout).toBe("42\n");
  });

  test("chained comparisons with boolean vars", () => {
    const r = run(
      "comparisons",
      `
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
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("true\ntrue\ntrue\ntrue\ntrue\ntrue\n");
  });

  test("deeply nested expressions", () => {
    const r = run(
      "deep_expr",
      `
      import { print } from io;
      fn main() -> int {
        let result: int = (1 + 2) * (3 + 4) - (5 - 6);
        print(result);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    // (1+2)*(3+4) - (5-6) = 3*7 - (-1) = 21 + 1 = 22
    expect(r.stdout).toBe("22\n");
  });
});

// ─── Complex: recursive algorithms ──────────────────────────────────────────

describe("Complex: recursive algorithms", () => {
  test("fibonacci recursive vs iterative", () => {
    const r = run(
      "complex_fib",
      `
      import { print } from io;

      fn fib_rec(n: int) -> int {
        if n <= 1 { return n; }
        return fib_rec(n - 1) + fib_rec(n - 2);
      }

      fn fib_iter(n: int) -> int {
        if n <= 1 { return n; }
        let a: int = 0;
        let b: int = 1;
        let i: int = 2;
        while i <= n {
          let tmp: int = a + b;
          a = b;
          b = tmp;
          i = i + 1;
        }
        return b;
      }

      fn main() -> int {
        // Both methods should agree for all values
        for (let i = 0; i < 15; i = i + 1) {
          let rec: int = fib_rec(i);
          let iter: int = fib_iter(i);
          if rec != iter {
            print("MISMATCH");
            return 1;
          }
        }
        print(fib_rec(10));
        print(fib_iter(20));
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("55\n6765\n");
  });

  test("factorial with overflow check", () => {
    const r = run(
      "complex_fact",
      `
      import { print } from io;

      fn factorial(n: int) -> int {
        if n <= 1 { return 1; }
        return n * factorial(n - 1);
      }

      fn safe_factorial(n: int) -> int {
        // Iterative with running product
        let result: int = 1;
        for (let i = 1; i < 13; i = i + 1) {
          if i > n { break; }
          result = result * i;
        }
        return result;
      }

      fn main() -> int {
        // Check small values
        print(factorial(0));
        print(factorial(1));
        print(factorial(5));
        print(factorial(10));

        // Verify iterative matches recursive
        for (let i = 0; i < 12; i = i + 1) {
          if factorial(i) != safe_factorial(i) {
            print("MISMATCH");
            return 1;
          }
        }
        print("ok");
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("1\n1\n120\n3628800\nok\n");
  });

  test("tower of hanoi counter", () => {
    const r = run(
      "complex_hanoi",
      `
      import { print } from io;

      // Count moves needed for Tower of Hanoi
      fn hanoi_moves(n: int) -> int {
        if n <= 0 { return 0; }
        if n == 1 { return 1; }
        // Move n-1 disks to aux, move largest, move n-1 from aux to target
        return hanoi_moves(n - 1) + 1 + hanoi_moves(n - 1);
      }

      fn main() -> int {
        print(hanoi_moves(1));
        print(hanoi_moves(2));
        print(hanoi_moves(3));
        print(hanoi_moves(4));
        print(hanoi_moves(10));
        // 2^n - 1 moves
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    // 2^1-1=1, 2^2-1=3, 2^3-1=7, 2^4-1=15, 2^10-1=1023
    expect(r.stdout).toBe("1\n3\n7\n15\n1023\n");
  });

  test("binary search on sorted array", () => {
    const r = run(
      "complex_bsearch",
      `
      import { print } from io;

      fn main() -> int {
        let arr = [2, 5, 8, 12, 16, 23, 38, 56];

        // Search for 23 (index 5)
        let target: int = 23;
        let lo: int = 0;
        let hi: int = 7;
        let found: int = -1;
        while lo <= hi {
          let mid: int = lo + (hi - lo) / 2;
          if arr[mid] == target {
            found = mid;
            break;
          } else {
            if arr[mid] < target {
              lo = mid + 1;
            } else {
              hi = mid - 1;
            }
          }
        }
        print(found);

        // Search for 2 (index 0)
        target = 2;
        lo = 0;
        hi = 7;
        found = -1;
        while lo <= hi {
          let mid: int = lo + (hi - lo) / 2;
          if arr[mid] == target {
            found = mid;
            break;
          } else {
            if arr[mid] < target {
              lo = mid + 1;
            } else {
              hi = mid - 1;
            }
          }
        }
        print(found);

        // Search for 99 (not found)
        target = 99;
        lo = 0;
        hi = 7;
        found = -1;
        while lo <= hi {
          let mid: int = lo + (hi - lo) / 2;
          if arr[mid] == target {
            found = mid;
            break;
          } else {
            if arr[mid] < target {
              lo = mid + 1;
            } else {
              hi = mid - 1;
            }
          }
        }
        print(found);

        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("5\n0\n-1\n");
  });

  test("GCD and LCM via recursion", () => {
    const r = run(
      "complex_gcd",
      `
      import { print } from io;

      fn gcd(a: int, b: int) -> int {
        if b == 0 { return a; }
        return gcd(b, a % b);
      }

      fn lcm(a: int, b: int) -> int {
        return (a / gcd(a, b)) * b;
      }

      fn main() -> int {
        print(gcd(48, 18));
        print(gcd(100, 75));
        print(gcd(17, 13));
        print(lcm(4, 6));
        print(lcm(12, 18));
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("6\n25\n1\n12\n36\n");
  });
});

// ─── Complex: structs with lifecycle ────────────────────────────────────────

describe("Complex: structs with lifecycle", () => {
  test("struct with __destroy hook", () => {
    const r = run(
      "complex_destroy",
      `
      import { print } from io;

      struct Resource {
        id: int;

        fn __destroy(self: Resource) {
          print("destroy");
          print(self.id);
        }
      }

      fn main() -> int {
        let r1 = Resource{ id: 1 };
        print("created");
        print(r1.id);
        // r1 destroyed at end of scope
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("created\n1\n");
    expect(r.stdout).toContain("destroy\n1\n");
  });

  test("struct with __oncopy hook via assignment", () => {
    const r = run(
      "complex_oncopy",
      `
      import { print } from io;

      struct Counter {
        val: int;

        fn __oncopy(self: Counter) -> Counter {
          print("copied");
          return Counter{ val: self.val + 100 };
        }

        fn __destroy(self: Counter) {
          print("destroy");
          print(self.val);
        }
      }

      fn main() -> int {
        let c = Counter{ val: 42 };
        let c2 = c;
        print(c.val);
        print(c2.val);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("copied\n");
    expect(r.stdout).toContain("42\n");
  });

  test("auto-generated __oncopy for struct with string field", () => {
    const r = run(
      "auto_oncopy_string",
      `
      import { print } from io;

      struct Wrapper {
        text: string;
        id: int;
      }

      fn main() -> int {
        let a = Wrapper{ text: "hello", id: 1 };
        let b = a;
        print(a.text);
        print(b.text);
        print(a.id);
        print(b.id);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("hello\nhello\n1\n1\n");
  });

  test("struct field manipulation and computation", () => {
    const r = run(
      "complex_struct_compute",
      `
      import { print } from io;

      struct Point {
        x: int;
        y: int;
      }

      fn make_point(x: int, y: int) -> Point {
        return Point{ x: x, y: y };
      }

      fn main() -> int {
        let origin = make_point(0, 0);
        let p = make_point(origin.x + 3, origin.y + 4);
        print(p.x);
        print(p.y);

        let q = make_point(p.x + 1, p.y + 1);
        print(q.x);
        print(q.y);

        // Distance squared computed inline
        let dx: int = origin.x - p.x;
        let dy: int = origin.y - p.y;
        print(dx * dx + dy * dy);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("3\n4\n4\n5\n25\n");
  });

  test("multiple struct types with computed fields", () => {
    const r = run(
      "complex_multi_struct",
      `
      import { print } from io;

      struct Rect {
        x: int;
        y: int;
        w: int;
        h: int;
      }

      struct Circle {
        cx: int;
        cy: int;
        r: int;
      }

      fn rect_area(x: int, y: int, w: int, h: int) -> int {
        return w * h;
      }

      fn rect_contains(rx: int, ry: int, rw: int, rh: int, px: int, py: int) -> bool {
        return px >= rx && px < rx + rw
            && py >= ry && py < ry + rh;
      }

      fn circle_area_approx(r: int) -> int {
        return 3 * r * r;
      }

      fn main() -> int {
        let r = Rect{ x: 0, y: 0, w: 10, h: 5 };
        print(rect_area(r.x, r.y, r.w, r.h));
        print(rect_contains(r.x, r.y, r.w, r.h, 5, 3));
        print(rect_contains(r.x, r.y, r.w, r.h, 15, 3));

        let c = Circle{ cx: 0, cy: 0, r: 5 };
        print(circle_area_approx(c.r));

        // Nested struct computations
        let r2 = Rect{ x: r.x + r.w, y: r.y, w: 5, h: 3 };
        print(r2.x);
        print(rect_area(r2.x, r2.y, r2.w, r2.h));

        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("50\ntrue\nfalse\n75\n10\n15\n");
  });
});

// ─── Complex: error handling chains ─────────────────────────────────────────

describe("Complex: error handling chains", () => {
  test("error propagation through call chain", () => {
    const r = run(
      "complex_err_chain",
      `
      import { print } from io;

      struct ParseError { pos: int; }
      struct ValidateError { code: int; }

      fn parse(input: int) -> int throws ParseError {
        if input < 0 {
          throw ParseError{ pos: input };
        }
        return input * 2;
      }

      fn validate(value: int) -> int throws ValidateError {
        if value > 100 {
          throw ValidateError{ code: 1 };
        }
        return value;
      }

      fn process(input: int) -> int throws ParseError, ValidateError {
        let parsed = parse(input) catch throw;
        let validated = validate(parsed) catch throw;
        return validated;
      }

      fn main() -> int {
        // Success case
        let r1 = process(10) catch {
          ParseError e: {
            print("parse error");
            return 1;
          }
          ValidateError e: {
            print("validate error");
            return 1;
          }
        };
        print(r1);

        // Parse error case
        let r2 = process(-5) catch {
          ParseError e: {
            print("parse error");
            print(e.pos);
            return 0;
          }
          ValidateError e: {
            print("validate error");
            return 1;
          }
        };

        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("20\nparse error\n-5\n");
  });

  test("multiple error types with binding", () => {
    const r = run(
      "complex_multi_err",
      `
      import { print } from io;

      struct NotFound { id: int; }
      struct Forbidden { level: int; }
      struct Timeout { ms: int; }

      fn lookup(id: int) -> int throws NotFound, Forbidden, Timeout {
        if id == 0 { throw NotFound{ id: 0 }; }
        if id < 0 { throw Forbidden{ level: 3 }; }
        if id > 1000 { throw Timeout{ ms: 5000 }; }
        return id;
      }

      fn main() -> int {
        // Test each error branch
        let a = lookup(42) catch {
          NotFound e: { return 1; }
          Forbidden e: { return 1; }
          Timeout e: { return 1; }
        };
        print(a);

        let b = lookup(0) catch {
          NotFound e: {
            print(e.id);
            return 0;
          }
          Forbidden e: { return 1; }
          Timeout e: { return 1; }
        };

        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("42\n0\n");
  });

  test("catch throw re-propagation with tag remapping", () => {
    const r = run(
      "complex_rethrow",
      `
      import { print } from io;

      struct ErrA { a: int; }
      struct ErrB { b: int; }

      fn inner() -> int throws ErrA {
        throw ErrA{ a: 111 };
      }

      fn middle() -> int throws ErrB, ErrA {
        // catch throw propagates ErrA, but tag remapping needed
        // because middle's error order is different
        let x = inner() catch throw;
        return x;
      }

      fn main() -> int {
        let result = middle() catch {
          ErrB e: {
            print("got B");
            return 1;
          }
          ErrA e: {
            print("got A");
            print(e.a);
            return 0;
          }
        };
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("got A\n111\n");
  });

  test("error handling with success path computations", () => {
    const r = run(
      "complex_err_compute",
      `
      import { print } from io;

      struct DivByZero { dividend: int; }

      fn safe_div(a: int, b: int) -> int throws DivByZero {
        if b == 0 {
          throw DivByZero{ dividend: a };
        }
        return a / b;
      }

      fn main() -> int {
        // Chain of successful divisions
        let a = safe_div(100, 5) catch { DivByZero e: { return 1; } };
        let b = safe_div(a, 4) catch { DivByZero e: { return 1; } };
        let c = safe_div(b, 1) catch { DivByZero e: { return 1; } };
        print(a);
        print(b);
        print(c);

        // Division by zero
        let d = safe_div(42, 0) catch {
          DivByZero e: {
            print(e.dividend);
            return 0;
          }
        };
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("20\n5\n5\n42\n");
  });
});

// ─── Complex: operator overloading + generics ───────────────────────────────

describe("Complex: operator overloading + generics", () => {
  test("Vec2 with +, -, == operators", () => {
    const r = run(
      "complex_vec2_ops",
      `
      import { print } from io;

      struct Vec2 {
        x: int;
        y: int;

        fn op_add(self: Vec2, other: Vec2) -> Vec2 {
          return Vec2{ x: self.x + other.x, y: self.y + other.y };
        }

        fn op_sub(self: Vec2, other: Vec2) -> Vec2 {
          return Vec2{ x: self.x - other.x, y: self.y - other.y };
        }

        fn op_eq(self: Vec2, other: Vec2) -> bool {
          return self.x == other.x && self.y == other.y;
        }

        fn dot(self: Vec2, other: Vec2) -> int {
          return self.x * other.x + self.y * other.y;
        }

        fn magnitude_sq(self: Vec2) -> int {
          return self.x * self.x + self.y * self.y;
        }
      }

      fn main() -> int {
        let a = Vec2{ x: 3, y: 4 };
        let b = Vec2{ x: 1, y: 2 };

        let sum = a + b;
        print(sum.x);
        print(sum.y);

        let diff = a - b;
        print(diff.x);
        print(diff.y);

        print(a == a);
        print(a == b);

        print(a.dot(b));
        print(a.magnitude_sq());

        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    // sum = (4,6), diff = (2,2), a==a true, a==b false, dot=3+8=11, mag_sq=9+16=25
    expect(r.stdout).toBe("4\n6\n2\n2\ntrue\nfalse\n11\n25\n");
  });

  test("chained operator overloading (a + b + c)", () => {
    const r = run(
      "complex_chained_ops",
      `
      import { print } from io;

      struct Vec2 {
        x: int;
        y: int;

        fn op_add(self: Vec2, other: Vec2) -> Vec2 {
          return Vec2{ x: self.x + other.x, y: self.y + other.y };
        }

        fn op_sub(self: Vec2, other: Vec2) -> Vec2 {
          return Vec2{ x: self.x - other.x, y: self.y - other.y };
        }
      }

      fn main() -> int {
        let a = Vec2{ x: 1, y: 1 };
        let b = Vec2{ x: 2, y: 3 };
        let c = Vec2{ x: 4, y: 5 };

        // a + b + c
        let sum = a + b + c;
        print(sum.x);
        print(sum.y);

        // a + b - c
        let mixed = a + b - c;
        print(mixed.x);
        print(mixed.y);

        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    // sum = (1+2+4, 1+3+5) = (7, 9)
    // mixed = (1+2-4, 1+3-5) = (-1, -1)
    expect(r.stdout).toBe("7\n9\n-1\n-1\n");
  });

  // skip: KIR lowering and C backend not yet updated for generics (generic type args in function body)
  test("generic struct Pair with methods", () => {
    const r = run(
      "complex_generic_pair",
      `
      import { print } from io;

      struct Pair<A, B> {
        first: A;
        second: B;
      }

      fn make_pair<A, B>(a: A, b: B) -> Pair<A, B> {
        return Pair<A, B>{ first: a, second: b };
      }

      fn main() -> int {
        let p1 = make_pair<i32, i32>(10, 20);
        print(p1.first);
        print(p1.second);

        let p2 = make_pair<i32, bool>(42, true);
        print(p2.first);
        print(p2.second);

        let p3 = make_pair<string, i32>("hello", 99);
        print(p3.first);
        print(p3.second);

        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("10\n20\n42\ntrue\nhello\n99\n");
  });

  // skip: KIR lowering and C backend not yet updated for generics (generic type args in nested calls)
  test("generic function with multiple instantiations", () => {
    const r = run(
      "complex_generic_multi",
      `
      import { print } from io;

      fn max<T>(a: T, b: T) -> T {
        if a > b { return a; }
        return b;
      }

      fn min<T>(a: T, b: T) -> T {
        if a < b { return a; }
        return b;
      }

      fn clamp<T>(val: T, lo: T, hi: T) -> T {
        return max<T>(lo, min<T>(val, hi));
      }

      fn main() -> int {
        print(max<i32>(10, 20));
        print(min<i32>(10, 20));
        print(clamp<i32>(50, 0, 100));
        print(clamp<i32>(-10, 0, 100));
        print(clamp<i32>(200, 0, 100));
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("20\n10\n50\n0\n100\n");
  });
});

// ─── Complex: control flow edge cases ───────────────────────────────────────

describe("Complex: control flow edge cases", () => {
  test("nested loops with break and continue", () => {
    const r = run(
      "complex_nested_loops",
      `
      import { print } from io;

      fn main() -> int {
        // Find first pair (i, j) where i*j == 12 with i < j
        let found_i: int = -1;
        let found_j: int = -1;
        let i: int = 1;
        while i <= 10 {
          let j: int = i + 1;
          while j <= 10 {
            if i * j == 12 {
              found_i = i;
              found_j = j;
              break;
            }
            j = j + 1;
          }
          if found_i != -1 { break; }
          i = i + 1;
        }
        print(found_i);
        print(found_j);

        // Sum only when both indices are odd
        let sum: int = 0;
        for (let i = 0; i < 5; i = i + 1) {
          if i % 2 == 0 { continue; }
          for (let j = 0; j < 5; j = j + 1) {
            if j % 2 == 0 { continue; }
            sum = sum + i * j;
          }
        }
        print(sum);

        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    // First pair: 2*6=12, so (2,6). But wait: i=1, j=12 nope (j<=10). i=2, j=6. Yes.
    // Sum: i=1,j=1: 1; i=1,j=3: 3; i=3,j=1: 3; i=3,j=3: 9 = 16
    expect(r.stdout).toBe("2\n6\n16\n");
  });

  test("switch statement with multiple cases", () => {
    const r = run(
      "complex_switch",
      `
      import { print } from io;

      fn day_type(day: int) -> string {
        switch day {
          case 0: return "sunday";
          case 6: return "saturday";
          case 1: return "monday";
          case 2: return "tuesday";
          case 3: return "wednesday";
          case 4: return "thursday";
          case 5: return "friday";
          default: return "unknown";
        }
      }

      fn main() -> int {
        for (let i = 0; i < 8; i = i + 1) {
          print(day_type(i));
        }
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(
      "sunday\nmonday\ntuesday\nwednesday\nthursday\nfriday\nsaturday\nunknown\n"
    );
  });

  test("switch expression", () => {
    const r = run(
      "switch_expr",
      `
      import { print } from io;

      fn status_message(code: int) -> string {
        let msg = switch code {
          case 200: "OK";
          case 404: "Not Found";
          case 500: "Server Error";
          default: "Unknown";
        };
        return msg;
      }

      fn main() -> int {
        print(status_message(200));
        print(status_message(404));
        print(status_message(500));
        print(status_message(999));
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("OK\nNot Found\nServer Error\nUnknown\n");
  });

  test("switch expression with int result", () => {
    const r = run(
      "switch_expr_int",
      `
      import { print } from io;

      fn main() -> int {
        let x = 2;
        let result = switch x {
          case 1: 10;
          case 2: 20;
          case 3: 30;
          default: 0;
        };
        print(result);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("20\n");
  });

  test("early return from deeply nested blocks", () => {
    const r = run(
      "complex_early_return",
      `
      import { print } from io;

      fn find_divisor(n: int) -> int {
        let i: int = 2;
        while i < n {
          if n % i == 0 {
            return i;
          }
          i = i + 1;
        }
        return n;
      }

      fn is_prime(n: int) -> bool {
        if n < 2 { return false; }
        return find_divisor(n) == n;
      }

      fn main() -> int {
        // Print primes up to 30
        for (let i = 2; i < 31; i = i + 1) {
          if is_prime(i) {
            print(i);
          }
        }
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("2\n3\n5\n7\n11\n13\n17\n19\n23\n29\n");
  });

  test("complex while with multiple conditions and state", () => {
    const r = run(
      "complex_while_state",
      `
      import { print } from io;

      fn collatz_steps(n: int) -> int {
        let steps: int = 0;
        let val: int = n;
        while val != 1 {
          if val % 2 == 0 {
            val = val / 2;
          } else {
            val = val * 3 + 1;
          }
          steps = steps + 1;
        }
        return steps;
      }

      fn main() -> int {
        print(collatz_steps(1));
        print(collatz_steps(2));
        print(collatz_steps(3));
        print(collatz_steps(6));
        print(collatz_steps(27));
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    // Collatz: 1→0, 2→1, 3→7, 6→8, 27→111
    expect(r.stdout).toBe("0\n1\n7\n8\n111\n");
  });

  test("for range with break and accumulated result", () => {
    const r = run(
      "complex_for_break",
      `
      import { print } from io;

      fn sum_until_exceeds(limit: int) -> int {
        let sum: int = 0;
        for (let i = 1; i < 1000; i = i + 1) {
          sum = sum + i;
          if sum > limit { break; }
        }
        return sum;
      }

      fn main() -> int {
        print(sum_until_exceeds(10));
        print(sum_until_exceeds(50));
        print(sum_until_exceeds(100));
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    // 1+2+3+4+5=15 > 10
    // 1+...+10=55 > 50
    // 1+...+14=105 > 100
    expect(r.stdout).toBe("15\n55\n105\n");
  });
});

// ─── Complex: realistic programs ────────────────────────────────────────────

describe("Complex: realistic programs", () => {
  test("bubble sort on array", () => {
    const r = run(
      "complex_bubble_sort",
      `
      import { print } from io;

      fn main() -> int {
        let arr = [64, 34, 25, 12, 22, 11, 90];
        let n: int = 7;

        // Bubble sort
        for (let i = 0; i < 7; i = i + 1) {
          let j: int = 0;
          while j < n - i - 1 {
            if arr[j] > arr[j + 1] {
              let tmp: int = arr[j];
              arr[j] = arr[j + 1];
              arr[j + 1] = tmp;
            }
            j = j + 1;
          }
        }

        for (let i = 0; i < 7; i = i + 1) {
          print(arr[i]);
        }
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("11\n12\n22\n25\n34\n64\n90\n");
  });

  test("selection sort with min-finding", () => {
    const r = run(
      "complex_selection_sort",
      `
      import { print } from io;

      fn main() -> int {
        let arr = [5, 3, 8, 1, 9, 2, 7, 4, 6];
        let n: int = 9;

        for (let i = 0; i < 9; i = i + 1) {
          let min_idx: int = i;
          let j: int = i + 1;
          while j < n {
            if arr[j] < arr[min_idx] {
              min_idx = j;
            }
            j = j + 1;
          }
          if min_idx != i {
            let tmp: int = arr[i];
            arr[i] = arr[min_idx];
            arr[min_idx] = tmp;
          }
        }

        for (let i = 0; i < 9; i = i + 1) {
          print(arr[i]);
        }
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("1\n2\n3\n4\n5\n6\n7\n8\n9\n");
  });

  test("string building via concatenation", () => {
    const r = run(
      "complex_string_build",
      `
      import { print } from io;

      fn repeat(s: string, n: int) -> string {
        let result: string = "";
        for (let i = 0; i < 10; i = i + 1) {
          if i >= n { break; }
          result = result + s;
        }
        return result;
      }

      fn main() -> int {
        print(repeat("ab", 3));
        print(repeat("x", 5));
        print(repeat("hi ", 2));
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("ababab\nxxxxx\nhi hi \n");
  });

  test("enum state machine", () => {
    const r = run(
      "complex_enum_sm",
      `
      import { print } from io;

      enum State {
        Idle,
        Running,
        Paused,
        Done,
      }

      fn transition(state: State, event: int) -> State {
        // event: 0=start, 1=pause, 2=resume, 3=finish
        switch state {
          case State.Idle: {
            if event == 0 { return State.Running; }
            return state;
          }
          case State.Running: {
            if event == 1 { return State.Paused; }
            if event == 3 { return State.Done; }
            return state;
          }
          case State.Paused: {
            if event == 2 { return State.Running; }
            if event == 3 { return State.Done; }
            return state;
          }
          default: return state;
        }
      }

      fn state_name(s: State) -> string {
        switch s {
          case State.Idle: return "idle";
          case State.Running: return "running";
          case State.Paused: return "paused";
          case State.Done: return "done";
          default: return "unknown";
        }
      }

      fn main() -> int {
        let s = State.Idle;
        print(state_name(s));

        s = transition(s, 0);
        print(state_name(s));

        s = transition(s, 1);
        print(state_name(s));

        s = transition(s, 2);
        print(state_name(s));

        s = transition(s, 3);
        print(state_name(s));

        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("idle\nrunning\npaused\nrunning\ndone\n");
  });

  // skip: parser does not support typed array syntax [type; N] in struct fields
  test.skip("struct-based stack (LIFO) with fixed array", () => {
    const r = run(
      "complex_stack",
      `
      import { print } from io;

      struct Stack {
        data: [int; 16];
        top: int;

        fn push(self: Stack, val: int) -> Stack {
          let s = Stack{ data: self.data, top: self.top };
          s.data[s.top] = val;
          s.top = s.top + 1;
          return s;
        }

        fn peek(self: Stack) -> int {
          return self.data[self.top - 1];
        }

        fn pop(self: Stack) -> Stack {
          return Stack{ data: self.data, top: self.top - 1 };
        }

        fn is_empty(self: Stack) -> bool {
          return self.top == 0;
        }

        fn size(self: Stack) -> int {
          return self.top;
        }
      }

      fn main() -> int {
        let s = Stack{ data: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], top: 0 };
        print(s.is_empty());

        s = s.push(10);
        s = s.push(20);
        s = s.push(30);
        print(s.size());
        print(s.peek());

        s = s.pop();
        print(s.peek());
        print(s.size());

        s = s.pop();
        s = s.pop();
        print(s.is_empty());

        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("true\n3\n30\n20\n2\ntrue\n");
  });

  // skip: parser does not support typed array syntax [type; N] as function parameter type
  test.skip("matrix-like computation with nested arrays", () => {
    const r = run(
      "complex_matrix",
      `
      import { print } from io;

      // Simulate 3x3 matrix as flat array
      fn mat_get(m: [int; 9], row: int, col: int) -> int {
        return m[row * 3 + col];
      }

      fn mat_trace(m: [int; 9]) -> int {
        return mat_get(m, 0, 0) + mat_get(m, 1, 1) + mat_get(m, 2, 2);
      }

      fn mat_row_sum(m: [int; 9], row: int) -> int {
        let sum: int = 0;
        for (let col = 0; col < 3; col = col + 1) {
          sum = sum + mat_get(m, row, col);
        }
        return sum;
      }

      fn main() -> int {
        // Identity-like matrix with values
        //  1  2  3
        //  4  5  6
        //  7  8  9
        let m = [1, 2, 3, 4, 5, 6, 7, 8, 9];

        print(mat_trace(m));

        print(mat_row_sum(m, 0));
        print(mat_row_sum(m, 1));
        print(mat_row_sum(m, 2));

        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    // trace = 1+5+9=15, rows: 6, 15, 24
    expect(r.stdout).toBe("15\n6\n15\n24\n");
  });

  test("integer-to-string conversion algorithm", () => {
    const r = run(
      "complex_itoa",
      `
      import { print } from io;

      fn num_digits(n: int) -> int {
        if n == 0 { return 1; }
        let count: int = 0;
        let val: int = n;
        if val < 0 { val = 0 - val; }
        while val > 0 {
          count = count + 1;
          val = val / 10;
        }
        return count;
      }

      fn digit_sum(n: int) -> int {
        let sum: int = 0;
        let val: int = n;
        if val < 0 { val = 0 - val; }
        while val > 0 {
          sum = sum + val % 10;
          val = val / 10;
        }
        return sum;
      }

      fn reverse_number(n: int) -> int {
        let result: int = 0;
        let val: int = n;
        while val > 0 {
          result = result * 10 + val % 10;
          val = val / 10;
        }
        return result;
      }

      fn main() -> int {
        print(num_digits(0));
        print(num_digits(42));
        print(num_digits(12345));

        print(digit_sum(123));
        print(digit_sum(999));

        print(reverse_number(12345));
        print(reverse_number(100));

        // Check if palindrome: 12321
        let n: int = 12321;
        print(n == reverse_number(n));
        let m: int = 12345;
        print(m == reverse_number(m));

        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("1\n2\n5\n6\n27\n54321\n1\ntrue\nfalse\n");
  });
});

// ─── Enum data variants with destructuring ──────────────────────────────────

describe("e2e: enum data variants", () => {
  test("create data variant and switch with destructuring", () => {
    const r = run(
      "enum_data_destruct",
      `
      import { print } from io;

      enum Shape {
        Circle(radius: f64),
        Rect(w: f64, h: f64),
        Point
      }

      fn main() -> int {
        let c: Shape = Shape.Circle(3.14);
        let r: Shape = Shape.Rect(2.0, 5.0);
        let p: Shape = Shape.Point;

        switch c {
          case Circle(rad): print(rad);
          case Rect(w, h): print(w);
          case Point: print(0.0);
        }

        switch r {
          case Circle(rad): print(rad);
          case Rect(w, h): {
            let area = w * h;
            print(area);
          }
          case Point: print(0.0);
        }

        switch p {
          case Circle(rad): print(rad);
          case Rect(w, h): print(w);
          case Point: print(0.0);
        }

        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("3.14\n10\n0\n");
  });

  test("enum data variant with single field destructured in switch", () => {
    const r = run(
      "enum_single_field",
      `
      import { print } from io;

      enum Token {
        Number(val: i32),
        Plus,
        Minus
      }

      fn main() -> int {
        let t1: Token = Token.Number(42);
        let t2: Token = Token.Plus;
        let t3: Token = Token.Minus;

        switch t1 {
          case Number(v): print(v);
          case Plus: print(-1);
          case Minus: print(-2);
          default: print(-99);
        }

        switch t2 {
          case Number(v): print(v);
          case Plus: print(-1);
          case Minus: print(-2);
          default: print(-99);
        }

        switch t3 {
          case Number(v): print(v);
          case Plus: print(-1);
          case Minus: print(-2);
          default: print(-99);
        }

        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("42\n-1\n-2\n");
  });

  test("switch on enum data variant as expression with destructuring", () => {
    const r = run(
      "enum_switch_expr",
      `
      import { print } from io;

      enum Value {
        Int(n: i32),
        Bool(b: bool)
      }

      fn main() -> int {
        let v: Value = Value.Int(99);
        let result = switch v {
          case Int(n): n;
          case Bool(b): 0;
        };
        print(result);

        let v2: Value = Value.Bool(true);
        let result2 = switch v2 {
          case Int(n): n;
          case Bool(b): 1;
        };
        print(result2);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("99\n1\n");
  });
});

// ─── Switch expression ──────────────────────────────────────────────────────

describe("e2e: switch expression extended", () => {
  test("switch expression used directly in print", () => {
    const r = run(
      "switch_expr_print",
      `
      import { print } from io;

      fn main() -> int {
        let code = 2;
        let msg = switch code {
          case 1: "one";
          case 2: "two";
          case 3: "three";
          default: "other";
        };
        print(msg);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("two\n");
  });

  test("switch expression with default fallback", () => {
    const r = run(
      "switch_expr_default",
      `
      import { print } from io;

      fn main() -> int {
        let x = 999;
        let result = switch x {
          case 0: 10;
          case 1: 20;
          default: 30;
        };
        print(result);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("30\n");
  });
});

// ─── Numeric literal suffixes ───────────────────────────────────────────────

describe("e2e: numeric literal suffixes", () => {
  test("i32 and i64 suffixes", () => {
    const r = run(
      "suffix_int",
      `
      import { print } from io;

      fn main() -> int {
        let a = 42i32;
        let b = 100i64;
        print(a);
        print(b);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("42\n100\n");
  });

  test("f32 and f64 suffixes", () => {
    const r = run(
      "suffix_float",
      `
      import { print } from io;

      fn main() -> int {
        let c = 2.5f32;
        let d = 3.14f64;
        print(c);
        print(d);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("2.5\n3.14\n");
  });

  test("integer literal with float suffix", () => {
    const r = run(
      "suffix_int_to_float",
      `
      import { print } from io;

      fn main() -> int {
        let x = 42f64;
        print(x);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("42\n");
  });
});

// ─── Auto lifecycle (struct with string field) ──────────────────────────────

describe("e2e: auto lifecycle", () => {
  test("struct with string field: create and copy preserves values", () => {
    const r = run(
      "auto_lifecycle",
      `
      import { print } from io;

      struct Wrapper {
        name: string;
        id: i32;
      }

      fn main() -> int {
        let a = Wrapper{ name: "hello", id: 1 };
        let b = a;
        print(a.name);
        print(b.name);
        print(a.id);
        print(b.id);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("hello\nhello\n1\n1\n");
  });

  test("multiple structs with string fields", () => {
    const r = run(
      "auto_lifecycle_multi",
      `
      import { print } from io;

      struct Named {
        label: string;
      }

      fn main() -> int {
        let x = Named{ label: "alpha" };
        let y = Named{ label: "beta" };
        let z = x;
        print(x.label);
        print(y.label);
        print(z.label);
        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("alpha\nbeta\nalpha\n");
  });
});

// ─── Generic struct + function combo ────────────────────────────────────────

describe("e2e: generic struct + function combo", () => {
  test("generic Box struct with wrap function", () => {
    const r = run(
      "generic_box_wrap",
      `
      import { print } from io;

      struct Box<T> {
        value: T;
      }

      fn wrap<T>(x: T) -> Box<T> {
        return Box<T>{ value: x };
      }

      fn main() -> int {
        let b1 = wrap<i32>(42);
        print(b1.value);

        let b2 = wrap<bool>(true);
        print(b2.value);

        let b3 = wrap<string>("boxed");
        print(b3.value);

        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("42\ntrue\nboxed\n");
  });

  test("generic Pair struct with make function", () => {
    const r = run(
      "generic_pair_make",
      `
      import { print } from io;

      struct Pair<A, B> {
        first: A;
        second: B;
      }

      fn make_pair<A, B>(a: A, b: B) -> Pair<A, B> {
        return Pair<A, B>{ first: a, second: b };
      }

      fn main() -> int {
        let p = make_pair<i32, string>(10, "ten");
        print(p.first);
        print(p.second);

        let q = make_pair<bool, i32>(true, 99);
        print(q.first);
        print(q.second);

        return 0;
      }
    `
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("10\nten\ntrue\n99\n");
  });
});
