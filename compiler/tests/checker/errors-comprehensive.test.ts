import { describe, test } from "bun:test";
import { checkError, checkOk } from "./helpers.ts";

describe("Checker — Error Handling (comprehensive)", () => {
  // ── Single error type ──────────────────────────────────────────────────

  describe("function that throws single error type", () => {
    test("throw and catch single error type → ok", () => {
      checkOk(`
        struct FileError {}
        fn readFile() -> int throws FileError {
          throw FileError{};
        }
        fn main() -> int {
          let x = readFile() catch {
            FileError: return -1;
          };
          return x;
        }
      `);
    });

    test("throws with return value on success path → ok", () => {
      checkOk(`
        struct ParseError {}
        fn parseInt(s: string) -> int throws ParseError {
          if s == "" { throw ParseError{}; }
          return 42;
        }
        fn main() -> int {
          let x = parseInt("42") catch {
            ParseError: return -1;
          };
          return x;
        }
      `);
    });
  });

  // ── Multiple error types ───────────────────────────────────────────────

  describe("function that throws multiple error types", () => {
    test("throw first of two error types → ok", () => {
      checkOk(`
        struct NotFound {}
        struct Forbidden {}
        fn getResource(id: int) -> int throws NotFound, Forbidden {
          if id < 0 { throw NotFound{}; }
          if id == 0 { throw Forbidden{}; }
          return id;
        }
        fn main() -> int {
          let x = getResource(1) catch {
            NotFound: return -1;
            Forbidden: return -2;
          };
          return x;
        }
      `);
    });

    test("three error types all handled → ok", () => {
      checkOk(`
        struct A {}
        struct B {}
        struct C {}
        fn risky() -> int throws A, B, C {
          throw A{};
        }
        fn main() -> int {
          let x = risky() catch {
            A: return 1;
            B: return 2;
            C: return 3;
          };
          return x;
        }
      `);
    });

    test("three error types, one missing → error", () => {
      checkError(
        `
          struct A {}
          struct B {}
          struct C {}
          fn risky() -> int throws A, B, C {
            throw A{};
          }
          fn main() -> int {
            let x = risky() catch {
              A: return 1;
              B: return 2;
            };
            return x;
          }
        `,
        "unhandled error types: C"
      );
    });
  });

  // ── Catch block with correct type ──────────────────────────────────────

  describe("catch block with correct error type", () => {
    test("catch block binding accesses error fields → ok", () => {
      checkOk(`
        struct ConnError { code: int; msg: string; }
        fn connect() -> int throws ConnError {
          throw ConnError{ code: 500, msg: "timeout" };
        }
        fn main() -> int {
          let x = connect() catch {
            ConnError e: {
              let c = e.code;
              let m = e.msg;
              return c;
            };
          };
          return x;
        }
      `);
    });

    test("catch with wrong error type name → error", () => {
      checkError(
        `
          struct RealError {}
          fn fail() -> int throws RealError {
            throw RealError{};
          }
          fn main() -> int {
            let x = fail() catch {
              FakeError: return -1;
            };
            return x;
          }
        `,
        "is not thrown by the callee"
      );
    });
  });

  // ── Nested try/catch ───────────────────────────────────────────────────

  describe("nested try/catch", () => {
    test("catch throw chain through three functions → ok", () => {
      checkOk(`
        struct E {}
        fn level1() -> int throws E { throw E{}; }
        fn level2() -> int throws E {
          let x = level1() catch throw;
          return x;
        }
        fn level3() -> int throws E {
          let x = level2() catch throw;
          return x;
        }
        fn main() -> int {
          let x = level3() catch { E: return -1; };
          return x;
        }
      `);
    });

    test("inner catch block, outer catch panic → ok", () => {
      checkOk(`
        struct InnerErr {}
        struct OuterErr {}
        fn inner() -> int throws InnerErr {
          throw InnerErr{};
        }
        fn outer() -> int throws OuterErr {
          let x = inner() catch {
            InnerErr: return -1;
          };
          return x;
        }
        fn main() -> int {
          let x = outer() catch panic;
          return x;
        }
      `);
    });

    test("inner catch transforms error, outer catches different type → ok", () => {
      checkOk(`
        struct ParseErr {}
        struct AppErr {}
        fn parse() -> int throws ParseErr { throw ParseErr{}; }
        fn process() -> int throws AppErr {
          let x = parse() catch {
            ParseErr: throw AppErr{};
          };
          return x;
        }
        fn main() -> int {
          let x = process() catch { AppErr: return -1; };
          return x;
        }
      `);
    });
  });

  // ── Throwing inside if/else branches ───────────────────────────────────

  describe("throwing inside if/else branches", () => {
    test("throw in if branch → ok", () => {
      checkOk(`
        struct Err {}
        fn check(x: int) -> int throws Err {
          if x < 0 { throw Err{}; }
          return x;
        }
        fn main() -> int {
          let r = check(5) catch { Err: return -1; };
          return r;
        }
      `);
    });

    test("throw in else branch → ok", () => {
      checkOk(`
        struct Err {}
        fn check(x: int) -> int throws Err {
          if x >= 0 { return x; } else { throw Err{}; }
        }
        fn main() -> int {
          let r = check(5) catch { Err: return -1; };
          return r;
        }
      `);
    });

    test("throw in both if and else branches → ok", () => {
      checkOk(`
        struct NegErr {}
        struct ZeroErr {}
        fn validate(x: int) -> int throws NegErr, ZeroErr {
          if x < 0 {
            throw NegErr{};
          } else if x == 0 {
            throw ZeroErr{};
          }
          return x;
        }
        fn main() -> int {
          let r = validate(5) catch {
            NegErr: return -1;
            ZeroErr: return -2;
          };
          return r;
        }
      `);
    });

    test("throw in nested if/else → ok", () => {
      checkOk(`
        struct Err {}
        fn deep(x: int) -> int throws Err {
          if x > 0 {
            if x > 100 {
              throw Err{};
            }
            return x;
          }
          throw Err{};
        }
        fn main() -> int {
          let r = deep(5) catch { Err: return -1; };
          return r;
        }
      `);
    });
  });

  // ── Uncaught throw → checker error ─────────────────────────────────────

  describe("uncaught throw should be checker error", () => {
    test("throw in non-throws function → error", () => {
      checkError(
        `
          struct Err {}
          fn bad() -> int { throw Err{}; }
        `,
        "does not declare 'throws'"
      );
    });

    test("calling throws function without any catch → error", () => {
      checkError(
        `
          struct Err {}
          fn risky() -> int throws Err { throw Err{}; }
          fn main() -> int {
            let x = risky();
            return x;
          }
        `,
        "must use 'catch'"
      );
    });

    test("throw type not in throws clause → error", () => {
      checkError(
        `
          struct A {}
          struct B {}
          fn bad() -> int throws A { throw B{}; }
        `,
        "is not declared in function's throws clause"
      );
    });
  });

  // ── Void return with throws ────────────────────────────────────────────

  describe("void return with throws", () => {
    test("void throws function with catch block → ok", () => {
      checkOk(`
        struct IOErr {}
        fn write() throws IOErr {
          throw IOErr{};
        }
        fn main() -> int {
          write() catch { IOErr: return -1; };
          return 0;
        }
      `);
    });

    test("void throws function with catch panic → ok", () => {
      checkOk(`
        struct IOErr {}
        fn write() throws IOErr {
          throw IOErr{};
        }
        fn main() -> int {
          write() catch panic;
          return 0;
        }
      `);
    });
  });

  // ── Error types with fields ────────────────────────────────────────────

  describe("error types with fields", () => {
    test("error struct with multiple fields, binding accesses them → ok", () => {
      checkOk(`
        struct HttpError { status: int; body: string; }
        fn request() -> int throws HttpError {
          throw HttpError{ status: 404, body: "not found" };
        }
        fn main() -> int {
          let x = request() catch {
            HttpError e: return e.status;
          };
          return x;
        }
      `);
    });
  });

  // ── Default catch clause ───────────────────────────────────────────────

  describe("default catch clause", () => {
    test("default covers all remaining error types → ok", () => {
      checkOk(`
        struct A {}
        struct B {}
        struct C {}
        fn risky() -> int throws A, B, C { throw A{}; }
        fn main() -> int {
          let x = risky() catch {
            A: return 1;
            default: return -1;
          };
          return x;
        }
      `);
    });

    test("default alone covers everything → ok", () => {
      checkOk(`
        struct X {}
        struct Y {}
        fn foo() -> int throws X, Y { throw X{}; }
        fn main() -> int {
          let x = foo() catch {
            default: return -1;
          };
          return x;
        }
      `);
    });
  });
});
