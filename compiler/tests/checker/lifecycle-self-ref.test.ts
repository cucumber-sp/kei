import { describe, test } from "bun:test";
import { checkError, checkOk } from "./helpers";

describe("lifecycle hook ABI: `self: ref T` is required", () => {
  test("`__destroy(self: ref T)` is accepted", () => {
    checkOk(`
      unsafe struct Bag {
        n: i32;
        fn __destroy(self: ref Bag) {}
        fn __oncopy(self: ref Bag) {}
      }
      fn main() -> i32 { return 0; }
    `);
  });

  test("`__destroy(self: T)` (by value) is rejected", () => {
    checkError(
      `
      unsafe struct Bag {
        n: i32;
        fn __destroy(self: Bag) {}
        fn __oncopy(self: ref Bag) {}
      }
      fn main() -> i32 { return 0; }
      `,
      "'__destroy' must take 'self: ref"
    );
  });

  test("`__oncopy(self: T)` (by value) is rejected", () => {
    checkError(
      `
      unsafe struct Bag {
        n: i32;
        fn __destroy(self: ref Bag) {}
        fn __oncopy(self: Bag) {}
      }
      fn main() -> i32 { return 0; }
      `,
      "'__oncopy' must take 'self: ref"
    );
  });

  test("`__destroy(self: *T)` (raw pointer) is rejected", () => {
    checkError(
      `
      unsafe struct Bag {
        n: i32;
        fn __destroy(self: *Bag) {}
        fn __oncopy(self: ref Bag) {}
      }
      fn main() -> i32 { return 0; }
      `,
      "'__destroy' must take 'self: ref"
    );
  });

  test("`__destroy` with a non-void return type is rejected", () => {
    checkError(
      `
      unsafe struct Bag {
        n: i32;
        fn __destroy(self: ref Bag) -> i32 { return 0; }
        fn __oncopy(self: ref Bag) {}
      }
      fn main() -> i32 { return 0; }
      `,
      "'__destroy' must return void"
    );
  });

  test("`__oncopy` with a non-void return type is rejected", () => {
    checkError(
      `
      unsafe struct Bag {
        n: i32;
        fn __destroy(self: ref Bag) {}
        fn __oncopy(self: ref Bag) -> Bag { return Bag{ n: 0 }; }
      }
      fn main() -> i32 { return 0; }
      `,
      "'__oncopy' must return void"
    );
  });
});
