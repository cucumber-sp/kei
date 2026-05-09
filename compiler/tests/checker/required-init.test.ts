import { describe, test } from "bun:test";
import { checkError, checkOk } from "./helpers";

const ONE_REF = `
unsafe struct Bag {
  payload: ref i32;
  fn __destroy(self: ref Bag) {}
  fn __oncopy(self: ref Bag) {}
}
`;

const TWO_REFS = `
unsafe struct Pair {
  left: ref i32;
  right: ref i32;
  fn __destroy(self: ref Pair) {}
  fn __oncopy(self: ref Pair) {}
}
`;

describe("required-init rule for `ref T` fields on unsafe structs", () => {
  test("empty literal of an unsafe struct with a `ref T` field is rejected", () => {
    checkError(
      `${ONE_REF}
        fn build() -> Bag {
          unsafe { return Bag{}; }
        }
        fn main() -> i32 { return 0; }
      `,
      "missing field 'payload'"
    );
  });

  test("partial literal omitting one of two `ref T` fields is rejected", () => {
    checkError(
      `${TWO_REFS}
        fn build(p: *i32) -> Pair {
          unsafe { return Pair{ left: p }; }
        }
        fn main() -> i32 { return 0; }
      `,
      "missing field 'right'"
    );
  });

  test("full literal that initializes every `ref T` field is accepted", () => {
    checkOk(`${TWO_REFS}
      fn build(a: *i32, b: *i32) -> Pair {
        unsafe { return Pair{ left: a, right: b }; }
      }
      fn main() -> i32 { return 0; }
    `);
  });

  test("generic unsafe struct with a `ref T` field — empty literal rejected", () => {
    checkError(
      `
      unsafe struct Holder<T> {
        value: ref T;
        fn __destroy(self: ref Holder<T>) {}
        fn __oncopy(self: ref Holder<T>) {}
      }
      fn build() -> Holder<i32> {
        unsafe { return Holder<i32>{}; }
      }
      fn main() -> i32 { return 0; }
      `,
      "missing field 'value'"
    );
  });

  test("generic unsafe struct with a `ref T` field — full literal accepted", () => {
    checkOk(`
      unsafe struct Holder<T> {
        value: ref T;
        fn __destroy(self: ref Holder<T>) {}
        fn __oncopy(self: ref Holder<T>) {}
      }
      fn build(p: *i32) -> Holder<i32> {
        unsafe { return Holder<i32>{ value: p }; }
      }
      fn main() -> i32 { return 0; }
    `);
  });
});
