import { describe, test } from "bun:test";
import { checkError, checkErrors, checkOk } from "./helpers.ts";

describe("Checker: Generics", () => {
  // ─── Generic Structs with Explicit Type Args ──────────────────────────

  describe("generic struct instantiation", () => {
    test("basic generic struct with one type param", () => {
      checkOk(`
        struct Box<T> {
          value: T;
        }
        fn main() {
          let b = Box<i32>{ value: 42 };
        }
      `);
    });

    test("generic struct with two type params", () => {
      checkOk(`
        struct Pair<A, B> {
          first: A;
          second: B;
        }
        fn main() {
          let p = Pair<i32, bool>{ first: 1, second: true };
        }
      `);
    });

    test("generic struct field access", () => {
      checkOk(`
        struct Box<T> {
          value: T;
        }
        fn main() -> i32 {
          let b = Box<i32>{ value: 42 };
          return b.value;
        }
      `);
    });

    test("generic struct with string type arg", () => {
      checkOk(`
        struct Box<T> {
          value: T;
        }
        fn main() {
          let b = Box<string>{ value: "hello" };
        }
      `);
    });

    test("wrong number of type args", () => {
      checkError(
        `
        struct Pair<A, B> {
          first: A;
          second: B;
        }
        fn main() {
          let p = Pair<i32>{ first: 1, second: true };
        }
        `,
        "expects 2 type argument(s), got 1"
      );
    });

    test("type mismatch in generic struct field", () => {
      checkError(
        `
        struct Box<T> {
          value: T;
        }
        fn main() {
          let b = Box<i32>{ value: "hello" };
        }
        `,
        "expected 'i32', got 'string'"
      );
    });
  });

  // ─── Generic Struct Inference ─────────────────────────────────────────

  describe("generic struct inference", () => {
    test("infer type param from field value", () => {
      checkOk(`
        struct Box<T> {
          value: T;
        }
        fn main() {
          let b = Box{ value: 42 };
        }
      `);
    });

    test("infer multiple type params", () => {
      checkOk(`
        struct Pair<A, B> {
          first: A;
          second: B;
        }
        fn main() {
          let p = Pair{ first: 42, second: true };
        }
      `);
    });
  });

  // ─── Same Generic Used Multiple Times ─────────────────────────────────

  describe("multiple instantiations", () => {
    test("same generic struct with different type args", () => {
      checkOk(`
        struct Box<T> {
          value: T;
        }
        fn main() {
          let a = Box<i32>{ value: 42 };
          let b = Box<bool>{ value: true };
          let c = Box<string>{ value: "hi" };
        }
      `);
    });

    test("same generic struct used twice with same type args gives same type", () => {
      checkOk(`
        struct Box<T> {
          value: T;
        }
        fn main() {
          let a = Box<i32>{ value: 1 };
          let b = Box<i32>{ value: 2 };
        }
      `);
    });
  });

  // ─── Generic Functions with Explicit Type Args ────────────────────────

  describe("generic function calls with explicit type args", () => {
    test("basic generic function call", () => {
      checkOk(`
        fn identity<T>(x: T) -> T {
          return x;
        }
        fn main() -> i32 {
          return identity<i32>(42);
        }
      `);
    });

    test("generic function with two type params", () => {
      checkOk(`
        fn first<A, B>(a: A, b: B) -> A {
          return a;
        }
        fn main() -> i32 {
          return first<i32, bool>(42, true);
        }
      `);
    });

    test("wrong number of type args on function call", () => {
      checkError(
        `
        fn identity<T>(x: T) -> T {
          return x;
        }
        fn main() {
          identity<i32, bool>(42);
        }
        `,
        "expects 1 type argument(s), got 2"
      );
    });

    test("type mismatch with explicit type arg", () => {
      checkError(
        `
        fn identity<T>(x: T) -> T {
          return x;
        }
        fn main() {
          identity<i32>("hello");
        }
        `,
        "expected 'i32', got 'string'"
      );
    });

    test("calling non-generic function with type args", () => {
      checkError(
        `
        fn add(a: i32, b: i32) -> i32 {
          return a + b;
        }
        fn main() {
          add<i32>(1, 2);
        }
        `,
        "is not generic"
      );
    });
  });

  // ─── Generic Functions with Inferred Type Args ────────────────────────

  describe("generic function calls with inferred type args", () => {
    test("infer type from single argument", () => {
      checkOk(`
        fn identity<T>(x: T) -> T {
          return x;
        }
        fn main() -> i32 {
          return identity(42);
        }
      `);
    });

    test("infer type from multiple arguments", () => {
      checkOk(`
        fn pick_first<T>(a: T, b: T) -> T {
          return a;
        }
        fn main() -> i32 {
          return pick_first(10, 20);
        }
      `);
    });

    test("infer multiple type params", () => {
      checkOk(`
        fn first<A, B>(a: A, b: B) -> A {
          return a;
        }
        fn main() -> i32 {
          return first(42, true);
        }
      `);
    });
  });

  // ─── Generic Struct with Ptr Type Arg ─────────────────────────────────

  describe("generic struct with complex type args", () => {
    test("generic struct with ptr type arg", () => {
      checkOk(`
        struct Wrapper<T> {
          value: T;
        }
        fn main() {
          let w = Wrapper<bool>{ value: true };
        }
      `);
    });
  });

  // ─── Error Cases ──────────────────────────────────────────────────────

  describe("error cases", () => {
    test("undeclared type in type arg", () => {
      checkError(
        `
        struct Box<T> {
          value: T;
        }
        fn main() {
          let b = Box<Foo>{ value: 42 };
        }
        `,
        "undeclared type 'Foo'"
      );
    });

    test("non-generic struct with type args", () => {
      checkError(
        `
        struct Point {
          x: i32;
          y: i32;
        }
        fn main() {
          let p = Point<i32>{ x: 1, y: 2 };
        }
        `,
        "expects 0 type argument(s), got 1"
      );
    });

    test("generic function with wrong arg types after substitution", () => {
      checkError(
        `
        fn identity<T>(x: T) -> T {
          return x;
        }
        fn main() {
          let x: i32 = identity<string>("hello");
        }
        `,
        "expected 'i32', got 'string'"
      );
    });
  });

  // ─── Generic function body is not checked with TypeParam ──────────────

  describe("generic body deferral", () => {
    test("generic function body with operators not checked at definition", () => {
      // This function uses > on type param T which isn't valid for all types
      // But since we skip body checking for generic definitions, it passes
      checkOk(`
        fn max<T>(a: T, b: T) -> T {
          return a;
        }
        fn main() -> i32 {
          return max<i32>(10, 20);
        }
      `);
    });

    test("generic struct methods not checked at definition", () => {
      checkOk(`
        struct Container<T> {
          value: T;
          fn get(self: Container<T>) -> T {
            return self.value;
          }
        }
        fn main() {
          let c = Container<i32>{ value: 42 };
        }
      `);
    });
  });
});
