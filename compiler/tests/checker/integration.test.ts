import { describe, test } from "bun:test";
import { checkOk } from "./helpers.ts";

describe("Checker — Integration", () => {
  test("complete program: main function returns int", () => {
    checkOk(`
      fn main() -> int {
        return 0;
      }
    `);
  });

  test("program with struct + methods + function calls", () => {
    checkOk(`
      struct Point {
        x: f64;
        y: f64;

        fn length(self: Point) -> f64 {
          return self.x * self.x + self.y * self.y;
        }

        fn origin() -> Point {
          return Point{ x: 0.0, y: 0.0 };
        }
      }

      fn distance(p1: Point, p2: Point) -> f64 {
        let dx = p1.x - p2.x;
        let dy = p1.y - p2.y;
        return dx * dx + dy * dy;
      }

      fn main() -> int {
        let p = Point{ x: 1.0, y: 2.0 };
        let o = Point.origin();
        let len = p.length();
        let dist = distance(p, o);
        return 0;
      }
    `);
  });

  test("program with error handling (throws/catch)", () => {
    checkOk(`
      struct NotFound {}
      struct DbError { message: string; code: int; }

      fn getUser(id: int) -> int throws NotFound, DbError {
        if id < 0 { throw NotFound{}; }
        if id > 1000 { throw DbError{ message: "too large", code: 400 }; }
        return id;
      }

      fn main() -> int {
        let user = getUser(10) catch {
          NotFound: return -1;
          DbError e: return -2;
        };
        return user;
      }
    `);
  });

  test("program with unsafe block and extern fn", () => {
    checkOk(`
      extern fn puts(s: ptr<c_char>) -> int;

      fn main() -> int {
        unsafe {
          puts(null);
        }
        return 0;
      }
    `);
  });

  test("program with generics", () => {
    checkOk(`
      struct Pair<A, B> { first: A; second: B; }

      fn identity<T>(x: T) -> T { return x; }

      fn main() -> int {
        let p = Pair{ first: 42, second: "hello" };
        let x = identity(10);
        return 0;
      }
    `);
  });

  test("program with enums and switch", () => {
    checkOk(`
      enum Color : u8 { Red = 0, Green = 1, Blue = 2 }

      fn colorCode(c: Color) -> int {
        switch c {
          case Red: return 0;
          case Green: return 1;
          case Blue: return 2;
        }
      }

      fn main() -> int { return 0; }
    `);
  });

  test("program with loops, break, continue", () => {
    checkOk(`
      fn main() -> int {
        let sum = 0;
        for i in 0..10 {
          if i == 3 { continue; }
          if i == 8 { break; }
          sum = sum + i;
        }

        let count = 0;
        while count < 20 {
          count = count + 1;
        }

        return sum;
      }
    `);
  });

  test("program with move semantics", () => {
    checkOk(`
      struct Data { value: int; }

      fn consume(move d: Data) -> int {
        return d.value;
      }

      fn main() -> int {
        let d = Data{ value: 42 };
        let result = consume(move d);
        return result;
      }
    `);
  });

  test("program with type aliases", () => {
    checkOk(`
      type UserId = int;
      fn getUser(id: UserId) -> UserId { return id; }
      fn main() -> int { return getUser(42); }
    `);
  });

  test("program with static constants", () => {
    checkOk(`
      static MAX_SIZE = 1024;
      static PI = 3.14159;
      fn main() -> int { return MAX_SIZE; }
    `);
  });

  test("complex program with multiple features", () => {
    checkOk(`
      import math;
      import { HashMap } from collections;

      fn alloc(count: usize) -> ptr<u8> { return null; }
      fn free(p: ptr<u8>) {}

      static MAX_USERS = 1000;
      pub static VERSION = 1;

      pub type UserId = int;

      pub enum Color : u8 {
        Red = 0,
        Green = 1,
        Blue = 2
      }

      pub struct Point {
        x: f64;
        y: f64;

        fn length(self: Point) -> f64 {
          return self.x * self.x + self.y * self.y;
        }
      }

      struct Pair<A, B> {
        first: A;
        second: B;
      }

      struct NotFound {}
      struct DbError { message: string; code: int; }

      extern fn puts(s: ptr<c_char>) -> int;

      pub fn add(a: int, b: int) -> int { return a + b; }

      fn identity<T>(x: T) -> T { return x; }

      fn getUser(id: int) -> int throws NotFound, DbError {
        if id < 0 { throw NotFound{}; }
        return id;
      }

      fn cleanup() { }

      fn main() -> int {
        let x = 42;
        let y: int = 10;
        const PI = 3.14159;

        let sum = x + y * 2;
        let flag = x > 0 && y < 100;

        let result = if x > y { x } else { y };

        let p = Point{ x: 1.0, y: 2.0 };
        let len = p.length();

        let user = getUser(10) catch {
          NotFound: return -1;
          DbError e: return -2;
        };

        let safe = getUser(5) catch panic;

        for i in 0..10 {
          assert(i >= 0);
        }

        let count = 0;
        while count < 10 {
          count = count + 1;
          if count == 5 { continue; }
          if count == 8 { break; }
        }

        switch count {
          case 1: x = 10;
          case 2, 3: x = 20;
          default: x = 0;
        }

        require(x >= 0, "x must be non-negative");

        defer cleanup();

        unsafe {
          let raw = alloc(1024);
          free(raw);
        }

        let moved = move p;

        x++;
        y--;

        unsafe {
          let addr = &x;
        }
        let bits = ~x;
        let neg = -x;
        let not_flag = !flag;

        x += 10;
        x -= 5;
        x <<= 2;

        return 0;
      }
    `);
  });

  test("multiple functions calling each other", () => {
    checkOk(`
      fn a() -> int { return b() + 1; }
      fn b() -> int { return c() + 1; }
      fn c() -> int { return 0; }
      fn main() -> int { return a(); }
    `);
  });
});
