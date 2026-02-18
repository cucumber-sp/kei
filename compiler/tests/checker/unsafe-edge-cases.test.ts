import { describe, test } from "bun:test";
import { checkError, checkOk } from "./helpers.ts";

const MEM_STUBS = `
  fn alloc(count: usize) -> ptr<u8> { return null; }
  fn free(p: ptr<u8>) {}
`;

describe("Checker — Unsafe Edge Cases", () => {
  describe("pointer dereference", () => {
    test("deref inside unsafe block → ok", () => {
      checkOk(`
        fn main() -> int {
          let p: ptr<int> = null;
          unsafe { let x = *p; }
          return 0;
        }
      `);
    });

    test("deref outside unsafe → error", () => {
      checkError(
        `fn main() -> int { let p: ptr<int> = null; let x = *p; return 0; }`,
        "requires unsafe block"
      );
    });

    test("deref of non-pointer → error", () => {
      checkError(
        `fn main() -> int { unsafe { let x = 42; let y = *x; } return 0; }`,
        "cannot dereference non-pointer"
      );
    });

    test("deref chain: ptr<ptr<int>> → ok (nested unsafe)", () => {
      checkOk(`
        fn main() -> int {
          let x = 42;
          unsafe {
            let p = &x;
            let pp = &p;
            let val = **pp;
          }
          return 0;
        }
      `);
    });

    test("deref then member access → ok", () => {
      checkOk(`
        struct Point { x: f64; y: f64; }
        fn main() -> int {
          let p = Point{ x: 1.0, y: 2.0 };
          unsafe {
            let pp = &p;
            let val = pp->x;
          }
          return 0;
        }
      `);
    });
  });

  describe("address-of", () => {
    test("address-of inside unsafe → ok", () => {
      checkOk(`
        fn main() -> int {
          let x = 42;
          unsafe { let p = &x; }
          return 0;
        }
      `);
    });

    test("address-of outside unsafe → error", () => {
      checkError(`fn main() -> int { let x = 42; let p = &x; return 0; }`, "requires unsafe block");
    });

    test("address-of struct field → ok", () => {
      checkOk(`
        struct Point { x: f64; y: f64; }
        fn main() -> int {
          let p = Point{ x: 1.0, y: 2.0 };
          unsafe { let addr = &p; }
          return 0;
        }
      `);
    });
  });

  describe("extern function calls", () => {
    test("extern fn call inside unsafe → ok", () => {
      checkOk(`
        extern fn puts(s: ptr<c_char>) -> int;
        fn main() -> int { unsafe { puts(null); } return 0; }
      `);
    });

    test("extern fn call outside unsafe → error", () => {
      checkError(
        `
          extern fn puts(s: ptr<c_char>) -> int;
          fn main() -> int { puts(null); return 0; }
        `,
        "cannot call extern function outside unsafe block"
      );
    });

    test("extern fn with multiple params → ok", () => {
      checkOk(`
        extern fn memcpy(dest: ptr<u8>, src: ptr<u8>, n: usize) -> ptr<u8>;
        fn main() -> int {
          unsafe { memcpy(null, null, 0); }
          return 0;
        }
      `);
    });

    test("multiple extern fn calls in same unsafe block → ok", () => {
      checkOk(`
        extern fn puts(s: ptr<c_char>) -> int;
        extern fn strlen(s: ptr<c_char>) -> usize;
        fn main() -> int {
          unsafe {
            puts(null);
            strlen(null);
          }
          return 0;
        }
      `);
    });
  });

  describe("unsafe expression vs unsafe block", () => {
    test("unsafe expression returns value → ok", () => {
      checkOk(`
        fn main() -> int {
          let x = 42;
          let addr = unsafe { &x };
          return 0;
        }
      `);
    });

    test("unsafe expression with alloc → ok", () => {
      checkOk(`${MEM_STUBS}
        fn main() -> int {
          let size = 1024;
          let p = unsafe { alloc(size) };
          unsafe { free(p); }
          return 0;
        }
      `);
    });

    test("unsafe block as statement → ok", () => {
      checkOk(`${MEM_STUBS}
        fn main() -> int {
          unsafe {
            let p = alloc(100);
            free(p);
          }
          return 0;
        }
      `);
    });

    test("unsafe block with return → ok", () => {
      checkOk(`${MEM_STUBS}
        fn main() -> int {
          unsafe {
            let p = alloc(100);
            free(p);
            return 0;
          }
        }
      `);
    });
  });

  describe("unsafe scope does not leak", () => {
    test("unsafe expression scope does not leak to outer", () => {
      checkError(
        `fn main() -> int {
          let x = 42;
          let addr = unsafe { &x };
          let addr2 = &x;
          return 0;
        }`,
        "requires unsafe block"
      );
    });

    test("unsafe block scope does not leak to next statement", () => {
      checkError(
        `fn main() -> int {
          let x = 42;
          unsafe { let p = &x; }
          let p2 = &x;
          return 0;
        }`,
        "requires unsafe block"
      );
    });

    test("alloc outside unsafe after unsafe block → error", () => {
      checkError(
        `${MEM_STUBS}
        fn main() -> int {
          unsafe { let p = alloc(100); free(p); }
          let p2 = alloc(200);
          return 0;
        }`,
        "cannot call 'alloc' outside unsafe block"
      );
    });
  });

  describe("nested unsafe blocks", () => {
    test("nested unsafe blocks → ok", () => {
      checkOk(`${MEM_STUBS}
        fn main() -> int {
          unsafe {
            let p = alloc(100);
            unsafe {
              free(p);
            }
          }
          return 0;
        }
      `);
    });

    test("unsafe inside if inside unsafe → ok", () => {
      checkOk(`${MEM_STUBS}
        fn main() -> int {
          unsafe {
            let p = alloc(100);
            if true {
              unsafe { free(p); }
            }
          }
          return 0;
        }
      `);
    });
  });

  describe("alloc/free edge cases", () => {
    test("alloc inside unsafe → ok", () => {
      checkOk(`${MEM_STUBS}
        fn main() -> int { unsafe { let p = alloc(1024); free(p); } return 0; }`);
    });

    test("alloc outside unsafe → error", () => {
      checkError(
        `${MEM_STUBS}
        fn main() -> int { let p = alloc(1024); return 0; }`,
        "cannot call 'alloc' outside unsafe block"
      );
    });

    test("free outside unsafe → error", () => {
      checkError(
        `${MEM_STUBS}
        fn main() -> int { let p: ptr<int> = null; free(p); return 0; }`,
        "cannot call 'free' outside unsafe block"
      );
    });

    test("free with non-pointer → error", () => {
      checkError(
        `${MEM_STUBS}
        fn main() -> int { unsafe { free(42); } return 0; }`,
        "expects a pointer argument"
      );
    });

    test("alloc with wrong number of args → error", () => {
      checkError(
        `${MEM_STUBS}
        fn main() -> int { unsafe { let p = alloc(1, 2); } return 0; }`,
        "expects exactly 1 argument"
      );
    });
  });

  describe("unsafe struct requirements", () => {
    test("unsafe struct with ptr and no __destroy → error", () => {
      checkError(
        `
          unsafe struct Bad { data: ptr<u8>; }
          fn main() -> int { return 0; }
        `,
        "must define '__destroy'"
      );
    });

    test("unsafe struct with ptr and __destroy but no __oncopy → error", () => {
      checkError(
        `
          unsafe struct Bad {
            data: ptr<u8>;
            fn __destroy(self: Bad) { }
          }
          fn main() -> int { return 0; }
        `,
        "must define '__oncopy'"
      );
    });

    test("unsafe struct with both lifecycle hooks → ok", () => {
      checkOk(`${MEM_STUBS}
        unsafe struct Buffer {
          data: ptr<u8>;
          size: usize;
          fn __destroy(self: Buffer) {
            unsafe { free(self.data); }
          }
          fn __oncopy(self: Buffer) -> Buffer {
            unsafe {
              let new_data = alloc(self.size);
              return Buffer{ data: new_data, size: self.size };
            }
          }
        }
        fn main() -> int { return 0; }
      `);
    });

    test("unsafe struct without ptr<T> fields — hooks optional → ok", () => {
      checkOk(`
        unsafe struct Simple { value: int; }
        fn main() -> int { return 0; }
      `);
    });
  });

  describe("sizeof", () => {
    test("sizeof is safe — no unsafe needed → ok", () => {
      checkOk(`
        struct Point { x: f64; y: f64; }
        fn main() -> int { let s = sizeof(Point); return 0; }
      `);
    });
  });

  describe("method with ptr<T> self", () => {
    test("method with ptr<T> self parameter → ok", () => {
      checkOk(`
        struct Counter {
          value: int;
          fn increment(self: ptr<Counter>) {
            unsafe { self->value = self->value + 1; }
          }
        }
        fn main() -> int { return 0; }
      `);
    });
  });

  describe("unsafe with control flow", () => {
    test("unsafe block with if → ok", () => {
      checkOk(`${MEM_STUBS}
        fn main() -> int {
          unsafe {
            let p = alloc(100);
            if true {
              free(p);
            }
          }
          return 0;
        }
      `);
    });

    test("unsafe block with while → ok", () => {
      checkOk(`
        fn main() -> int {
          let x = 42;
          unsafe {
            let p = &x;
            let i = 0;
            while i < 3 {
              i = i + 1;
            }
          }
          return 0;
        }
      `);
    });

    test("return from inside unsafe → ok", () => {
      checkOk(`
        fn main() -> int {
          unsafe {
            return 0;
          }
        }
      `);
    });
  });
});
