import { describe, test } from "bun:test";
import { checkError, checkOk } from "./helpers.ts";

const MEM_STUBS = `
  fn alloc(count: usize) -> ptr<u8> { return null; }
  fn free(p: ptr<u8>) {}
`;

describe("Checker — Lifecycle Hooks (comprehensive)", () => {
  // ── Struct with __destroy ──────────────────────────────────────────────

  describe("struct with __destroy", () => {
    test("unsafe struct with ptr<T> and __destroy only → missing __oncopy error", () => {
      checkError(
        `
          unsafe struct Buf {
            data: ptr<u8>;
            fn __destroy(self: Buf) { }
          }
          fn main() -> int { return 0; }
        `,
        "must define '__oncopy'"
      );
    });

    test("__destroy has correct self parameter → ok", () => {
      checkOk(`${MEM_STUBS}
        unsafe struct Res {
          data: ptr<u8>;
          fn __destroy(self: Res) {
            unsafe { free(self.data); }
          }
          fn __oncopy(self: Res) -> Res {
            return Res{ data: self.data };
          }
        }
        fn main() -> int { return 0; }
      `);
    });
  });

  // ── Struct with __oncopy ───────────────────────────────────────────────

  describe("struct with __oncopy", () => {
    test("unsafe struct with ptr<T> and __oncopy only → missing __destroy error", () => {
      checkError(
        `
          unsafe struct Buf {
            data: ptr<u8>;
            fn __oncopy(self: Buf) -> Buf {
              return Buf{ data: self.data };
            }
          }
          fn main() -> int { return 0; }
        `,
        "must define '__destroy'"
      );
    });

    test("__oncopy returns the struct type → ok", () => {
      checkOk(`${MEM_STUBS}
        unsafe struct Data {
          ptr_field: ptr<u8>;
          size: usize;
          fn __destroy(self: Data) {
            unsafe { free(self.ptr_field); }
          }
          fn __oncopy(self: Data) -> Data {
            unsafe {
              let new_ptr = alloc(self.size);
              return Data{ ptr_field: new_ptr, size: self.size };
            }
          }
        }
        fn main() -> int { return 0; }
      `);
    });
  });

  // ── Struct with both __destroy and __oncopy ────────────────────────────

  describe("struct with both __destroy and __oncopy", () => {
    test("both hooks defined with ptr<T> field → ok", () => {
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

    test("both hooks with additional methods → ok", () => {
      checkOk(`${MEM_STUBS}
        unsafe struct SmartPtr {
          data: ptr<u8>;
          len: usize;
          fn __destroy(self: SmartPtr) {
            unsafe { free(self.data); }
          }
          fn __oncopy(self: SmartPtr) -> SmartPtr {
            unsafe {
              let new_data = alloc(self.len);
              return SmartPtr{ data: new_data, len: self.len };
            }
          }
          fn length(self: SmartPtr) -> usize {
            return self.len;
          }
        }
        fn main() -> int { return 0; }
      `);
    });
  });

  // ── Move semantics ─────────────────────────────────────────────────────

  describe("move semantics", () => {
    test("move struct variable → ok", () => {
      checkOk(`
        struct Data { value: int; }
        fn main() -> int {
          let a = Data{ value: 42 };
          let b = move a;
          return b.value;
        }
      `);
    });

    test("use after move → error", () => {
      checkError(
        `
          struct Data { value: int; }
          fn main() -> int {
            let a = Data{ value: 42 };
            let b = move a;
            return a.value;
          }
        `,
        "use of moved variable 'a'"
      );
    });

    test("double move → error", () => {
      checkError(
        `
          fn main() -> int {
            let x = 42;
            let y = move x;
            let z = move x;
            return y;
          }
        `,
        "use of moved variable 'x'"
      );
    });

    test("move integer variable → ok", () => {
      checkOk(`
        fn main() -> int {
          let x = 42;
          let y = move x;
          return y;
        }
      `);
    });

    test("move non-variable expression → error", () => {
      checkError(
        `fn main() -> int { let x = move 42; return 0; }`,
        "'move' can only be applied to a variable"
      );
    });

    test("move field access → error", () => {
      checkError(
        `
          struct Point { x: f64; y: f64; }
          fn main() -> int {
            let p = Point{ x: 1.0, y: 2.0 };
            let x = move p.x;
            return 0;
          }
        `,
        "'move' can only be applied to a variable"
      );
    });

    test("move in if branch → conservative: use after is error", () => {
      checkError(
        `
          struct Data { value: int; }
          fn main() -> int {
            let a = Data{ value: 42 };
            if true {
              let b = move a;
            }
            let c = a;
            return 0;
          }
        `,
        "use of moved variable 'a'"
      );
    });

    test("move as function argument", () => {
      checkOk(`
        struct Data { value: int; }
        fn consume(move d: Data) -> int {
          return d.value;
        }
        fn main() -> int {
          let d = Data{ value: 42 };
          return consume(move d);
        }
      `);
    });

    test("use after move as function argument → error", () => {
      checkError(
        `
          struct Data { value: int; }
          fn consume(move d: Data) -> int {
            return d.value;
          }
          fn main() -> int {
            let d = Data{ value: 42 };
            let r = consume(move d);
            return d.value;
          }
        `,
        "use of moved variable 'd'"
      );
    });
  });

  // ── No hooks needed for regular structs ────────────────────────────────

  describe("no hooks needed for regular structs", () => {
    test("regular struct without ptr → no hooks needed → ok", () => {
      checkOk(`
        struct Point { x: f64; y: f64; }
        fn main() -> int {
          let p = Point{ x: 1.0, y: 2.0 };
          return 0;
        }
      `);
    });

    test("unsafe struct without ptr fields → hooks optional → ok", () => {
      checkOk(`
        unsafe struct Flags { bits: u32; }
        fn main() -> int { return 0; }
      `);
    });
  });

  // ── Edge: ptr field requirements ───────────────────────────────────────

  describe("ptr field requirements", () => {
    test("unsafe struct with ptr<T> but no hooks → error for __destroy", () => {
      checkError(
        `
          unsafe struct Bad { data: ptr<u8>; }
          fn main() -> int { return 0; }
        `,
        "must define '__destroy'"
      );
    });

    test("unsafe struct with multiple ptr fields needs hooks → error if missing", () => {
      checkError(
        `
          unsafe struct TwoPtr { a: ptr<u8>; b: ptr<i32>; }
          fn main() -> int { return 0; }
        `,
        "must define '__destroy'"
      );
    });

    test("unsafe struct with multiple ptr fields and both hooks → ok", () => {
      checkOk(`${MEM_STUBS}
        unsafe struct TwoPtr {
          a: ptr<u8>;
          b: ptr<i32>;
          fn __destroy(self: TwoPtr) {
            unsafe {
              free(self.a);
            }
          }
          fn __oncopy(self: TwoPtr) -> TwoPtr {
            return TwoPtr{ a: self.a, b: self.b };
          }
        }
        fn main() -> int { return 0; }
      `);
    });
  });
});
