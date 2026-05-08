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

describe("§4.1 — `ref T` is rejected as a return type", () => {
  test("safe function returning `ref T` is a compile error", () => {
    checkError(
      `
      struct Item { value: i32; }
      fn first(items: ref Item) -> ref Item {
        return items;
      }
      fn main() -> int { return 0; }
      `,
      "'ref T' is not allowed in function return type"
    );
  });

  test("`readonly ref T` is also rejected as a return type", () => {
    checkError(
      `
      struct Item { value: i32; }
      fn first(items: ref Item) -> readonly ref Item {
        return items;
      }
      fn main() -> int { return 0; }
      `,
      "'ref T' is not allowed in function return type"
    );
  });
});

// ─── §4.2 — `ref T` is not a struct field (in safe structs) ──────────────────

describe("§4.2 — `ref T` is rejected in safe-struct fields", () => {
  test("safe struct holding `ref T` is a compile error", () => {
    checkError(
      `
      struct Item { value: i32; }
      struct Holder {
        item: ref Item;
      }
      fn main() -> int { return 0; }
      `,
      "'ref T' is not allowed in safe struct field"
    );
  });
});

// ─── §4.3 — `&` and `*` are unsafe ───────────────────────────────────────────

describe("§4.3 — `&` and `*` operators are unsafe-only", () => {
  test("`&x` outside `unsafe` is a compile error", () => {
    checkError(
      `
      fn bad(x: i32) -> *i32 {
        return &x;
      }
      fn main() -> int { return 0; }
      `,
      "address-of operator '&' requires unsafe"
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
      "pointer dereference requires unsafe"
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

describe("§4.4 — `addr(...)` is unsafe-only", () => {
  test("`addr(field)` outside `unsafe` is a compile error", () => {
    checkError(
      `
      unsafe struct Box { value: ref i32; fn __destroy(self: ref Box) {} fn __oncopy(self: ref Box) {} }
      fn leak(b: ref Box) -> *i32 {
        return addr(b.value);
      }
      fn main() -> int { return 0; }
      `,
      "'addr(...)' requires unsafe"
    );
  });
});

// ─── §4.5 — Auto-deref through `ref T` reads the pointed-to value ─────────────

describe("§4.5 — auto-deref returns T, not ref T", () => {
  test("reading a field through `ref T` yields T", () => {
    checkOk(`
      struct Item { value: i32; }
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
      "type mismatch"
    );
  });
});

// ─── §4.6 — Type mismatch on Shared<T> field assignment ──────────────────────

describe("§4.6 — Shared<T> field assignment is explicit", () => {
  test("`field: T` on a `Shared<T>` field is rejected (no auto-deref)", () => {
    checkError(
      `
      unsafe struct Shared<T> {
        refcount: ref i64;
        value: ref T;
        fn __oncopy(self: ref Shared<T>) {}
        fn __destroy(self: ref Shared<T>) {}
      }
      struct Cfg { online: Shared<bool>; }
      fn turnOff(c: ref Cfg) {
        c.online = false;
      }
      fn main() -> int { return 0; }
      `,
      "type mismatch"
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
      struct Cfg { online: Shared<bool>; }
      fn turnOff(c: ref Cfg) {
        c.online.value = false;
      }
      fn main() -> int { return 0; }
    `);
  });
});

// ─── §4.7 — `init` only valid in `unsafe` ────────────────────────────────────

describe("§4.7 — `init` is unsafe-only at the field level", () => {
  test("`init` outside `unsafe` is a compile error", () => {
    checkError(
      `
      struct Item { value: i32; }
      fn build() -> Item {
        let i: Item = Item{ value: 0 };
        init i.value = 42;
        return i;
      }
      fn main() -> int { return 0; }
      `,
      "'init' requires unsafe"
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

describe("§4.10 — `Shared<T>` does not auto-deref recursively", () => {
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
      "type mismatch"
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

describe("§4.11 — `readonly` semantics", () => {
  test("`readonly T` field rejects reassignment", () => {
    // Use a plain assignment (not Shared::wrap) since we don't yet support
    // qualified static method calls. `c.online = otherShared` exercises the
    // readonly-field check just as well.
    checkError(
      `
      unsafe struct Shared<T> {
        refcount: ref i64;
        value: ref T;
        fn __oncopy(self: ref Shared<T>) {}
        fn __destroy(self: ref Shared<T>) {}
      }
      struct Cfg { readonly online: Shared<bool>; }
      fn f(c: ref Cfg, fresh: Shared<bool>) {
        c.online = fresh;
      }
      fn main() -> int { return 0; }
      `,
      "cannot assign to readonly field"
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
      struct Cfg { readonly online: Shared<bool>; }
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
      "readonly reference"
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

describe("ref-T position restrictions (consolidated)", () => {
  test("`ref T` is rejected in a local binding", () => {
    checkError(
      `
      struct Item { value: i32; }
      fn f(x: ref Item) {
        let r: ref Item = x;
      }
      fn main() -> int { return 0; }
      `,
      "'ref T' is not allowed in local binding"
    );
  });

  test("`ref T` is rejected as a generic argument", () => {
    checkError(
      `
      struct List<T> { items: T; }
      struct Item { value: i32; }
      fn f(x: List<ref Item>) { }
      fn main() -> int { return 0; }
      `,
      "'ref T' is not allowed in generic argument"
    );
  });
});

// ─── `mut` keyword removal ───────────────────────────────────────────────────

describe("`mut` keyword is removed", () => {
  // `mut` is rejected at the parser level — these sources fail to parse,
  // which propagates as an error from `check()` (the helper throws).
  test("`mut x: T` parameter form fails to parse", () => {
    expect(() => check(`fn f(mut x: int) { } fn main() -> int { return 0; }`)).toThrow();
  });

  test("`let mut x` fails to parse", () => {
    expect(() => check(`fn main() -> int { let mut x = 1; return x; }`)).toThrow();
  });

  test("`ref mut T` fails to parse", () => {
    expect(() => check(`fn f(x: ref mut int) { } fn main() -> int { return 0; }`)).toThrow();
  });
});

// ─── `slice<T>` removal ──────────────────────────────────────────────────────

describe("`slice<T>` is removed", () => {
  test("`slice<T>` parameter is a compile error", () => {
    const errs = errorsOf(
      check(`fn f(x: slice<i32>) { } fn main() -> int { return 0; }`)
    );
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]?.message).toContain("'slice<T>' was removed");
  });
});

// ─── `Shared<T>` end-to-end (semantics) ──────────────────────────────────────

describe("Shared<T> stdlib semantics — checker only (KIR/codegen pending)", () => {
  test("`Shared<T>.wrap(item)` typechecks (parser + static method dispatch)", () => {
    checkOk(`
      unsafe struct Shared<T> {
        refcount: ref i64;
        value: ref T;
        fn wrap(item: ref T) -> Shared<T> {
          let s = Shared<T>{};
          return s;
        }
        fn __oncopy(self: ref Shared<T>) {}
        fn __destroy(self: ref Shared<T>) {}
      }
      fn main() -> int {
        let n: i32 = 42;
        let s = Shared<i32>.wrap(n);
        return 0;
      }
    `);
  });
});

describe.skip("Shared<T> stdlib semantics — original placeholder (e2e + monomorphization pending)", () => {
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

// ─── Documented future work ──────────────────────────────────────────────────
//
// Each describe.skip / test.skip below pins a known limitation that the
// initial ref-redesign rollout deliberately deferred. Future PRs should
// flip these back on as the underlying feature lands. They exist so the
// remaining work is a checklist, not tribal knowledge.

describe.skip("future: auto-generated lifecycle hooks use `self: ref T` ABI", () => {
  // Auto-derived __destroy / __oncopy on a `struct` with managed fields
  // (e.g. `string`) currently emit `fn __destroy(self: T)` (by-value).
  // Per §3.1 / §07-structures the canonical ABI is `fn __destroy(self:
  // ref T)` returning void. User-defined hooks already accept the new
  // form; this is about flipping the COMPILER-generated ones too. Once
  // KIR's auto-destroy/oncopy emit the ref-self form, this test can
  // assert (against KIR or against the emitted C signature) that the
  // synthetic hook signature reads `Foo* self` rather than `Foo self`
  // followed by an implicit pointer wrap.
  test("auto-generated __destroy emits `self: ref T`", () => {
    // Marker test — fill in once the KIR auto-gen is flipped.
  });
});

describe.skip("future: parser supports `Type<T>.method(args)` on generic types", () => {
  // The parser parses `Identifier<TypeArgs>` followed by `(args)` (call)
  // or `{ ... }` (struct literal), but NOT `.method(args)`. Static method
  // calls on generic types like `Shared<i32>.wrap(n)` therefore don't
  // parse — the user's only options today are non-generic dispatch
  // (`Shared.wrap(n)`, which fails to bind T) or a workaround. Once
  // postfix-parser handles `.member` after a closing `>`, the
  // `Shared<T> stdlib semantics` describe and the e2e shared.test.ts
  // skeleton can be flipped on.
  test("Shared<i32>.wrap(n) parses and binds T = i32", () => {
    // Marker test.
  });
});

describe.skip("future: `ptr<T>` source form is rejected", () => {
  // The type-resolver still accepts `ptr<T>` as a back-compat path so
  // older fixtures continue working through the rollout. Per the
  // redesign the canonical raw-pointer spelling is `*T` and `ptr<T>`
  // should be rejected with a hint to migrate.
  test("`ptr<T>` parameter is a compile error pointing at `*T`", () => {
    // Marker test.
  });
});

describe.skip("future: `dynarray<T>` source form is rejected", () => {
  // Same back-compat story as `ptr<T>` — the keyword is still active
  // and the type-resolver routes it through the array path. Per the
  // redesign neither `dynarray` nor `slice` exist; only `Array<T>` and
  // `inline<T, N>` survive at the source level.
  test("`dynarray<T>` parameter is a compile error", () => {
    // Marker test.
  });
});

describe.skip("future: `mut` keyword fully removed from the lexer", () => {
  // `mut` is rejected at the parser level (parseParam doesn't accept
  // it, parseLetStatement doesn't accept it, parseType doesn't accept
  // `ref mut T`) — the existing `mut keyword is removed` cases pass.
  // Cosmetic follow-up: also drop `mut` from the active KEYWORD_MAP so
  // `mut` becomes a regular identifier. This test pins that future state.
  test("`mut` is a regular identifier (no keyword diagnostic)", () => {
    // Marker test.
  });
});

describe.skip("future: reverse-declaration-order destruction (§6.9)", () => {
  // The spec pins that fields are destroyed in reverse declaration
  // order. The auto-generated __destroy emits them in declaration
  // order today. Test would build a struct whose fields print on
  // destroy and assert the output is in reverse.
  test("struct with two managed fields destroys them in reverse order", () => {
    // Marker test.
  });
});

describe.skip("future: equality + sameHandle for `Shared<T>` (§6.5)", () => {
  // `==` on Shared<T> recursively compares fields (matches plain struct
  // equality). `sameHandle(a, b)` is a separate identity primitive that
  // pointer-compares the underlying allocation. Neither is implemented
  // yet — both depend on having a working Shared<T> end-to-end first.
  test("Shared<T> == Shared<T> compares by value", () => {
    // Marker test.
  });
  test("sameHandle(a, b) is true when a and b share the same allocation", () => {
    // Marker test.
  });
});

describe.skip("future: auto-last-use elision (§3.5)", () => {
  // When the caller does not use a value after a call, the compiler
  // should elide the oncopy/destroy pair: `f(s)` with `s` unused
  // afterwards becomes `f(move s)`. Requires liveness-style analysis
  // on the AST or KIR; not implemented in v1.
  test("last-use of `s` before the end of scope is treated as `move s`", () => {
    // Marker test.
  });
});

describe.skip("future: `copy(x)` builtin (§6.3) — depends on §3.5 first", () => {
  // `copy(x)` is the de-optimizer for auto-last-use elision (§3.5).
  // Without elision it's redundant: `let temp = a; takeOwnership(move
  // temp);` already does an explicit oncopy + move. With elision the
  // compiler can convert `takeOwnership(a)` into `takeOwnership(move
  // a)` when `a` isn't used after the call — at which point the user
  // needs a way to say "no, I want the oncopy, keep `a` alive":
  //
  //   takeOwnership(copy(a));  // bumps refcount; `a` survives
  //
  // Until §3.5 lands `copy()` is a no-op in user-visible behaviour, so
  // this stays a skipped marker.
  test("`copy(x)` keeps the source alive across an otherwise-eliding call", () => {
    // Marker test.
  });
});

describe.skip("future: `weak<T>` companion type (§6.8)", () => {
  // Non-owning reference-counted pointer for breaking cycles. Out of
  // scope for v1; depends on Shared<T> being real first.
  test("Weak<T> upgrade returns Shared<T>? (None when count == 0)", () => {
    // Marker test.
  });
});

describe.skip("future: SliceType cleanup", () => {
  // Source-level `slice<T>` is rejected (see "`slice<T>` is removed"
  // above), but the internal SliceType semantic representation and
  // the type-resolver's slice-related code paths still exist for
  // back-compat. Cleanup is internal and not user-visible.
  test("SliceType is removed from the internal type system", () => {
    // Marker test.
  });
});

describe.skip("future: discarded return value fires __destroy on the temporary", () => {
  // Confirmed gap as of the ref-redesign rollout: when a function's
  // return value is dropped at the statement level (no `let`, no
  // assignment, no further use), the temporary's `__destroy` is NOT
  // emitted. The bytes leak.
  //
  // Repro (run via the CLI):
  //
  //   unsafe struct Res {
  //     id: i32;
  //     fn __destroy(self: ref Res) { print(self.id); }
  //     fn __oncopy(self: ref Res) {}
  //   }
  //   fn make(id: i32) -> Res { return Res { id: id }; }
  //   fn main() -> int {
  //     make(42);   // discarded — `__destroy` should print 42
  //     print(99);
  //     return 0;
  //   }
  //
  // Expected stdout: "42\n99\n". Actual: "99\n".
  //
  // Fix lives in KIR lowering for ExprStmt where the expression's type
  // has a non-trivial __destroy: emit a temporary slot, store the call
  // result, then emit `destroy &temp` before the statement ends.
  test("discarded `make()` result destroys before the next statement runs", () => {
    // Marker test.
  });
});


