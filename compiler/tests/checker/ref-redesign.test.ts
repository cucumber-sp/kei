/**
 * Tests for the ref-redesign §4 invariants.
 *
 * These tests pin down the position restrictions on `ref T`, the auto-deref
 * rules, the new `addr(...)` and `init` operators, and the `readonly` modifier.
 * The cases here mirror `docs/design/ref-redesign.md` §4 one-for-one.
 *
 * The whole suite is currently `.skip`'d — the compiler PRs that implement
 * each piece will flip the relevant block back on.
 */

import { describe, expect, test } from "bun:test";
import { check, checkError, checkOk } from "./helpers";
import { errorsOf } from "../helpers/pipeline";

// ─── §4.1 — `ref T` is not a return type ─────────────────────────────────────

describe.skip("§4.1 — `ref T` is rejected as a return type", () => {
  test("safe function returning `ref T` is a compile error", () => {
    checkError(
      `
      struct Item { value: i32 }
      fn first(items: ref List<Item>) -> ref Item {
        return items[0];
      }
      fn main() -> int { return 0; }
      `,
      "`ref T` is not allowed as a return type"
    );
  });

  test("`readonly ref T` is also rejected as a return type", () => {
    checkError(
      `
      struct Item { value: i32 }
      fn first(items: ref List<Item>) -> readonly ref Item {
        return items[0];
      }
      fn main() -> int { return 0; }
      `,
      "`ref T` is not allowed as a return type"
    );
  });
});

// ─── §4.2 — `ref T` is not a struct field (in safe structs) ──────────────────

describe.skip("§4.2 — `ref T` is rejected in safe-struct fields", () => {
  test("safe struct holding `ref T` is a compile error", () => {
    checkError(
      `
      struct Item { value: i32 }
      struct Holder {
        item: ref Item;
      }
      fn main() -> int { return 0; }
      `,
      "`ref T` field types are only allowed in `unsafe struct`"
    );
  });

  test("`unsafe struct` holding `ref T` is OK", () => {
    checkOk(`
      struct Item { value: i32 }
      unsafe struct Holder {
        item: ref Item;
        fn __destroy(self: ref Holder) { }
        fn __oncopy(self: ref Holder) { }
      }
      fn main() -> int { return 0; }
    `);
  });
});

// ─── §4.3 — `&` and `*` are unsafe ───────────────────────────────────────────

describe.skip("§4.3 — `&` and `*` operators are unsafe-only", () => {
  test("`&x` outside `unsafe` is a compile error", () => {
    checkError(
      `
      fn bad(x: i32) -> *i32 {
        return &x;
      }
      fn main() -> int { return 0; }
      `,
      "`&` is unsafe-only"
    );
  });

  test("`*p` outside `unsafe` is a compile error", () => {
    checkError(
      `
      fn read(p: *i32) -> i32 {
        return *p;
      }
      fn main() -> int { return 0; }
      `,
      "`*` deref is unsafe-only"
    );
  });

  test("inside `unsafe` both are OK", () => {
    checkOk(`
      fn read() -> i32 {
        let x: i32 = 7;
        unsafe {
          let p: *i32 = &x;
          return *p;
        }
      }
      fn main() -> int { return 0; }
    `);
  });
});

// ─── §4.4 — `addr()` is unsafe ───────────────────────────────────────────────

describe.skip("§4.4 — `addr(...)` is unsafe-only", () => {
  test("`addr(field)` outside `unsafe` is a compile error", () => {
    checkError(
      `
      unsafe struct Box { value: ref i32; }
      fn leak(b: ref Box) -> *i32 {
        return addr(b.value);
      }
      fn main() -> int { return 0; }
      `,
      "`addr(...)` is unsafe-only"
    );
  });

  test("`addr(field) = ptr` inside `unsafe` is OK", () => {
    checkOk(`
      unsafe struct Box { value: ref i32; fn __destroy(self: ref Box) {} fn __oncopy(self: ref Box) {} }
      fn make(p: *i32) -> Box {
        let b = Box{};
        unsafe { addr(b.value) = p; }
        return b;
      }
      fn main() -> int { return 0; }
    `);
  });
});

// ─── §4.5 — Auto-deref through `ref T` reads the pointed-to value ─────────────

describe.skip("§4.5 — auto-deref returns T, not ref T", () => {
  test("reading a field through `ref T` yields T", () => {
    checkOk(`
      struct Item { value: i32 }
      fn read(x: ref Item) -> i32 {
        return x.value;
      }
      fn main() -> int { return 0; }
    `);
  });

  test("auto-deref does NOT apply to `Shared<T>` (only `ref T`)", () => {
    checkError(
      `
      unsafe struct Shared<T> {
        refcount: ref i64;
        value: ref T;
        fn __oncopy(self: ref Shared<T>) {}
        fn __destroy(self: ref Shared<T>) {}
      }
      fn read(s: Shared<i32>) -> i32 {
        return s;       // ERROR: Shared<i32> does not auto-deref to i32
      }
      fn main() -> int { return 0; }
      `,
      "Cannot assign `Shared<i32>` to `i32`"
    );
  });
});

// ─── §4.6 — Type mismatch on Shared<T> field assignment ──────────────────────

describe.skip("§4.6 — Shared<T> field assignment is explicit", () => {
  test("`field: T` on a `Shared<T>` field is rejected (no auto-deref)", () => {
    checkError(
      `
      unsafe struct Shared<T> {
        refcount: ref i64;
        value: ref T;
        fn __oncopy(self: ref Shared<T>) {}
        fn __destroy(self: ref Shared<T>) {}
      }
      struct Cfg { online: Shared<bool> }
      fn turnOff(c: ref Cfg) {
        c.online = false;
      }
      fn main() -> int { return 0; }
      `,
      "Cannot assign `bool` to field of type `Shared<bool>`"
    );
  });

  test("`c.online.value = false` is OK (write-through via .value)", () => {
    checkOk(`
      unsafe struct Shared<T> {
        refcount: ref i64;
        value: ref T;
        fn __oncopy(self: ref Shared<T>) {}
        fn __destroy(self: ref Shared<T>) {}
      }
      struct Cfg { online: Shared<bool> }
      fn turnOff(c: ref Cfg) {
        c.online.value = false;
      }
      fn main() -> int { return 0; }
    `);
  });
});

// ─── §4.7 — `init` only valid in `unsafe` ────────────────────────────────────

describe.skip("§4.7 — `init` is unsafe-only at the field level", () => {
  test("`init` outside `unsafe` is a compile error", () => {
    checkError(
      `
      struct Item { value: i32 }
      fn build() -> Item {
        let i: Item = Item{ value: 0 };
        init i.value = 42;
        return i;
      }
      fn main() -> int { return 0; }
      `,
      "`init` is unsafe-only"
    );
  });

  test("`init` inside `unsafe` is OK", () => {
    checkOk(`
      unsafe struct Box { data: ref i32; fn __destroy(self: ref Box) {} fn __oncopy(self: ref Box) {} }
      fn make(item: ref i32) -> Box {
        let b = Box{};
        unsafe {
          addr(b.data) = item as *i32;
          init b.data = item;
        }
        return b;
      }
      fn main() -> int { return 0; }
    `);
  });
});

// ─── §4.10 — Nested `Shared<T>` requires explicit unwrapping ─────────────────

describe.skip("§4.10 — `Shared<T>` does not auto-deref recursively", () => {
  test("`let v: i32 = s` from `Shared<Shared<i32>>` is a compile error", () => {
    checkError(
      `
      unsafe struct Shared<T> {
        refcount: ref i64;
        value: ref T;
        fn __oncopy(self: ref Shared<T>) {}
        fn __destroy(self: ref Shared<T>) {}
      }
      fn read(s: Shared<Shared<i32>>) -> i32 {
        let v: i32 = s;
        return v;
      }
      fn main() -> int { return 0; }
      `,
      "Cannot assign"
    );
  });

  test("explicit `s.value.value` is OK", () => {
    checkOk(`
      unsafe struct Shared<T> {
        refcount: ref i64;
        value: ref T;
        fn __oncopy(self: ref Shared<T>) {}
        fn __destroy(self: ref Shared<T>) {}
      }
      fn read(s: Shared<Shared<i32>>) -> i32 {
        return s.value.value;
      }
      fn main() -> int { return 0; }
    `);
  });
});

// ─── §4.11 — `readonly` blocks reassignment but not write-through ─────────────

describe.skip("§4.11 — `readonly` semantics", () => {
  test("`readonly T` field rejects reassignment", () => {
    checkError(
      `
      unsafe struct Shared<T> {
        refcount: ref i64;
        value: ref T;
        fn wrap(item: ref T) -> Shared<T> { let s = Shared<T>{}; return s; }
        fn __oncopy(self: ref Shared<T>) {}
        fn __destroy(self: ref Shared<T>) {}
      }
      struct Cfg { readonly online: Shared<bool> }
      fn f(c: ref Cfg) {
        c.online = Shared<bool>::wrap(false);
      }
      fn main() -> int { return 0; }
      `,
      "readonly"
    );
  });

  test("`readonly` field permits write-through via `.value`", () => {
    checkOk(`
      unsafe struct Shared<T> {
        refcount: ref i64;
        value: ref T;
        fn __oncopy(self: ref Shared<T>) {}
        fn __destroy(self: ref Shared<T>) {}
      }
      struct Cfg { readonly online: Shared<bool> }
      fn f(c: ref Cfg) {
        c.online.value = false;
      }
      fn main() -> int { return 0; }
    `);
  });

  test("`readonly ref T` rejects write-through", () => {
    checkError(
      `
      fn f(x: readonly ref i32) {
        x = 1;
      }
      fn main() -> int { return 0; }
      `,
      "readonly ref"
    );
  });

  test("`readonly ref T` permits reads (auto-deref)", () => {
    checkOk(`
      fn show(x: readonly ref i32) -> i32 {
        return x;
      }
      fn main() -> int { return 0; }
    `);
  });
});

// ─── `ref T` position restrictions (gathered) ────────────────────────────────

describe.skip("ref-T position restrictions (consolidated)", () => {
  test("`ref T` is rejected in a local binding", () => {
    checkError(
      `
      struct Item { value: i32 }
      fn f(x: ref Item) {
        let r: ref Item = x;
        let _ = r;
      }
      fn main() -> int { return 0; }
      `,
      "`ref T` is not allowed in local bindings"
    );
  });

  test("`ref T` is rejected as a generic argument", () => {
    checkError(
      `
      struct List<T> { items: T }
      struct Item { value: i32 }
      fn f(x: List<ref Item>) { }
      fn main() -> int { return 0; }
      `,
      "`ref T` is not allowed in generic arguments"
    );
  });

  test("`ref T` is rejected as a static global type", () => {
    checkError(
      `
      struct Item { value: i32 }
      static SINGLETON: ref Item = ???;
      fn main() -> int { return 0; }
      `,
      "`ref T` is not allowed in static"
    );
  });
});

// ─── `mut` keyword removal ───────────────────────────────────────────────────

describe.skip("`mut` keyword is removed", () => {
  test("`mut x: T` parameter form is a compile error", () => {
    const errs = errorsOf(check(`fn f(mut x: int) { } fn main() -> int { return 0; }`));
    expect(errs.length).toBeGreaterThan(0);
  });

  test("`let mut x` is a compile error", () => {
    const errs = errorsOf(check(`fn main() -> int { let mut x = 1; return x; }`));
    expect(errs.length).toBeGreaterThan(0);
  });

  test("`ref mut T` is a compile error", () => {
    const errs = errorsOf(
      check(`fn f(x: ref mut int) { } fn main() -> int { return 0; }`)
    );
    expect(errs.length).toBeGreaterThan(0);
  });
});

// ─── `slice<T>` removal ──────────────────────────────────────────────────────

describe.skip("`slice<T>` is removed", () => {
  test("`slice<T>` parameter is a compile error", () => {
    const errs = errorsOf(
      check(`fn f(x: slice<i32>) { } fn main() -> int { return 0; }`)
    );
    expect(errs.length).toBeGreaterThan(0);
  });
});

// ─── `Shared<T>` end-to-end (semantics) ──────────────────────────────────────

describe.skip("Shared<T> stdlib semantics", () => {
  test("Shared<T>::wrap takes `ref T` and returns `Shared<T>`", () => {
    checkOk(`
      unsafe struct Shared<T> {
        refcount: ref i64;
        value: ref T;
        fn wrap(item: ref T) -> Shared<T> {
          let s = Shared<T>{};
          return s;
        }
        fn __oncopy(self: ref Shared<T>) { self.refcount += 1; }
        fn __destroy(self: ref Shared<T>) { self.refcount -= 1; }
      }
      fn main() -> int {
        let n: i32 = 42;
        let s = Shared<i32>::wrap(n);
        return 0;
      }
    `);
  });

  test("Shared<T> field can be replaced via wrap (handle replacement)", () => {
    checkOk(`
      unsafe struct Shared<T> {
        refcount: ref i64;
        value: ref T;
        fn wrap(item: ref T) -> Shared<T> { return Shared<T>{}; }
        fn __oncopy(self: ref Shared<T>) {}
        fn __destroy(self: ref Shared<T>) {}
      }
      struct Cfg { online: Shared<bool> }
      fn f(c: ref Cfg) {
        let v: bool = false;
        c.online = Shared<bool>::wrap(v);
      }
      fn main() -> int { return 0; }
    `);
  });
});
